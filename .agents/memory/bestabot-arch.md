---
name: BestaBot architecture
description: Key design decisions for the Besta Bot FastAPI + React trading dashboard.
---

## Auth pattern (BOT_API_KEY)
Write endpoints use `Depends(_require_api_key)` which checks the `X-API-Key` header against `BOT_API_KEY` env var. If `BOT_API_KEY` is empty the check is skipped (backward-compatible). Read/status endpoints are unprotected.

## License gate
`license_gate` middleware in `api.py` intercepts all `/api/*` calls except a whitelist of read-only paths. Returns 403 if `_license_valid` is False. `LicenseManager` lives in `src/licensing.py`. Frontend shows `LicenseGate` overlay when `/api/license/status` returns `valid: false` OR when `/api/status` returns `license_valid: false`.

## Lifecycle lock
`_lifecycle_lock` (threading.Lock) must wrap every operation that starts, stops, or reconfigures the trading thread — including the `/api/config` POST. Without it, concurrent config updates and start/stop calls race on the same bot instance.

## Atomic state writes
`bot_state_store.py` writes via `.tmp` → `os.replace()` with a `.bak` backup. A module-level `_store_lock` prevents RMW races between the trading thread and FastAPI web thread.

## Strategy monolith
`src/strategies/double_martingale.py` is ~7100 lines. The `src/strategies/` subdirectories (`mixins/`, `ladder/`, `execution/`, `market/`, `risk/`, `analysis/`) are scaffolded stubs for the planned modularisation — do NOT move live code there without following `docs/ARCHITECTURE_REFACTOR.md` step-by-step.

**Why:** Partial extraction breaks the monolith without completing it, leaving a mix of old and new import paths that is harder to debug than either state alone.

## Signal gate pipeline (directional_trend mode)
Gates run in order; any failure calls `_skip_to_next_entry_window()` or `continue`:
1. Volatility/suitability — `_assess_straddle_suitability()` (ER, slope, movement, momentum)
2. AI/rule confidence gate — `check_rule_based_entry_gate()` or AI ensemble — inside `try` block (~lines 5870–6257)
3. **Enhanced conviction gate** — `check_enhanced_conviction()` — at END of same `try` block (~lines 6258–6296), 28-space indentation inside the try

**try/except indentation rule:** `try:` is at 24sp, content at 28sp, `except:` at 24sp. The conviction gate MUST be at 28sp (inside try) — at 24sp it's between `try` and `except` which is a SyntaxError.

## Enhanced conviction gate (5 signal quality improvements)
Functions added to `src/ensemble.py`: `compute_signal_coherence()` + `check_enhanced_conviction()`.
Config constants in `config.py` (all env-overridable): `ENHANCED_CONVICTION_ENABLED`, `MIN_CANDLE_BODY_QUALITY` (0.15), `MIN_SIGNAL_COHERENCE` (0.22), `MIN_SIGNAL_COHERENCE_STEP3` (0.38), `MIN_ALIGNED_SIGNALS_STEP3` (2), `MIN_RECENT_WIN_RATE_STEP3` (0.25), `MIN_RECENT_TRADES_FOR_RATE` (4), `PAIR_RECENT_RESULT_WINDOW` (6).

- **Feature 1 (direction consistency)** — slope alignment weighted 35% in coherence score
- **Feature 2 (composite conviction)** — `compute_signal_coherence()`: slope 35% + ER 25% + momentum 20% + body 20%
- **Feature 3 (candle body quality)** — `candle_body_quality()` in `market_metrics.py`; body/range ratio, floor 0.15; also added to `entry_snapshot_from_candles()` return dict
- **Feature 4 (recent asset momentum)** — `_pair_recent_results` dict in bot (per-asset rolling True/False list); at step 3+, win rate < 25% over last 4+ trades skips
- **Feature 5 (step direction agreement)** — step 3+: requires 2/3 signals (slope direction, momentum ≥0.80, body ≥0.28) aligned with trade direction

`body_quality` data path: `_score_asset_movement()` → returned in its dict → forwarded by `_assess_straddle_suitability()` → stored in `self.last_pair_quality` → read by conviction gate.
`_pair_recent_results` init/clear: `__init__` and `_clear_ephemeral_session_state()` (alongside `_pair_win_er_history`). Updated after each round outcome.
