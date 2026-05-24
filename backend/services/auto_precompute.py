"""Background task that checks for new F1 session data and precomputes it.

Runs every 30 minutes on Friday–Monday (race weekend days).
Uses FastF1's schedule to find sessions that should have data available,
checks if we've already processed them, and runs precompute if not.
"""

import asyncio
import logging
import traceback
from datetime import datetime, timedelta, timezone

logger = logging.getLogger("auto_precompute")

# Check interval in seconds (30 minutes)
CHECK_INTERVAL = 30 * 60

_AUTO_PRECOMPUTE_PRESETS: dict[str, set[str]] = {
    "off":       set(),
    "race":      {"R", "S"},
    "race+qual": {"R", "S", "Q", "SQ"},
    "all":       {"R", "S", "Q", "SQ", "FP1", "FP2", "FP3"},
}


def get_allowed_session_types() -> set[str]:
    """Return the set of session type codes to auto-precompute.

    Controlled by the AUTO_PRECOMPUTE env var (default: race+qual).
    """
    import os
    value = os.environ.get("AUTO_PRECOMPUTE", "race+qual").strip().lower()
    if value not in _AUTO_PRECOMPUTE_PRESETS:
        logger.warning(
            f"Unknown AUTO_PRECOMPUTE value {value!r}, falling back to 'race+qual'. "
            f"Valid values: {', '.join(_AUTO_PRECOMPUTE_PRESETS)}"
        )
        value = "race+qual"
    return _AUTO_PRECOMPUTE_PRESETS[value]

# Days of the week to check (0=Monday, 4=Friday, 5=Saturday, 6=Sunday)
ACTIVE_DAYS = {0, 4, 5, 6}  # Mon, Fri, Sat, Sun

# How long after a session's scheduled start before we try to fetch data
DATA_AVAILABILITY_DELAY = timedelta(hours=0)


async def _check_and_process():
    """Check for new sessions and process any that have data available."""
    from services.f1_data import _fetch_schedule_sync, SESSION_NAME_TO_TYPE
    from services import storage

    from services.process import process_session_sync as process_session

    allowed = get_allowed_session_types()
    if not allowed:
        return

    now = datetime.now(timezone.utc)
    year = now.year

    try:
        events = _fetch_schedule_sync(year)
    except Exception as e:
        logger.error(f"Failed to fetch {year} schedule: {e}")
        return

    processed_any = False

    for event in events:
        round_num = event["round_number"]

        for s in event["sessions_raw"]:
            session_ts = s.get("_ts")
            if session_ts is None:
                continue

            session_name = s["name"]
            session_type = SESSION_NAME_TO_TYPE.get(session_name)
            if not session_type:
                continue

            if session_type not in allowed:
                continue

            # Skip if session hasn't had enough time for data to be available
            if now < session_ts + DATA_AVAILABILITY_DELAY:
                continue

            # Skip if too old (more than 7 days ago - no point retrying)
            if now > session_ts + timedelta(days=7):
                continue

            # Check if already processed
            base = f"sessions/{year}/{round_num}/{session_type}"
            if storage.exists(f"{base}/replay.json"):
                continue

            # New session data might be available - try to process it
            prefix = f"{year} R{round_num} {session_type}"
            logger.info(f"[auto] New session detected: {prefix}, attempting precompute...")

            try:
                # Run blocking precompute in thread pool
                success = await asyncio.to_thread(
                    process_session, year, round_num, session_type
                )
                if success:
                    logger.info(f"[auto] Successfully processed {prefix}")
                    processed_any = True

                    # Also update the schedule in storage
                    from services.f1_data import _get_season_events_sync
                    schedule_data = _get_season_events_sync(year)
                    storage.put_json(
                        f"seasons/{year}/schedule.json",
                        {"year": year, "events": schedule_data},
                    )
                else:
                    logger.warning(f"[auto] Failed to process {prefix}")
            except Exception as e:
                logger.warning(f"[auto] Error processing {prefix}: {e}")
                traceback.print_exc()

    if not processed_any:
        logger.debug("[auto] No new sessions to process")


async def auto_precompute_loop():
    """Main loop: checks for new data every 30 minutes on active days."""
    logger.info("Auto-precompute background task started")

    # Short initial delay to let the app finish starting up
    await asyncio.sleep(10)

    while True:
        try:
            now = datetime.now(timezone.utc)
            if now.weekday() in ACTIVE_DAYS:
                logger.info("[auto] Checking for new session data...")
                await _check_and_process()
            else:
                logger.debug(f"[auto] Skipping check (day={now.strftime('%A')})")
        except Exception as e:
            logger.error(f"[auto] Unexpected error in check loop: {e}")
            traceback.print_exc()

        await asyncio.sleep(CHECK_INTERVAL)
