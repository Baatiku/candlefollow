"""
Execution mixins for DoubleMartingaleBot.

Extraction order (see ARCHITECTURE_REFACTOR.md Steps 1.15–1.17):
  1.15  result_checker.py — _check_trade_result, timeout handling, partial fills
  1.16  pullback.py       — _monitor_intra_expiry, pullback order placement
  1.17  trade_placer.py   — _place_straddle, _place_directional, _buy_option, _inflight_trade_ids
"""
