import logging
import re

from fastapi import APIRouter, Query, HTTPException
from routers.sessions import SESSION_TYPE_PATTERN
from services.storage import get_json

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["laps"])

# Race control wording, e.g. "CAR 44 (HAM) TIME 1:36.101 DELETED - TRACK LIMITS AT TURN 9 LAP 12 16:36:37",
# "CAR 11 (PER) LAP DELETED - DOUBLE YELLOW AT TURN 12 LAP 2 21:32:22", "CAR LEC TIME 1:36.518 DELETED - ...",
# "CAR 55 (SAI) LAP 1 WILL BE REINSTATED", "CAR 44 (HAM) TIME 1:12.028 WILL BE REINSTATED"
_CAR = re.compile(r"\bCAR (?:\d+ \()?([A-Z]{3})\)?")
_TIME = re.compile(r"\bTIME (\d+:\d{2}\.\d{3})")
_LAP = re.compile(r"\bLAP (\d+)\b")
_REASON = re.compile(r"DELETED - (.+?)(?= LAP \d| \d{2}:\d{2}:\d{2}| \(|$)")


def _mark_deleted_laps(laps: list[dict], rc: list[dict], lap_shift: int) -> None:
    """Add deleted_at / deleted_reason / reinstated_at (replay seconds) to the laps the
    stewards deleted. Kept as times so the replay only strikes a lap once the message is out.

    lap_shift turns race control's LAP n into laps.json's lap_number: checked against every
    stored 2026 message that also gives the time, it is 0 in races and -1 in qualifying."""
    by_key = {(l.get("driver"), l.get("lap_number")): l for l in laps}
    for m in rc:
        text = m.get("message") or ""
        deleted, reinstated = "DELETED" in text, "REINSTATED" in text
        car = _CAR.search(text)
        if not (deleted or reinstated) or not car:
            continue
        drv = car.group(1)
        # The lap time is an exact match; the lap number only when there is no time
        lap = None
        if t := _TIME.search(text):
            lap = next((l for l in laps if l.get("driver") == drv and l.get("lap_time") == t.group(1)), None)
        if lap is None and (lap_no := _LAP.search(text)):
            lap = by_key.get((drv, int(lap_no.group(1)) + lap_shift))
        if lap is None:
            continue
        if deleted:
            lap["deleted_at"] = m.get("timestamp")
            reason = _REASON.search(text)
            lap["deleted_reason"] = reason.group(1).strip() if reason else "Deleted"
        else:
            lap["reinstated_at"] = m.get("timestamp")


@router.get("/sessions/{year}/{round_num}/laps")
def lap_data(
    year: int,
    round_num: int,
    type: str = Query("R", pattern=SESSION_TYPE_PATTERN, description="Session type"),
):
    data = get_json(f"sessions/{year}/{round_num}/{type}/laps.json")
    if data is None:
        raise HTTPException(
            status_code=404,
            detail="Lap data not available for this session.",
        )
    rc = get_json(f"sessions/{year}/{round_num}/{type}/rc_messages.json")
    if isinstance(rc, list):
        _mark_deleted_laps(data, rc, 0 if type in ("R", "S") else -1)
    return {"laps": data}


@router.get("/sessions/{year}/{round_num}/minisectors")
def mini_sectors(
    year: int,
    round_num: int,
    type: str = Query("Q", pattern=SESSION_TYPE_PATTERN, description="Session type"),
):
    data = get_json(f"sessions/{year}/{round_num}/{type}/minisectors.json")
    if data is None:
        raise HTTPException(status_code=404, detail="No mini-sectors for this session.")
    return data
