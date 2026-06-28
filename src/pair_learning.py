"""Automatic per-pair learning from bot trade log (all accounts combined)."""
from __future__ import annotations

import json
import logging
import os
import threading
import time
from collections import defaultdict
from datetime import datetime, timezone

from entry_pattern_learning import analyze_entry_patterns
_DEFAULT_MIN_ER = 0.25
_DEFAULT_MIN_SLOPE = 12.0
from trade_log import read_trades

logger = logging.getLogger(__name__)

DEFAULT_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "data", "pair_learning.json"
)

_MIN_TRADES_PER_PAIR = 25
_MIN_SNAPSHOTS = 15
_REFRESH_DEBOUNCE_SEC = 45.0

_lock = threading.Lock()
_last_refresh = 0.0
_pending_refresh = False
_refresh_running = False

_DB_KEY = "pair_learning"


def _db_conn():
    url = os.environ.get("DATABASE_URL")
    if not url:
        return None
    try:
        import psycopg2
        return psycopg2.connect(url)
    except Exception as e:
        logger.warning("Pair learning DB connection failed: %s", e)
        return None


def _ensure_db_table():
    conn = _db_conn()
    if not conn:
        return
    try:
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS kv_store (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """)
        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        logger.warning("Failed to ensure kv_store table: %s", e)
        try:
            conn.close()
        except Exception:
            pass


_ensure_db_table()


def store_path() -> str:
    return os.environ.get("PAIR_LEARNING_PATH", DEFAULT_PATH)


def load_pair_learning() -> dict:
    conn = _db_conn()
    if conn:
        try:
            cur = conn.cursor()
            cur.execute("SELECT value FROM kv_store WHERE key = %s", (_DB_KEY,))
            row = cur.fetchone()
            cur.close()
            conn.close()
            if row:
                data = json.loads(row[0])
                return data if isinstance(data, dict) else {"pairs": {}, "updated_at": None}
        except Exception as e:
            logger.warning("Pair learning DB load failed, falling back to file: %s", e)
            try:
                conn.close()
            except Exception:
                pass

    path = store_path()
    if not os.path.exists(path):
        return {"pairs": {}, "updated_at": None}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {"pairs": {}}
    except Exception as e:
        logger.warning("Could not load pair learning: %s", e)
        return {"pairs": {}, "updated_at": None}


def save_pair_learning(data: dict) -> str:
    data["updated_at"] = datetime.now(timezone.utc).isoformat()

    conn = _db_conn()
    if conn:
        try:
            cur = conn.cursor()
            cur.execute(
                """
                INSERT INTO kv_store (key, value, updated_at)
                VALUES (%s, %s, now())
                ON CONFLICT (key) DO UPDATE
                    SET value = EXCLUDED.value,
                        updated_at = now()
                """,
                (_DB_KEY, json.dumps(data))
            )
            conn.commit()
            cur.close()
            conn.close()
        except Exception as e:
            logger.warning("Pair learning DB save failed: %s", e)
            try:
                conn.close()
            except Exception:
                pass

    path = store_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    return path


def _trades_for_learning(limit: int = 600) -> list[dict]:
    """All completed bot rounds with snapshots — any account, keyed by pair."""
    rows = []
    for t in read_trades(limit=limit, account_key=None):
        if t.get("partial"):
            continue
        asset = t.get("asset")
        snap = t.get("entry_snapshot")
        if not asset or not snap:
            continue
        ts = t.get("entry_ts") or t.get("ts")
        close_ts = None
        if isinstance(ts, (int, float)):
            close_ts = float(ts)
        elif isinstance(ts, str):
            try:
                close_ts = datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
            except ValueError:
                close_ts = time.time()
        rows.append(
            {
                "asset": asset,
                "round_profit": float(t.get("round_profit", 0)),
                "entry_snapshot": snap,
                "metrics": snap,
                "close_ts": close_ts or time.time(),
            }
        )
    return rows


def refresh_pair_learning(*, force: bool = False) -> dict:
    """Rebuild per-pair gates from the global trade log."""
    global _last_refresh

    with _lock:
        now = time.time()
        if not force and now - _last_refresh < _REFRESH_DEBOUNCE_SEC:
            return load_pair_learning()
        _last_refresh = now

    trades = _trades_for_learning()
    by_asset: dict[str, list[dict]] = defaultdict(list)
    for t in trades:
        by_asset[t["asset"]].append(t)

    pairs_out = {}
    for asset, asset_trades in by_asset.items():
        total = len(asset_trades)
        if total < _MIN_TRADES_PER_PAIR:
            continue
        with_snap = [t for t in asset_trades if t.get("entry_snapshot")]
        if len(with_snap) < _MIN_SNAPSHOTS:
            continue

        pattern = analyze_entry_patterns(with_snap)
        wins = sum(1 for t in asset_trades if float(t.get("round_profit", 0)) > 0)
        losses = total - wins
        bot_rules = dict(pattern.get("bot_rules") or {})
        bot_rules.pop("focus_assets", None)
        bot_rules.pop("caution_assets", None)

        win_rate = wins / total * 100 if total else 0
        pairs_out[asset] = {
            "wins": wins,
            "losses": losses,
            "win_rate_pct": round(win_rate, 1),
            "trades_with_snapshots": pattern.get("trades_with_snapshots", len(with_snap)),
            "bot_rules": bot_rules,
            "chart_summary": pattern.get("chart_summary"),
            "gate_accuracy": pattern.get("gate_accuracy"),
        }

    store = {
        "pairs": pairs_out,
        "trade_count": len(trades),
        "notes": "Auto-learned from bot trades (all accounts). Rules apply on every account.",
    }
    save_pair_learning(store)
    logger.info(
        "Pair learning updated: %s pairs from %s trades",
        len(pairs_out),
        len(trades),
    )
    return store


def schedule_refresh():
    """Debounced background refresh after a trade is logged.
    At most one thread sleeps at a time (_pending_refresh gate) and at most one
    refresh runs at a time (_refresh_running gate), preventing overlapping runs
    on high trade-frequency sessions.
    """
    global _pending_refresh, _refresh_running

    def _run():
        global _pending_refresh, _refresh_running
        time.sleep(_REFRESH_DEBOUNCE_SEC)
        with _lock:
            if not _pending_refresh:
                _refresh_running = False
                return
            _pending_refresh = False
        try:
            refresh_pair_learning()
        except Exception as e:
            logger.warning("Pair learning refresh failed: %s", e)
        finally:
            with _lock:
                _refresh_running = False

    with _lock:
        if _pending_refresh or _refresh_running:
            # A thread is already sleeping or refresh is in progress;
            # just mark that another run is needed after it finishes.
            _pending_refresh = True
            return
        _pending_refresh = True
        _refresh_running = True
    threading.Thread(target=_run, daemon=True, name="pair-learning").start()


def effective_gates_for_asset(asset: str | None, store: dict | None = None) -> dict:
    """Default straddle gates merged with per-pair learned thresholds."""
    store = store if store is not None else load_pair_learning()
    gates = {
        "min_efficiency_ratio": _DEFAULT_MIN_ER,
        "min_directional_slope": _DEFAULT_MIN_SLOPE,
    }
    if not asset:
        return gates

    rules = ((store.get("pairs") or {}).get(asset) or {}).get("bot_rules") or {}
    gates["min_efficiency_ratio"] = max(
        gates["min_efficiency_ratio"],
        float(rules.get("min_efficiency_ratio", gates["min_efficiency_ratio"])),
    )
    gates["min_directional_slope"] = max(
        gates["min_directional_slope"],
        float(rules.get("min_directional_slope", gates["min_directional_slope"])),
    )
    if rules.get("min_momentum_ratio") is not None:
        gates["min_momentum_ratio"] = float(rules["min_momentum_ratio"])
    if rules.get("max_doji_streak") is not None:
        gates["max_doji_streak"] = int(rules["max_doji_streak"])
    if rules.get("min_movement_score") is not None:
        gates["min_movement_score"] = float(rules["min_movement_score"])
    return gates


def clear_pair_learning_store(reason: str = "manual clear") -> dict:
    """Wipe learned per-pair gates (e.g. after account reset with trade log cleared)."""
    store = {
        "pairs": {},
        "trade_count": 0,
        "notes": reason,
    }
    save_pair_learning(store)
    logger.info("Pair learning store cleared (%s)", reason)
    return store


def pair_learning_summary() -> dict:
    store = load_pair_learning()
    pairs = store.get("pairs") or {}
    return {
        "updated_at": store.get("updated_at"),
        "pair_count": len(pairs),
        "trade_count": store.get("trade_count"),
        "pairs": {
            asset: {
                "win_rate_pct": p.get("win_rate_pct"),
                "wins": p.get("wins"),
                "losses": p.get("losses"),
                "gates": p.get("bot_rules"),
            }
            for asset, p in pairs.items()
        },
    }
