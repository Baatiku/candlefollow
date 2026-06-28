# IQ Option Double Martingale Trading Bot Framework

**IMPORTANT: NEVER DELETE THIS FILE.**

This document is the single source of truth for trading logic. Read it before changing `double_martingale.py`, `pair_learning.py`, `api.py`, or order sizing.

---

## 1. Project Goal & Core Strategy

- **Instrument:** Digital options only (never classic Binary).
- **Each round:** Simultaneous OTM **CALL + PUT** on the same 1-minute expiry, same dollar amount per leg (placed **concurrently** via thread pool).
- **Strike selection:** Centered straddle around live spot — closest qualifying CALL above spot and closest qualifying PUT below spot (see Section 3). **No trend skew**, no asymmetric “insurance” legs.

### Fixed bet ladders (ONLY allowed order sizes)

Bet amounts are **hard-coded**. No dynamic sizing, no debt multipliers, no custom tiers, no `balance/200` scaling. `_validate_bet_amount()` rejects any other value before sending to IQ Option.

| Tier | Steps (per leg) | Base pattern |
|------|-----------------|--------------|
| **1–10** | 3 each | Generated in `STANDARD_BUDGET_TIERS` |

**Ladder math:** each tier base **doubles** the previous (`5→10→20…`). Within a tier: step2 ≈ `base×2.25`, step3 = `base×5`. Example: Tier 1 `$5→$11→$25`, Tier 5 `$80→$180→$400`, Tier 10 `$2560→$5760→$12800`.

**Balance baseline floor** (no debt / after debt cleared) — never play *below* this tier:

| Balance | Baseline tier |
|---------|---------------|
| &lt; $1,000 | Tier 1 |
| $1,000 – $2,999 | Tier 2 |
| $3,000 – $7,999 | Tier 3 |
| $8,000 – $19,999 | Tier 4 |
| ≥ $20,000 | Tier 5 |

Tiers **6–10** are recovery-only (escalation after exhaustions). Floor adjusts when balance crosses thresholds (up or down).

### Ladder rules (continuous trading — no session timer)

- `session_round_count` = **0-based index** into the current tier’s step array (UI/logs may show “step” as `session_round_count + 1`).
- **Win** (at least one leg profitable, round net P/L ≥ 0):
  1. Apply `session_profit` to `cumulative_debt`.
  2. If `cumulative_debt <= 0` → **balance baseline tier step 1**.
  3. If debt remains → **Stay on assigned tier, step 1** (e.g. stay on Tier 2 until debt cleared). **Never** escalate on a win.
- **Loss** (both legs lose): advance one step on the **same** tier only (`session_round_count += 1`). **Never** escalate on a single loss.
- **Tier exhausted** (all 3 steps lost without a win): cooldown, then retry assigned tier. After **2 full exhaustions** on the same assigned tier, escalate **one** tier only (step 1). **15-minute evaluation windows do not escalate tiers** — only exhaustion counts.
- **Partial fill** (only one leg): ladder does **not** advance; P/L still updates debt.

**Removed:** “Replay winning step” when session P/L was negative — wins always return to step 1.

### Debt

1. After each cycle (win or tier exhausted), apply `session_profit` to `cumulative_debt`.
2. **Never** escalate tier except on **Tier exhausted** (all steps lost).
3. With `cumulative_debt == 0`, never play below the **balance baseline** tier.
4. When debt is fully recovered → **baseline tier step 1** (from balance thresholds).
5. If balance cannot cover the scheduled step, play the highest affordable ladder step (may be below floor for that round only). Bot stops if balance &lt; minimum affordable round.

### Debt vs tier (summary)

- **Debt** = ledger of recovery still owed from past losing sessions. It controls **which tier** you trade, not the dollar amount (amounts always come from the table above).
- **Baseline tier when debt is zero** follows balance thresholds (see table above).
- **Balance vs tier:** Recovery may escalate above baseline; affordable-bet downgrade can place a smaller step temporarily. Trading stops when balance cannot fund any ladder step.

---

## 2. API Limitations & Overrides (CRITICAL)

### A. Broken `get_realtime_strike_list`

Do **not** use it. The bot uses `_install_price_sniffer` + `_subscribe` on `client-price-generated` websocket messages.

### B. Digital option place V2.0 bypass

`_place_trade` sends manual V2.0 payload via `send_websocket_request` (required on Railway with stock `iqoptionapi`).

### C. Turbo vs Digital Option Result Checking

The broker API uses completely different internal websocket events for `turbo` vs `digital` option trades.
- For `digital` options, it fires `"position-changed"`.
- For `turbo` (binary) options, it fires `"option-closed"`.
If the bot relies on `"position-changed"` for turbo trades, `get_async_order` will timeout forever, returning the sentinel and causing inaccurate tracking. `_check_trade_result` must verify BOTH events depending on the `trading_mode`.

---

## 3. Strike Selection Logic (centered straddle)

**Goal:** Price at placement sits **between** the two strikes — balanced CALL above and PUT below **live spot** (not skewed spot).

### Rules

1. **Spot:** Estimated from the live strike feed (strike where CALL/PUT asks are closest).
2. **Strike ladder:** All numeric strikes from the feed, sorted ascending. **ATM** = ladder index whose strike is closest to spot.
3. **CALL:** Walk **up** the ladder from ATM+1. First strike **strictly above spot** with profit in `[min_profit_pct, max_profit_pct]` (default **145%–277.5%**, env `MIN_PROFIT_PCT`) and valid expiry (when firing).
4. **PUT:** Walk **down** from ATM. First strike **strictly below spot** with profit in band and valid expiry.
5. **Maximum distance:** At most **`MAX_STRIKE_LADDER_STEPS_FROM_ATM = 3`** index steps from ATM on each side. **Never** use the 4th ladder step or farther — too wide to cover with a straddle.
6. **Closest wins:** The walk starts at the nearest OTM strike; farther strikes are only tried if nearer ones fail profit/expiry checks — never pick a wider strike when a closer one qualifies.

### Removed (do not re-add without updating this doc)

- **Trend skewing** (`_detect_micro_trend` / ATR bias shifting virtual spot) — removed; caused wider strikes than necessary.
- **Asymmetric straddle** (tight primary + far “insurance” leg) — removed; use symmetric centered selection only.

### Expiry filter at fire time

Only instruments expiring within **`MIN_SECONDS_TO_EXPIRY`–`MAX_SECONDS_TO_EXPIRY`** (default **18–75s**, server clock). Rejects the ~90s (“1m30s”) bucket when the next-minute contracts are not in the feed.

### Prep vs fire

- **Prep scan** (`for_entry_timing=False`): profit band only; expiry window not applied (feed often lacks next-minute bucket early in the minute).
- **Fire** (`for_entry_timing=True`): profit band **and** expiry window; used after waiting for the entry window (Section 5).

---

## 4. Asset Selection & Penalty Box

### Defaults

- Default asset: `GBPJPY-OTC` (configurable).
- Candidate list in bot `asset_candidates`; **`auto_select_asset` defaults ON** (only OFF if you uncheck it in the dashboard and save).

### When auto-select runs

- New session / step 1 (`session_round_count == 0`) when starting or after tier exhausted.
- **Mid-ladder rescue:** if prep finds no qualifying strikes and `session_round_count > 0`, may switch pair (when auto-select ON).
- After **both legs rejected** (15-minute penalty on current pair).
- After **untradeable** streak (see below).

### Pair quality gates (before trading)

`_assess_straddle_suitability()` — same logic for ranking and pre-trade:

- Efficiency ratio (chop), directional slope, movement score, optional learned thresholds (Section 11).
- Live snapshot: momentum, doji streak (when learned rules exist).
- ATR / strike distance, **zigzag** (price trapped between chosen strikes).

**Untradeable streak:** `PAIR_UNTRADEABLE_SKIP_STREAK = 2` failures (chop, zigzag, etc.) → **`PAIR_UNTRADEABLE_COOLDOWN_MINUTES = 15`** on that pair, then try auto-select or wait.

### Penalty box (enforced on current asset)

`asset_penalty_box[asset] = until_utc` blocks trading that symbol until expiry:

| Trigger | Duration |
|---------|----------|
| Both orders **rejected** | 15 minutes |
| **Tier exhausted** (all steps lost on tier) | 45 minutes |
| Untradeable **cooldown** (2 strikes) | 15 minutes |

All durations are strictly hard-capped to **5 minutes** per recent rules.

While penalized, the main loop **does not** place on that pair: skips to next entry window or switches asset if `auto_select_asset` is ON. (Penalty used to only affect candidate lists — now it blocks the active pair too.)

### Mid-ladder pair switch

Do **not** switch pair casually while `session_round_count > 0`, except rescue / penalty / rejection flows above.

---

## 5. Market Filters, Entry Timing & Safety Guards

### Entry window (IQ Option **server** clock via `timesync`)

Configured in `src/config.py` (env overrides):

| Setting | Default | Meaning |
|---------|---------|---------|
| `ENTRY_WINDOW_START` | 20 | Earliest second to place |
| `ENTRY_WINDOW_END` | 35 | Latest second to **enter** wait |
| `PURCHASE_DEADLINE_SEC` | 35 | Config hard cap (IQ expiry boundary) |
| `ENTRY_HARD_ABORT_SEC` | 35 | Abort if past this after wait |

Flow: prep strikes → `_wait_for_next_entry()` until server second in **:20–:35** → refresh strikes at fire → gates → concurrent placement.

**Placement cutoff:** orders are only sent while server second **&lt; min(END, DEADLINE) − 2** (default **:33**). Sending at **:34–:35** often gets `rejected` from IQ even when strikes look valid.

After **~:35** server time, IQ often rolls to the **next-next** expiry (~90s) — avoided by expiry seconds filter (Section 3).

### Skips and retries (ladder does **not** advance)

These only **retry the same step** after waiting for the next entry window (or short sleep for pair issues):

- No qualifying strikes / expiry window empty at fire time
- Straddle gates failed (chop, zigzag, momentum, etc.)
- Past hard abort / purchase deadline
- **Both legs rejected** → 15m penalty + skip to **next entry window** (not immediate 5s retry)
- **Too late in window** (server ≥ placement cutoff, default :33) → skip minute, no penalty
- **Penalty box** active on current asset

### Logging (operational)

- **`Ladder prep — Tier N step M/3`:** Logged **once per ladder step** (not every skip retry).
- **`Still Tier N step M/3 — skip (reason)`:** On skipped minutes / penalty wait.
- **`LADDER ORDER — Tier N step M`:** Only when orders are actually sent.

Do not confuse prep lines with completed trades — `session_round_count` advances only after a **settled** round (win/loss), not on skips or rejections.

### Other guards

- **`news_blackout_utc_hours`:** Optional; blocks **new step-1** rounds only when configured.
- **Partial fills:** Ladder does not advance.
- **Pause vs Stop:** Pause = no new rounds, stay connected. Stop = end trading thread, keep IQ session warm.

**Not in code / removed from older docs:** UTC :00–:09 / :50–:59 hour blocks, session-open 15-minute pauses, max daily tier escalations, balance-based tier demotion.

### Order placement (no duplicates)

- **One trading thread only.** `POST /api/start` refuses to spawn a loop if `trading-loop` is already alive.
- **Stop** waits up to 120s for the thread to finish.
- **Reset** rejected while any trading thread is alive.
- **One order per leg per round:** `_place_trade` default single attempt; `_round_in_flight` lock prevents duplicate placement.

**Removed / not used:** dynamic bet sizing, debt bet multiplier, custom `budget_tiers`, legacy martingale multipliers, `STRADDLE_ASYMMETRIC` (asymmetric path removed from code).

---

## 6. Alerts, Logging & Simulation

- Telegram/Discord via env vars (`notifier.py`).
- **Trade log:** `data/trade_log.jsonl` (`TRADE_LOG_PATH`), each row tagged with `account_key` (PRACTICE / REAL / `TOURNAMENT_<id>`).
- **Entry snapshot:** At placement, bot stores chart metrics (`entry_snapshot`) on the trade row for learning and debugging.
- `simulation_mode`: full loop, no real orders.
- `POST /api/simulate`: Monte Carlo using `STANDARD_BUDGET_TIERS`.
- REAL start: `confirm_real: true` on `POST /api/start`.

---

## 7. Per-Account State (Practice / Real / Tournament)

State file: `data/bot_state.json` (`BOT_STATE_PATH`), structure:

```json
{
  "version": 3,
  "accounts": {
    "PRACTICE": { "current_tier_index", "session_round_count", "cumulative_debt", "asset", ... },
    "REAL": { ... },
    "TOURNAMENT_<balance_id>": { ... }
  }
}
```

- Switching account: save current bucket → switch IQ balance → load target bucket (or fresh Tier 1 if none).
- Trades/analytics API filter by active `account_key`.
- **Ladder state is per account.** Pair-learning rules are **global** (Section 11).

### Reset progress

`POST /api/reset` (bot stopped): Tier 1, $0 debt, optional trade-log purge for active account only. REAL requires `confirm: true`.

---

## 8. Connection, Boot & Railway Deployment (CRITICAL)

### Golden rule: ONE IQ Option session per process

| Action | `connect()`? | Trade? |
|--------|--------------|--------|
| Deploy / startup | Yes | Yes if `AUTO_START=true` |
| Reconnect | Yes (`force_reconnect`) | If `AUTO_START=true` |
| Start button | **No** | Yes (thread only if no `trading-loop` alive) |
| `run()` loop | **Never** | Yes (mutex — second `run()` exits immediately) |

### Boot (`api.py` → `_boot`)

1. Retry `bot.connect()` up to 5×.
2. `warm_up_market_feed()`.
3. `_start_trading_thread()` if `AUTO_START` (default true).

### Session readiness

`is_session_ready()` = `_session_ready` event + profile/balances on `self.api.api.profile`.  
Balances: `get_all_balances()` only — never `bot.api.profile` as a dict.

### Railway health

`GET /api/health` → instant `{"status":"ok"}` — no disk I/O, no IQ checks.

### User controls

| Control | Behavior |
|---------|----------|
| Stop | `running=false`, keep websocket + feed |
| Start | Trading thread on existing session |
| Reconnect | New login + optional auto-start |
| Pause | No new rounds |

### Do not repeat

1. `connect()` inside `run()` or blocking `/api/start` on login.
2. Two parallel connects without `_connect_lock`.
3. Heavy `/api/health`.
4. `_unsubscribe()` on Stop (use graceful stop, keep feed warm).

### Persisted paths on Railway

Mount a volume for:

- `BOT_STATE_PATH` → `data/bot_state.json`
- `TRADE_LOG_PATH` → `data/trade_log.jsonl`
- `PAIR_LEARNING_PATH` → `data/pair_learning.json` (optional; rebuilt from trade log)

---

## 9. State Persistence

- Persists per account: debt, tier index, step (`session_round_count`), asset, P/L stats, pause/sim flags, penalty-box times (in-memory until restart — not always persisted; re-built from rules).
- Does **not** persist custom bet sizes (always `STANDARD_BUDGET_TIERS`).
- On deploy **resume:** bot may restore mid-ladder (e.g. Tier 1 step 3) and continue that step until win/loss/settle.

---

## 10. Automatic Per-Pair Learning

**Module:** `src/pair_learning.py`  
**Store:** `data/pair_learning.json` (`PAIR_LEARNING_PATH`)

### Behavior

- **Automatic:** After each logged trade, `schedule_refresh()` debounces (~45s) and rebuilds rules from **`data/trade_log.jsonl` across all accounts** (practice, real, tournament combined).
- **Not account-specific:** Learned gates for e.g. `AUDJPY-OTC` apply on every account type.
- **Startup:** Loads existing JSON only (no blocking full rebuild on boot).
- **In-memory cache:** `bot.pair_learning_store` + `_straddle_gate_thresholds()` — avoids reading disk on every gate check. Cache reloads ~48s after a trade is logged.

### Minimum data per pair

- ≥ **8** trades on asset, ≥ **6** with `entry_snapshot` → derive `bot_rules` via `entry_pattern_learning.analyze_entry_patterns()`.

### Merged gates (`effective_gates_for_asset`)

Defaults: `min_efficiency_ratio` 0.25, `min_directional_slope` 18.5 — raised per pair when learning finds stricter values. Optional: `min_momentum_ratio`, `max_doji_streak`, `min_movement_score`.

### API

| Endpoint | Purpose |
|----------|---------|
| `GET /api/learned-pattern` | Summary of `pair_learning.json` |
| `POST /api/learn-pattern` | Force refresh from trade log + reload bot cache |

Dashboard: “Per-pair learning (automatic)” — no manual IQ history import required for normal operation.

---

## 11. Development Guidelines

- Preserve `double_martingale.py` structure and `STANDARD_BUDGET_TIERS`.
- Re-read **Section 8** before editing `api.py` / `connect()` / `run()`.
- Never block websocket thread with `get_balance()` except inside trading loop with `allow_blocking=True`.
- Any change to bet sizing must keep exact ladder values only.
- Strike changes must keep: **live spot**, **closest OTM**, **max 3 ladder steps from ATM**, no trend skew.
- Win handling must **always** reset to step 1 on win; tier 1 only when `cumulative_debt <= 0`.
- Before merging, ask:
  - Does this call `connect()` from the wrong place?
  - Does it scale bet sizes?
  - Does it mix account state with global pair rules incorrectly?
  - Does it advance the ladder on skips, rejections, or wins?

### Key constants (`double_martingale.py`)

```python
STANDARD_BUDGET_TIERS          # fixed $ ladders
MAX_STRIKE_LADDER_STEPS_FROM_ATM = 3
MIN_STRADDLE_EFFICIENCY_RATIO = 0.25
MIN_STRADDLE_DIRECTIONAL_SLOPE = 18.5
PAIR_UNTRADEABLE_SKIP_STREAK = 2
PAIR_PENALTY_MIN_MINUTES = 15
PAIR_PENALTY_MAX_MINUTES = 45
ORDER_REJECTION_PENALTY_MINUTES = 15
PAIR_UNTRADEABLE_COOLDOWN_MINUTES = 15
TIER_EXHAUSTED_PENALTY_MINUTES = 45
```

### Key config (`config.py`)

```python
ENTRY_WINDOW_START = 20   # env: ENTRY_WINDOW_START
ENTRY_WINDOW_END = 35     # env: ENTRY_WINDOW_END
MIN_SECONDS_TO_EXPIRY = 18
MAX_SECONDS_TO_EXPIRY = 75
```

---

## 12. Directional Trend-Following Martingale Strategy

### A. Execution Mode & Selection
- The bot features a configuration parameter `strategy_mode` which can be set to `"directional_trend"` (default) or `"straddle"`.
- Under `"directional_trend"` mode, the bot places a **single directional trade** (CALL or PUT) instead of placing both concurrently.

### B. Trend & Reversal Detection Logic
- **Indicators**: Direction is resolved using `normalized_slope` (regression slope normalized by spot) and `efficiency_ratio` (Chop index) of the past 15 candles.
  - **Uptrend**: `normalized_slope >= 15.0` AND `efficiency_ratio >= 0.25` → trade **CALL**.
  - **Downtrend**: `normalized_slope <= -15.0` AND `efficiency_ratio >= 0.25` → trade **PUT**.
- **Correction vs Reversal Filtering**:
  - A round loss triggers the next Martingale step.
  - Before placing the next recovery step, trend metrics are recalculated.
  - To prevent switching direction on minor pullbacks/noise (corrections), a direction flip is **only** performed if a true **structural trend reversal** occurs:
    1. **Slope Swap**: The slope has flipped sign and exceeds the opposite boundary threshold (e.g. from +15 to <= -15).
    2. **Momentum Acceleration**: Short-term ATR volatility ratio in the new direction is accelerating (`momentum_ratio >= 1.20`).
    3. **Structural EMA Breach**: The spot price breaches the 15-period Exponential Moving Average (EMA) by at least `1.2 * ATR` in the opposite direction.
  - If these filtering gates are not satisfied, the move is classified as a **correction** (pullback). The bot will continue the Martingale sequence in the original trend direction.

### C. Intra-Expiry Pullback Re-entry Rule
- Under `"directional_trend"` mode, if an open directional trade goes into a temporary loss due to a sudden price spike against the trend (a pullback) before expiry:
  - If the spot price moves against the trade direction by more than **`0.05 * ATR`** from the entry strike, and the trend metrics are still intact (no reversal), the bot is authorized to place another leg in the same direction.
  - The bot immediately places the **NEXT Martingale step size** to "average down" at a better price.
  - This can trigger up to 2 extra times (3 trades total).
  - If all trades lose, the bot accurately counts all steps consumed during the minute and escalates the tier appropriately.

### D. Tier Exhaustion Direction Flip Rule
- If the bot exhausts all recovery steps on a given Tier (e.g. loses $1, $3, $9 on Tier 1) trading in one trend direction (e.g. CALL):
  - Upon escalating to the next Tier (e.g. Tier 2, step 1: $5), the bot must **automatically switch its base trend direction** (e.g. flip to PUT).
  - This ensures that a persistent trend breach forces recovery trades to run in the actual breakout direction.

### E. Strike Selection (ATM/ITM targeting)
- Unlike OTM straddle strike selection, the directional trend strategy targets **At-The-Money (ATM)** or slightly **In-The-Money (ITM)** options.
- The target profit payout percentage for ATM/ITM legs is typically in the range **70%–105%**.
- The bot walks the strike ladder outward from ATM and picks the first strike strictly closest to spot that satisfies this profit range for the determined direction (CALL or PUT).

---

*Last aligned with codebase: Directional trend strategy implementation, toggle mode config, correction/reversal filtering rules, intra-expiry pullback entries, Tier exhaustion direction flip, and ATM/ITM strike rules (2026-06).*
