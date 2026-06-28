import json
import logging
import datetime
from typing import Dict, Any, List

logger = logging.getLogger(__name__)

# Strict safety boundaries for the bot
SAFETY_BOUNDARIES = {
    "min_efficiency_ratio": {"min": 0.15, "max": 0.45},
    "min_directional_slope": {"min": 10.0, "max": 40.0},
    "max_doji_streak": {"min": 1, "max": 4},
    "min_movement_score": {"min": 1.0, "max": 5.0},
}

class TradeAnalystAgent:
    """Analyzes recent trades and generates natural language recommendations."""
    
    def __init__(self, ai_assessor):
        self.ai_assessor = ai_assessor

    def run(self, recent_trades: List[Dict[str, Any]]) -> str:
        if not recent_trades:
            return "Not enough recent trades to analyze."
            
        wins = [t for t in recent_trades if float(t.get("round_profit", 0)) > 0]
        losses = [t for t in recent_trades if float(t.get("round_profit", 0)) < 0]
        
        # Format a summary of the trades
        trade_lines = []
        for i, t in enumerate(recent_trades):
            status = "WIN" if float(t.get("round_profit", 0)) > 0 else "LOSS"
            er = t.get("entry_er", "N/A")
            slope = t.get("entry_slope", "N/A")
            ai_dir = t.get("ai_direction", "N/A")
            bot_dir = t.get("bot_direction", "N/A")
            trade_lines.append(f"Trade {i+1}: {status} | ER: {er} | Slope: {slope} | AI Dir: {ai_dir} | Bot Dir: {bot_dir}")
            
        trade_summary = "\n".join(trade_lines)
        
        prompt = f"""You are the 'Trade Analyst Agent' for a Double Martingale trading bot.
Review the following recent trades (Wins: {len(wins)}, Losses: {len(losses)}):

{trade_summary}

Analyze what went wrong on the losses and what went right on the wins (focusing on Efficiency Ratio 'ER' and 'Slope'). 
Generate a JSON output with your findings and recommended threshold tweaks.

Schema:
{{
  "analysis": "detailed explanation of patterns found",
  "recommendations": {{
    "min_efficiency_ratio": float_suggestion,
    "min_directional_slope": float_suggestion
  }}
}}
Respond ONLY with JSON and no markdown formatting.
"""
        result = self.ai_assessor.generate_json(prompt)
        if result:
            logger.info("🕵️ Analyst Agent generated recommendations.")
            return result
        return {"analysis": "Analysis failed.", "recommendations": {}}


class SupervisorAgent:
    """Reviews Analyst recommendations, enforces safety constraints, and applies config changes."""
    
    def __init__(self, ai_assessor):
        self.ai_assessor = ai_assessor

    def _clamp(self, value: float, min_val: float, max_val: float) -> float:
        return max(min_val, min(max_val, value))

    def run(self, analyst_report: Dict[str, Any], current_config: Dict[str, Any], pair_learning: Dict[str, Any]) -> Dict[str, Any]:
        prompt = f"""You are the 'Supervisor Agent'.
The Trade Analyst has provided the following report:
{json.dumps(analyst_report, indent=2)}

Current Bot Configurations:
{json.dumps(current_config, indent=2)}

Current Pair Learning Status (Assets currently blacklisted or heavily restricted by the bot's internal memory):
{json.dumps(pair_learning, indent=2)}

Decide which recommendations to accept. You must stay within these absolute safety boundaries:
{json.dumps(SAFETY_BOUNDARIES, indent=2)}

Note: Consider the Pair Learning Status! If an asset is already blocked or heavily penalized, do not make extreme global threshold changes to try to fix it. The bot is already handling it.

Output the final configuration parameters that should be updated, and your reasoning.

Schema:
{{
  "reasoning": "why you are applying these changes",
  "config_updates": {{
    "min_efficiency_ratio": float,
    "min_directional_slope": float
  }}
}}
Respond ONLY with JSON and no markdown formatting.
"""
        result = self.ai_assessor.generate_json(prompt)
        
        final_updates = {}
        reasoning = "No changes applied."
        
        if result and "config_updates" in result:
            raw_updates = result["config_updates"]
            reasoning = result.get("reasoning", "Applied AI adjustments.")
            
            # Python-level Safety Guardrails (prevents AI hallucination/extreme values)
            for key, bounds in SAFETY_BOUNDARIES.items():
                if key in raw_updates and raw_updates[key] is not None:
                    try:
                        val = float(raw_updates[key])
                        clamped_val = self._clamp(val, bounds["min"], bounds["max"])
                        final_updates[key] = round(clamped_val, 3)
                        if val != clamped_val:
                            logger.warning(f"🛡️ Supervisor Agent clipped {key} from {val} to {clamped_val}")
                    except (ValueError, TypeError):
                        pass
        
        return {
            "reasoning": reasoning,
            "updates": final_updates,
            "raw_analyst_report": analyst_report
        }

class EvaluatorAgent:
    """Evaluates the performance of the latest config change vs the previous one."""
    
    def __init__(self, ai_assessor):
        self.ai_assessor = ai_assessor

    def run(self, previous_stats: Dict[str, Any], current_stats: Dict[str, Any], previous_config: Dict[str, Any], current_config: Dict[str, Any]) -> Dict[str, Any]:
        prompt = f"""You are the 'Evaluator Agent' for a trading bot. Your job is to A/B test AI configuration changes and protect the bot from regression.

Compare the performance BEFORE the config change to the performance AFTER the config change.

--- PREVIOUS CONFIG ---
{json.dumps(previous_config, indent=2)}
Stats Before Change: {json.dumps(previous_stats, indent=2)}

--- CURRENT CONFIG ---
{json.dumps(current_config, indent=2)}
Stats After Change: {json.dumps(current_stats, indent=2)}

Rules:
1. "trades" tells you the sample size. If the Current Config has taken fewer than 5 trades, you MUST NOT revert unless the performance is a catastrophic 0% win rate or huge loss, because the sample size is too small to judge against market variance.
2. If the current config shows a clear, statistically significant degradation in win rate or P/L, output action: "revert".
3. Otherwise, output action: "keep".

Schema:
{{
  "action": "keep" or "revert",
  "reasoning": "Explain your decision, citing sample sizes and performance differences."
}}
Respond ONLY with JSON and no markdown formatting.
"""
        result = self.ai_assessor.generate_json(prompt)
        
        if result and "action" in result:
            logger.info(f"⚖️ Evaluator Agent decided to {result['action'].upper()}.")
            return result
            
        return {"action": "keep", "reasoning": "Evaluation failed to return valid JSON, defaulting to keep."}

def run_optimization_agents(ai_assessor, recent_trades: List[Dict[str, Any]], current_config: Dict[str, Any], pair_learning: Dict[str, Any]) -> Dict[str, Any]:
    """Runs the Analyst and Supervisor AI agents."""
    if not ai_assessor:
        return {"error": "AI Assessor not available."}
        
    logger.info("🤖 Starting AI Optimization Phase...")
    
    analyst = TradeAnalystAgent(ai_assessor)
    analyst_report = analyst.run(recent_trades)
    
    supervisor = SupervisorAgent(ai_assessor)
    supervisor_result = supervisor.run(analyst_report, current_config, pair_learning)
    
    # Attach timestamp
    supervisor_result["timestamp"] = datetime.datetime.utcnow().isoformat()
    
    return supervisor_result
