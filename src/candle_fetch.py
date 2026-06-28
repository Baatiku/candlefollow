"""Bulk historical candle fetch for pattern learning (few API calls per pair)."""
from __future__ import annotations

import logging
import time
from collections import defaultdict
from typing import Callable

import iqoptionapi.constants as OP_code

from market_metrics import entry_snapshot_from_candles

logger = logging.getLogger(__name__)

_MAX_CANDLES_PER_REQUEST = 1000
_CHUNK_MINUTES = 480


def _candle_epoch(c: dict) -> int:
    t = c.get("from") or c.get("at") or 0
    if not t:
        return 0
    t = int(t)
    if t > 1_000_000_000_000:
        t //= 1000
    return t


def _prepare_candle_api(api) -> None:
    try:
        if hasattr(api, "get_all_init"):
            api.get_all_init()
    except Exception as e:
        logger.debug("get_all_init skipped: %s", e)


def _active_id_for_asset(asset: str) -> int | None:
    aid = OP_code.ACTIVES.get(asset)
    if aid is None:
        return None
    try:
        return int(aid)
    except (TypeError, ValueError):
        return None


def _fetch_candles(api, asset: str, end_ts: float, count: int) -> list[dict]:
    """Low-level candle fetch with timeout (avoids library reconnect loop)."""
    active_id = _active_id_for_asset(asset)
    if not active_id:
        logger.warning("No active_id registered for %s — run history fetch first", asset)
        return []

    count = min(max(int(count), 5), _MAX_CANDLES_PER_REQUEST)
    end_ts = int(end_ts)

    for attempt in range(2):
        try:
            if hasattr(api, "check_connect") and not api.check_connect():
                api.connect()
            api.api.candles.candles_data = None
            api.api.getcandles(active_id, 60, count, end_ts)
            deadline = time.time() + 15
            while time.time() < deadline:
                data = api.api.candles.candles_data
                if data is not None:
                    return sorted(data, key=_candle_epoch)
                time.sleep(0.08)
        except Exception as e:
            logger.warning(
                "Candle fetch %s (id=%s, end=%s, n=%s) attempt %s: %s",
                asset,
                active_id,
                end_ts,
                count,
                attempt + 1,
                e,
            )
            if attempt == 0:
                try:
                    api.connect()
                except Exception:
                    pass
                time.sleep(2)
    return []


def _snapshot_at_entry(all_candles: list[dict], entry_ts: float, candle_count: int) -> dict | None:
    if not all_candles:
        return None
    window = [c for c in all_candles if _candle_epoch(c) <= entry_ts]
    if len(window) < 3:
        return None
    return entry_snapshot_from_candles(window[-candle_count:])


def build_entry_snapshot_cache(
    api,
    trades: list[dict],
    *,
    entry_offset_sec: int = 75,
    candle_count: int = 20,
    pause_sec: float = 0.45,
    max_keys: int = 350,
    on_progress: Callable[[int, int], None] | None = None,
) -> tuple[dict[tuple, dict | None], dict]:
    """
    For each trade, reconstruct chart state at entry from bulk candle pulls (per asset).
    Returns (cache, stats).
    """
    keys_needed: dict[tuple, float] = {}
    for t in trades:
        asset = t.get("asset")
        close_ts = t.get("close_ts")
        if not asset or not close_ts:
            continue
        entry_ts = close_ts - entry_offset_sec
        bucket = int(entry_ts // 60)
        key = (asset, bucket)
        if key not in keys_needed:
            keys_needed[key] = entry_ts

    _prepare_candle_api(api)

    items = list(keys_needed.items())
    if len(items) > max_keys:
        # Keep most recent unique minutes (more relevant + smaller API span)
        items.sort(key=lambda x: x[1], reverse=True)
        items = items[:max_keys]

    by_asset: dict[str, list[tuple[tuple, float]]] = defaultdict(list)
    for key, entry_ts in items:
        asset, _bucket = key
        by_asset[asset].append((key, entry_ts))

    cache: dict[tuple, dict | None] = {}
    reconnects = 0
    api_calls = 0
    done = 0
    total_keys = len(items)

    for asset, asset_items in by_asset.items():
        entry_times = sorted({et for _, et in asset_items})
        chunks: list[list[float]] = []
        i = 0
        while i < len(entry_times):
            chunks.append(entry_times[i : i + _CHUNK_MINUTES])
            i += _CHUNK_MINUTES

        asset_candles: list[dict] = []
        for chunk in chunks:
            end_ts = max(chunk) + 60
            span_min = int((max(chunk) - min(chunk)) / 60) + candle_count + 5
            count = min(max(span_min, 30), _MAX_CANDLES_PER_REQUEST)
            batch = _fetch_candles(api, asset, end_ts, count)
            api_calls += 1
            if on_progress:
                on_progress(min(done + len(chunk), total_keys), total_keys)
            time.sleep(pause_sec)
            if batch:
                # Merge batches; dedupe by minute
                seen = {_candle_epoch(c) for c in asset_candles}
                for c in batch:
                    ep = _candle_epoch(c)
                    if ep and ep not in seen:
                        asset_candles.append(c)
                        seen.add(ep)
                asset_candles.sort(key=_candle_epoch)
            else:
                reconnects += 1

        for key, entry_ts in asset_items:
            cache[key] = _snapshot_at_entry(asset_candles, entry_ts, candle_count)
            done += 1

    stats = {
        "unique_minutes": len(items),
        "cached": sum(1 for v in cache.values() if v),
        "api_calls": api_calls,
        "reconnects": reconnects,
    }
    return cache, stats


def attach_snapshots_to_trades(
    trades: list[dict],
    cache: dict[tuple, dict | None],
    entry_offset_sec: int = 75,
) -> list[dict]:
    out = []
    for t in trades:
        asset = t.get("asset")
        close_ts = t.get("close_ts")
        snap = None
        if asset and close_ts:
            bucket = int((close_ts - entry_offset_sec) // 60)
            snap = cache.get((asset, bucket))
        out.append({**t, "entry_snapshot": snap, "metrics": snap})
    return out
