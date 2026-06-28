# Besta Bot — Modularisation Plan
## Breaking the Monoliths into Maintainable Modules

> The two largest files — `double_martingale.py` (~6000 lines) and `api.py` (~900 lines) —
> are too large to maintain, test, or extend without risking regressions.
> This document defines the exact split: what goes where, why, and in what order.
>
> DO NOT implement this refactor in a single session. Work through it module by module,
> running the bot after each extraction to verify nothing broke.

---

## Guiding Principles

1. **Behaviour does not change.** The refactor is purely structural. No logic changes, no new
   features. If a line of code moves, it moves verbatim.
2. **Extract by responsibility.** Each module does exactly one thing. Names should be so obvious
   that you can guess what's inside without opening the file.
3. **The `DoubleMartingaleBot` class stays whole.** Only its methods are re-homed into mixins.
   The class itself inherits from all mixins, so all existing call sites (`self.xxx()`) work
   without change.
4. **Test after each extraction.** After moving each section, restart the bot and let it run one
   full entry window. If it connects and places/simulates a trade, the extraction is safe.
5. **Keep `__init__.py` re-exports.** Every new package exposes the same public symbols via
   `__init__.py` so `api.py` import lines do not change.

---

## Part 1 — Strategy Refactor

### Current state
```
src/strategies/
└── double_martingale.py   (~6000 lines — EVERYTHING in one file)
```

### Target state
```
src/strategies/
├── __init__.py                    # Re-exports DoubleMartingaleBot, STANDARD_BUDGET_TIERS
├── bot.py                         # Class definition + __init__ + top-level run() call
├── loop.py                        # The main while-loop body (run() method internals)
├── mixins/
│   ├── __init__.py
│   ├── config_mixin.py            # update_config, _apply_standard_budget_tiers, _save_config_history
│   ├── connection_mixin.py        # connect, disconnect, reconnect, warm_up_market_feed, is_session_ready
│   ├── account_mixin.py           # switch_trading_account, _state_account_key, active_balance_id
│   └── state_mixin.py             # persist_state, get_state, full_system_reset, _default_trading_state
├── ladder/
│   ├── __init__.py
│   ├── tiers.py                   # _compute_round_bet, _apply_risk_tier_caps, _advance_tier
│   ├── debt.py                    # cumulative_debt updates, session_total_profit, window_profit
│   ├── escalation.py              # tier escalation after exhaustion, _apply_balance_ladder_downgrade
│   └── reconciliation.py          # _reconcile_inflight_trades, _finalize_session
├── execution/
│   ├── __init__.py
│   ├── trade_placer.py            # _place_straddle, _place_directional, _buy_option
│   ├── result_checker.py          # _check_trade_result, timeout handling, partial fills
│   └── pullback.py                # intra-expiry pullback / sniper re-entry logic
├── market/
│   ├── __init__.py
│   ├── price_feed.py              # _install_price_sniffer, _price_data, _subscribe, _unsubscribe
│   ├── asset_selector.py          # auto_select_asset, list_tradeable_asset_symbols, _pick_best_asset
│   └── timing.py                  # entry window, _wait_for_next_entry, _skip_to_next_entry_window
├── risk/
│   ├── __init__.py
│   ├── drawdown.py                # drawdown breaker, risk_mode, DRAWDOWN_* config
│   ├── balance.py                 # safe_get_balance, _refresh_balance_cache, _balance_lock
│   └── profit_lock.py             # locked_profit ratchet, session_peak_balance
└── analysis/
    ├── __init__.py
    ├── gates.py                   # straddle gates, _passes_straddle_gates, efficiency ratio checks
    ├── direction.py               # _determine_trend_direction, trend reversal filter
    ├── strike_selector.py         # _get_best_strikes, _get_best_directional_strike
    └── candles.py                 # candle fetching wrappers, ATR/momentum calculations
```

---

### Module-by-Module Extraction Guide

#### Step 1.1 — Extract `analysis/candles.py`
**What moves:** All functions that fetch and process candles from IQ Option.
- `_fetch_candles(asset, period, count)`
- `_compute_atr(candles)`
- `_compute_efficiency_ratio(candles)`
- `_compute_momentum_ratio(candles)`
- Candle caching logic

**Why first:** These are pure utility functions with no dependencies on other bot methods.
Easiest to test in isolation.

**Pattern:**
```python
# analysis/candles.py
class CandleMixin:
    def _fetch_candles(self, asset, period, count):
        # ... verbatim move from double_martingale.py
```

```python
# bot.py
from strategies.analysis.candles import CandleMixin
class DoubleMartingaleBot(CandleMixin, ...):
    pass
```

---

#### Step 1.2 — Extract `analysis/gates.py`
**What moves:** All entry gate checks.
- `_passes_straddle_gates(strikes, candles)`
- Efficiency ratio threshold check
- ATR threshold check
- Momentum ratio check
- Doji streak check
- Trader mood check
- `_compute_straddle_score()`

**Dependencies:** Requires `CandleMixin` (from 1.1).

---

#### Step 1.3 — Extract `analysis/direction.py`
**What moves:** Trend direction determination for directional_trend mode.
- `_determine_trend_direction(candles, last_direction)`
- Slope calculation
- Reversal filter
- Directional confidence scoring

**Dependencies:** Requires `CandleMixin`.

---

#### Step 1.4 — Extract `analysis/strike_selector.py`
**What moves:** Strike selection logic.
- `_get_best_strikes(period, for_entry_timing)` — straddle mode
- `_get_best_directional_strike(direction, for_entry_timing)` — directional mode
- `_filter_strikes_by_profit_pct(strikes)`
- Strike scoring and ranking

**Dependencies:** Requires `CandleMixin`, `GatesMixin`, `DirectionMixin`.

---

#### Step 1.5 — Extract `market/price_feed.py`
**What moves:** WebSocket price sniffer.
- `_install_price_sniffer()`
- `_on_price_message(message)` — the overridden WS handler
- `_price_data` dict and `_price_lock`
- `_subscribe(asset_id)`
- `_unsubscribe(asset_id)`

**Note:** `_price_lock` must stay on `self` (it's accessed from multiple threads).
Move the initialisation to `__init__` in `PriceFeedMixin.__init__()` and call
`super().__init__()` — standard Python MRO pattern.

---

#### Step 1.6 — Extract `market/timing.py`
**What moves:** Entry window timing.
- `_wait_for_next_entry()`
- `_skip_to_next_entry_window(reason)`
- `_past_entry_hard_abort()`
- `_too_late_to_place()`
- `_placement_deadline_second()`
- `_server_second()`
- `_server_timestamp()`
- `_sync_clock()`

**Dependencies:** No other mixins required. Only uses `self.api` and timing constants.

---

#### Step 1.7 — Extract `market/asset_selector.py`
**What moves:** Asset selection and switching.
- `auto_select_asset` logic
- `list_tradeable_asset_symbols()`
- `_pick_best_asset()`
- `_score_asset(asset)`
- Asset penalty box management
- Pair filter skip streak tracking

**Dependencies:** Requires `PriceFeedMixin` (to subscribe/unsubscribe).

---

#### Step 1.8 — Extract `risk/balance.py`
**What moves:** Balance tracking.
- `safe_get_balance()`
- `_refresh_balance_cache(allow_blocking)`
- `_cached_balance` and `_balance_lock`

---

#### Step 1.9 — Extract `risk/profit_lock.py`
**What moves:** Profit lock / ratchet.
- `_update_profit_lock()`
- `session_peak_balance`
- `locked_profit`
- All `PROFIT_LOCK_*` config references

---

#### Step 1.10 — Extract `risk/drawdown.py`
**What moves:** Drawdown breaker / risk mode.
- `_check_drawdown_breaker()`
- `risk_mode_until`
- `_enter_risk_mode()`
- `_exit_risk_mode()`
- All `DRAWDOWN_*` config references

**Dependencies:** Requires `BalanceMixin`.

---

#### Step 1.11 — Extract `ladder/debt.py`
**What moves:** Debt and profit tracking.
- `cumulative_debt` update logic (win path, loss path)
- `session_total_profit` accumulation
- `window_profit` management
- `_apply_window_profit_reset()`

---

#### Step 1.12 — Extract `ladder/tiers.py`
**What moves:** Tier and step mathematics.
- `_compute_round_bet()`
- `_apply_risk_tier_caps()`
- `_apply_standard_budget_tiers()`
- `STANDARD_BUDGET_TIERS` constant
- Straddle multiplier application

**Dependencies:** Requires `DebtMixin`, `BalanceMixin`.

---

#### Step 1.13 — Extract `ladder/escalation.py`
**What moves:** Tier escalation and retreat.
- `_advance_tier()` — after exhaustion, move to next tier
- `_apply_balance_ladder_downgrade()` — retreat to previous tier if balance insufficient
- `tier_escalations_today` tracking
- `tier_failure_streak` tracking
- `tier_exhaustion_cooldown_until` logic

**Dependencies:** Requires `TiersMixin`, `BalanceMixin`.

---

#### Step 1.14 — Extract `ladder/reconciliation.py`
**What moves:** Crash recovery.
- `_reconcile_inflight_trades()`
- `_finalize_session(result)` — the session win/loss handler
- `_resuming_mid_ladder` handling

**Dependencies:** Requires `DebtMixin`, `TiersMixin`.

---

#### Step 1.15 — Extract `execution/result_checker.py`
**What moves:** Trade result polling.
- `_check_trade_result(order_id, call_info, put_info)`
- Timeout → loss handling
- Partial fill handling
- `_parse_position_result(position_data)`

**Dependencies:** Requires `DebtMixin`.

---

#### Step 1.16 — Extract `execution/pullback.py`
**What moves:** Intra-expiry pullback / sniper re-entry.
- `_monitor_intra_expiry(call_info, put_info)`
- Pullback order placement
- `_pullback_order_ids` tracking

---

#### Step 1.17 — Extract `execution/trade_placer.py`
**What moves:** Order placement.
- `_place_straddle(call_strike, put_strike, amount, expiry)`
- `_place_directional(direction, strike, amount, expiry)`
- `_buy_option(direction, asset, amount, expiry)` — the actual API call
- `_inflight_trade_ids` management
- `_round_in_flight` flag management

**Dependencies:** Requires `TimingMixin`, `BalanceMixin`.

---

#### Step 1.18 — Extract `mixins/state_mixin.py`
**What moves:** Persistence and state reporting.
- `persist_state(reason)`
- `get_state(thread_alive)` — the dict returned by `/api/status`
- `full_system_reset(clear_trade_log, reason)`
- `_default_trading_state()`
- `_clear_ephemeral_session_state()`

---

#### Step 1.19 — Extract `mixins/config_mixin.py`
**What moves:** Runtime configuration updates.
- `update_config(new_config, skip_history, tag)`
- `_save_config_history()`
- `config_history` list

---

#### Step 1.20 — Extract `mixins/connection_mixin.py`
**What moves:** IQ Option connection lifecycle.
- `connect(force_reconnect)`
- `disconnect()`
- `warm_up_market_feed()`
- `is_session_ready()`
- `_connecting` flag management
- `_connect_lock`

---

#### Step 1.21 — Extract `mixins/account_mixin.py`
**What moves:** Account switching.
- `switch_trading_account(account_type, balance_id)`
- `_state_account_key()`
- `active_balance_id`

---

#### Step 1.22 — Assemble `bot.py`

```python
# src/strategies/bot.py
from strategies.mixins.connection_mixin import ConnectionMixin
from strategies.mixins.account_mixin import AccountMixin
from strategies.mixins.config_mixin import ConfigMixin
from strategies.mixins.state_mixin import StateMixin
from strategies.market.price_feed import PriceFeedMixin
from strategies.market.asset_selector import AssetSelectorMixin
from strategies.market.timing import TimingMixin
from strategies.risk.balance import BalanceMixin
from strategies.risk.profit_lock import ProfitLockMixin
from strategies.risk.drawdown import DrawdownMixin
from strategies.ladder.debt import DebtMixin
from strategies.ladder.tiers import TiersMixin
from strategies.ladder.escalation import EscalationMixin
from strategies.ladder.reconciliation import ReconciliationMixin
from strategies.execution.trade_placer import TradePlacerMixin
from strategies.execution.result_checker import ResultCheckerMixin
from strategies.execution.pullback import PullbackMixin
from strategies.analysis.candles import CandleMixin
from strategies.analysis.gates import GatesMixin
from strategies.analysis.direction import DirectionMixin
from strategies.analysis.strike_selector import StrikeSelectorMixin

class DoubleMartingaleBot(
    ConnectionMixin,
    AccountMixin,
    ConfigMixin,
    StateMixin,
    PriceFeedMixin,
    AssetSelectorMixin,
    TimingMixin,
    BalanceMixin,
    ProfitLockMixin,
    DrawdownMixin,
    DebtMixin,
    TiersMixin,
    EscalationMixin,
    ReconciliationMixin,
    TradePlacerMixin,
    ResultCheckerMixin,
    PullbackMixin,
    CandleMixin,
    GatesMixin,
    DirectionMixin,
    StrikeSelectorMixin,
):
    def __init__(self, asset, ...):
        # All __init__ code verbatim from current double_martingale.py
        ...
```

---

#### Step 1.23 — Extract `loop.py`

The `run()` method body is ~1500 lines. Extract the main while loop into `loop.py`:

```python
# src/strategies/loop.py
class LoopMixin:
    def run(self):
        # verbatim content of current run() method
        ...
```

Add `LoopMixin` to `DoubleMartingaleBot`'s inheritance list.

---

#### Step 1.24 — `__init__.py` re-exports

```python
# src/strategies/__init__.py
from strategies.bot import DoubleMartingaleBot
from strategies.ladder.tiers import STANDARD_BUDGET_TIERS

__all__ = ["DoubleMartingaleBot", "STANDARD_BUDGET_TIERS"]
```

This means `api.py` import line `from strategies.double_martingale import DoubleMartingaleBot`
changes to simply `from strategies import DoubleMartingaleBot` — a one-line change.

---

## Part 2 — API Refactor

### Current state
```
src/
└── api.py   (~900 lines — all endpoints + middleware + startup in one file)
```

### Target state
```
src/api/
├── __init__.py          # Re-exports `app` for uvicorn
├── app.py               # FastAPI app creation, CORS middleware, startup event
├── auth.py              # _require_api_key dependency
├── deps.py              # Shared bot instance, _lifecycle_lock, _thread_alive()
├── thread_manager.py    # _start_trading_thread, _run_bot_wrapper, _sync_running_flag
└── routes/
    ├── __init__.py
    ├── bot_control.py   # POST /start, /stop, /pause, /resume, /reconnect
    ├── reset.py         # POST /reset, GET /health
    ├── status.py        # GET /status
    ├── config.py        # GET /config, POST /config
    ├── trades.py        # GET /trades, GET /trades/export, GET /analytics
    ├── accounts.py      # GET /accounts, POST /account
    ├── assets.py        # GET /assets
    ├── ai.py            # GET /ai-comparison, POST /trigger-optimization, GET /ai-*-logs
    └── learning.py      # POST /learn-pattern, GET /pattern-analysis
```

---

### Module-by-Module Extraction Guide

#### Step 2.1 — Extract `api/auth.py`

```python
# src/api/auth.py
import os
from fastapi import HTTPException, Header

def _require_api_key(x_api_key: str = Header(default="")):
    key = os.environ.get("BOT_API_KEY", "")
    if key and x_api_key != key:
        raise HTTPException(status_code=401, detail="Invalid or missing X-API-Key header")
```

---

#### Step 2.2 — Extract `api/deps.py`

```python
# src/api/deps.py
import threading
import time
from strategies import DoubleMartingaleBot
from config import IQ_ACCOUNT_TYPE, TRADING_MODE

bot = DoubleMartingaleBot(...)   # The singleton bot instance
bot_thread: threading.Thread = None
_lifecycle_lock = threading.Lock()
_start_time = time.time()

def _thread_alive() -> bool:
    global bot_thread
    return bot_thread is not None and bot_thread.is_alive()
```

All route modules import `from api.deps import bot, bot_thread, _lifecycle_lock, _thread_alive`.

---

#### Step 2.3 — Extract `api/thread_manager.py`

```python
# src/api/thread_manager.py
"""Manages the trading loop background thread lifecycle."""
from api.deps import bot, bot_thread, _lifecycle_lock, _thread_alive

def _start_trading_thread() -> bool: ...
def _run_bot_wrapper(): ...
def _sync_running_flag() -> bool: ...
def _wait_for_trading_thread_stop(timeout=120.0) -> bool: ...
def _should_auto_start() -> bool: ...
```

---

#### Step 2.4 — Extract `api/routes/bot_control.py`

Routes: `POST /api/start`, `POST /api/stop`, `POST /api/pause`, `POST /api/resume`,
`POST /api/reconnect`

```python
# src/api/routes/bot_control.py
from fastapi import APIRouter, HTTPException, Depends
from api.auth import _require_api_key
from api.deps import bot, _lifecycle_lock, _thread_alive
from api.thread_manager import _start_trading_thread, _wait_for_trading_thread_stop

router = APIRouter()

@router.post("/start")
def start_bot(...):
    ...
```

---

#### Step 2.5 — Extract remaining route modules

Each route file follows the same pattern: `router = APIRouter()` then route decorators.
The routes are identical to the current `api.py` — just moved.

| File | Routes |
|------|--------|
| `routes/reset.py` | `POST /reset`, `GET /health` |
| `routes/status.py` | `GET /status` |
| `routes/config.py` | `GET /config`, `POST /config` |
| `routes/trades.py` | `GET /trades`, `GET /trades/export`, `GET /analytics`, `GET /trade-history-analytics`, `GET /simulate` |
| `routes/accounts.py` | `GET /accounts`, `POST /account`, `POST /balance/refresh` |
| `routes/assets.py` | `GET /assets` |
| `routes/ai.py` | `GET /ai-comparison`, `POST /trigger-optimization`, `GET /ai-optimization-logs`, `GET /ai-evaluator-logs` |
| `routes/learning.py` | `POST /learn-pattern`, `GET /pattern-analysis` |

---

#### Step 2.6 — Assemble `api/app.py`

```python
# src/api/app.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from config import ALLOWED_ORIGINS

from api.routes import bot_control, reset, status, config, trades, accounts, assets, ai, learning

app = FastAPI(title="Besta Bot API")
app.add_middleware(CORSMiddleware, allow_origins=ALLOWED_ORIGINS, ...)

# Register all routers
app.include_router(bot_control.router, prefix="/api")
app.include_router(reset.router, prefix="/api")
app.include_router(status.router, prefix="/api")
app.include_router(config.router, prefix="/api")
app.include_router(trades.router, prefix="/api")
app.include_router(accounts.router, prefix="/api")
app.include_router(assets.router, prefix="/api")
app.include_router(ai.router, prefix="/api")
app.include_router(learning.router, prefix="/api")

# Static file serving (frontend build)
...

@app.on_event("startup")
def startup_event():
    ...
```

#### Step 2.7 — `api/__init__.py`

```python
# src/api/__init__.py
from api.app import app
__all__ = ["app"]
```

Update `railway.toml` and the workflow start command from:
```
uvicorn src.api:app
```
to:
```
uvicorn src.api:app   ← stays the same! __init__.py re-exports `app`
```

---

## Part 3 — Other Files to Split

### `src/trade_log.py` (medium priority)

Currently handles reading, writing, exporting, and analytics in one ~500-line file.
Split into:
```
src/trade_log/
├── __init__.py      # Re-exports all public functions
├── writer.py        # append_trade(), write_partial_fill()
├── reader.py        # read_trades(), read_trades_for_export()
├── exporter.py      # export_trades_csv()
└── analytics.py     # analytics(), per-asset statistics
```

### `src/config.py` (low priority)

Already reasonable at ~160 lines. Consider splitting into:
```
src/config/
├── __init__.py      # Re-exports everything
├── iq.py            # IQ Option credentials and account settings
├── strategy.py      # Entry windows, profit %, tier thresholds
├── ai.py            # Gemini/AI configuration
├── risk.py          # Drawdown, profit lock, step score settings
└── security.py      # BOT_API_KEY, ALLOWED_ORIGINS
```

---

## Refactor Execution Order

Do NOT attempt the whole refactor at once. Work through it in this order, verifying after each:

```
Week 1:
  1.1  candles.py           (pure utility, no risk)
  1.2  gates.py             (depends on 1.1 only)
  1.3  direction.py         (depends on 1.1 only)
  1.4  strike_selector.py   (depends on 1.1, 1.2, 1.3)

Week 2:
  1.5  price_feed.py        (isolated — no mixin deps)
  1.6  timing.py            (isolated — only uses self.api)
  1.8  balance.py           (isolated)
  1.9  profit_lock.py       (depends on 1.8)

Week 3:
  1.10 drawdown.py          (depends on 1.8)
  1.11 debt.py              (isolated)
  1.12 tiers.py             (depends on 1.11, 1.8)
  1.13 escalation.py        (depends on 1.12, 1.8)

Week 4:
  1.14 reconciliation.py    (depends on 1.11, 1.12)
  1.15 result_checker.py    (depends on 1.11)
  1.16 pullback.py          (isolated)
  1.17 trade_placer.py      (depends on 1.6, 1.8)
  1.7  asset_selector.py    (depends on 1.5)

Week 5:
  1.18 state_mixin.py       (depends on all above)
  1.19 config_mixin.py      (depends on 1.12, 1.7)
  1.20 connection_mixin.py  (isolated)
  1.21 account_mixin.py     (isolated)
  1.22 Assemble bot.py
  1.23 Extract loop.py
  1.24 __init__.py

Week 6 (if strategy is stable):
  API refactor (Steps 2.1–2.7)
  trade_log split
```

---

## Testing After Each Step

After each extraction, run this checklist before moving to the next:

1. `cd src && python -c "from strategies import DoubleMartingaleBot; b = DoubleMartingaleBot('GBPJPY-OTC'); print('OK')"` — no import errors
2. Restart the workflow — no startup errors in logs
3. Dashboard loads and shows status correctly
4. Simulation mode: start the bot, let it enter one window, verify a trade is "placed" (simulated)
5. Stop bot cleanly
6. Check `data/bot_state.json` is written correctly

If any step fails: **revert the extraction** (git checkout the file), identify the dependency
that was missed, and re-do the split including that dependency.

---

## What NOT to Change During Refactor

- `src/bot_state_store.py` — already clean and correct, no split needed
- `src/connection.py` — stays separate (referenced by both bot and standalone_iq)
- `src/licensing.py` — already a clean single-purpose module
- `src/risk_governor.py` — already separate
- `src/pair_learning.py` — already separate
- `frontend/` — untouched during backend refactor
- `website/` — untouched during backend refactor
- `data/` — no changes to data formats

---

## File Size Targets After Refactor

| File | Current | Target |
|------|---------|--------|
| `strategies/double_martingale.py` | ~6000 lines | DELETED |
| `strategies/bot.py` | — | ~400 lines |
| `strategies/loop.py` | — | ~1500 lines |
| Largest mixin | — | <500 lines |
| `api.py` | ~900 lines | DELETED |
| `api/app.py` | — | ~80 lines |
| Largest route module | — | <200 lines |
