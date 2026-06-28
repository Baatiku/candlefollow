"""Tests for trade log evaluation export."""
import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src")))

from trade_log import flatten_trade_for_export, export_trades_csv  # noqa: E402


class TestTradeLogExport(unittest.TestCase):
    def test_flatten_includes_bot_evaluation(self):
        row = flatten_trade_for_export(
            {
                "ts": "2026-06-07T10:00:00Z",
                "asset": "XAUUSD-OTC",
                "round_profit": 17.0,
                "bot_evaluation": {
                    "direction": "put",
                    "bot_confidence": 0.39,
                    "entry_er": 0.36,
                    "entry_slope_signed": -227,
                    "entry_straddle_score": 82,
                    "trend_aligned": True,
                    "ai_disabled": True,
                },
                "entry_snapshot": {
                    "efficiency_ratio": 0.36,
                    "slope_signed": -220,
                    "momentum_ratio": 0.85,
                },
            }
        )
        self.assertEqual(row["direction"], "put")
        self.assertEqual(row["bot_confidence"], 0.39)
        self.assertEqual(row["outcome"], "win")
        self.assertEqual(row["snap_slope_signed"], -220)
        self.assertTrue(row["trend_aligned"])

    def test_csv_export_has_header(self):
        csv_text = export_trades_csv(limit=1, account_key="__none__")
        self.assertIn("bot_confidence", csv_text.splitlines()[0])


if __name__ == "__main__":
    unittest.main()
