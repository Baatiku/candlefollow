"""One-off IQ connection for analysis when the trading bot is stopped."""
from __future__ import annotations

import logging

from connection import connect_to_iqoption

logger = logging.getLogger(__name__)

_active_api = None


def get_standalone_api(force_new: bool = False):
    """Connect once for history/analysis; avoids needing the FastAPI bot session."""
    global _active_api
    if _active_api and not force_new:
        try:
            if _active_api.check_connect():
                return _active_api
        except Exception:
            _active_api = None
    api = connect_to_iqoption(max_retries=3, base_delay=3)
    if api:
        _active_api = api
    return api


def disconnect_standalone():
    global _active_api
    _active_api = None
