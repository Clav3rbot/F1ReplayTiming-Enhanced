from fastapi import APIRouter, Query, HTTPException
from routers.sessions import SESSION_TYPE_PATTERN
from services.storage import get_json, exists
from services.team_radio import queue_radio

router = APIRouter(prefix="/api", tags=["radio"])


@router.get("/sessions/{year}/{round_num}/radio")
def team_radio(
    year: int,
    round_num: int,
    type: str = Query("R", pattern=SESSION_TYPE_PATTERN, description="Session type"),
):
    base = f"sessions/{year}/{round_num}/{type}"
    data = get_json(f"{base}/radio.json")
    if data is not None:
        return {"radio": data}
    if not exists(f"{base}/replay.json"):
        return {"radio": []}
    # Sessions processed before radio existed are transcribed on first view;
    # 404 until then so the client keeps polling.
    queue_radio(year, round_num, type)
    raise HTTPException(status_code=404, detail="Team radio is being transcribed.")
