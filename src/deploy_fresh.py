"""Detect new Railway deploys and trigger a full data wipe once per deployment."""
import os
import logging

logger = logging.getLogger(__name__)

_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
_MARKER_PATH = os.path.join(_DATA_DIR, "last_railway_deployment.txt")


def _env_truthy(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def should_wipe_on_deploy() -> bool:
    """
    True once per Railway deployment (new RAILWAY_DEPLOYMENT_ID).
    Falls back to FRESH_START_ON_DEPLOY when not on Railway.
    """
    deploy_id = (os.environ.get("RAILWAY_DEPLOYMENT_ID") or "").strip()
    if deploy_id:
        os.makedirs(_DATA_DIR, exist_ok=True)
        try:
            if os.path.isfile(_MARKER_PATH):
                with open(_MARKER_PATH, "r", encoding="utf-8") as f:
                    last = f.read().strip()
            else:
                last = ""
        except OSError as e:
            logger.warning("Could not read deploy marker: %s", e)
            last = ""

        if last == deploy_id:
            return False

        try:
            with open(_MARKER_PATH, "w", encoding="utf-8") as f:
                f.write(deploy_id)
        except OSError as e:
            logger.warning("Could not write deploy marker: %s", e)
        logger.info("New Railway deployment detected (%s) — fresh start", deploy_id[:12])
        return True

    # Local / non-Railway: opt-in via env (default off so dev keeps state)
    return _env_truthy("FRESH_START_ON_DEPLOY", default=False)
