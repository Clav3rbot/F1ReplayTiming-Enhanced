"""Simple site-wide passphrase authentication."""

from __future__ import annotations

import hashlib
import hmac
import os
import threading
import time


def is_auth_enabled() -> bool:
    return os.environ.get("AUTH_ENABLED", "false").lower() in ("true", "1", "yes")


def _get_passphrase() -> str:
    return os.environ.get("AUTH_PASSPHRASE", "")


# --- Login rate limiting (per IP, in-memory) ---
_login_attempts: dict[str, list[float]] = {}
_attempts_lock = threading.Lock()
_LOGIN_MAX = 5
_LOGIN_WINDOW = 60.0  # seconds


def check_rate_limit(ip: str) -> bool:
    """Return True if request allowed, False if rate limited."""
    now = time.monotonic()
    with _attempts_lock:
        attempts = [t for t in _login_attempts.get(ip, []) if now - t < _LOGIN_WINDOW]
        if len(attempts) >= _LOGIN_MAX:
            _login_attempts[ip] = attempts
            return False
        attempts.append(now)
        _login_attempts[ip] = attempts
        return True


def generate_token(passphrase: str) -> str | None:
    expected = _get_passphrase().strip()
    if not expected:
        return None
    if not hmac.compare_digest(passphrase.strip().encode(), expected.encode()):
        return None
    return _make_token(expected)


def verify_token(token: str) -> bool:
    expected = _get_passphrase()
    if not expected or not token:
        return False
    return hmac.compare_digest(token, _make_token(expected))


def _make_token(passphrase: str) -> str:
    return hashlib.sha256(f"f1replay:{passphrase}".encode()).hexdigest()
