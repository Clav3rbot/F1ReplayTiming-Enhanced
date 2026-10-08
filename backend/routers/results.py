import logging

from fastapi import APIRouter, Query, HTTPException
from routers.sessions import SESSION_TYPE_PATTERN
from services.storage import get_json

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["results"])


@router.get("/sessions/{year}/{round_num}/results")
async def race_results(
    year: int,
    round_num: int,
    type: str = Query("R", pattern=SESSION_TYPE_PATTERN, description="Session type"),
):
    data = get_json(f"sessions/{year}/{round_num}/{type}/results.json")
    if data is None:
        raise HTTPException(
            status_code=404,
            detail="Results not available for this session.",
        )
    return {"results": data}
