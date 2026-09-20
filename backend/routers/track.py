import logging
from datetime import date, timedelta

from fastapi import APIRouter, Query, HTTPException
from services.storage import get_json, put_json
from services.f1_data import _get_track_data_sync

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["track"])

# How long to trust a "the corner API does not know this circuit" verdict.
# A track new to the calendar shows up in that database within weeks of its
# first race, so this is about eventually picking the corners up, not polling.
CORNER_RECHECK_DAYS = 30


def _has_corners(track_data: dict | None) -> bool:
    """True when this copy carries usable corner data, not just the key."""
    if not track_data:
        return False
    corners = track_data.get("corners")
    return isinstance(corners, list) and len(corners) > 0


def _corner_check_is_due(track_data: dict) -> bool:
    """True when corners are missing and the last attempt is old enough to retry.

    A circuit the upstream API has no entry for (Madrid, new in 2026) answers
    404 every time, so retrying on each request rebuilt the whole session and
    rewrote track.json to storage for nothing. Recording when we last asked
    keeps the retry to once a month, which still picks the corners up once the
    circuit is added upstream.
    """
    if _has_corners(track_data):
        return False
    last = track_data.get("corners_checked")
    if not isinstance(last, str):
        return True
    try:
        checked = date.fromisoformat(last)
    except ValueError:
        return True
    return date.today() - checked >= timedelta(days=CORNER_RECHECK_DAYS)


def _is_stale(track_data: dict | None) -> bool:
    """True when track.json predates a feature the current backend emits.

    Elevation is keyed on presence, not value: a circuit whose telemetry has no
    Z channel still gets `"elevation": null`, so it is not regenerated forever.
    """
    if not track_data:
        return True
    if "elevation" not in track_data:
        return True
    return _corner_check_is_due(track_data)


def _regenerate(path: str, year: int, round_num: int, session_type: str, cached: dict) -> dict:
    """Rebuild track.json with the current backend logic, keeping the cached
    copy if the rebuild fails."""
    try:
        fresh = _get_track_data_sync(year, round_num, session_type)
    except Exception as e:
        logger.warning(f"Could not regenerate track data for {path}: {e}")
        return cached

    if not fresh:
        return cached

    if not _has_corners(fresh) and _has_corners(cached):
        # Never trade away corners we already have for a rebuild that lost them.
        fresh["corners"] = cached["corners"]

    if not _has_corners(fresh):
        # Remember that we asked, so the next request serves this copy instead
        # of rebuilding the session again.
        fresh["corners_checked"] = date.today().isoformat()

    put_json(path, fresh)
    return fresh


@router.get("/sessions/{year}/{round_num}/track")
async def track_geometry(
    year: int,
    round_num: int,
    type: str = Query("R", description="Session type"),
):
    target_path = f"sessions/{year}/{round_num}/{type}/track.json"
    data = get_json(target_path)
    if data is not None:
        if _is_stale(data):
            data = _regenerate(target_path, year, round_num, type, data)
        return data

    # Fast fallback: try other session types or previous years BEFORE
    # triggering slow FastF1 processing (track outlines rarely change)
    for alt_type in ("R", "Q", "S", "SQ", "FP1", "FP2", "FP3"):
        if alt_type == type:
            continue
        alt_path = f"sessions/{year}/{round_num}/{alt_type}/track.json"
        data = get_json(alt_path)
        if data is not None:
            logger.info(f"Track fallback: using {year}/{round_num}/{alt_type} for {type}")
            if _is_stale(data):
                data = _regenerate(alt_path, year, round_num, alt_type, data)
            return data

    for prev_year in range(year - 1, year - 4, -1):
        for alt_type in ("R", "Q"):
            prev_path = f"sessions/{prev_year}/{round_num}/{alt_type}/track.json"
            data = get_json(prev_path)
            if data is not None:
                logger.info(f"Track fallback: using {prev_year}/{round_num}/{alt_type} for {year}/{round_num}/{type}")
                if _is_stale(data):
                    data = _regenerate(prev_path, prev_year, round_num, alt_type, data)
                return data

    raise HTTPException(
        status_code=404,
        detail="Track data not available for this session.",
    )
