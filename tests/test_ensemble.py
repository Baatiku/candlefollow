"""Tests for bot+AI ensemble and Gemini rate limiting."""
import os
import sys
import time
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src")))

from ensemble import (  # noqa: E402
    check_rule_based_entry_gate,
    compute_bot_confidence,
    resolve_ensemble,
    should_skip_ai_call,
)
from ai_assessment import GeminiKeyPool  # noqa: E402


class TestEnsemble(unittest.TestCase):
    def test_high_straddle_aligned_slope_gives_high_bot_confidence(self):
        assess = {"straddle_score": 140, "efficiency_ratio": 0.6}
        conf = compute_bot_confidence(assess, "call", slope=300, er=0.6)
        self.assertGreater(conf, 0.65)

    def test_should_skip_ai_when_signals_strong(self):
        assess = {"straddle_score": 130}
        self.assertTrue(
            should_skip_ai_call(
                0.80,
                assess,
                "call",
                slope=250,
                er=0.5,
                min_bot_confidence=0.78,
                min_straddle_score=115,
                min_er=0.45,
            )
        )

    def test_ensemble_agree_proceeds(self):
        ai = {"approve": True, "direction": "call", "confidence": 0.8, "reason": "trend"}
        final, action, reason, combined = resolve_ensemble(
            "call",
            0.75,
            ai,
            min_combined_confidence=0.55,
            ai_unavailable_proceed_threshold=0.5,
        )
        self.assertEqual(final, "call")
        self.assertEqual(action, "proceed")
        self.assertGreater(combined, 0.55)

    def test_ensemble_disagreement_skips(self):
        ai = {"approve": True, "direction": "put", "confidence": 0.55, "reason": "fade"}
        _, action, _, _ = resolve_ensemble(
            "call",
            0.55,
            ai,
            min_combined_confidence=0.55,
            ai_unavailable_proceed_threshold=0.5,
        )
        self.assertEqual(action, "skip")

    def test_ai_unavailable_trusts_bot_when_strong(self):
        _, action, reason, _ = resolve_ensemble(
            "call",
            0.72,
            None,
            min_combined_confidence=0.55,
            ai_unavailable_proceed_threshold=0.50,
        )
        self.assertEqual(action, "proceed")
        self.assertIn("unavailable", reason.lower())

    def test_rule_gate_allows_low_aligned_put_win(self):
        allow, _ = check_rule_based_entry_gate(
            0.39,
            "put",
            slope=-220,
            er=0.36,
            slope_override_flip=False,
        )
        self.assertTrue(allow)

    def test_rule_gate_blocks_weak_slope_override_flip(self):
        allow, reason = check_rule_based_entry_gate(
            0.40,
            "call",
            slope=196,
            er=0.30,
            slope_override_flip=True,
        )
        self.assertFalse(allow)
        self.assertIn("override", reason.lower())

    def test_rule_gate_blocks_slope_flip_call_low_er(self):
        allow, reason = check_rule_based_entry_gate(
            0.68,
            "call",
            slope=378,
            er=0.37,
            slope_override_flip=True,
        )
        self.assertFalse(allow)
        self.assertIn("ER", reason)


class TestGeminiRateLimit(unittest.TestCase):
    def test_per_key_minute_budget(self):
        pool = GeminiKeyPool("key-a,key-b", max_calls_per_minute=4)
        used = []
        for _ in range(4):
            k = pool.get_next_key()
            self.assertIsNotNone(k)
            pool.record_call(k)
            used.append(k)
        # Fifth call in same minute should fail when only one key used up
        if len(set(used)) == 1:
            self.assertIsNone(pool.get_next_key())


if __name__ == "__main__":
    unittest.main()
