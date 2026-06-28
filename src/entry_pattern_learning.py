"""Compare chart/entry conditions before wins vs losses; derive bot rules."""
from __future__ import annotations

import statistics
from typing import Any

# Metrics the bot can gate on (must exist on entry_snapshot)
FEATURES = [
    {
        "key": "efficiency_ratio",
        "label": "Efficiency Ratio (direction vs chop)",
        "higher_better": True,
        "description_win": "price moved with purpose, not sideways noise",
        "description_loss": "choppy, whipsaw price action",
    },
    {
        "key": "abs_slope",
        "label": "Trend strength (slope)",
        "higher_better": True,
        "description_win": "clear short-term drift",
        "description_loss": "flat, directionless",
    },
    {
        "key": "momentum_ratio",
        "label": "Momentum (recent vs older volatility)",
        "higher_better": True,
        "description_win": "volatility expanding into the trade",
        "description_loss": "volatility fading",
    },
    {
        "key": "range_pct",
        "label": "15m range %",
        "higher_better": True,
        "description_win": "enough room for OTM strikes to be reached",
        "description_loss": "tight, dead range",
    },
    {
        "key": "score",
        "label": "Movement score",
        "higher_better": True,
        "description_win": "active, tradeable candles",
        "description_loss": "doji-heavy or flat",
    },
    {
        "key": "doji_streak",
        "label": "Doji streak (last candles)",
        "higher_better": False,
        "description_win": "real bodies, decisive candles",
        "description_loss": "indecision dojis",
    },
    {
        "key": "last_3m_range_pct",
        "label": "Last 3m range %",
        "higher_better": True,
        "description_win": "recent expansion",
        "description_loss": "recent compression",
    },
]


def _percentile(values: list[float], pct: float) -> float | None:
    if not values:
        return None
    s = sorted(values)
    idx = max(0, min(len(s) - 1, int(len(s) * pct)))
    return s[idx]


def _distribution(samples: list[dict], key: str) -> dict:
    vals = [s[key] for s in samples if s.get(key) is not None]
    if not vals:
        return {"count": 0}
    return {
        "count": len(vals),
        "median": round(statistics.median(vals), 3),
        "mean": round(sum(vals) / len(vals), 3),
        "p25": round(_percentile(vals, 0.25) or 0, 3),
        "p75": round(_percentile(vals, 0.75) or 0, 3),
    }


def _suggest_threshold(win_dist: dict, loss_dist: dict, higher_better: bool) -> float | None:
    if win_dist.get("count", 0) < 5 or loss_dist.get("count", 0) < 5:
        if win_dist.get("count", 0) >= 5:
            base = win_dist.get("p25") if higher_better else win_dist.get("p75")
            return round(base * 0.9, 3) if base is not None else None
        return None
    w25, w50, l50, l75 = (
        win_dist.get("p25"),
        win_dist.get("median"),
        loss_dist.get("median"),
        loss_dist.get("p75"),
    )
    if None in (w25, w50, l50, l75):
        return None
    if higher_better:
        # Between loser upper tail and winner lower tail
        return round(max(w25 * 0.92, (l75 + w25) / 2), 3)
    # Lower is better (doji): threshold below loser median
    return round(min(w50 * 1.1, (l50 + w50) / 2), 3)


def analyze_entry_patterns(trades: list[dict]) -> dict[str, Any]:
    """
    Core learning: what did the chart look like before wins vs before losses?
    """
    with_snap = [t for t in trades if t.get("entry_snapshot")]
    wins = [t for t in with_snap if float(t.get("round_profit", 0)) > 0]
    losses = [t for t in with_snap if float(t.get("round_profit", 0)) < 0]

    win_snaps = [t["entry_snapshot"] for t in wins]
    loss_snaps = [t["entry_snapshot"] for t in losses]

    winner_profile = {f["key"]: _distribution(win_snaps, f["key"]) for f in FEATURES}
    loser_profile = {f["key"]: _distribution(loss_snaps, f["key"]) for f in FEATURES}

    comparisons = []
    rules = []
    for feat in FEATURES:
        key = feat["key"]
        wd = winner_profile.get(key, {})
        ld = loser_profile.get(key, {})
        if wd.get("count", 0) < 3 or ld.get("count", 0) < 3:
            continue

        w_med = wd.get("median")
        l_med = ld.get("median")
        sep = None
        if w_med is not None and l_med is not None and (wd.get("p75", 0) - wd.get("p25", 0)) > 0:
            sep = abs(w_med - l_med) / max(1e-9, wd["p75"] - wd["p25"])

        threshold = _suggest_threshold(wd, ld, feat["higher_better"])
        direction = "higher" if feat["higher_better"] else "lower"
        narrative = ""
        if w_med is not None and l_med is not None:
            if feat["higher_better"] and w_med > l_med:
                narrative = (
                    f"Before wins: {feat['description_win']} (median {w_med}); "
                    f"before losses: {feat['description_loss']} (median {l_med})."
                )
            elif not feat["higher_better"] and w_med < l_med:
                narrative = (
                    f"Before wins: {feat['description_win']} (median {w_med}); "
                    f"before losses: {feat['description_loss']} (median {l_med})."
                )
            else:
                narrative = f"Weak separation on {feat['label']}."

        comparisons.append(
            {
                "metric": key,
                "label": feat["label"],
                "winner": wd,
                "loser": ld,
                "separation_score": round(sep, 2) if sep is not None else None,
                "narrative": narrative,
                "suggested_threshold": threshold,
                "direction": direction,
            }
        )

        if threshold is not None and narrative and "Weak" not in narrative:
            op = ">=" if feat["higher_better"] else "<="
            rules.append(
                {
                    "metric": key,
                    "rule": f"{key} {op} {threshold}",
                    "threshold": threshold,
                    "direction": direction,
                }
            )

    comparisons.sort(
        key=lambda x: x.get("separation_score") or 0,
        reverse=True,
    )

    # Backtest rules on sample
    def passes_rules(snap: dict) -> bool:
        if not snap:
            return False
        for r in rules:
            key = r["metric"]
            val = snap.get(key)
            if val is None:
                return False
            if r["direction"] == "higher" and val < r["threshold"]:
                return False
            if r["direction"] == "lower" and val > r["threshold"]:
                return False
        return True

    win_pass = sum(1 for t in wins if passes_rules(t.get("entry_snapshot")))
    loss_block = sum(1 for t in losses if not passes_rules(t.get("entry_snapshot")))

    chart_summary = _build_chart_summary(comparisons[:5])
    insights = [chart_summary]
    for c in comparisons[:6]:
        if c.get("narrative") and "Weak" not in c["narrative"]:
            insights.append(c["narrative"])

    if wins and losses:
        insights.append(
            f"Learned rules would allow {win_pass}/{len(wins)} wins "
            f"and block {loss_block}/{len(losses)} losses (snapshot sample)."
        )

    bot_rules = _rules_to_bot_format(rules, comparisons)

    return {
        "trades_with_snapshots": len(with_snap),
        "wins": len(wins),
        "losses": len(losses),
        "winner_profile": winner_profile,
        "loser_profile": loser_profile,
        "comparisons": comparisons,
        "learned_rules": rules,
        "bot_rules": bot_rules,
        "chart_summary": chart_summary,
        "insights": insights,
        "gate_accuracy": {
            "wins_pass_pct": (win_pass / len(wins) * 100) if wins else None,
            "losses_blocked_pct": (loss_block / len(losses) * 100) if losses else None,
        },
    }


def _build_chart_summary(top_comparisons: list[dict]) -> str:
    if not top_comparisons:
        return "Not enough candle data to compare charts before wins vs losses."
    parts = []
    for c in top_comparisons[:3]:
        if c.get("narrative") and "Weak" not in c["narrative"]:
            parts.append(c["narrative"])
    if not parts:
        return "Wins and losses looked similar on measured chart features — use stricter default gates."
    return " ".join(parts)


def _rules_to_bot_format(rules: list[dict], comparisons: list[dict]) -> dict:
    out = {
        "min_efficiency_ratio": 0.25,
        "min_directional_slope": 18.5,
        "focus_assets": [],
        "caution_assets": [],
        "entry_rules": rules,
        "notes": "Derived from before-trade chart comparison (winners vs losers).",
    }
    for r in rules:
        if r["metric"] == "efficiency_ratio":
            out["min_efficiency_ratio"] = max(0.12, float(r["threshold"]))
        elif r["metric"] == "abs_slope":
            out["min_directional_slope"] = max(12.0, float(r["threshold"]))
        elif r["metric"] == "momentum_ratio":
            out["min_momentum_ratio"] = float(r["threshold"])
        elif r["metric"] == "doji_streak":
            out["max_doji_streak"] = int(float(r["threshold"]))
        elif r["metric"] == "score":
            out["min_movement_score"] = float(r["threshold"])
    return out


def profile_by_asset(trades: list[dict]) -> dict:
    """Per-pair win/loss with median ER before entry."""
    from collections import defaultdict

    buckets = defaultdict(lambda: {"w": [], "l": []})
    for t in trades:
        snap = t.get("entry_snapshot")
        if not snap:
            continue
        asset = t.get("asset") or "?"
        if float(t.get("round_profit", 0)) > 0:
            buckets[asset]["w"].append(snap)
        else:
            buckets[asset]["l"].append(snap)

    report = {}
    for asset, data in buckets.items():
        report[asset] = {
            "wins": len(data["w"]),
            "losses": len(data["l"]),
            "winner_er_median": _distribution(data["w"], "efficiency_ratio").get("median"),
            "loser_er_median": _distribution(data["l"], "efficiency_ratio").get("median"),
            "winner_slope_median": _distribution(data["w"], "abs_slope").get("median"),
            "loser_slope_median": _distribution(data["l"], "abs_slope").get("median"),
        }
    return report
