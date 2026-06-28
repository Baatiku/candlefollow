#!/usr/bin/env python3
"""
Analyze IQ account trade history (practice, real, or tournament) and print learned bot rules.

Usage (from repo root, IQ credentials in env / config):
  python scripts/learn_tournament.py --current --apply
  python scripts/learn_tournament.py --search "nigeria champions"
  python scripts/learn_tournament.py --balance-id 12345678 --apply
"""
from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from connection import connect_to_iqoption
from trade_pattern_analysis import learn_from_account_history
from pattern_profile import save_pattern_profile
from iqoptionapi.stable_api import global_value


def _find_tournament(api, search: str):
    raw = api.get_balances().get("msg", [])
    needle = search.lower()
    for b in raw:
        if b.get("type") != 2:
            continue
        name = (b.get("tournament_name") or "").lower()
        if needle in name:
            return int(b["id"]), b.get("tournament_name") or search
    return None, None


def main():
    parser = argparse.ArgumentParser(description="Learn straddle patterns from IQ history")
    parser.add_argument("--search", default="", help="Tournament name substring (optional)")
    parser.add_argument("--balance-id", type=int, default=None, help="Any IQ balance id")
    parser.add_argument(
        "--current",
        action="store_true",
        help="Use the balance selected after connect (practice/real/tournament)",
    )
    parser.add_argument("--days", type=int, default=90)
    parser.add_argument("--apply", action="store_true", help="Write data/learned_pattern.json")
    parser.add_argument(
        "--stats-only",
        action="store_true",
        help="Win/loss by pair only (fast, no candle API spam)",
    )
    parser.add_argument("--candle-sample", type=int, default=280, help="Max unique entry minutes to fetch")
    args = parser.parse_args()

    api = connect_to_iqoption()
    if not api:
        print("Could not connect to IQ Option")
        sys.exit(1)

    from iqoptionapi.stable_api import global_value

    balance_id = args.balance_id
    label = ""
    source_type = ""
    if balance_id is None and args.current:
        balance_id = int(global_value.balance_id)
        label = f"current balance {balance_id}"
    elif balance_id is None and args.search:
        balance_id, label = _find_tournament(api, args.search)
        if balance_id is None:
            print(f"No tournament found for: {args.search}")
            sys.exit(1)
        source_type = "TOURNAMENT"
    elif balance_id is None:
        balance_id = int(global_value.balance_id)
        label = f"current balance {balance_id}"
    else:
        label = f"balance {balance_id}"

    print(f"Analyzing {label} (id={balance_id})…")
    result = learn_from_account_history(
        api,
        balance_id=balance_id,
        account_label=label,
        source_account_type=source_type,
        days_back=args.days,
        enrich_candles=not args.stats_only,
        max_candle_lookups=args.candle_sample,
    )

    if result.get("error"):
        print("Error:", result["error"])
        sys.exit(1)

    btc = result.get("before_trade_conditions") or {}
    print(json.dumps(
        {
            "win_rate_pct": result.get("win_rate_pct"),
            "wins": result.get("wins"),
            "losses": result.get("losses"),
            "trades_with_snapshots": result.get("trades_with_snapshots"),
            "chart_summary": btc.get("chart_summary"),
            "insights": result.get("insights"),
            "bot_rules": result.get("bot_rules"),
            "by_asset": result.get("by_asset"),
            "by_asset_chart": result.get("by_asset_chart"),
            "gate_accuracy": result.get("gate_accuracy"),
        },
        indent=2,
    ))

    if args.apply:
        path = save_pattern_profile(result)
        print(f"\nSaved bot rules to {path}")


if __name__ == "__main__":
    main()
