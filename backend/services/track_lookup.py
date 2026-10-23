"""Where a session's track outline comes from when the session has none yet.

A live session starts before anything of its weekend has been processed, and
the circuit outline is what the live map draws car positions on. Outlines are
looked up by circuit (schedule location), never by round number: calendars
reshuffle every year, so "same round last year" is usually a different track.

F1's own archive needs an F1 TV login since October 2026, so outlines of earlier
seasons come from OpenF1 instead. OpenF1 refuses anonymous requests while any
session is live, which is why auto_precompute prepares them the day before.
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timedelta

import fastf1.mvapi
import httpx
import numpy as np

from services import storage
from services.f1_data import _fetch_schedule_sync, _track_from_outline

logger = logging.getLogger(__name__)

_SESSION_TYPES = ("R", "Q", "S", "SQ", "FP1", "FP2", "FP3")
_YEARS_BACK = 3
_OPENF1 = "https://api.openf1.org/v1"
_OPENF1_NAMES = {"Q": "Qualifying", "R": "Race"}


def prepared_outline_path(year: int, round_num: int) -> str:
    """Outline drawn from an earlier season for a weekend not processed yet."""
    return f"circuits/{year}/{round_num}/track.json"


def _location(year: int, round_num: int) -> str | None:
    for e in _fetch_schedule_sync(year):
        if e["round_number"] == round_num:
            return (e.get("location") or "").strip().lower() or None
    return None


def same_circuit_rounds(year: int, round_num: int) -> list[tuple[int, int]]:
    """(year, round) of earlier seasons' events at the same location, newest first."""
    try:
        loc = _location(year, round_num)
    except Exception:
        return []
    if not loc:
        return []
    out = []
    for y in range(year - 1, year - 1 - _YEARS_BACK, -1):
        try:
            events = _fetch_schedule_sync(y)
        except Exception:
            continue
        out += [(y, e["round_number"]) for e in events if (e.get("location") or "").strip().lower() == loc]
    return out


def find_track(year: int, round_num: int, session_type: str) -> tuple[str, dict] | None:
    """(storage path, track.json) for this session, else another session of the
    weekend, the weekend's prepared outline, or the same circuit in an earlier season."""
    paths = [f"sessions/{year}/{round_num}/{session_type}/track.json"]
    paths += [f"sessions/{year}/{round_num}/{t}/track.json" for t in _SESSION_TYPES if t != session_type]
    paths.append(prepared_outline_path(year, round_num))
    for y, r in same_circuit_rounds(year, round_num):
        paths += [f"sessions/{y}/{r}/{t}/track.json" for t in ("R", "Q")]
    for p in paths:
        data = storage.get_json(p)
        if data:
            if p != paths[0]:
                logger.info(f"Track fallback: {p} for {year}/{round_num}/{session_type}")
            return p, data
    return None


def _openf1(path: str, **params) -> list[dict]:
    time.sleep(0.4)  # OpenF1 allows 3 anonymous requests per second
    r = httpx.get(f"{_OPENF1}/{path}", params=params, timeout=60)
    r.raise_for_status()
    return r.json()


def _openf1_outline(year: int, round_num: int, session_type: str) -> dict | None:
    """Outline from the fastest clean lap of that session on OpenF1, with sector
    boundaries from its sector times and corners from MultiViewer."""
    name = _OPENF1_NAMES[session_type]
    event = next((e for e in _fetch_schedule_sync(year) if e["round_number"] == round_num), None)
    ts = next((s["_ts"] for s in (event or {}).get("sessions_raw", []) if s["name"] == name and s["_ts"]), None)
    if ts is None:
        return None
    # Matched by date: OpenF1 and FastF1 spell some locations differently
    session = next((s for s in _openf1("sessions", year=year, session_name=name)
                    if abs(datetime.fromisoformat(s["date_start"]) - ts) < timedelta(days=1)), None)
    if session is None:
        return None
    key = session["session_key"]
    laps = sorted(
        (l for l in _openf1("laps", session_key=key)
         if l.get("lap_duration") and l.get("duration_sector_1") and l.get("duration_sector_2")
         and l.get("date_start") and not l.get("is_pit_out_lap")),
        key=lambda l: l["lap_duration"],
    )
    for lap in laps[:3]:
        start = datetime.fromisoformat(lap["date_start"])
        end = start + timedelta(seconds=lap["lap_duration"])
        # One driver's whole session (~1 MB): OpenF1 rejects date filters sent URL-encoded
        pts = [p for p in _openf1("location", session_key=key, driver_number=lap["driver_number"])
               if start <= datetime.fromisoformat(p["date"]) <= end]
        if len(pts) < 100:
            continue
        times = np.array([datetime.fromisoformat(p["date"]).timestamp() for p in pts])
        s1 = start.timestamp() + lap["duration_sector_1"]
        s2 = s1 + lap["duration_sector_2"]
        sector_boundaries = {
            "s1_end": int(np.abs(times - s1).argmin()),
            "s2_end": int(np.abs(times - s2).argmin()),
            "total": len(pts),
        }
        try:
            circuit_info = fastf1.mvapi.get_circuit_info(year=year, circuit_key=session["circuit_key"])
        except Exception:
            circuit_info = None
        return _track_from_outline(
            [p["x"] for p in pts], [p["y"] for p in pts], [p["z"] for p in pts],
            circuit_info, sector_boundaries, session.get("location") or "",
        )
    return None


_building: set[str] = set()
_building_lock = threading.Lock()


def ensure_circuit_outline(year: int, round_num: int) -> dict | None:
    """Make sure the weekend has an outline before its first live session.

    When storage has nothing for this circuit, draw it from the same circuit's
    qualifying (then race) of an earlier season and keep it under circuits/.
    Downloads from OpenF1, so it runs in a thread; concurrent calls for the
    same weekend return None while the first one is still at it.
    """
    found = find_track(year, round_num, "R")
    if found:
        return found[1]
    key = f"{year}_{round_num}"
    with _building_lock:
        if key in _building:
            return None
        _building.add(key)
    try:
        for y, r in same_circuit_rounds(year, round_num):
            for t in ("Q", "R"):
                try:
                    data = _openf1_outline(y, r, t)
                except Exception as e:
                    logger.info(f"No outline from {y}/{r}/{t} for {year}/{round_num}: {e}")
                    continue
                if data:
                    data["outline_from"] = f"{y}/{r}/{t}"
                    storage.put_json(prepared_outline_path(year, round_num), data)
                    logger.info(f"Prepared outline for {year}/{round_num} from {y}/{r}/{t}")
                    return data
        logger.warning(f"No earlier season has an outline for {year}/{round_num}")
        return None
    finally:
        with _building_lock:
            _building.discard(key)
