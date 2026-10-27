"""Team radio caption settings: the Whisper model for replays and live timing.

Each can be set in the environment or from the app (Settings > Team radio).
An environment value wins, and the app shows it as locked. App choices are
saved in storage (config/captions.json).

- TEAM_RADIO_MODEL: the Whisper model for replays (WHISPER_MODELS)
- TEAM_RADIO_LIVE_MODEL: the Whisper model for live timing, where a caption
  must be ready within the broadcast delay; unset, the same as replays
"""

from __future__ import annotations

import logging
import os
import threading
from typing import Any

from services import storage

logger = logging.getLogger(__name__)

_PATH = "config/captions.json"

# Speeds per clip on the 2-core ARM VPS with one CPU thread (int8)
WHISPER_MODELS: list[dict[str, str]] = [
    {"id": "tiny.en", "label": "Tiny", "size": "75 MB",
     "note": "Fastest, least accurate."},
    {"id": "base.en", "label": "Base", "size": "145 MB",
     "note": "Fast, less accurate than Small."},
    {"id": "small.en", "label": "Small", "size": "480 MB",
     "note": "The default. About 5 seconds per clip."},
    {"id": "medium.en", "label": "Medium", "size": "1.5 GB",
     "note": "Slower than Large v3 Turbo and no more accurate."},
    {"id": "large-v3-turbo", "label": "Large v3 Turbo", "size": "1.6 GB",
     "note": "Most accurate. About 18 seconds per clip, so live captions can fall behind."},
]
DEFAULT_WHISPER_MODEL = "small.en"

_lock = threading.Lock()


class CaptionSettingsError(ValueError):
    """An invalid setting from the app."""


def _saved() -> dict[str, Any]:
    try:
        return storage.get_json(_PATH) or {}
    except Exception as e:
        logger.warning(f"Couldn't read caption settings: {e}")
        return {}


def _env(name: str) -> str | None:
    value = os.environ.get(name, "").strip()
    return value or None


def whisper_model(live: bool = False) -> str:
    """The Whisper model for replays, or for live timing."""
    saved = _saved()
    replay = _env("TEAM_RADIO_MODEL") or saved.get("whisper_model") or DEFAULT_WHISPER_MODEL
    if not live:
        return replay
    return _env("TEAM_RADIO_LIVE_MODEL") or saved.get("live_whisper_model") or replay


def describe() -> dict[str, Any]:
    """Settings for the app, with which ones the environment has locked."""
    from services import whisper_models

    return {
        "whisper_model": whisper_model(),
        "whisper_model_locked": _env("TEAM_RADIO_MODEL") is not None,
        "whisper_models": WHISPER_MODELS,
        # null: the same as replays
        "live_whisper_model": _env("TEAM_RADIO_LIVE_MODEL") or _saved().get("live_whisper_model"),
        "live_whisper_model_locked": _env("TEAM_RADIO_LIVE_MODEL") is not None,
        # Whether each Whisper model is on this server, and download progress
        "model_status": {m["id"]: whisper_models.status(m["id"]) for m in WHISPER_MODELS},
    }


def download_selected() -> None:
    """Download the replay and live models now if they aren't here, so
    they're ready before the next clip."""
    from services import whisper_models

    for live in (False, True):
        whisper_models.ensure(whisper_model(live))


_UNSET = object()


def save(whisper: str | None = None, live_whisper: Any = _UNSET) -> dict[str, Any]:
    """Save settings from the app. Ones locked by the environment are refused.
    live_whisper None means "the same as replays"."""
    ids = {m["id"] for m in WHISPER_MODELS}
    with _lock:
        data = _saved()
        if live_whisper is not _UNSET:
            if _env("TEAM_RADIO_LIVE_MODEL"):
                raise CaptionSettingsError("The live caption model is set by TEAM_RADIO_LIVE_MODEL.")
            if live_whisper is not None and live_whisper not in ids:
                raise CaptionSettingsError(f"Unknown caption model: {live_whisper}")
            data["live_whisper_model"] = live_whisper
        if whisper is not None:
            if _env("TEAM_RADIO_MODEL"):
                raise CaptionSettingsError("The caption model is set by TEAM_RADIO_MODEL.")
            if whisper not in ids:
                raise CaptionSettingsError(f"Unknown caption model: {whisper}")
            data["whisper_model"] = whisper
        storage.put_json(_PATH, data)
    return describe()
