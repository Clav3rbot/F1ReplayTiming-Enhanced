from fastapi import APIRouter, Query
from services.f1_data import get_lap_data

router = APIRouter(prefix="/api", tags=["laps"])


@router.get("/sessions/{year}/{round_num}/laps")
async def lap_data(
    year: int,
    round_num: int,
    type: str = Query("R", description="Session type"),
):
    laps = await get_lap_data(year, round_num, type)
    return {"laps": laps}
