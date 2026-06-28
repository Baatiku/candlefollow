# Besta Bot — Development Progress Log

> This document is the canonical record of every bug fix, feature, and architectural change
> made to Besta Bot. It is ordered chronologically, newest at the top.
> Reference this when returning to a new session so nothing needs to be re-explained.

---

## Session 3 — Security & Reliability Audit + Fixes
**Commit:** `a9ff9e5c` — "Add security and reliability improvements"

### What was audited
A full 6-parallel-explorer audit covered: architecture, security, trading logic, API layer,
frontend, and state persistence. Ten issues were found and prioritised. All ten were fixed.

### Fixes applied

#### Fix 1 — Atomic state writes + rolling backup (CRITICAL)
**File:** `src/bot_state_store.py`
- `_write_store_file()` previously used `open(path, "w")` which truncates the file immediately.
  A crash mid-write leaves a zero-byte or partial JSON file; on next boot the state was silently
  wiped (debt, tier, step all reset to zero).
- **Fix:** Write to a `.tmp` file in the same directory, then `os.replace()` which is atomic on
  all POSIX systems and Windows NTFS.
- **Also added:** Before overwriting, a `.bak` copy of the previous good state is kept using
  `shutil.copy2`. On load failure, the code now tries `.bak` before giving up.
- **Also added:** A module-level `_store_lock = threading.Lock()` wraps every `save_state`,
  `load_state`, and `clear_all_accounts` call. Previously the FastAPI web thread and the trading
  loop thread could both call `save_state` concurrently; the RMW cycle had no protection and one
  thread's write would silently overwrite the other.

#### Fix 2 — Replace `eval()` with `json.loads()` (CRITICAL)
**File:** `src/gui.py` (lines 149 and 209)
- Both occurrences of `eval()` used to parse tier lists from user input (e.g. `"[2, 5, 11]"`)
  were replaced with `json.loads()`.
- **Why critical:** Combined with the unprotected `/api/config` POST, an attacker could send
  `{"budget_tiers": "__import__('os').system('rm -rf /')" }` and execute arbitrary code on the
  server running the bot.

#### Fix 3 — API key authentication for all write endpoints (CRITICAL)
**Files:** `src/api.py`, `src/config.py`
- Added `BOT_API_KEY = os.getenv("BOT_API_KEY", "")` to `config.py`.
- Added `_require_api_key` FastAPI `Depends` function to `api.py`:
  - If `BOT_API_KEY` env var is empty → auth is **disabled** (backward-compatible default).
  - If set → any request to a protected endpoint without `X-API-Key: <key>` header gets 401.
- **Protected endpoints:** `/api/start`, `/api/stop`, `/api/pause`, `/api/resume`, `/api/reset`,
  `/api/config`, `/api/reconnect`, `/api/account`, `/api/trigger-optimization`, `/api/learn-pattern`.
- **Unprotected (read-only):** `/api/status`, `/api/trades`, `/api/config` GET, `/api/accounts`,
  `/api/assets`, `/api/analytics` — these must remain open so the dashboard polling works.

#### Fix 4 — CORS restricted via env var (HIGH)
**Files:** `src/api.py`, `src/config.py`
- `allow_origins=["*"]` replaced with `allow_origins=ALLOWED_ORIGINS` where `ALLOWED_ORIGINS`
  is read from `os.getenv("ALLOWED_ORIGINS", "*")` (comma-separated list).
- Default remains `*` to avoid breaking existing deployments. Set in Railway env vars to lock down.

#### Fix 5 — `update_config` locked against trading-loop race (HIGH)
**File:** `src/api.py`
- `/api/config` POST now holds `_lifecycle_lock` while calling `bot.update_config()`.
- Previously, a config update (changing `budget_tiers`) could modify the tier list while the
  trading loop thread was mid-calculation in `_compute_round_bet()`, causing `IndexError`.

#### Fix 6 — Mid-ladder asset stall auto-stop (MEDIUM)
**File:** `src/strategies/double_martingale.py`
- Added `self._midladder_stall_since = None` to `__init__` and `_clear_ephemeral_session_state`.
- In the prep-scan "no qualifying strikes" branch:
  - If `session_round_count > 0` (mid-ladder), start the stall timer.
  - Log a warning every minute with elapsed time.
  - After **30 minutes** of continuous stalling: set `self.running = False` and break the loop
    with `last_stop_reason = "Mid-ladder stall: no tradeable strikes for 30 minutes"`.
  - Reset timer to `None` when valid strikes are found.
- **Why:** Without this, if the chosen asset becomes untradeable mid-ladder (market closes,
  profit% drops), the bot loops indefinitely in `_skip_to_next_entry_window` with capital locked.

#### Fix 7 — Log endpoints return proper HTTP status codes (MEDIUM)
**File:** `src/api.py`
- `/api/ai-optimization-logs` and `/api/ai-evaluator-logs` previously returned `200 OK` with
  `{"error": "..."}` in the body when the log file didn't exist.
- Now return `HTTPException(404)` for missing files and `HTTPException(500)` for read errors.

#### Fix 8 — Frontend `loadAssetList` throttled (LOW)
**File:** `frontend/src/App.jsx`
- `loadAssetList()` was called redundantly: in the init `useEffect`, from `saveConfig()`, and
  in the `[status?.connected, status?.running]` effect — potentially multiple times per minute.
- **Fix:** Added `_lastAssetLoadRef = useRef(0)`. Function returns early if called within 60
  seconds of the last successful call.

---

## Session 2 — Debt/Earnings Display + Session Profit Fixes
**Commit:** `9443af7f` — "Improve tracking of session profits and debt calculations"

### Bug 1 — "Session P/L" always showed $0.00
- Added `session_total_profit` field that accumulates all session results and **never resets**.
- The dashboard's "Session P/L" card now reads from `session_total_profit` instead of
  `session_profit` (which resets every martingale cycle).

### Bug 2 — Debt inflated by double-counting losses
- Replaced cycle-based `_apply_cycle_profit_to_debt()` with per-round tracking:
  - Win: `cumulative_debt -= round_profit` immediately
  - Loss: `cumulative_debt += abs(round_profit)`
- Old path caused losses to be penalised twice.

### Bug 3 — Reconciled losses after restart didn't add to debt
- In `_reconcile_inflight_trades()`, loss path now explicitly adds `abs(total_profit)` to
  `cumulative_debt`. Win path now reduces debt directly.

### Bug 4 — Partial fills invisible to Session P/L
- Added `self.session_total_profit += partial_profit` in the partial fill path.

### Bug 5 — Window P/L was stale on restart
- `window_profit` is no longer restored from saved state. Always initialised to `0.0` on load.

### Tier ceiling bug fix
- Removed balance-based tier cap from `_apply_risk_tier_caps` so tier escalation after
  exhaustion works regardless of current balance.

### Tier retreat fix
- `_apply_balance_ladder_downgrade` now retreats to **previous tier Step 1** (not same-tier
  cheaper step) when balance can't cover the scheduled step.

### Reset button fix
- Error message now shows inside the confirmation panel.
- Button shows "Resetting…" during the operation.

---

## Session 1 — Initial Bot Architecture
The base bot was built across multiple earlier sessions. Key modules:

| File | Purpose |
|------|---------|
| `src/strategies/double_martingale.py` | ~6000-line monolith: all trading logic |
| `src/api.py` | ~900-line FastAPI app + all endpoints |
| `src/bot_state_store.py` | State persistence to `data/bot_state.json` |
| `src/config.py` | All environment variable configuration |
| `src/connection.py` | IQ Option API connection + reconnect logic |
| `src/pair_learning.py` | Per-asset entry gate tuning from trade history |
| `src/entry_pattern_learning.py` | Pattern-based entry learning |
| `src/risk_governor.py` | Safety limits (max debt, balance-based tier floors) |
| `src/ai_assessment.py` | Gemini AI trade assessment (optional) |
| `src/ai_agents.py` | Multi-agent AI optimisation pipeline |
| `src/ensemble.py` | Bot+AI ensemble confidence scoring |
| `src/trade_log.py` | JSONL trade log read/write/export |
| `src/trade_pattern_analysis.py` | Win/loss pattern analysis |
| `src/licensing.py` | Supabase-backed token system with HWID binding |
| `src/gui.py` | CustomTkinter desktop GUI |
| `src/main.py` | Desktop entry point |
| `src/simulator.py` | Session simulator for backtesting |
| `src/market_metrics.py` | ATR, efficiency ratio, momentum calculations |
| `src/standalone_iq.py` | IQ Option connection outside main bot loop |
| `src/notifier.py` | Telegram/notification hooks |
| `frontend/src/App.jsx` | React/Vite dashboard (~1400 lines) |
| `website/index.html` | Marketing landing page |
| `website/style.css` | Landing page styles |
| `website/BestaBot.exe` | Pre-built Windows executable |
| `supabase/migrations/` | Supabase schema for token table |
| `railway.toml` | Railway deployment config |

---

## Known Issues / Not Yet Fixed

| Issue | Severity | Notes |
|-------|----------|-------|
| Timeout trades assumed as losses | HIGH | Phantom win causes ladder to over-escalate. Fix requires checking IQ position history instead of assuming loss on timeout. |
| State snapshot not atomic with trade accounting | MEDIUM | `persist_state()` reads debt/step without lock — a crash between debt update and step increment creates inconsistent recovery. Needs a `_persist_lock` on the bot class. |
| Reconciliation uses `current_bet` not actual staked amount | MEDIUM | After crash + tier escalation, `current_bet` may be wrong tier. Fix: store bet amount alongside order IDs in `_inflight_trade_ids`. |
| `/api/reset` blocks up to 90s | MEDIUM | Ties up a FastAPI worker thread. Fix: convert to async background task. |
| `/api/trades/export` has no cap | LOW | Can OOM if log has 50k+ entries. Fix: hard cap at 10k or paginate. |
| `/api/reconnect` returns 200 before connection succeeds | LOW | Returns "Reconnect started" immediately. Fix: return a job ID and poll. |
| Frontend shows "Connecting…" forever if API is down | LOW | No retry button or error state. |
| `window_profit` label has no 15-min boundary indicator | LOW | Users don't know when the window resets. |
