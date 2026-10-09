"""Team radio transcripts.

F1 publishes a selection of driver/team radio clips for each session
(TeamRadio.jsonStream plus one mp3 per clip on the static API) but no text,
so every clip is transcribed locally with faster-whisper.
"""

from __future__ import annotations

import io
import logging
import os
import re
import threading
from datetime import timedelta

import fastf1
import fastf1._api
import httpx
from fastf1.utils import to_datetime

from services import storage
from services.f1_data import CACHE_DIR

logger = logging.getLogger(__name__)

_WHISPER_DIR = os.path.join(CACHE_DIR, "whisper")
# The container user has no home directory for huggingface_hub to write to
os.environ.setdefault("HF_HOME", _WHISPER_DIR)

# Benchmarked on the 2-core ARM VPS: small.en ~5 s per clip; large-v3-turbo read
# a little better but took ~18 s per clip with both cores pegged.
_MODEL_NAME = "small.en"
# One thread leaves the other core to the API and live broadcaster.
_CPU_THREADS = 1
_model = None
_model_lock = threading.Lock()


def _transcribe(audio: bytes, speaker: str = "") -> str:
    global _model
    with _model_lock:
        if _model is None:
            from faster_whisper import WhisperModel
            _model = WhisperModel(
                _MODEL_NAME, device="cpu", compute_type="int8", cpu_threads=_CPU_THREADS,
                download_root=_WHISPER_DIR,
            )
        # Vocabulary only: whole phrases in the prompt ("Box box") leak into the text
        prompt = f"Formula 1 team radio{f' with {speaker}' if speaker else ''}: track, DRS, tyres, gap, lap, safety car, VSC."
        segments, _ = _model.transcribe(
            io.BytesIO(audio), language="en", beam_size=5, vad_filter=True, initial_prompt=prompt,
        )
        text = " ".join(s.text.strip() for s in segments).strip()
    # On near-silent clips Whisper echoes the prompt back
    words = set(re.findall(r"[a-z0-9]+", text.lower()))
    return "" if words <= set(re.findall(r"[a-z0-9]+", prompt.lower())) else text


def _fetch_clip(api_path: str, clip_path: str) -> bytes:
    headers = {}
    if key := os.environ.get("F1_SIGNALR_PROXY_KEY", ""):
        headers["X-Proxy-Key"] = key
    r = httpx.get(f"{fastf1._api.base_url}{api_path}{clip_path}", headers=headers, timeout=30)
    r.raise_for_status()
    return r.content


def transcribe_capture(api_path: str, capture: dict, speaker: str = "") -> str:
    """Download one TeamRadio capture ({Utc, RacingNumber, Path}) and return its text."""
    return _transcribe(_fetch_clip(api_path, capture["Path"]), speaker)


def _captures(api_path: str) -> list[dict]:
    out: list[dict] = []
    for _, content in fastf1._api.fetch_page(api_path, "team_radio") or []:
        caps = content.get("Captures") if isinstance(content, dict) else None
        # The first line is a list, later lines are dicts keyed by index
        out.extend(caps.values() if isinstance(caps, dict) else caps or [])
    return out


def _replay_zero(api_path: str, rc: list[dict]):
    """UTC instant of replay timestamp 0.

    rc_messages.json timestamps are (message Utc - replay zero), so the earliest
    stored message pins the offset without loading the session's telemetry.
    """
    if not rc:
        return None
    rcm = fastf1._api.race_control_messages(api_path)
    times = sorted(t for t, m in zip(rcm["Time"], rcm["Message"]) if m and t is not None)
    return times[0] - timedelta(seconds=float(rc[0]["timestamp"])) if times else None


def build_radio_list(year: int, round_num: int, session_type: str) -> list[dict]:
    """Transcribed radio clips with replay timestamps, oldest first."""
    base = f"sessions/{year}/{round_num}/{session_type}"
    api_path = fastf1.get_session(year, round_num, session_type).api_path
    zero = _replay_zero(api_path, storage.get_json(f"{base}/rc_messages.json") or [])
    if zero is None:
        # Processed before rc_messages.json existed: load the session (slow, ~300 MB)
        from services.f1_data import _load_session, _replay_min_date, clear_telemetry_memo
        zero = _replay_min_date(_load_session(year, round_num, session_type))
        clear_telemetry_memo()
    if zero is None:
        return []
    info = storage.get_json(f"{base}/info.json") or {}
    by_number = {str(d.get("driver_number")): d for d in info.get("drivers", [])}

    out: list[dict] = []
    failed = 0
    for cap in _captures(api_path):
        drv = by_number.get(str(cap.get("RacingNumber")), {})
        try:
            text = transcribe_capture(api_path, cap, drv.get("full_name", ""))
        except Exception as e:
            logger.warning(f"Radio clip {cap.get('Path')} failed: {e}")
            failed += 1
            continue
        if not text:
            continue  # silence or noise only
        out.append({
            "timestamp": round((to_datetime(cap["Utc"]) - zero).total_seconds(), 1),
            "driver": drv.get("abbreviation", ""),
            "text": text,
        })
    if failed and not out:
        # Systemic failure (proxy down, decoder broken): don't store an empty list for good
        raise RuntimeError(f"all {failed} radio clips failed")
    out.sort(key=lambda m: m["timestamp"])
    return out


def store_radio(year: int, round_num: int, session_type: str) -> None:
    """Transcribe the session's radio into radio.json (slow: seconds per clip)."""
    prefix = f"{year} R{round_num} {session_type}"
    try:
        radio = build_radio_list(year, round_num, session_type)
        storage.put_json(f"sessions/{year}/{round_num}/{session_type}/radio.json", radio)
        logger.info(f"[{prefix}] Transcribed {len(radio)} radio clips")
    except Exception as e:
        logger.warning(f"[{prefix}] Team radio failed: {e}")


# Sessions already handed to a worker in this process (never retried until restart)
_queued: set[tuple] = set()
_queued_lock = threading.Lock()


def queue_radio(year: int, round_num: int, session_type: str) -> None:
    """Transcribe in a background thread; clips are serialized on the model lock."""
    key = (year, round_num, session_type)
    with _queued_lock:
        if key in _queued:
            return
        _queued.add(key)
    threading.Thread(target=store_radio, args=key, daemon=True).start()
