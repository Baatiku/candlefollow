"""Fetch and normalize IQ Option digital position history."""
from __future__ import annotations

import contextlib
import logging
import re
import time
from datetime import datetime, timezone
from typing import Any, Iterator

import iqoptionapi.constants as OP_code

logger = logging.getLogger(__name__)

ACTIVE_ID_TO_SYMBOL = {v: k for k, v in OP_code.ACTIVES.items()}
_INSTRUMENT_ACTIVE_RE = re.compile(r"^do(\d+)A", re.I)

ASSET_ALIASES = {
    "GBPJPY": "GBPJPY-OTC",
    "EURNZD": "EURNZD-OTC",
    "AUDJPY": "AUDJPY-OTC",
    "EURUSD": "EURUSD-OTC",
    "EURJPY": "EURJPY-OTC",
}


def normalize_asset_symbol(symbol: str | None) -> str | None:
    if not symbol:
        return None
    clean = re.sub(r"[^A-Za-z0-9]", "", str(symbol)).upper()
    if OP_code.ACTIVES.get(clean):
        return clean
    if clean.endswith("OTC") and not clean.endswith("-OTC"):
        base = clean[:-3]
        otc = f"{base}-OTC"
        if OP_code.ACTIVES.get(otc):
            return otc
        if ASSET_ALIASES.get(base):
            return ASSET_ALIASES[base]
    for base, otc in ASSET_ALIASES.items():
        if base in clean:
            return otc
    base = clean.replace("-OTC", "")
    return ASSET_ALIASES.get(base) or (clean if OP_code.ACTIVES.get(clean) else None)


def asset_matches_filter(symbol: str | None, filters: list[str]) -> bool:
    if not filters:
        return True
    if not symbol:
        return False
    sym = normalize_asset_symbol(symbol) or symbol
    bases = {f.replace("-OTC", "").upper() for f in filters}
    sym_base = sym.replace("-OTC", "").upper()
    return sym in filters or sym_base in bases


def _ms_to_iso(ms: int | float | None) -> str | None:
    if ms is None:
        return None
    try:
        sec = float(ms) / 1000.0 if float(ms) > 1e12 else float(ms)
        return datetime.fromtimestamp(sec, tz=timezone.utc).isoformat()
    except (TypeError, ValueError, OSError):
        return None


def _active_id_from_instrument(instrument_id: str | None) -> int | None:
    if not instrument_id:
        return None
    m = _INSTRUMENT_ACTIVE_RE.match(str(instrument_id))
    if m:
        return int(m.group(1))
    return None


def build_active_id_cache(api, active_ids: set[int]) -> dict[int, str]:
    """Resolve tournament/digital active_ids to symbols (cached per fetch)."""
    cache = dict(ACTIVE_ID_TO_SYMBOL)
    for aid in sorted(active_ids):
        if aid in cache and cache[aid]:
            cache[aid] = normalize_asset_symbol(cache[aid]) or cache[aid]
            continue
        if not api:
            continue
        try:
            info = api.get_name_by_activeId(aid)
            if info:
                name = str(info).split(".")[-1].strip()
                sym = normalize_asset_symbol(name) or normalize_asset_symbol(
                    name.replace("/", "")
                )
                if sym:
                    cache[aid] = sym
                    OP_code.ACTIVES[sym] = aid
                    logger.info("Mapped active_id %s -> %s", aid, sym)
        except Exception as e:
            logger.warning("Could not resolve active_id %s: %s", aid, e)
    return cache


def _symbol_from_position(pos: dict, id_cache: dict[int, str]) -> str | None:
    raw = pos.get("raw_event") or pos.get("instrument_underlying") or pos.get("underlying")
    if isinstance(raw, str) and raw:
        sym = normalize_asset_symbol(raw if raw in OP_code.ACTIVES else f"{raw}-OTC")
        if sym:
            return sym

    active = pos.get("active_id") or pos.get("instrument_active_id")
    if active is None:
        active = _active_id_from_instrument(pos.get("instrument_id"))
    if active is not None:
        aid = int(active)
        sym = id_cache.get(aid)
        if sym:
            return normalize_asset_symbol(sym)
    return None


def _position_pnl(pos: dict) -> float:
    """Net P/L for a closed digital leg (IQ fields vary by account type)."""
    if pos.get("pnl_realized") is not None:
        try:
            return float(pos["pnl_realized"])
        except (TypeError, ValueError):
            pass
    if pos.get("pnl") is not None:
        try:
            return float(pos["pnl"])
        except (TypeError, ValueError):
            pass
    invest = float(pos.get("invest", 0) or pos.get("amount", 0) or 0)
    close_profit = pos.get("close_profit")
    if close_profit is not None:
        try:
            cp = float(close_profit)
            if invest > 0 and cp > invest * 2:
                return cp - invest
            if invest > 0:
                return cp - invest
            return cp
        except (TypeError, ValueError):
            pass
    return 0.0


def _close_timestamp(pos: dict) -> float | None:
    for key in ("close_time", "closed_at", "close_timestamp", "updated_at", "created_at"):
        val = pos.get(key)
        if val is None:
            continue
        try:
            ts = float(val)
            return ts / 1000.0 if ts > 1e12 else ts
        except (TypeError, ValueError):
            continue
    return None


def normalize_positions(raw_msg: Any, api=None, id_cache: dict[int, str] | None = None) -> list[dict]:
    """Flatten IQ portfolio history payload into uniform dicts."""
    if raw_msg is None:
        return []
    items = raw_msg
    if isinstance(raw_msg, dict):
        items = (
            raw_msg.get("positions")
            or raw_msg.get("items")
            or raw_msg.get("history")
            or raw_msg.get("msg")
            or []
        )
    if not isinstance(items, list):
        return []

    if id_cache is None:
        active_ids = set()
        for pos in items:
            if not isinstance(pos, dict):
                continue
            aid = pos.get("active_id") or _active_id_from_instrument(pos.get("instrument_id"))
            if aid is not None:
                active_ids.add(int(aid))
        id_cache = build_active_id_cache(api, active_ids)

    out = []
    for pos in items:
        if not isinstance(pos, dict):
            continue
        pnl = round(_position_pnl(pos), 2)
        close_ts = _close_timestamp(pos)
        symbol = _symbol_from_position(pos, id_cache)
        direction = (pos.get("direction") or pos.get("type") or "").lower()
        out.append(
            {
                "symbol": symbol,
                "direction": direction,
                "pnl": pnl,
                "won": pnl > 0,
                "invest": float(pos.get("invest", 0) or pos.get("amount", 0) or 0),
                "close_ts": close_ts,
                "close_iso": _ms_to_iso(close_ts * 1000 if close_ts else None),
                "status": pos.get("status") or pos.get("close_reason"),
                "order_id": pos.get("id") or pos.get("order_id"),
                "active_id": pos.get("active_id"),
                "raw": pos,
            }
        )
    return out


@contextlib.contextmanager
def temporary_balance(api, balance_id: int) -> Iterator[None]:
    """Fetch history for a specific IQ balance without leaving the bot on that account."""
    from iqoptionapi.stable_api import global_value

    prev = global_value.balance_id
    try:
        global_value.balance_id = int(balance_id)
        if hasattr(api, "position_change_all"):
            if prev is not None:
                api.position_change_all("unsubscribeMessage", prev)
            api.position_change_all("subscribeMessage", int(balance_id))
        yield
    finally:
        if prev is not None:
            global_value.balance_id = prev
            if hasattr(api, "position_change_all"):
                api.position_change_all("unsubscribeMessage", int(balance_id))
                api.position_change_all("subscribeMessage", prev)


def fetch_digital_history_paginated(
    api,
    *,
    balance_id: int | None = None,
    days_back: int = 90,
    max_positions: int = 500,
    page_size: int = 100,
) -> tuple[bool, list[dict], str]:
    """Pull as much closed digital history as IQ allows (paginated)."""
    if not api:
        return False, [], "not connected"

    end = int(time.time())
    start = end - days_back * 86400
    all_positions: list[dict] = []
    offset = 0
    pages = 0
    raw_batches: list = []

    def _fetch_page():
        return api.get_position_history_v2(
            "digital-option", min(page_size, 100), offset, start, end
        )

    ctx = temporary_balance(api, balance_id) if balance_id else contextlib.nullcontext()
    try:
        with ctx:
            while pages < 20:
                try:
                    ok, msg = _fetch_page()
                except Exception as e:
                    if pages == 0:
                        try:
                            ok, msg = api.get_position_history("digital-option")
                        except Exception as e2:
                            return False, [], str(e2)
                    else:
                        break
                if not ok:
                    if pages == 0:
                        return False, [], "history request failed"
                    break
                raw_batches.append(msg)
                batch_items = msg
                if isinstance(msg, dict):
                    batch_items = (
                        msg.get("positions")
                        or msg.get("items")
                        or msg.get("history")
                        or msg.get("msg")
                        or []
                    )
                if not batch_items:
                    break
                pages += 1
                offset += page_size
                if len(batch_items) < page_size:
                    break

            all_items = []
            for raw in raw_batches:
                if isinstance(raw, dict):
                    chunk = (
                        raw.get("positions")
                        or raw.get("items")
                        or raw.get("history")
                        or raw.get("msg")
                        or []
                    )
                else:
                    chunk = raw if isinstance(raw, list) else []
                all_items.extend(chunk)

            active_ids = set()
            for pos in all_items:
                if isinstance(pos, dict):
                    aid = pos.get("active_id") or _active_id_from_instrument(
                        pos.get("instrument_id")
                    )
                    if aid is not None:
                        active_ids.add(int(aid))
            id_cache = build_active_id_cache(api, active_ids)
            for raw in raw_batches:
                all_positions.extend(normalize_positions(raw, api=api, id_cache=id_cache))

    except Exception as e:
        return False, [], str(e)

    all_positions.sort(key=lambda p: p.get("close_ts") or 0, reverse=True)
    mapped = sum(1 for p in all_positions if p.get("symbol"))
    note = (
        f"{len(all_positions)} positions over {days_back}d ({pages} page(s)), "
        f"{mapped} mapped to symbols"
    )
    return True, all_positions[:max_positions], note


def fetch_digital_history(
    api,
    *,
    limit: int = 50,
    days_back: int = 14,
    balance_id: int | None = None,
) -> tuple[bool, list[dict], str]:
    ok, positions, note = fetch_digital_history_paginated(
        api,
        balance_id=balance_id,
        days_back=days_back,
        max_positions=limit,
        page_size=min(limit, 100),
    )
    return ok, positions, note


def group_positions_into_rounds(positions: list[dict], window_sec: int = 90) -> list[dict]:
    """Group single-leg history rows into approximate straddle rounds by asset + time."""
    sorted_pos = sorted(
        [p for p in positions if p.get("symbol") and p.get("close_ts")],
        key=lambda p: p["close_ts"],
    )
    rounds = []
    bucket: list[dict] = []

    def flush():
        nonlocal bucket
        if not bucket:
            return
        total_pnl = sum(p["pnl"] for p in bucket)
        symbols = {p["symbol"] for p in bucket}
        rounds.append(
            {
                "asset": next(iter(symbols)),
                "close_ts": max(p["close_ts"] for p in bucket),
                "close_iso": _ms_to_iso(max(p["close_ts"] for p in bucket) * 1000),
                "round_profit": round(total_pnl, 2),
                "leg_count": len(bucket),
                "legs": bucket,
                "source": "iq_history",
            }
        )
        bucket = []

    for pos in sorted_pos:
        if not bucket:
            bucket = [pos]
            continue
        same_asset = pos["symbol"] == bucket[0]["symbol"]
        close_delta = abs(pos["close_ts"] - bucket[-1]["close_ts"])
        if same_asset and close_delta <= window_sec:
            bucket.append(pos)
        else:
            flush()
            bucket = [pos]
    flush()
    return rounds


def positions_to_single_trades(
    positions: list[dict], asset_filters: list[str] | None = None
) -> list[dict]:
    """Each closed leg = one trade (best for tournament / manual digital history)."""
    trades = []
    for pos in positions:
        sym = pos.get("symbol")
        if not sym or not pos.get("close_ts"):
            continue
        if asset_filters and not asset_matches_filter(sym, asset_filters):
            continue
        pnl = float(pos.get("pnl", 0))
        trades.append(
            {
                "asset": sym,
                "close_ts": pos["close_ts"],
                "close_iso": pos.get("close_iso"),
                "round_profit": round(pnl, 2),
                "won": pnl > 0,
                "direction": pos.get("direction"),
                "invest": pos.get("invest"),
                "leg_count": 1,
                "source": "iq_leg",
            }
        )
    trades.sort(key=lambda t: t.get("close_ts") or 0, reverse=True)
    return trades
