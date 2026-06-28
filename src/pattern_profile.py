"""Persist learned win/loss patterns for the trading bot."""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

DEFAULT_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "data", "learned_pattern.json"
)


def profile_path() -> str:
    return os.environ.get("LEARNED_PATTERN_PATH", DEFAULT_PATH)


def load_pattern_profile() -> dict:
    path = profile_path()
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception as e:
        logger.warning("Could not load learned pattern: %s", e)
        return {}


def save_pattern_profile(profile: dict) -> str:
    path = profile_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    profile["saved_at"] = datetime.now(timezone.utc).isoformat()
    with open(path, "w", encoding="utf-8") as f:
        json.dump(profile, f, indent=2)
    return path


_DEFAULT_MIN_ER = 0.10
_DEFAULT_MIN_SLOPE = 8.0


def effective_gates(profile: dict | None = None) -> dict:
    """Merge defaults with learned thresholds (learned values only raise the bar)."""
    profile = profile if profile is not None else load_pattern_profile()
    rules = profile.get("bot_rules") or profile.get("recommended_thresholds") or {}
    gates = {
        "min_efficiency_ratio": max(
            _DEFAULT_MIN_ER,
            float(rules.get("min_efficiency_ratio", _DEFAULT_MIN_ER)),
        ),
        "min_directional_slope": max(
            _DEFAULT_MIN_SLOPE,
            float(rules.get("min_directional_slope", _DEFAULT_MIN_SLOPE)),
        ),
        "focus_assets": profile.get("bot_rules", {}).get("focus_assets")
        or profile.get("preferred_assets")
        or [],
        "caution_assets": profile.get("bot_rules", {}).get("caution_assets") or [],
    }
    if rules.get("min_momentum_ratio") is not None:
        gates["min_momentum_ratio"] = float(rules["min_momentum_ratio"])
    if rules.get("max_doji_streak") is not None:
        gates["max_doji_streak"] = int(rules["max_doji_streak"])
    if rules.get("min_movement_score") is not None:
        gates["min_movement_score"] = float(rules["min_movement_score"])
    return gates
