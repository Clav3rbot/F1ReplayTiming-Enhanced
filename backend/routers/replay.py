import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from services.f1_data import get_driver_positions_by_time

logger = logging.getLogger(__name__)
router = APIRouter(tags=["replay"])

# Cache computed replay frames
_replay_cache: dict[str, list[dict]] = {}


async def _get_frames(year: int, round_num: int, session_type: str) -> list[dict]:
    key = f"{year}_{round_num}_{session_type}"
    if key not in _replay_cache:
        frames = await get_driver_positions_by_time(year, round_num, session_type)
        _replay_cache[key] = frames
    return _replay_cache[key]


@router.websocket("/ws/replay/{year}/{round_num}")
async def replay_websocket(
    websocket: WebSocket,
    year: int,
    round_num: int,
    type: str = Query("R"),
):
    await websocket.accept()

    try:
        # Send loading status
        await websocket.send_json({"type": "status", "message": "Loading session data..."})

        frames = await _get_frames(year, round_num, type)

        if not frames:
            await websocket.send_json({"type": "error", "message": "No position data available"})
            await websocket.close()
            return

        await websocket.send_json({
            "type": "ready",
            "total_frames": len(frames),
            "total_time": frames[-1]["timestamp"] if frames else 0,
            "total_laps": frames[-1]["total_laps"] if frames else 0,
        })

        # Playback state
        playing = False
        speed = 1.0
        frame_index = 0
        base_interval = 0.5  # matches the 0.5s sampling rate

        while True:
            if playing and frame_index < len(frames):
                # Send current frame
                frame = frames[frame_index]
                await websocket.send_json({"type": "frame", **frame})
                frame_index += 1

                # Wait based on speed
                await asyncio.sleep(base_interval / speed)
            else:
                # Wait for commands
                try:
                    msg = await asyncio.wait_for(websocket.receive_text(), timeout=0.1)
                    cmd = msg.strip().lower()

                    if cmd == "play":
                        playing = True
                    elif cmd == "pause":
                        playing = False
                    elif cmd.startswith("speed:"):
                        try:
                            speed = float(cmd.split(":")[1])
                            speed = max(0.25, min(50.0, speed))
                        except ValueError:
                            pass
                    elif cmd.startswith("seek:"):
                        try:
                            target_time = float(cmd.split(":")[1])
                            # Find nearest frame
                            for i, f in enumerate(frames):
                                if f["timestamp"] >= target_time:
                                    frame_index = i
                                    break
                            # Send the seeked frame immediately
                            if frame_index < len(frames):
                                await websocket.send_json({
                                    "type": "frame",
                                    **frames[frame_index],
                                })
                        except ValueError:
                            pass
                    elif cmd == "reset":
                        frame_index = 0
                        playing = False
                except asyncio.TimeoutError:
                    # Check for incoming messages while playing
                    if playing:
                        continue
                    await asyncio.sleep(0.05)

            # Also check for commands while playing
            if playing:
                try:
                    msg = await asyncio.wait_for(websocket.receive_text(), timeout=0.01)
                    cmd = msg.strip().lower()
                    if cmd == "pause":
                        playing = False
                    elif cmd.startswith("speed:"):
                        try:
                            speed = float(cmd.split(":")[1])
                            speed = max(0.25, min(50.0, speed))
                        except ValueError:
                            pass
                    elif cmd.startswith("seek:"):
                        try:
                            target_time = float(cmd.split(":")[1])
                            for i, f in enumerate(frames):
                                if f["timestamp"] >= target_time:
                                    frame_index = i
                                    break
                        except ValueError:
                            pass
                    elif cmd == "reset":
                        frame_index = 0
                        playing = False
                except asyncio.TimeoutError:
                    pass

            # If we've reached the end
            if frame_index >= len(frames) and playing:
                playing = False
                await websocket.send_json({"type": "finished"})

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected: {year}/{round_num}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        try:
            await websocket.close()
        except Exception:
            pass
