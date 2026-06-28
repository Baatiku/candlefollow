"""Optional Telegram / Discord alerts for bot events."""
import logging
import os
import urllib.request
import urllib.parse
import json

logger = logging.getLogger(__name__)


def _telegram(message: str) -> bool:
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
    if not token or not chat_id:
        return False
    try:
        url = f"https://api.telegram.org/bot{token}/sendMessage"
        # Use JSON body + Content-Type to avoid HTTP 400 from special characters
        payload = json.dumps({
            "chat_id": chat_id,
            "text": message[:4000],
        }).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status == 200
    except Exception as e:
        logger.warning(f"Telegram alert failed: {e}")
        return False


def _discord(message: str) -> bool:
    webhook = os.environ.get("DISCORD_WEBHOOK_URL", "").strip()
    if not webhook:
        return False
    try:
        payload = json.dumps({"content": message[:2000]}).encode()
        req = urllib.request.Request(
            webhook,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status in (200, 204)
    except Exception as e:
        logger.warning(f"Discord alert failed: {e}")
        return False


def notify(title: str, body: str = ""):
    """Send alert if Telegram or Discord env vars are configured."""
    message = f"🤖 IQ Bot — {title}"
    if body:
        message += f"\n{body}"
    sent = _telegram(message) or _discord(message)
    if sent:
        logger.info(f"Alert sent: {title}")
    return sent
