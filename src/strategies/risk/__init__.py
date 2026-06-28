"""
Risk mixins for DoubleMartingaleBot.

Extraction order (see ARCHITECTURE_REFACTOR.md Steps 1.8–1.10):
  1.8   balance.py     — safe_get_balance, _refresh_balance_cache, _balance_lock
  1.9   profit_lock.py — _update_profit_lock, session_peak_balance, locked_profit
  1.10  drawdown.py    — _check_drawdown_breaker, risk_mode_until, _enter_risk_mode, _exit_risk_mode
"""
