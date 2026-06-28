"""Unit tests for trading time-block helpers."""
import datetime
import os
import sys
import unittest
from unittest.mock import MagicMock

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src")))

from strategies.double_martingale import DoubleMartingaleBot  # noqa: E402


def _dt(h, m):
    return datetime.datetime(2026, 6, 1, h, m)


class TestTimeBlocks(unittest.TestCase):
    def test_hour_boundary_blocks_first_and_last_five_minutes(self):
        bot = MagicMock(spec=DoubleMartingaleBot)
        bot.hour_boundary_block_minutes = 5
        bot.market_open_blocks = []
        bot.blocked_time_windows = []
        bot._trading_now = lambda: _dt(10, 2)
        self.assertTrue(DoubleMartingaleBot._is_blocked_time_window(bot))
        bot._trading_now = lambda: _dt(10, 57)
        self.assertTrue(DoubleMartingaleBot._is_blocked_time_window(bot))
        bot._trading_now = lambda: _dt(10, 30)
        self.assertFalse(DoubleMartingaleBot._is_blocked_time_window(bot))

    def test_market_open_block_2am_wat_30_min_after(self):
        self.assertFalse(
            DoubleMartingaleBot._is_in_market_open_block(_dt(1, 44), 2, 0, 15, 30)
        )
        self.assertTrue(
            DoubleMartingaleBot._is_in_market_open_block(_dt(1, 45), 2, 0, 15, 30)
        )
        self.assertTrue(
            DoubleMartingaleBot._is_in_market_open_block(_dt(2, 30), 2, 0, 15, 30)
        )
        self.assertFalse(
            DoubleMartingaleBot._is_in_market_open_block(_dt(2, 31), 2, 0, 15, 30)
        )

    def test_market_open_block_wraps_midnight(self):
        self.assertTrue(
            DoubleMartingaleBot._is_in_market_open_block(_dt(23, 50), 0, 0, 15, 15)
        )
        self.assertTrue(
            DoubleMartingaleBot._is_in_market_open_block(_dt(0, 10), 0, 0, 15, 15)
        )
        self.assertFalse(
            DoubleMartingaleBot._is_in_market_open_block(_dt(0, 20), 0, 0, 15, 15)
        )


if __name__ == "__main__":
    unittest.main()
