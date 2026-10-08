"""Simple site-wide passphrase authentication."""

from __future__ import annotations

import hashlib
import hmac
import os
import secrets
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


# --- Session tokens (random, in-memory, expiring) ---
# A token used to be sha256(passphrase): permanent, unrevocable, and an offline
# cracking target for the passphrase if it ever leaked. Now it is random and
# stored only as a hash, so a dump of this dict is useless too.
# ponytail: in-memory, so a restart logs everyone out; move to storage if that hurts.
_sessions: dict[str, float] = {}  # sha256(token) -> expiry (monotonic)
_sessions_lock = threading.Lock()
TOKEN_TTL = 30 * 24 * 3600.0  # seconds
_MAX_SESSIONS = 1000


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def generate_token(passphrase: str) -> str | None:
    expected = _get_passphrase().strip()
    if not expected:
        return None
    if not hmac.compare_digest(passphrase.strip().encode(), expected.encode()):
        return None
    token = secrets.token_urlsafe(32)
    now = time.monotonic()
    with _sessions_lock:
        for h, exp in list(_sessions.items()):
            if exp <= now:
                del _sessions[h]
        if len(_sessions) >= _MAX_SESSIONS:
            # Drop the oldest so a login flood cannot grow memory unbounded
            del _sessions[min(_sessions, key=_sessions.get)]
        _sessions[_hash(token)] = now + TOKEN_TTL
    return token


def verify_token(token: str) -> bool:
    if not _get_passphrase() or not token:
        return False
    with _sessions_lock:
        exp = _sessions.get(_hash(token))
        if exp is None:
            return False
        if exp <= time.monotonic():
            del _sessions[_hash(token)]
            return False
        return True
