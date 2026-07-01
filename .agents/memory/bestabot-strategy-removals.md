---
name: BestaBot strategy removals
description: Which risk/penalty mechanisms were removed vs kept in double_martingale.py, and the new sliding-window rule that replaced them.
---

# Removed mechanisms (user request)
- **Item 1** Deep Sequence Strike (`_check_deep_sequence_strike`) — fully removed
- **Item 2** Pair Baseline Degradation (`_pair_baseline_degraded`, `_record_pair_selection_baseline`, `_active_pair_baseline`, `_pair_consecutive_losses`) — fully removed
- **Item 4** Consecutive Full-Ladder-Loss Pause (`sequential_steps_mode` block, `_consecutive_full_ladder_losses`, `CONSECUTIVE_LADDER_LOSS_LIMIT/PAUSE_SEC`) — fully removed from config.py and main loop
- **Item 6** Asset Suspension / Wilson Score (`asset_health_check` import, entire ~57-line suspension gate block) — fully removed
- **Item 7** Recovery Mode (`_evaluate_recovery_mode`, `_recovery_tier_bump`, `_recovery_hard_stopped`) — fully removed

# Kept mechanisms
- **Item 3** Pair Quality Drop Filter — `_pair_win_er_history`, `ph_adjusted_score` from pair_health still used
- **Item 5** Step Score Escalation — conviction gate still active

# New rule replacing item 4
`_record_ladder_exhaustion_and_check_penalty()` — called just before `_finalize_session("Tier exhausted")`.
Tracks `_pair_ladder_loss_times` per asset (UTC datetimes of full ladder exhaustions).
If 2+ exhaustions in 15 minutes → 5-min skip penalty, list cleared. Never penalises mid-ladder.

**Why:** User wanted simpler, more transparent penalty logic without suppressing mid-session trades.

**How to apply:** Any future work on ladder exhaustion handling should call this method instead of adding new penalty counters.
