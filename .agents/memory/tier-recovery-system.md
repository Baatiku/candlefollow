---
name: 3-level tier recovery system
description: Architecture of the expanded 16-tier / 3-level cascade recovery mode in double_martingale.py
---

## Rule
ALL_TIERS now has 16 tiers (was 12). BALANCE_BRACKET_TABLE has 5 columns including an optional second_recovery_idx.
Recovery is capped at 3 levels: default → 1st recovery → 2nd recovery → hard stop.

## Why
Sized each band so the cascade has enough capital with 20% cushion. Low balances ($1–$499) have no recovery
capital so they hard-stop immediately. Mid balances ($500–$1099) get 2-level protection. Full 3-level
protection starts at $1100.

## Key constants (double_martingale.py)
- `ALL_TIERS` — 16 tiers, index 0–15, formula Tier N = N×[1,4,10,23,55]
- `STANDARD_BUDGET_TIERS` — independent copy of ALL_TIERS (NOT an alias); do not mutate it
- `BALANCE_BRACKET_TABLE` — 5-tuples: (min_bal, max_bal, default_idx, recovery_idx_or_None, second_recovery_idx_or_None)
- `RECOVERY_TIER_CEILING` = 15 (Tier 16)

## State fields
- `_in_recovery_mode: bool` — True while in level 1 or 2
- `_recovery_level: int` — 0=default, 1=first recovery, 2=second recovery
- `_recovery_tier_idx: int` — current active recovery tier index; -1 = sentinel "no recovery"
- `_pre_loss_balance: float` — balance snapshot at exhaustion; recovery exits when balance ≥ this

## Critical pinning rule
`_sync_assigned_tier_for_trading()` has an early-return in recovery mode that pins to `_recovery_tier_idx`
WITHOUT running `_apply_risk_tier_caps()` or `_apply_balance_ladder_downgrade()` — those would silently
move the bot off the pinned tier.

**Why:** Risk-cap and ladder-downgrade logic can lower the tier index, breaking the "hold recovery tier
until balance ≥ _pre_loss_balance" invariant.

## State restore invariant
On restore: if `_in_recovery_mode` is False, force `_recovery_level=0` and reset any `-1` sentinel to `0`.
The `-1` sentinel is only meaningful at runtime; persisted state should not store it long-term.
Clamp `_recovery_tier_idx` only when ≥ 0 (preserve -1 sentinel if active).

## How to apply
Any change to tier sync, risk caps, or ladder downgrade must respect the recovery-mode early-return guard.
Any new exhaustion path must go through `_start_tier_exhaustion_cooldown()` (sets state) then
`_maybe_escalate_assigned_tier_after_exhaustion()` (switches tiers / returns hard_stop).
