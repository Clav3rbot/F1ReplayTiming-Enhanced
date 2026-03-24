import logging

from fastapi import APIRouter, Query, HTTPException
from services.storage import get_json, put_json
from services.f1_data import _get_track_data_sync

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["track"])


@router.get("/sessions/{year}/{round_num}/track")
async def track_geometry(
    year: int,
    round_num: int,
    type: str = Query("R", description="Session type"),
):
    def _needs_corners(track_data: dict | None) -> bool:
        if not track_data:
            return True
        corners = track_data.get("corners")
        if corners is None:
            return True
        if isinstance(corners, list) and len(corners) == 0:
            return True
        return False

    target_path = f"sessions/{year}/{round_num}/{type}/track.json"
    data = get_json(target_path)
    if data is not None:
        if _needs_corners(data):
            # track.json might already exist without corners (old generation),
            # so regenerate corners with the current backend logic.
            try:
                regenerated = _get_track_data_sync(year, round_num, type)
                if regenerated and not _needs_corners(regenerated):
                    put_json(target_path, regenerated)
                    return regenerated
            except Exception as e:
                logger.warning(f"Could not regenerate corners for {target_path}: {e}")
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
            if _needs_corners(data):
                try:
                    regenerated = _get_track_data_sync(year, round_num, alt_type)
                    if regenerated and not _needs_corners(regenerated):
                        put_json(alt_path, regenerated)
                        return regenerated
                except Exception as e:
                    logger.warning(f"Could not regenerate corners for fallback {alt_path}: {e}")
            return data

    for prev_year in range(year - 1, year - 4, -1):
        for alt_type in ("R", "Q"):
            prev_path = f"sessions/{prev_year}/{round_num}/{alt_type}/track.json"
            data = get_json(prev_path)
            if data is not None:
                logger.info(f"Track fallback: using {prev_year}/{round_num}/{alt_type} for {year}/{round_num}/{type}")
                if _needs_corners(data):
                    try:
                        regenerated = _get_track_data_sync(prev_year, round_num, alt_type)
                        if regenerated and not _needs_corners(regenerated):
                            put_json(prev_path, regenerated)
                            return regenerated
                    except Exception as e:
                        logger.warning(f"Could not regenerate corners for fallback {prev_path}: {e}")
                return data

    raise HTTPException(
        status_code=404,
        detail="Track data not available for this session.",
    )
