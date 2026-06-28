"""
Mixin classes for DoubleMartingaleBot.

Extraction order (see ARCHITECTURE_REFACTOR.md Steps 1.18–1.24):
  1.18  state_mixin.py      — persist_state, get_state, full_system_reset, _default_trading_state
  1.19  config_mixin.py     — update_config, _save_config_history, config_history
  1.20  connection_mixin.py — connect, disconnect, warm_up_market_feed, is_session_ready
  1.21  account_mixin.py    — switch_trading_account, _state_account_key, active_balance_id
"""
