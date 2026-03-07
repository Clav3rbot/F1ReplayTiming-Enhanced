from fastapi import APIRouter, Query
from services.f1_data import get_season_events, get_session_info

router = APIRouter(prefix="/api", tags=["sessions"])

AVAILABLE_SEASONS = list(range(2018, 2026))


@router.get("/seasons")
async def list_seasons():
    return {"seasons": AVAILABLE_SEASONS}


@router.get("/seasons/{year}/events")
async def list_events(year: int):
    events = await get_season_events(year)
    return {"year": year, "events": events}


@router.get("/sessions/{year}/{round_num}")
async def get_session(
    year: int,
    round_num: int,
    type: str = Query("R", description="Session type: R, Q, S, FP1, FP2, FP3, SQ"),
):
    info = await get_session_info(year, round_num, type)
    return info
