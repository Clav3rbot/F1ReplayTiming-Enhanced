"""Where a session's track outline comes from when the session has none yet.

A live session starts before anything of its weekend has been processed, and
the circuit outline is what the live map draws car positions on. Outlines are
looked up by circuit (schedule location), never by round number: calendars
reshuffle every year, so "same round last year" is usually a different track.
"""

from __future__ import annotations

import logging
import threading

from services import storage
from services.f1_data import _fetch_schedule_sync, _get_track_data_sync

logger = logging.getLogger(__name__)

_SESSION_TYPES = ("R", "Q", "S", "SQ", "FP1", "FP2", "FP3")
_YEARS_BACK = 3


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


_building: set[str] = set()
_building_lock = threading.Lock()


def ensure_circuit_outline(year: int, round_num: int) -> dict | None:
    """Make sure the weekend has an outline before its first live session.

    When storage has nothing for this circuit, draw it from the same circuit's
    qualifying (then race) of an earlier season and keep it under circuits/.
    Downloads one session, so it runs in a thread; concurrent calls for the
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
                    data = _get_track_data_sync(y, r, t)
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
