import asyncio
import re
from typing import Optional

from fastapi import APIRouter, Query, HTTPException, Response
from pydantic import BaseModel
from routers.sessions import SESSION_TYPE_PATTERN, _reprocess_allowed
from services import caption_settings
from services.storage import get_json, get_bytes, exists
from services.team_radio import queue_radio

router = APIRouter(prefix="/api", tags=["radio"])


class CaptionSettingsUpdate(BaseModel):
    whisper_model: Optional[str] = None
    # Sent as null for "the same as replays"; left out to leave unchanged
    live_whisper_model: Optional[str] = None


@router.get("/captions/settings")
async def caption_settings_get():
    return {**await asyncio.to_thread(caption_settings.describe), "editable": _reprocess_allowed()}


@router.put("/captions/settings")
async def caption_settings_put(body: CaptionSettingsUpdate):
    # A model download is up to 1.6 GB: same gate as reprocessing
    if not _reprocess_allowed():
        raise HTTPException(status_code=403, detail="Caption settings are disabled on this instance. Enable AUTH_ENABLED or set ALLOW_REPROCESS=true.")
    sent = body.model_dump(exclude_unset=True)
    kwargs = {"live_whisper": sent["live_whisper_model"]} if "live_whisper_model" in sent else {}
    try:
        await asyncio.to_thread(caption_settings.save, whisper=sent.get("whisper_model"), **kwargs)
    except caption_settings.CaptionSettingsError as e:
        raise HTTPException(status_code=400, detail=str(e))
    # Start downloading a newly chosen model now, not at the next clip
    await asyncio.to_thread(caption_settings.download_selected)
    return {**await asyncio.to_thread(caption_settings.describe), "editable": True}


# F1's clip names, e.g. VER_1_20261024_165239.mp3
_CLIP_NAME = re.compile(r"^[A-Z]{3}_\d{1,2}_\d{8}_\d{6}\.mp3$")


@router.get("/sessions/{year}/{round_num}/radio/audio/{name}")
def team_radio_audio(
    year: int,
    round_num: int,
    name: str,
    type: str = Query("R", pattern=SESSION_TYPE_PATTERN, description="Session type"),
):
    if not _CLIP_NAME.match(name):
        raise HTTPException(status_code=400, detail="Invalid clip name")
    audio = get_bytes(f"sessions/{year}/{round_num}/{type}/radio/{name}")
    if audio is None:
        raise HTTPException(status_code=404, detail="Clip not stored")
    # Clips never change once stored
    return Response(audio, media_type="audio/mpeg", headers={"Cache-Control": "private, max-age=31536000, immutable"})


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
