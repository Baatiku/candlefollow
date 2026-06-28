"""Monte Carlo simulator for tier ladder recovery (planning tool)."""
import random


def simulate_sessions(
    win_rate=0.55,
    sessions=1000,
    budget_tiers=None,
    tier1_steps=(5, 20, 50),
    tier2_steps=(10, 40, 100),
    tier3_steps=(20, 80, 200),
    payout_mult=1.85,
    straddle=False,
):
    """
    Each session walks the full tier ladder: win ends cycle; loss advances step;
    tier exhaustion escalates until the last tier, then hard-stops.

    straddle=False (default): single-leg directional trade.
      - Loss cost  = bet
      - Win profit = bet * payout_mult - bet   (= bet * 0.85 at 85% payout)

    straddle=True: simultaneous CALL + PUT placement.
      - Loss cost  = 2 * bet  (both legs lose)
      - Win profit = bet * payout_mult - bet   (one leg wins, one loses)
    """
    if budget_tiers is not None:
        tiers = [list(t) for t in budget_tiers]
    else:
        tiers = [list(tier1_steps), list(tier2_steps), list(tier3_steps)]

    total_pnl = 0.0
    max_debt = 0.0
    hard_stops = 0

    for _ in range(sessions):
        tier_idx = 0
        debt = 0.0
        session_profit = 0.0
        step = 0

        while tier_idx < len(tiers):
            tier = tiers[tier_idx]
            bet = tier[step]
            loss_cost = (2 * bet) if straddle else bet
            win_profit = bet * payout_mult - bet
            if random.random() < win_rate:
                session_profit += win_profit
                if session_profit > 0:
                    debt = max(0, debt - session_profit)
                break
            session_profit -= loss_cost
            step += 1
            if step >= len(tier):
                debt += abs(session_profit)
                max_debt = max(max_debt, debt)
                if tier_idx >= len(tiers) - 1:
                    hard_stops += 1
                    break
                tier_idx += 1
                step = 0
                session_profit = 0.0
        total_pnl += session_profit

    return {
        "sessions": sessions,
        "win_rate": win_rate,
        "straddle": straddle,
        "payout_mult": payout_mult,
        "total_pnl": round(total_pnl, 2),
        "avg_pnl_per_session": round(total_pnl / sessions, 2),
        "max_debt_seen": round(max_debt, 2),
        "hard_stops": hard_stops,
        "tiers": tiers,
    }
