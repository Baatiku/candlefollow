"""Tests for market metrics and IQ round grouping."""
import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src")))

from market_metrics import efficiency_ratio, movement_score_from_candles, candle_ohlc
from iq_trade_history import group_positions_into_rounds, normalize_positions
from trade_pattern_analysis import suggest_thresholds, _would_pass_gates


def _make_trending_candles(n=20, start=1.10, step=0.0002):
    candles = []
    price = start
    for i in range(n):
        o = price
        c = price + step
        candles.append({"open": o, "close": c, "max": max(o, c) + 0.0001, "min": min(o, c) - 0.0001})
        price = c
    return candles


def _make_choppy_candles(n=20, center=1.10, wiggle=0.0003):
    candles = []
    for i in range(n):
        o = center + (wiggle if i % 2 == 0 else -wiggle)
        c = center + (-wiggle if i % 2 == 0 else wiggle)
        candles.append({"open": o, "close": c, "max": max(o, c) + 0.00005, "min": min(o, c) - 0.00005})
    return candles


class TestMarketMetrics(unittest.TestCase):
    def test_trending_has_higher_er_than_chop(self):
        trend = [candle_ohlc(c)[3] for c in _make_trending_candles()]
        chop = [candle_ohlc(c)[3] for c in _make_choppy_candles()]
        self.assertGreater(efficiency_ratio(trend), efficiency_ratio(chop))

    def test_movement_score_on_trending(self):
        m = movement_score_from_candles(_make_trending_candles())
        self.assertIsNotNone(m)
        self.assertGreater(m["efficiency_ratio"], 0.25)


class TestRoundGrouping(unittest.TestCase):
    def test_groups_legs_within_window(self):
        positions = normalize_positions(
            [
                {"active_id": 76, "close_time": 1_700_000_000_000, "close_profit": 50, "invest": 10},
                {"active_id": 76, "close_time": 1_700_000_030_000, "close_profit": -10, "invest": 10},
            ]
        )
        rounds = group_positions_into_rounds(positions, window_sec=90)
        self.assertEqual(len(rounds), 1)
        self.assertEqual(rounds[0]["leg_count"], 2)


class TestThresholds(unittest.TestCase):
    def test_suggest_thresholds_from_winners(self):
        win_m = [{"efficiency_ratio": 0.5, "abs_slope": 30}] * 5
        loss_m = [{"efficiency_ratio": 0.1, "abs_slope": 10}] * 3
        rec = suggest_thresholds(win_m, loss_m)
        self.assertGreaterEqual(rec["min_efficiency_ratio"], 0.25)
        self.assertTrue(_would_pass_gates(win_m[0], 0.25, 18.5))


if __name__ == "__main__":
    unittest.main()
