"""
Ladder mixins for DoubleMartingaleBot.

Extraction order (see ARCHITECTURE_REFACTOR.md Steps 1.11–1.14):
  1.11  debt.py            — cumulative_debt, session_total_profit, window_profit, _apply_window_profit_reset
  1.12  tiers.py           — _compute_round_bet, _apply_risk_tier_caps, STANDARD_BUDGET_TIERS
  1.13  escalation.py      — _advance_tier, _apply_balance_ladder_downgrade, tier_escalations_today
  1.14  reconciliation.py  — _reconcile_inflight_trades, _finalize_session, _resuming_mid_ladder
"""
