"""On-demand session processing.

Shared by both the CLI precompute script and the backend's on-demand processing.
Uses locks to prevent duplicate processing of the same session.
"""

from __future__ import annotations

import asyncio
import logging
import threading
import time as _time
import traceback
from concurrent.futures import ThreadPoolExecutor

from services import storage
from services.f1_data import (
    _load_session,
    _get_session_info_sync,
    _get_track_data_sync,
    _get_lap_data_sync,
    _get_race_results_sync,
    _get_driver_positions_by_time_sync,
    _get_driver_telemetry_sync,
)

logger = logging.getLogger(__name__)

# Locks to prevent duplicate processing of the same session
_locks: dict[str, asyncio.Lock] = {}

# Thread pool for parallel telemetry uploads
_telemetry_pool = ThreadPoolExecutor(max_workers=4)
import atexit as _atexit
_atexit.register(_telemetry_pool.shutdown, wait=False)


def _process_driver_telemetry(
    year: int, round_num: int, session_type: str,
    abbr: str, total_laps_set: set, base: str, prefix: str,
) -> bool:
    """Process and upload telemetry for a single driver. Returns True on success."""
    try:
        drv_telemetry = {}
        for lap_num in sorted(total_laps_set):
            try:
                tel = _get_driver_telemetry_sync(
                    year, round_num, session_type, abbr, lap_num
                )
                if tel:
                    drv_telemetry[str(lap_num)] = tel
            except Exception:
                continue
        if drv_telemetry:
            storage.put_json(f"{base}/telemetry/{abbr}.json", drv_telemetry)
        return True
    except Exception as e:
        logger.warning(f"[{prefix}] Telemetry failed for {abbr}: {e}")
        return False


def process_session_sync(
    year: int,
    round_num: int,
    session_type: str,
    skip_existing: bool = False,
    on_status: callable = None,
) -> bool:
    """Process and upload all data for a single session. Returns True if successful.

    on_status: optional callback(message: str) called with progress updates.
    """
    prefix = f"{year} R{round_num} {session_type}"
    base = f"sessions/{year}/{round_num}/{session_type}"

    if skip_existing and storage.exists(f"{base}/replay.json"):
        logger.info(f"[{prefix}] Already exists, skipping")
        return True

    def status(msg: str):
        logger.info(f"[{prefix}] {msg}")
        if on_status:
            on_status(msg)

    status("Loading session data from F1 API...")

    # Session info
    try:
        info = _get_session_info_sync(year, round_num, session_type)
        storage.put_json(f"{base}/info.json", info)
    except Exception as e:
        logger.error(f"[{prefix}] Failed to get session info: {e}")
        return False

    status("Processing track data...")

    # Track data
    try:
        track = _get_track_data_sync(year, round_num, session_type)
        storage.put_json(f"{base}/track.json", track)
    except Exception as e:
        logger.warning(f"[{prefix}] No track data: {e}")

    status("Processing lap data...")

    # Lap data
    laps = None
    try:
        laps = _get_lap_data_sync(year, round_num, session_type)
        storage.put_json(f"{base}/laps.json", laps)
    except Exception as e:
        logger.warning(f"[{prefix}] No lap data: {e}")

    # Results
    try:
        results = _get_race_results_sync(year, round_num, session_type)
        storage.put_json(f"{base}/results.json", results)
    except Exception as e:
        logger.warning(f"[{prefix}] No results: {e}")

    status("Building replay frames (this may take a minute)...")

    # Replay frames (the big one)
    try:
        frames = _get_driver_positions_by_time_sync(year, round_num, session_type)
        storage.put_json(f"{base}/replay.json", frames)
        logger.info(f"[{prefix}] Uploaded {len(frames)} replay frames")
    except Exception as e:
        logger.warning(f"[{prefix}] No replay data: {e}")

    status("Processing telemetry...")

    # Telemetry per driver — parallelized across drivers
    try:
        drivers = info.get("drivers", [])
        total_laps_set = set()
        if laps:
            for lap in laps:
                total_laps_set.add(lap["lap_number"])

        if total_laps_set and drivers:
            futures = []
            for drv in drivers:
                abbr = drv["abbreviation"]
                fut = _telemetry_pool.submit(
                    _process_driver_telemetry,
                    year, round_num, session_type,
                    abbr, total_laps_set, base, prefix,
                )
                futures.append((abbr, fut))

            # Wait for all drivers to finish
            for abbr, fut in futures:
                try:
                    fut.result(timeout=300)
                except Exception as e:
                    logger.warning(f"[{prefix}] Telemetry timeout/error for {abbr}: {e}")

        logger.info(f"[{prefix}] Uploaded telemetry for {len(drivers)} drivers")
    except Exception as e:
        logger.warning(f"[{prefix}] Telemetry upload issue: {e}")

    status("Done")
    logger.info(f"[{prefix}] Done")
    return True


def process_core_sync(
    year: int,
    round_num: int,
    session_type: str,
    on_status: callable = None,
) -> bool:
    """Process only replay-critical data (no telemetry). Returns True if successful.

    This is the fast path for on-demand processing — gets the user into the replay
    ASAP, while telemetry is processed in the background.
    Uses minimal session loading (skips weather & messages) for speed.
    """
    prefix = f"{year} R{round_num} {session_type}"
    base = f"sessions/{year}/{round_num}/{session_type}"
    t_total = _time.monotonic()

    def status(msg: str):
        logger.info(f"[{prefix}] {msg}")
        if on_status:
            on_status(msg)

    status("Loading session data from F1 API (minimal mode)...")

    # Pre-load session in minimal mode to warm the cache
    t0 = _time.monotonic()
    try:
        _load_session(year, round_num, session_type, minimal=True)
    except Exception as e:
        logger.error(f"[{prefix}] Failed to load session: {e}")
        return False
    status(f"Session loaded in {_time.monotonic() - t0:.0f}s. Processing session info...")

    # Session info
    try:
        info = _get_session_info_sync(year, round_num, session_type)
        storage.put_json(f"{base}/info.json", info)
    except Exception as e:
        logger.error(f"[{prefix}] Failed to get session info: {e}")
        return False

    status("Processing track data...")
    try:
        track = _get_track_data_sync(year, round_num, session_type)
        storage.put_json(f"{base}/track.json", track)
    except Exception as e:
        logger.warning(f"[{prefix}] No track data: {e}")

    status("Processing lap data...")
    try:
        laps = _get_lap_data_sync(year, round_num, session_type)
        storage.put_json(f"{base}/laps.json", laps)
    except Exception as e:
        logger.warning(f"[{prefix}] No lap data: {e}")

    try:
        results = _get_race_results_sync(year, round_num, session_type)
        storage.put_json(f"{base}/results.json", results)
    except Exception as e:
        logger.warning(f"[{prefix}] No results: {e}")

    t0 = _time.monotonic()
    status("Building replay frames...")
    try:
        frames = _get_driver_positions_by_time_sync(year, round_num, session_type, minimal=True)
        storage.put_json(f"{base}/replay.json", frames)
        elapsed = _time.monotonic() - t0
        logger.info(f"[{prefix}] Replay built: {len(frames)} frames in {elapsed:.1f}s")
    except Exception as e:
        logger.warning(f"[{prefix}] No replay data: {e}")
        return False

    total_elapsed = _time.monotonic() - t_total
    status(f"Replay ready in {total_elapsed:.0f}s — telemetry loading in background...")
    logger.info(f"[{prefix}] process_core_sync completed in {total_elapsed:.1f}s")
    return True


def process_telemetry_background(
    year: int, round_num: int, session_type: str,
) -> None:
    """Process and upload telemetry in the background (called from a fire-and-forget thread)."""
    prefix = f"{year} R{round_num} {session_type}"
    base = f"sessions/{year}/{round_num}/{session_type}"

    try:
        info_data = storage.get_json(f"{base}/info.json")
        laps_data = storage.get_json(f"{base}/laps.json")
        if not info_data:
            logger.warning(f"[{prefix}] No info.json for background telemetry")
            return

        drivers = info_data.get("drivers", [])
        total_laps_set = set()
        if laps_data:
            for lap in laps_data:
                total_laps_set.add(lap["lap_number"])

        if not total_laps_set or not drivers:
            return

        futures = []
        for drv in drivers:
            abbr = drv["abbreviation"]
            fut = _telemetry_pool.submit(
                _process_driver_telemetry,
                year, round_num, session_type,
                abbr, total_laps_set, base, prefix,
            )
            futures.append((abbr, fut))

        for abbr, fut in futures:
            try:
                fut.result(timeout=300)
            except Exception as e:
                logger.warning(f"[{prefix}] Background telemetry error for {abbr}: {e}")

        logger.info(f"[{prefix}] Background telemetry done for {len(drivers)} drivers")
    except Exception as e:
        logger.error(f"[{prefix}] Background telemetry failed: {e}")


async def ensure_session_data(
    year: int,
    round_num: int,
    session_type: str,
    on_status: callable = None,
) -> bool:
    """Ensure session data exists, processing on-demand if needed.

    Uses per-session locks so concurrent requests wait rather than duplicate work.
    on_status: optional async callback(message: str) for progress updates.
    """
    base = f"sessions/{year}/{round_num}/{session_type}"

    # Fast path: data already exists
    if storage.exists(f"{base}/replay.json"):
        return True

    # Get or create lock for this session
    key = f"{year}_{round_num}_{session_type}"
    if key not in _locks:
        _locks[key] = asyncio.Lock()

    async with _locks[key]:
        # Double-check after acquiring lock (another request may have finished)
        if storage.exists(f"{base}/replay.json"):
            return True

        # Wrap sync callback for async on_status
        status_messages = []

        def sync_status(msg: str):
            status_messages.append(msg)

        # Run processing in a thread
        try:
            success = await asyncio.to_thread(
                process_session_sync,
                year,
                round_num,
                session_type,
                on_status=sync_status,
            )
            return success
        except Exception as e:
            logger.error(f"On-demand processing failed for {key}: {e}")
            traceback.print_exc()
            return False


async def ensure_session_data_ws(
    year: int,
    round_num: int,
    session_type: str,
    send_status,
) -> bool:
    """Like ensure_session_data but sends WebSocket status updates during processing.

    Processes only core data (replay frames) first, then fires off telemetry
    in the background so the user can start watching immediately.
    """
    base = f"sessions/{year}/{round_num}/{session_type}"

    if storage.exists(f"{base}/replay.json"):
        return True

    key = f"{year}_{round_num}_{session_type}"
    if key not in _locks:
        _locks[key] = asyncio.Lock()

    # If another request is already processing, just wait
    if _locks[key].locked():
        await send_status("Waiting for session data (another request is processing)...")
        async with _locks[key]:
            return storage.exists(f"{base}/replay.json")

    async with _locks[key]:
        if storage.exists(f"{base}/replay.json"):
            return True

        await send_status("Session data not found — processing on demand...")

        # Use a queue to bridge sync callbacks to async WebSocket sends
        status_queue: asyncio.Queue = asyncio.Queue()

        def sync_status(msg: str):
            status_queue.put_nowait(msg)

        # Process core data only (no telemetry) — much faster
        loop = asyncio.get_event_loop()
        process_task = loop.run_in_executor(
            None,
            process_core_sync,
            year,
            round_num,
            session_type,
            sync_status,
        )

        # Forward status messages while processing
        while not process_task.done():
            try:
                msg = await asyncio.wait_for(status_queue.get(), timeout=1.0)
                await send_status(msg)
            except asyncio.TimeoutError:
                pass

        # Drain remaining messages
        while not status_queue.empty():
            msg = status_queue.get_nowait()
            await send_status(msg)

        try:
            success = process_task.result()
        except Exception as e:
            logger.error(f"On-demand processing failed for {key}: {e}")
            return False

        if success:
            # Fire off telemetry processing in background — don't block the replay
            threading.Thread(
                target=process_telemetry_background,
                args=(year, round_num, session_type),
                daemon=True,
            ).start()

        return success
