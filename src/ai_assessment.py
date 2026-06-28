import time
import json
import logging
from collections import deque
from typing import Optional, Dict, Any, Tuple, Deque, List
from google import genai
from google.genai import types
from google.genai.errors import APIError

logger = logging.getLogger(__name__)


class GeminiKeyPool:
    """Round-robin Gemini keys with 429 cooldowns and per-minute call budgets."""

    def __init__(
        self,
        api_keys_str: str,
        cooldown_seconds: int = 60,
        max_calls_per_minute: int = 4,
    ):
        self.keys = [k.strip() for k in api_keys_str.split(",") if k.strip()]
        self.cooldown_seconds = cooldown_seconds
        self.max_calls_per_minute = max(1, int(max_calls_per_minute))

        self.cooldowns: Dict[str, float] = {k: 0.0 for k in self.keys}
        self.call_timestamps: Dict[str, Deque[float]] = {
            k: deque() for k in self.keys
        }
        self.current_idx = 0

        if not self.keys:
            logger.warning("GeminiKeyPool initialized with NO valid keys!")

    def _prune_calls(self, key: str, now: Optional[float] = None) -> None:
        now = now if now is not None else time.time()
        dq = self.call_timestamps[key]
        while dq and now - dq[0] >= 60.0:
            dq.popleft()

    def is_rate_limited(self, key: str) -> bool:
        if key not in self.call_timestamps:
            return True
        self._prune_calls(key)
        return len(self.call_timestamps[key]) >= self.max_calls_per_minute

    def record_call(self, key: str) -> None:
        if key not in self.call_timestamps:
            return
        now = time.time()
        self._prune_calls(key, now)
        self.call_timestamps[key].append(now)

    def get_next_key(self) -> Optional[str]:
        """Next key that is not on cooldown and under the per-minute budget."""
        if not self.keys:
            return None

        now = time.time()
        start_idx = self.current_idx
        rate_limited_only = True

        while True:
            key = self.keys[self.current_idx]
            self.current_idx = (self.current_idx + 1) % len(self.keys)

            if now < self.cooldowns.get(key, 0.0):
                if self.current_idx == start_idx:
                    if rate_limited_only:
                        logger.error(
                            "🚨 All Gemini API keys are rate-limited "
                            f"(max {self.max_calls_per_minute}/min each)!"
                        )
                    else:
                        logger.error("🚨 All Gemini API keys are currently on cooldown!")
                    return None
                continue

            if self.is_rate_limited(key):
                if self.current_idx == start_idx:
                    logger.error(
                        "🚨 All Gemini API keys are rate-limited "
                        f"(max {self.max_calls_per_minute}/min each)!"
                    )
                    return None
                continue

            rate_limited_only = False
            return key

    def mark_key_cooldown(self, key: str) -> None:
        if key in self.cooldowns:
            self.cooldowns[key] = time.time() + self.cooldown_seconds
            logger.warning(
                f"🔑 Gemini Key marked for {self.cooldown_seconds}s cooldown."
            )


class AITradeAssessor:
    """Gemini trade assessment with rate-limited keys and lean live-path calls."""

    def __init__(
        self,
        api_keys: str,
        timeout: float = 3.0,
        key_cooldown: int = 60,
        max_calls_per_minute: int = 4,
        live_model: str = "gemini-2.5-flash",
    ):
        self.key_pool = GeminiKeyPool(
            api_keys,
            cooldown_seconds=key_cooldown,
            max_calls_per_minute=max_calls_per_minute,
        )
        self.timeout = timeout
        self.live_model = live_model

        self.fallback_models = [
            "gemini-2.5-flash",
            "gemini-3-flash-preview",
            "gemini-flash-preview-09-2025",
            "gemini-2.5-flash-lite-preview-09-2025",
        ]

    def _gen_config(self) -> types.GenerateContentConfig:
        return types.GenerateContentConfig(
            response_mime_type="application/json",
            temperature=0.1,
        )

    def _call_gemini(
        self, model_name: str, key: str, prompt: str
    ) -> Tuple[bool, Optional[str]]:
        try:
            client = genai.Client(
                api_key=key,
                http_options={"timeout": self.timeout},
            )

            response = client.models.generate_content(
                model=model_name,
                contents=prompt,
                config=self._gen_config(),
            )

            return False, response.text

        except APIError as e:
            if e.code == 429:
                return True, None
            logger.debug(f"Gemini API Error with {model_name}: {e}")
            return False, None
        except Exception as e:
            logger.debug(f"Gemini Request failed (timeout/network): {e}")
            return False, None

    def _try_model_once_per_key(
        self, model_name: str, prompt: str, validate_fields: Optional[List[str]] = None
    ) -> Optional[Dict[str, Any]]:
        keys_tried = 0
        n_keys = len(self.key_pool.keys)
        validate_fields = validate_fields or ["approve", "direction"]

        while keys_tried < n_keys:
            key = self.key_pool.get_next_key()
            if not key:
                break
            keys_tried += 1
            self.key_pool.record_call(key)

            is_429, response_text = self._call_gemini(model_name, key, prompt)
            if is_429:
                self.key_pool.mark_key_cooldown(key)
                continue

            if not response_text:
                continue

            try:
                result = json.loads(response_text)
            except json.JSONDecodeError:
                logger.warning(
                    f"AI Assessor: Failed to parse JSON from {model_name}: "
                    f"{response_text[:200]}"
                )
                continue

            if all(field in result for field in validate_fields):
                result["_model_used"] = model_name
                return result

        return None

    def assess_trade(self, context_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Live trade path: one model, one pass across keys (rate-limited).
        """
        prompt = self._build_prompt(context_data)
        result = self._try_model_once_per_key(self.live_model, prompt)
        if result:
            return result

        logger.error(
            "🚨 AI Assessment failed (all keys rate-limited, on cooldown, or timed out)."
        )
        return None

    def generate_json(self, prompt: str) -> Optional[Dict[str, Any]]:
        """
        Background optimization: try fallback models sequentially, still rate-limited.
        """
        for model in self.fallback_models:
            result = self._try_model_once_per_key(model, prompt, validate_fields=[])
            if result is not None:
                return result

        logger.error("🚨 Generic AI generation completely failed.")
        return None

    def _build_prompt(self, data: Dict[str, Any]) -> str:
        # ── 1-min candle table ──
        candle_rows = []
        for i, c in enumerate(data.get("candles", [])):
            body = abs(c["close"] - c["open"])
            direction_char = "▲" if c["close"] >= c["open"] else "▼"
            candle_rows.append(
                f"| {i+1:2d} {direction_char} | {c['open']:.5f} | {c['high']:.5f} | "
                f"{c['low']:.5f} | {c['close']:.5f} | {body:.5f} |"
            )
        candle_table = "\n".join(candle_rows)

        # ── 5-min candle table ──
        candles_5min = data.get("candles_5min", [])
        if candles_5min:
            rows_5 = []
            for i, c in enumerate(candles_5min):
                body = abs(c["close"] - c["open"])
                dc = "▲" if c["close"] >= c["open"] else "▼"
                rows_5.append(
                    f"| {i+1:2d} {dc} | {c['open']:.5f} | {c['high']:.5f} | "
                    f"{c['low']:.5f} | {c['close']:.5f} | {body:.5f} |"
                )
            table_5min = (
                "5-MINUTE CANDLES (last 10, higher timeframe context):\n"
                "| # | Open | High | Low | Close | Body |\n"
                "|---|------|------|-----|-------|------|\n"
                + "\n".join(rows_5)
            )
        else:
            table_5min = "5-MINUTE CANDLES: unavailable"

        # ── Recent trade history on this pair ──
        recent_trades = data.get("recent_pair_trades", [])
        if recent_trades:
            trade_lines = []
            for t in recent_trades:
                ai_str = ""
                if t.get("ai_confidence") is not None:
                    ai_str = f", AI conf={t['ai_confidence']:.2f}"
                ai_approved = t.get("ai_approved")
                if ai_approved is not None:
                    ai_str += f" (AI {'✓' if ai_approved else '✗'})"
                trade_lines.append(
                    f"  - {t['outcome']:4s} | {str(t.get('direction','?')).upper():4s} | Step {t.get('step','?')}{ai_str}"
                )
            history_block = "RECENT TRADES ON THIS PAIR (most recent first):\n" + "\n".join(trade_lines)
        else:
            history_block = "RECENT TRADES ON THIS PAIR: no history yet"

        streak_wins = data.get("streak_wins", 0)
        streak_losses = data.get("streak_losses", 0)
        if streak_wins > 0:
            streak_str = f"Current streak: {streak_wins} consecutive WIN(s)"
        elif streak_losses > 0:
            streak_str = f"Current streak: {streak_losses} consecutive LOSS(es) — be more selective"
        else:
            streak_str = "Current streak: mixed"

        # ── Volatility info ──
        recent_atr = data.get("recent_atr")
        older_atr = data.get("older_atr")
        atr_ratio_str = ""
        if recent_atr and older_atr and older_atr > 0:
            atr_ratio_str = f" (recent/older ratio: {recent_atr/older_atr:.2f})"

        # ── Step risk context ──
        step_scale = data.get("step_scale", 1.0)
        if step_scale and float(step_scale) > 1:
            risk_note = f"⚠ This is a recovery step — bet is {step_scale:.1f}x the base amount. Higher stakes."
        else:
            risk_note = "Step 1 — standard base bet, normal risk."

        return f'''You are an expert binary options market analyst. Your job is to make an informed, data-driven decision about whether the proposed trade should proceed.

ASSET: {data.get("asset")}
PROPOSED DIRECTION: {data.get("direction", "").upper()}
LADDER POSITION: Tier {data.get("tier")} / Step {data.get("step")}
{risk_note}

SESSION: {data.get("session", "unknown")} (Lagos time {data.get("lagos_hour", "?")}:00)
VOLATILITY REGIME: {data.get("volatility_trend", "unknown")}{atr_ratio_str}

{history_block}
{streak_str}

1-MINUTE CANDLES (last {len(data.get("candles", []))} candles):
| # | Open | High | Low | Close | Body |
|---|------|------|-----|-------|------|
{candle_table}

{table_5min}

TECHNICAL INDICATORS (1-min):
- 15-candle slope: {data.get("slope")} (normalized; positive = uptrend, negative = downtrend)
- Efficiency Ratio (ER): {data.get("er")} (0=choppy, 1=perfect trend)
- ATR(5): {data.get("atr")}
- EMA15: {data.get("ema15")} | Current price distance: {data.get("distance_from_ema")} ({data.get("distance_atr")}x ATR)
- Last candle body vs recent average: {data.get("spike_ratio")}x
- Consecutive {data.get("direction","?").upper()} candles in a row: {data.get("consecutive_same_dir_candles", 0)}
- Doji/indecision candles in last 10: {data.get("doji_count_last_10", 0)}
- Trader sentiment: {data.get("mood_pct")}% betting HIGHER (50% = neutral)

HOW TO USE THIS DATA:
- Use the 5-min candles to judge the bigger trend. If the 1-min signal aligns with the 5-min trend, that's a stronger entry.
- If there is a losing streak on this pair, require cleaner signals before approving. A 3+ loss streak in the same direction is a red flag — look for a clear reason why this trade is different.
- Recovery steps (step_scale > 1) carry compounded risk. At step 3+ (6x bet), a clean setup is essential. Reject marginal setups.
- Off-peak/Asian session trades are inherently riskier due to low liquidity — apply extra caution.
- Expanding volatility means wider swings; the current ATR may understate real risk.
- A high ER (>0.5) with aligned slope is a solid trending environment. Low ER (<0.25) + near-zero slope = choppy, avoid.

Respond with ONLY valid JSON and no markdown formatting or backticks.
Schema:
{{"approve": boolean, "direction": "call" or "put", "confidence": float 0.0-1.0, "reason": "one sentence max"}}

CRITICAL RULES:
1. Parabolic spike chase: if price is stretched >2x ATR from EMA AND last candle body >2x average, approve=false. Do NOT suggest the opposite direction — just reject.
2. Trader sentiment is a weak signal. Only use it if everything else is already borderline.
3. Choppy market: ER < 0.20 AND slope near zero AND many doji candles → approve=false.
4. Trends continue more often than they reverse. A clean trend with aligned 5-min and 1-min is a good entry.
5. Recovery steps (scale >3x): raise your bar — only approve on clearly aligned, high-ER setups.
6. When genuinely unsure, default approve=true. Only reject on clear evidence from the data above.
'''
