"""API endpoint for checking live session status.

Determines if any F1 session is currently live or imminent based on
the session schedule and known session durations.
"""

import logging
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter
from services.storage import get_json

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["live"])

# Typical session durations (generous — better to show LIVE too long than miss it)
SESSION_DURATIONS: dict[str, int] = {
    "Race": 7200,           # 2 hours
    "Qualifying": 4200,     # 70 minutes
    "Sprint": 3600,         # 1 hour
    "Sprint Qualifying": 3000,  # 50 minutes
    "Sprint Shootout": 3000,
    "Practice 1": 3600,     # 1 hour
    "Practice 2": 3600,
    "Practice 3": 3600,
}

SESSION_NAME_TO_TYPE = {
    "Race": "R",
    "Qualifying": "Q",
    "Sprint": "S",
    "Sprint Qualifying": "SQ",
    "Sprint Shootout": "SQ",
    "Practice 1": "FP1",
    "Practice 2": "FP2",
    "Practice 3": "FP3",
}

# How early before session start to show as "live" (pre-session build-up)
PRE_SESSION_MINUTES = 15

# How close (in hours) to a scheduled session before we try to re-fetch
# the schedule from FastF1 to catch any FIA time changes
REFRESH_WINDOW_HOURS = 3

# In-process cache to avoid hammering FastF1 on every status poll
# Stores: (last_refresh_utc, schedule_data)
_schedule_cache: dict[int, tuple[datetime, dict]] = {}
_CACHE_TTL_SECONDS = 60  # refresh at most once per minute when near a session


def _is_near_any_session(events: list, now: datetime) -> bool:
    """Return True if we are within REFRESH_WINDOW_HOURS of any session start,
    or within its expected duration (i.e. it may be live / just ended)."""
    window = timedelta(hours=REFRESH_WINDOW_HOURS)
    for evt in events:
        for session in evt.get("sessions", []):
            date_str = session.get("date_utc")
            if not date_str:
                continue
            try:
                session_dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
                if session_dt.tzinfo is None:
                    session_dt = session_dt.replace(tzinfo=timezone.utc)
            except (ValueError, TypeError):
                continue
            duration = SESSION_DURATIONS.get(session.get("name", ""), 3600)
            if (session_dt - window) <= now <= (session_dt + timedelta(seconds=duration)):
                return True
    return False


async def _get_schedule(year: int, now: datetime) -> dict | None:
    """Return schedule, refreshing from FastF1 when near a session to catch
    FIA anticipi/posticipi. Falls back to cached storage on error."""
    import asyncio

    # Always start with what we have stored
    stored = get_json(f"seasons/{year}/schedule.json")

    # Decide whether to attempt a live refresh
    cached = _schedule_cache.get(year)
    cache_fresh = (
        cached is not None
        and (now - cached[0]).total_seconds() < _CACHE_TTL_SECONDS
    )

    if cache_fresh:
        return cached[1]

    # If we have a stored schedule and we're NOT near any session, use it as-is
    if stored and not _is_near_any_session(stored.get("events", []), now):
        return stored

    # We're near a session (or have no stored schedule) — try a live FastF1 fetch
    try:
        from services.f1_data import _get_season_events_sync
        from services.storage import put_json

        events = await asyncio.to_thread(_get_season_events_sync, year)
        schedule = {"year": year, "events": events}
        put_json(f"seasons/{year}/schedule.json", schedule)
        _schedule_cache[year] = (now, schedule)
        logger.info(f"[live_status] Refreshed {year} schedule from FastF1 "
                    f"({len(events)} events)")
        return schedule
    except Exception as exc:
        logger.warning(f"[live_status] FastF1 refresh failed, using stored: {exc}")
        if stored:
            _schedule_cache[year] = (now, stored)
        return stored


@router.get("/live/status")
async def live_status():
    """Check if any session is currently live or imminent.

    Returns the live session details if found, or null.
    When close to a scheduled session the schedule is automatically
    re-fetched from FastF1 so that FIA anticipi/posticipi are reflected
    without manual intervention.
    """
    now = datetime.now(timezone.utc)
    year = now.year

    schedule = await _get_schedule(year, now)
    if not schedule:
        return {"live": None}

    events = schedule.get("events", [])

    for evt in events:
        for session in evt.get("sessions", []):
            date_str = session.get("date_utc")
            if not date_str:
                continue

            try:
                session_dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
                if session_dt.tzinfo is None:
                    session_dt = session_dt.replace(tzinfo=timezone.utc)
            except (ValueError, TypeError):
                continue

            session_name = session.get("name", "")
            duration = SESSION_DURATIONS.get(session_name, 3600)
            session_type = SESSION_NAME_TO_TYPE.get(session_name)

            if not session_type:
                continue

            # Session window: PRE_SESSION_MINUTES before start → duration after start
            window_start = session_dt - timedelta(minutes=PRE_SESSION_MINUTES)
            window_end = session_dt + timedelta(seconds=duration)

            if window_start <= now <= window_end:
                return {
                    "live": {
                        "year": year,
                        "round_number": evt.get("round_number"),
                        "event_name": evt.get("event_name", ""),
                        "country": evt.get("country", ""),
                        "session_name": session_name,
                        "session_type": session_type,
                        "session_start": date_str,
                        "pre_session": now < session_dt,
                    }
                }

    return {"live": None}
