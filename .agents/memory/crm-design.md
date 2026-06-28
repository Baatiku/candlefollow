---
name: CRM compartmentalised design
description: Architecture of the Capital Recovery Mode replacing old T2-T4 escalation in double_martingale.py
---

## Rule
STANDARD_BUDGET_TIERS now contains only T0 and T1. Exhausting T0→T1 then T1 triggers Capital Recovery Mode (CRM), not T2/T3/T4 escalation.

## Why
User requested compartmentalised system: 2 active tiers per balance bracket, then CRM instead of runaway escalation. Prevents single bets exceeding 35% of balance. Max CRM bet = 35% of balance (capped).

## Key constants/methods (double_martingale.py)
- `STANDARD_BUDGET_TIERS` = [[1,3,9],[6,15,42]] only
- `RECOVERY_TIER_CEILING` = 1
- `_compute_crm_tiers(balance, total_loss)` — dynamic formula: 10-win recovery, profit_target = min(200, max(15, balance×0.10)), S1/S2/S3 capped at 10%/20%/35% of balance
- `_trigger_crm()` — called from `_maybe_escalate_assigned_tier_after_exhaustion` when current_tier == max_normal_tier (T1)
- `_compute_crm_bet()` — intercepts `_compute_round_bet` when crm_mode=True
- `_apply_crm_win(net_gain)` — accumulates crm_collected; exits CRM when >= crm_target
- `_exit_crm(success)` — resets all CRM state, returns to balance-floor tier

## State fields (persisted via bot_state_store.py)
crm_mode, crm_tiers, crm_tier_index, crm_target, crm_collected

## CRM guard points
- `_sync_assigned_tier_for_trading`: early return if crm_mode
- `_validate_bet_amount`: return True if crm_mode
- `_apply_win_ladder_rules`: calls _apply_crm_win and returns early if crm_mode
- `_finalize_session`: guards _return_to_tier_one_step_one_if_debt_cleared; CRM-aware state log
- Main loop & reconciliation: use crm_tiers[crm_tier_index] for step count when crm_mode
- `_current_tier_step_count`: returns CRM tier step count when crm_mode

## CRM formula example (balance=$1,000)
profit_target = $100; total_loss = $76; target1 = $176
CRM-T1: S1=$21, S2=$116, S3=$350 (capped at 35%×$1k)
CRM-T2: targets recovery of $76 + $487 + $100 = $663; S1=$78, S2=$200, S3=$350

## How to apply
Any future changes to tier escalation must check crm_mode guards at all 6 hook points above.
