---
name: Never-skip-minute + tier escalation fixes
description: Two bugs fixed in double_martingale.py — recovery tier bracket using post-loss balance, and bot skipping candles instead of finding an alternative pair.
---

## Tier escalation bug
**Rule:** Recovery bracket lookup must use `_ladder_start_balance` (balance at step-1 of the ladder), not the post-loss balance at exhaustion time.

**Why:** After losing 8 steps of Tier 1, the account balance is $923 lower. An account that started at $550 (in the $500–$699 bracket with recovery tier) ends up at ~$457 at exhaustion — which falls into the $1–$499 no-recovery bracket, so the bot hard-stops instead of escalating.

**How to apply:** `_on_ladder_step_start()` captures `self._ladder_start_balance = self.safe_get_balance()` at `session_round_count == 0`. `_start_tier_exhaustion_cooldown()` uses `bracket_balance = max(_ladder_start_balance, current_balance)` for `_recovery_tier_idx_for_balance()` and `_second_recovery_tier_idx_for_balance()` lookups. `_pre_loss_balance` is set to `bracket_balance` (not current balance).

## Never-skip-minute bug
**Rule:** When a pair fails the quality gate or has no strikes, the bot must immediately scan all ranked candidates, switch to the first one that passes `_evaluate_candle_follow`, and trade that candle. Only skip to the next candle if every candidate fails.

**Why:** The old `_handle_trade_gate_failure` called `_skip_to_next_entry_window` after trying just one alternative (single call to `_switch_to_next_tradeable_pair`). If that one alternative also failed, the candle was skipped even if other tradeable pairs existed.

**How to apply:**
- New helper `_try_alternate_pair_for_candle(skipped_asset, reason)` builds a ranked list of all non-penalised candidates, iterates them, switches to each, calls `_evaluate_candle_follow`, and returns True on the first pass. Restores original asset if all fail.
- `_handle_trade_gate_failure` now delegates to this helper immediately (no single-pair shortcut).
- "No strikes at fire time" path in the main loop also delegates to `_try_alternate_pair_for_candle`.
- `"quality gate switch"` added to `_switch_bypass` in `_switch_to_next_tradeable_pair` so mid-ladder switches are allowed for gate failures.
- When `_try_alternate_pair_for_candle` returns True, the caller returns immediately; the outer loop's `continue` re-enters and re-evaluates the new asset (including `_wait_for_next_entry` and all timing gates) — this is correct since we are still within the same candle window.
