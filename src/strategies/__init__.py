"""
Strategies package.

Currently a single-file monolith (double_martingale.py ~6000 lines).
Modularisation plan: see docs/ARCHITECTURE_REFACTOR.md

After refactor (Step 1.24), this file will become:
    from strategies.bot import DoubleMartingaleBot
    from strategies.ladder.tiers import STANDARD_BUDGET_TIERS
    __all__ = ["DoubleMartingaleBot", "STANDARD_BUDGET_TIERS"]

Until then: import directly from strategies.double_martingale
"""
from strategies.double_martingale import DoubleMartingaleBot, STANDARD_BUDGET_TIERS

__all__ = ["DoubleMartingaleBot", "STANDARD_BUDGET_TIERS"]
