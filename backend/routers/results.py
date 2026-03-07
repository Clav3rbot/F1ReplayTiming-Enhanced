from fastapi import APIRouter, Query
from services.f1_data import get_race_results

router = APIRouter(prefix="/api", tags=["results"])


@router.get("/sessions/{year}/{round_num}/results")
async def race_results(
    year: int,
    round_num: int,
    type: str = Query("R", description="Session type"),
):
    results = await get_race_results(year, round_num, type)
    return {"results": results}
