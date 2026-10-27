#!/usr/bin/env python3
"""Pre-compute F1 session data and store it.

Uses local filesystem by default, or Cloudflare R2 if STORAGE_MODE=r2.

Usage:
    # Process all sessions for a year
    python precompute.py 2024

    # Process a specific round
    python precompute.py 2024 --round 1

    # Process a specific session type
    python precompute.py 2024 --round 1 --session R

    # Skip already-processed sessions
    python precompute.py 2024 --skip-existing

    # Process multiple years
    python precompute.py 2024 2025
"""

from __future__ import annotations

import argparse
import logging
import sys
import os
import time
import traceback

from dotenv import load_dotenv

load_dotenv()

# Ensure backend modules are importable
sys.path.insert(0, os.path.dirname(__file__))

from services import storage
from services.process import process_session_sync
from services.team_radio import add_radio_audio, wait_radio
from services.minisectors import SESSION_TYPES as MINI_SECTOR_SESSIONS
from services.f1_data import (
    _fetch_schedule_sync,
    _get_season_events_sync,
    SESSION_NAME_TO_TYPE,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("precompute")


# Set once a download has run in this process, so the next one waits --gap seconds first
_downloaded_any = False


def process_year(year: int, target_round: int | None = None, target_session: str | None = None, skip_existing: bool = False,
                 gap: float = 60):
    """Process all (or specific) sessions for a year."""
    global _downloaded_any
    # Upload schedule
    logger.info(f"Processing schedule for {year}...")
    try:
        events = _get_season_events_sync(year)
        storage.put_json(f"seasons/{year}/schedule.json", {"year": year, "events": events})
        logger.info(f"Uploaded schedule for {year} ({len(events)} events)")
    except Exception as e:
        logger.error(f"Failed to get schedule for {year}: {e}")
        return

    raw_events = _fetch_schedule_sync(year)

    for event in raw_events:
        round_num = event["round_number"]
        if target_round is not None and round_num != target_round:
            continue

        # Determine which session types to process
        session_types = []
        for s in event["sessions_raw"]:
            st = SESSION_NAME_TO_TYPE.get(s["name"])
            if st:
                if target_session is not None and st != target_session:
                    continue
                session_types.append(st)

        for st in session_types:
            if skip_existing and storage.exists(f"sessions/{year}/{round_num}/{st}/replay.json"):
                continue
            # Pause between downloads to stay within F1's limits
            if _downloaded_any and gap > 0:
                logger.info(f"Waiting {gap:g}s before the next download...")
                time.sleep(gap)
            _downloaded_any = True
            try:
                process_session_sync(year, round_num, st, skip_existing=skip_existing)
            except Exception as e:
                logger.error(f"Failed {year} R{round_num} {st}: {e}")
                traceback.print_exc()


def radio_audio_only(year: int, target_round: int | None, target_session: str | None, gap: float) -> None:
    """Store the radio audio of sessions transcribed before audio was kept (no re-transcription)."""
    # Local storage lists Windows paths with backslashes
    keys = [k.replace("\\", "/") for k in storage.list_keys(f"sessions/{year}/")]
    first = True
    for key in sorted((k for k in keys if k.endswith("/radio.json")), key=lambda k: (int(k.split("/")[2]), k)):
        _, _, rnd, st, _ = key.split("/")
        if (target_round is not None and int(rnd) != target_round) or (target_session and st != target_session):
            continue
        if not first and gap > 0:
            time.sleep(gap)
        first = False
        try:
            logger.info(f"{year} R{rnd} {st}: added audio to {add_radio_audio(year, int(rnd), st)} radio clips")
        except Exception as e:
            logger.error(f"Failed radio audio for {year} R{rnd} {st}: {e}")


def minisectors_only(year: int, target_round: int | None, target_session: str | None, gap: float) -> None:
    """Add minisectors.json to stored qualifying and practice sessions (timing stream only, no reprocessing)."""
    from services.f1_data import rebuild_minisectors_sync
    keys = [k.replace("\\", "/") for k in storage.list_keys(f"sessions/{year}/")]
    first = True
    for key in sorted((k for k in keys if k.endswith("/laps.json")), key=lambda k: (int(k.split("/")[2]), k)):
        _, _, rnd, st, _ = key.split("/")
        if st not in MINI_SECTOR_SESSIONS:
            continue
        if (target_round is not None and int(rnd) != target_round) or (target_session and st != target_session):
            continue
        if not first and gap > 0:
            time.sleep(gap)
        first = False
        try:
            ms = rebuild_minisectors_sync(year, int(rnd), st)
            logger.info(f"{year} R{rnd} {st}: mini-sectors {ms['counts'] if ms else 'not built'}")
        except Exception as e:
            logger.error(f"Failed mini-sectors for {year} R{rnd} {st}: {e}")


def main():
    parser = argparse.ArgumentParser(description="Pre-compute F1 data and upload to storage")
    parser.add_argument("years", type=int, nargs="+", help="Year(s) to process")
    parser.add_argument("--round", type=int, default=None, help="Specific round number")
    parser.add_argument("--session", type=str, default=None, help="Session type (R, Q, S, FP1, FP2, FP3, SQ)")
    parser.add_argument("--skip-existing", action="store_true", help="Skip sessions already in R2")
    parser.add_argument("--gap", type=float, default=60, help="Seconds to wait between session downloads (default 60)")
    parser.add_argument("--radio-audio-only", action="store_true",
                        help="Only store the team radio audio of already transcribed sessions")
    parser.add_argument("--minisectors-only", action="store_true",
                        help="Only add mini-sectors to stored qualifying and practice sessions")
    args = parser.parse_args()

    if args.radio_audio_only:
        for year in args.years:
            radio_audio_only(year, args.round, args.session, args.gap)
        return
    if args.minisectors_only:
        for year in args.years:
            minisectors_only(year, args.round, args.session, args.gap)
        return

    for year in args.years:
        process_year(year, target_round=args.round, target_session=args.session, skip_existing=args.skip_existing,
                     gap=args.gap)

    # Radio is transcribed in background threads; they die with the process
    logger.info("Waiting for team radio transcription...")
    wait_radio()
    logger.info("Pre-compute complete.")


if __name__ == "__main__":
    main()
