"""Sessions that failed to download, for the home page.

Background downloads (auto_precompute) and reprocesses run with no one
watching, so their failures are kept in config/download_problems.json until
the session next downloads or is deleted.
"""

from __future__ import annotations

import logging
import re
import threading
import time
from typing import Any

from services import storage

logger = logging.getLogger(__name__)

_PATH = "config/download_problems.json"
_lock = threading.Lock()


def _read() -> dict[str, dict[str, Any]]:
    try:
        return storage.get_json(_PATH) or {}
    except Exception:
        return {}


def _key(year: int, round_num: int, session_type: str) -> str:
    return f"{year}_{round_num}_{session_type}"


def record(year: int, round_num: int, session_type: str, message: str) -> None:
    # Exceptions can carry internal addresses (the proxy, storage): the logs keep the full text
    message = re.sub(r"https?://\S+", "<address>", message or "") or "Download failed. The server's logs have the details."
    with _lock:
        data = _read()
        data[_key(year, round_num, session_type)] = {
            "year": year,
            "round": round_num,
            "type": session_type,
            "message": message[:500],
            "time": time.time(),
        }
        try:
            storage.put_json(_PATH, data)
        except Exception as e:
            logger.warning(f"Couldn't save download problems: {e}")


def clear(year: int, round_num: int, session_type: str) -> None:
    with _lock:
        data = _read()
        if data.pop(_key(year, round_num, session_type), None) is not None:
            try:
                storage.put_json(_PATH, data)
            except Exception as e:
                logger.warning(f"Couldn't save download problems: {e}")


def all_problems() -> list[dict[str, Any]]:
    """Newest first."""
    with _lock:
        return sorted(_read().values(), key=lambda p: p["time"], reverse=True)
