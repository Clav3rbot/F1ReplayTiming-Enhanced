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

from services import caption_settings, storage, whisper_models

logger = logging.getLogger(__name__)

_WHISPER_DIR = str(whisper_models.MODEL_DIR)
# The container user has no home directory for huggingface_hub to write to
os.environ.setdefault("HF_HOME", _WHISPER_DIR)

# One thread leaves the other core to the API and live broadcaster.
_CPU_THREADS = 1
_models: dict = {}
_model_lock = threading.Lock()


def _get_model(live: bool = False):
    # Read each time, so a model chosen in the app is used from the next clip
    name = caption_settings.whisper_model(live)
    if not whisper_models.is_downloaded(name):
        # Keep captioning with a model that's already here while the chosen one
        # downloads in the background; with none here, load (and download) it now
        here = next(iter(_models), None) or next(
            (m["id"] for m in caption_settings.WHISPER_MODELS if whisper_models.is_downloaded(m["id"])), None,
        )
        if here:
            whisper_models.ensure(name)
            name = here
    if name not in _models:
        from faster_whisper import WhisperModel
        logger.info(f"Loading Whisper model {name} (downloads on first use)")
        # At most the replay and the live model in memory: they take 0.3-1.5 GB each
        if len(_models) >= 2:
            _models.pop(next(iter(_models)))
        _models[name] = WhisperModel(
            name, device="cpu", compute_type="int8", cpu_threads=_CPU_THREADS, download_root=_WHISPER_DIR,
        )
    return _models[name]


def _prompt(speaker: str, year: int | None) -> str:
    """Vocabulary only, and no everyday words: whole phrases in the prompt ("Box box")
    leak into the text, and Whisper reads the prompt back on near-silent clips."""
    # DRS was replaced by boost and overtake mode in 2026
    era = "boost, overtake mode" if year is None or year >= 2026 else "DRS"
    return f"Formula 1 team radio{f' with {speaker}' if speaker else ''}. Tyres, safety car, {era}."


def _transcribe(audio: bytes, speaker: str = "", year: int | None = None, live: bool = False) -> str:
    """Whisper's caption for one clip ("" when nothing was said)."""
    prompt = _prompt(speaker, year)
    with _model_lock:
        segments, _ = _get_model(live).transcribe(
            io.BytesIO(audio), language="en", beam_size=5, vad_filter=True, initial_prompt=prompt,
        )
        text = " ".join(s.text.strip() for s in segments).strip()
    # A read-back repeats a piece of the prompt in order; real radio may use its words ("Safety car, box")
    words = " ".join(re.findall(r"[a-z0-9]+", text.lower()))
    if not words or f" {words} " in f" {' '.join(re.findall(r'[a-z0-9]+', prompt.lower()))} ":
        return ""
    # F1 spelling, whatever the model writes
    return re.sub(r"\b([Tt])ires\b", r"\1yres", text)


def _fetch_clip(api_path: str, clip_path: str) -> bytes:
    headers = {}
    if key := os.environ.get("F1_SIGNALR_PROXY_KEY", ""):
        headers["X-Proxy-Key"] = key
    # The clips sit in F1's archive, which needs the F1 TV token since 2026-10-15
    try:
        from fastf1.internals.f1account import get_token
        headers["Authorization"] = get_token().authorization_header
    except Exception as e:
        logger.warning(f"No F1 TV token for team radio: {e}")
    r = httpx.get(f"{fastf1._api.base_url}{api_path}{clip_path}", headers=headers, timeout=30)
    r.raise_for_status()
    return r.content


def transcribe_capture(api_path: str, capture: dict, speaker: str = "", year: int | None = None) -> tuple[str, bytes]:
    """Download one live TeamRadio capture ({Utc, RacingNumber, Path}): its caption and audio."""
    audio = _fetch_clip(api_path, capture["Path"])
    return _transcribe(audio, speaker, year, live=True), audio


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
        from services.f1_data import _load_session, _replay_min_date, clear_telemetry_memo, hold_weekend, release_weekend
        hold_weekend(year, round_num)
        try:
            zero = _replay_min_date(_load_session(year, round_num, session_type))
        finally:
            clear_telemetry_memo()
            release_weekend(year, round_num)
    if zero is None:
        return []
    info = storage.get_json(f"{base}/info.json") or {}
    by_number = {str(d.get("driver_number")): d for d in info.get("drivers", [])}

    out: list[dict] = []
    failed = 0
    for cap in _captures(api_path):
        drv = by_number.get(str(cap.get("RacingNumber")), {})
        try:
            audio = _fetch_clip(api_path, cap["Path"])
            text = _transcribe(audio, drv.get("full_name", ""), year)
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
            "audio": _store_audio(base, cap["Path"], audio),
        })
    if failed and not out:
        # Systemic failure (proxy down, decoder broken): don't store an empty list for good
        raise RuntimeError(f"all {failed} radio clips failed")
    out.sort(key=lambda m: m["timestamp"])
    return out


def _store_audio(base: str, clip_path: str, audio: bytes) -> str:
    """Keep the clip with the session (F1's copy needs an F1 TV token); returns its file name."""
    name = clip_path.rsplit("/", 1)[-1]
    storage.put_bytes(f"{base}/radio/{name}", audio, "audio/mpeg")
    return name


def add_radio_audio(year: int, round_num: int, session_type: str) -> int:
    """Store the audio of an already transcribed session's clips, without transcribing
    again: each capture is matched to its radio.json entry by driver and time.
    Returns how many clips were added."""
    base = f"sessions/{year}/{round_num}/{session_type}"
    radio = storage.get_json(f"{base}/radio.json")
    if not radio:
        return 0
    api_path = fastf1.get_session(year, round_num, session_type).api_path
    zero = _replay_zero(api_path, storage.get_json(f"{base}/rc_messages.json") or [])
    if zero is None:
        return 0
    info = storage.get_json(f"{base}/info.json") or {}
    abbr = {str(d.get("driver_number")): d.get("abbreviation", "") for d in info.get("drivers", [])}
    added = 0
    for cap in _captures(api_path):
        t = round((to_datetime(cap["Utc"]) - zero).total_seconds(), 1)
        drv = abbr.get(str(cap.get("RacingNumber")), "")
        entry = next((m for m in radio if m.get("driver") == drv and abs(m["timestamp"] - t) < 0.6 and not m.get("audio")), None)
        if entry is None:
            continue  # dropped as silence when transcribed
        try:
            entry["audio"] = _store_audio(base, cap["Path"], _fetch_clip(api_path, cap["Path"]))
            added += 1
        except Exception as e:
            logger.warning(f"Radio clip {cap.get('Path')} failed: {e}")
    if added:
        storage.put_json(f"{base}/radio.json", radio)
    return added


def store_radio(year: int, round_num: int, session_type: str) -> None:
    """Transcribe the session's radio into radio.json (slow: seconds per clip)."""
    prefix = f"{year} R{round_num} {session_type}"
    try:
        radio = build_radio_list(year, round_num, session_type)
        storage.put_json(f"sessions/{year}/{round_num}/{session_type}/radio.json", radio)
        logger.info(f"[{prefix}] Transcribed {len(radio)} radio clips")
    except Exception as e:
        logger.warning(f"[{prefix}] Team radio failed: {e}")
        # Let the next /radio request retry (proxy hiccup, model download)
        with _queued_lock:
            _queued.discard((year, round_num, session_type))


# Sessions handed to a worker in this process; a failed one is dropped so it can be retried
_queued: set[tuple] = set()
_queued_lock = threading.Lock()
_workers: list[threading.Thread] = []


def queue_radio(year: int, round_num: int, session_type: str) -> None:
    """Transcribe in a background thread; clips are serialized on the model lock."""
    key = (year, round_num, session_type)
    with _queued_lock:
        if key in _queued:
            return
        _queued.add(key)
    worker = threading.Thread(target=store_radio, args=key, daemon=True)
    _workers[:] = [w for w in _workers if w.is_alive()] + [worker]
    worker.start()


def wait_radio() -> None:
    """Block until every queued transcription has finished (CLI exit)."""
    for worker in list(_workers):
        worker.join()
