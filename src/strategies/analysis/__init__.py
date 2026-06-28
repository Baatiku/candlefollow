"""
Analysis mixins for DoubleMartingaleBot.

Extraction order (see ARCHITECTURE_REFACTOR.md Steps 1.1–1.4 — do these FIRST, they are pure):
  1.1  candles.py         — _fetch_candles, _compute_atr, _compute_efficiency_ratio, _compute_momentum_ratio
  1.2  gates.py           — _passes_straddle_gates, _compute_straddle_score, all threshold checks
  1.3  direction.py       — _determine_trend_direction, slope calc, reversal filter
  1.4  strike_selector.py — _get_best_strikes, _get_best_directional_strike, _filter_strikes_by_profit_pct
"""
