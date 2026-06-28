"""Unit tests for micro-pullback sniper helpers."""
import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src")))

from strategies.double_martingale import DoubleMartingaleBot  # noqa: E402


class TestSniperHelpers(unittest.TestCase):
    def test_favorable_call_on_dip(self):
        ok = DoubleMartingaleBot._sniper_favorable_spot(
            None, "call", 1.1000, 1.0990, 1.1010, 1.0985, 0.0010
        )
        self.assertTrue(ok)

    def test_unfavorable_call_after_recovery(self):
        ok = DoubleMartingaleBot._sniper_favorable_spot(
            None, "call", 1.1000, 1.1015, 1.1015, 1.0995, 0.0010
        )
        self.assertFalse(ok)

    def test_seed_extremes_from_candles(self):
        bot = DoubleMartingaleBot(simulation_mode=True)
        bot._price_data[60] = [
            {"close": 1.1000},
            {"close": 1.1010},
            {"close": 1.0985},
        ]
        high, low = bot._seed_sniper_window_extremes(1.1000)
        self.assertEqual(high, 1.1010)
        self.assertEqual(low, 1.0985)

    def test_sticky_veto_only_on_clear_short_term_disagreement(self):
        self.assertTrue(
            DoubleMartingaleBot._sticky_direction_disagrees_with_short_term(
                "put", med_slope=-5.0, short_slope=20.0, short_er=0.20
            )
        )
        self.assertFalse(
            DoubleMartingaleBot._sticky_direction_disagrees_with_short_term(
                "put", med_slope=-20.0, short_slope=20.0, short_er=0.20
            )
        )
        self.assertFalse(
            DoubleMartingaleBot._sticky_direction_disagrees_with_short_term(
                "put", med_slope=-5.0, short_slope=10.0, short_er=0.20
            )
        )

    def test_sniper_recovery_block_requires_directional_short_move(self):
        self.assertTrue(
            DoubleMartingaleBot._sniper_blocked_by_recovery_momentum(
                "put", med_slope=-5.0, short_slope=18.0, short_er=0.18
            )
        )
        self.assertFalse(
            DoubleMartingaleBot._sniper_blocked_by_recovery_momentum(
                "put", med_slope=-20.0, short_slope=18.0, short_er=0.18
            )
        )


if __name__ == "__main__":
    unittest.main()
