"""
Bot + AI ensemble: combine rule-based signals with Gemini assessment.
"""
from __future__ import annotations

from typing import Any, Dict, Optional, Tuple


def compute_bot_confidence(
    assess: Dict[str, Any],
    target_dir: str,
    slope: float,
    er: float,
) -> float:
    """
    Map straddle suitability + trend alignment to 0.0–1.0 confidence.
    """
    straddle = float(assess.get("straddle_score", 0) or 0)
    score_component = min(1.0, max(0.0, (straddle - 60.0) / 100.0))

    er_val = float(er or 0)
    er_component = min(1.0, max(0.0, (er_val - 0.20) / 0.50))

    slope_val = float(slope or 0)
    aligned = (target_dir == "call" and slope_val > 0) or (
        target_dir == "put" and slope_val < 0
    )
    slope_mag = min(1.0, abs(slope_val) / 400.0)
    slope_component = slope_mag if aligned else slope_mag * 0.35

    return round(
        0.40 * score_component + 0.35 * er_component + 0.25 * slope_component,
        3,
    )


def compute_signal_coherence(
    target_dir: str,
    slope: float,
    er: float,
    *,
    momentum_ratio: float = 1.0,
    body_quality: float = 0.5,
) -> float:
    """
    0.0–1.0: how consistently all signals point toward the trade direction.
    High coherence = signals reinforce each other cleanly.
    Low coherence = signals are mixed or actively contradict each other.

    Weights: slope alignment 35%, ER quality 25%, momentum 20%, body quality 20%.
    """
    slope_val = float(slope or 0)
    er_val = float(er or 0)

    # 1. Slope direction alignment (35%)
    # Aligned slope adds full strength; misaligned slope subtracts.
    aligned = (target_dir == "call" and slope_val > 0) or (
        target_dir == "put" and slope_val < 0
    )
    slope_strength = min(1.0, abs(slope_val) / 120.0)
    slope_contrib = slope_strength if aligned else max(0.0, 0.3 - slope_strength * 0.3)

    # 2. ER quality (25%): higher ER = cleaner trend, more reliable direction
    er_contrib = min(1.0, max(0.0, (er_val - 0.20) / 0.45))

    # 3. Momentum (20%): ratio > 1.0 = accelerating movement, supports trade
    mom = max(0.0, float(momentum_ratio or 1.0))
    mom_contrib = min(1.0, max(0.0, (mom - 0.4) / 1.4))

    # 4. Candle body quality (20%): clean bodies = direction being sustained
    body_contrib = min(1.0, max(0.0, (float(body_quality or 0.5) - 0.10) / 0.70))

    return round(
        0.35 * slope_contrib + 0.25 * er_contrib + 0.20 * mom_contrib + 0.20 * body_contrib,
        3,
    )


def check_enhanced_conviction(
    bot_confidence: float,
    target_dir: str,
    slope: float,
    er: float,
    *,
    momentum_ratio: float = 1.0,
    body_quality: float = 0.5,
    recent_win_rate: float = 1.0,
    recent_trade_count: int = 0,
    current_step: int = 1,
    min_body_quality: float = 0.15,
    min_coherence: float = 0.22,
    min_coherence_step3: float = 0.38,
    min_aligned_signals_step3: int = 2,
    min_recent_win_rate_step3: float = 0.25,
    min_recent_trades_for_rate: int = 4,
) -> Tuple[bool, str]:
    """
    Additional conviction gate combining signal coherence, candle body quality,
    step-level direction agreement count, and recent per-asset win rate.

    Runs AFTER the basic rule/AI gate passes. Filters trades where each individual
    check is technically satisfied but the signals collectively contradict each other
    or the asset is on a cold streak at a high-bet step.

    Returns (allow, reason). Empty reason string = gate passed.
    """
    slope_val = float(slope or 0)
    bq = float(body_quality or 0.5)

    # --- Feature 3: Candle body / wick quality ---
    # Block when recent candles are dominated by rejection wicks, indicating the
    # market is pushing back against the intended direction.
    if bq < min_body_quality:
        return False, (
            f"candle body quality {bq:.2f} < {min_body_quality:.2f} "
            f"(recent candles dominated by wicks — direction not sustained)"
        )

    # --- Features 1+2: Signal coherence / composite conviction ---
    # Penalises trades where slope, ER, momentum, and body disagree with each other
    # even if each one individually clears its own threshold.
    coherence = compute_signal_coherence(
        target_dir, slope_val, er,
        momentum_ratio=momentum_ratio, body_quality=bq,
    )
    eff_min_coh = min_coherence_step3 if current_step >= 3 else min_coherence
    if coherence < eff_min_coh:
        return False, (
            f"signal coherence {coherence:.2f} < {eff_min_coh:.2f} "
            f"(signals conflict: slope={slope_val:+.0f}, ER={er:.2f}, "
            f"mom={momentum_ratio:.2f}, body={bq:.2f})"
        )

    # --- Feature 5: Step-3+ direction agreement count ---
    # At high-bet steps, require a majority of independent directional signals
    # to agree with the intended trade direction — not just a passing bot confidence.
    if current_step >= 3:
        aligned_count = 0
        if (target_dir == "call" and slope_val > 5) or (
            target_dir == "put" and slope_val < -5
        ):
            aligned_count += 1
        if float(momentum_ratio or 1.0) >= 0.80:
            aligned_count += 1
        if bq >= 0.28:
            aligned_count += 1

        if aligned_count < min_aligned_signals_step3:
            return False, (
                f"step {current_step}: {aligned_count}/3 signals aligned with "
                f"{target_dir.upper()} (slope={slope_val:+.0f}, "
                f"mom={momentum_ratio:.2f}, body={bq:.2f}) — "
                f"need {min_aligned_signals_step3} for high-bet step"
            )

    # --- Feature 4: Recent per-asset win rate (step 3+ only) ---
    # If this asset has been consistently losing recently, avoid committing a large
    # step-3 bet on it — wait for the pair to re-establish momentum.
    if current_step >= 3 and recent_trade_count >= min_recent_trades_for_rate:
        if recent_win_rate < min_recent_win_rate_step3:
            return False, (
                f"step {current_step}: asset win rate {recent_win_rate:.0%} "
                f"over last {recent_trade_count} trades "
                f"< {min_recent_win_rate_step3:.0%} — "
                f"skipping high-bet step on cold asset"
            )

    return True, ""


def should_skip_ai_call(
    bot_confidence: float,
    assess: Dict[str, Any],
    target_dir: str,
    slope: float,
    er: float,
    *,
    min_bot_confidence: float,
    min_straddle_score: float,
    min_er: float,
) -> bool:
    """Skip Gemini when bot signals are already strong and aligned."""
    if bot_confidence < min_bot_confidence:
        return False
    straddle = float(assess.get("straddle_score", 0) or 0)
    if straddle < min_straddle_score:
        return False
    if float(er or 0) < min_er:
        return False
    aligned = (target_dir == "call" and float(slope or 0) > 0) or (
        target_dir == "put" and float(slope or 0) < 0
    )
    return aligned


def check_rule_based_entry_gate(
    bot_confidence: float,
    target_dir: str,
    slope: float,
    er: float,
    *,
    slope_override_flip: bool = False,
    slope_override_min_bot_confidence: float = 0.70,
    slope_flip_call_min_er: float = 0.38,
    misaligned_slope_threshold: float = 50.0,
    misaligned_min_bot_confidence: float = 0.42,
    min_bot_confidence: float = 0.35,
    min_er: float = 0.30,
) -> Tuple[bool, str]:
    """
    Targeted rule-based gate when AI is disabled.
    Blocks low-confidence signals and choppy/directionless markets globally,
    plus specific guards for slope-override flips and counter-trend entries.
    """
    bot_conf = max(0.0, min(1.0, float(bot_confidence or 0)))
    slope_val = float(slope or 0)
    er_val = float(er or 0)
    aligned = (target_dir == "call" and slope_val > 0) or (
        target_dir == "put" and slope_val < 0
    )

    # Hard floor: block any trade with confidence below minimum
    if bot_conf < min_bot_confidence:
        return False, (
            f"bot confidence {bot_conf:.0%} below minimum {min_bot_confidence:.0%}"
        )

    # Hard floor: block trades in choppy/directionless markets
    if er_val < min_er:
        return False, (
            f"ER {er_val:.3f} below minimum {min_er:.2f} — market too choppy"
        )

    if slope_override_flip:
        if bot_conf < slope_override_min_bot_confidence:
            return False, (
                f"slope override flip needs bot confidence >= "
                f"{slope_override_min_bot_confidence:.0%} (got {bot_conf:.0%})"
            )
        if target_dir == "call" and er_val < slope_flip_call_min_er:
            return False, (
                f"slope-flip CALL needs ER >= {slope_flip_call_min_er:.2f} "
                f"(got {er_val:.2f})"
            )

    if not aligned and abs(slope_val) >= misaligned_slope_threshold:
        if bot_conf < misaligned_min_bot_confidence:
            return False, (
                f"counter-trend entry (slope {slope_val:.0f}) needs confidence "
                f">= {misaligned_min_bot_confidence:.0%} (got {bot_conf:.0%})"
            )

    return True, ""


def resolve_ensemble(
    bot_dir: str,
    bot_confidence: float,
    ai_assessment: Optional[Dict[str, Any]],
    *,
    min_combined_confidence: float,
    ai_unavailable_proceed_threshold: float,
) -> Tuple[str, str, str, float]:
    """
    Returns (final_direction, action, reason, combined_confidence).
    action: proceed | flip | skip
    """
    bot_dir = (bot_dir or "call").lower()
    bot_conf = max(0.0, min(1.0, float(bot_confidence or 0)))

    if not ai_assessment or ai_assessment.get("approve") is None:
        if bot_conf >= ai_unavailable_proceed_threshold:
            return (
                bot_dir,
                "proceed",
                f"AI unavailable; bot confidence {bot_conf:.0%} sufficient",
                bot_conf,
            )
        return (
            bot_dir,
            "proceed",
            "AI unavailable; proceeding with rule-based logic",
            bot_conf,
        )

    ai_approve = bool(ai_assessment.get("approve", False))
    ai_dir = (ai_assessment.get("direction") or bot_dir).lower()
    ai_conf = max(0.0, min(1.0, float(ai_assessment.get("confidence", 0.5) or 0)))
    # Bot carries 65% of the weight — it has rule-based gates, candle analysis,
    # and per-pair learning. AI carries 35% as a veto signal.
    combined = round(0.65 * bot_conf + 0.35 * ai_conf, 3)
    same_dir = bot_dir == ai_dir

    if ai_approve and same_dir:
        if combined >= min_combined_confidence:
            return (
                bot_dir,
                "proceed",
                f"Ensemble agree {bot_dir.upper()} (combined {combined:.0%})",
                combined,
            )
        # High bot confidence overrides a low combined score — the bot's own
        # rule gate already vetted this trade.
        if bot_conf >= 0.65:
            return (
                bot_dir,
                "proceed",
                f"Bot confidence {bot_conf:.0%} overrides combined floor ({combined:.0%})",
                combined,
            )
        return (
            bot_dir,
            "skip",
            f"Agreement but combined confidence too low ({combined:.0%})",
            combined,
        )

    if ai_approve and not same_dir:
        if ai_conf >= bot_conf + 0.15:
            return (
                ai_dir,
                "flip",
                f"AI direction stronger ({ai_conf:.0%} vs bot {bot_conf:.0%})",
                combined,
            )
        if bot_conf >= ai_conf + 0.15:
            return (
                bot_dir,
                "proceed",
                f"Bot direction stronger than AI flip ({bot_conf:.0%} vs {ai_conf:.0%})",
                combined,
            )
        return (
            bot_dir,
            "skip",
            f"Direction disagreement (bot {bot_conf:.0%}, AI {ai_conf:.0%})",
            combined,
        )

    if not ai_approve and same_dir:
        if bot_conf >= 0.72:
            return (
                bot_dir,
                "proceed",
                f"AI rejected but bot high confidence ({bot_conf:.0%})",
                combined,
            )
        reason = ai_assessment.get("reason") or "AI rejected"
        return bot_dir, "skip", f"AI rejected: {reason}", combined

    # AI rejects and suggests opposite
    if ai_conf >= 0.70:
        return (
            ai_dir,
            "flip",
            f"AI contrarian flip ({ai_conf:.0%} confidence)",
            combined,
        )
    if bot_conf >= 0.65:
        return (
            bot_dir,
            "proceed",
            f"AI contrarian rejected; trusting bot ({bot_conf:.0%})",
            combined,
        )
    return (
        bot_dir,
        "skip",
        "AI rejects with conflicting direction",
        combined,
    )
