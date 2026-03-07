from fastapi import APIRouter, Query
from services.f1_data import get_track_data

router = APIRouter(prefix="/api", tags=["track"])


@router.get("/sessions/{year}/{round_num}/track")
async def track_geometry(
    year: int,
    round_num: int,
    type: str = Query("R", description="Session type"),
):
    data = await get_track_data(year, round_num, type)
    return data
