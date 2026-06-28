import datetime
import uuid
import logging
import os
from typing import Tuple

try:
    from getmac import get_mac_address
except ImportError:
    pass

logger = logging.getLogger(__name__)

TRIAL_CODE = "BESTA-FREE-TRIAL"
TRIAL_DURATION_DAYS = 3

def _get_conn():
    import psycopg2
    return psycopg2.connect(os.environ["DATABASE_URL"])

def _ensure_table():
    try:
        conn = _get_conn()
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS tokens (
                id SERIAL PRIMARY KEY,
                token_key TEXT UNIQUE NOT NULL,
                status TEXT NOT NULL DEFAULT 'unclaimed',
                duration_days INTEGER NOT NULL,
                activated_at TIMESTAMPTZ,
                expires_at TIMESTAMPTZ,
                hwid TEXT,
                is_trial BOOLEAN NOT NULL DEFAULT FALSE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """)
        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        logger.error(f"Failed to ensure tokens table: {e}")


class LicenseManager:
    def __init__(self):
        _ensure_table()

    def _get_hwid(self) -> str:
        """Return a stable machine ID, persisting it to disk so container/cloud
        restarts always return the same value even when the MAC address is
        unavailable or randomised."""
        hwid_path = os.path.join(
            os.path.dirname(os.path.abspath(__file__)), "..", "data", ".hwid"
        )
        os.makedirs(os.path.dirname(hwid_path), exist_ok=True)
        # Return cached value if it exists
        try:
            if os.path.isfile(hwid_path):
                with open(hwid_path, "r", encoding="utf-8") as f:
                    cached = f.read().strip()
                if cached:
                    return cached
        except OSError:
            pass
        # Generate a fresh stable ID
        hwid = None
        try:
            mac = get_mac_address()
            if mac:
                hwid = mac.upper()
        except Exception:
            pass
        if not hwid:
            hwid = str(uuid.uuid4()).upper()
        # Persist so all future calls return the same value
        try:
            with open(hwid_path, "w", encoding="utf-8") as f:
                f.write(hwid)
        except OSError as e:
            logger.warning("Could not persist HWID: %s", e)
        return hwid

    def _handle_trial(self) -> Tuple[bool, str]:
        current_hwid = self._get_hwid()
        now = datetime.datetime.utcnow()
        try:
            conn = _get_conn()
            cur = conn.cursor()
            cur.execute(
                "SELECT id, status, expires_at FROM tokens WHERE hwid = %s AND is_trial = TRUE",
                (current_hwid,)
            )
            row = cur.fetchone()
            if row:
                row_id, status, expires_at = row
                if status == 'active':
                    if expires_at and now > expires_at.replace(tzinfo=None):
                        cur.execute("UPDATE tokens SET status='expired' WHERE id=%s", (row_id,))
                        conn.commit()
                        cur.close(); conn.close()
                        return False, "Your 72-hour free trial has ended. Purchase a subscription to continue."
                    cur.close(); conn.close()
                    return True, f"Trial active! Expires on {expires_at.strftime('%Y-%m-%d %H:%M')} UTC."
                cur.close(); conn.close()
                return False, "You have already used your free trial on this computer. Purchase a subscription to continue."

            expires_at = now + datetime.timedelta(days=TRIAL_DURATION_DAYS)
            trial_token_key = f"TRIAL-{current_hwid[-8:]}-{uuid.uuid4().hex[:6].upper()}"
            cur.execute(
                """INSERT INTO tokens (token_key, status, duration_days, activated_at, expires_at, hwid, is_trial)
                   VALUES (%s, 'active', %s, %s, %s, %s, TRUE)""",
                (trial_token_key, TRIAL_DURATION_DAYS, now, expires_at, current_hwid)
            )
            conn.commit()
            cur.close(); conn.close()
            logger.info(f"Trial token created: {trial_token_key} for HWID {current_hwid}")
            return True, f"72-hour free trial activated! Expires on {expires_at.strftime('%Y-%m-%d %H:%M')} UTC."
        except Exception as e:
            logger.error(f"Trial activation error: {e}")
            return False, f"Could not activate trial: {e}"

    def validate_and_activate(self, token_key: str) -> Tuple[bool, str]:
        if not os.environ.get("DATABASE_URL"):
            return False, "Database not configured. The bot cannot verify licenses."
        if not token_key:
            return False, "Token cannot be empty."
        if token_key.strip().upper() == TRIAL_CODE:
            return self._handle_trial()

        try:
            conn = _get_conn()
            cur = conn.cursor()
            cur.execute(
                "SELECT id, status, duration_days, expires_at, hwid FROM tokens WHERE token_key = %s",
                (token_key,)
            )
            row = cur.fetchone()
            if not row:
                cur.close(); conn.close()
                return False, "Invalid access token."
            row_id, status, duration_days, expires_at, db_hwid = row
        except Exception as e:
            return False, f"Network Error checking token: {e}"

        current_hwid = self._get_hwid()
        now = datetime.datetime.utcnow()

        if status == 'revoked':
            cur.close(); conn.close()
            return False, "This token has been revoked by the administrator."

        if status == 'unclaimed':
            exp = now + datetime.timedelta(days=int(duration_days or 0))
            try:
                cur.execute(
                    "UPDATE tokens SET status='active', activated_at=%s, expires_at=%s, hwid=%s WHERE id=%s",
                    (now, exp, current_hwid, row_id)
                )
                conn.commit()
                cur.close(); conn.close()
                return True, f"Token successfully activated! Expires on {exp.strftime('%Y-%m-%d')}."
            except Exception as e:
                cur.close(); conn.close()
                return False, f"Failed to activate token: {e}"

        elif status == 'active':
            if db_hwid and db_hwid != current_hwid:
                cur.close(); conn.close()
                return False, "This token is registered to a different computer."
            if expires_at:
                exp_naive = expires_at.replace(tzinfo=None)
                if now > exp_naive:
                    cur.execute("UPDATE tokens SET status='expired' WHERE id=%s", (row_id,))
                    conn.commit()
                    cur.close(); conn.close()
                    return False, "Your access token has expired. Please recharge your account."
                cur.close(); conn.close()
                return True, f"Token valid. Expires on {expires_at.strftime('%Y-%m-%d')}."
            cur.close(); conn.close()
            return True, "Token valid (No Expiration)."

        elif status == 'expired':
            cur.close(); conn.close()
            return False, "Your access token has expired. Please recharge your account."

        cur.close(); conn.close()
        return False, "Unknown token status."
