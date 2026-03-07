from __future__ import annotations

import os
import logging
from functools import lru_cache

import fastf1
import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

CACHE_DIR = os.environ.get("FASTF1_CACHE_DIR", os.path.join(os.path.dirname(__file__), "..", ".fastf1-cache"))

# Enable cache on import
try:
    os.makedirs(CACHE_DIR, exist_ok=True)
    fastf1.Cache.enable_cache(CACHE_DIR)
except OSError:
    # Fallback to temp dir if configured path is not writable
    import tempfile
    CACHE_DIR = os.path.join(tempfile.gettempdir(), "fastf1-cache")
    os.makedirs(CACHE_DIR, exist_ok=True)
    fastf1.Cache.enable_cache(CACHE_DIR)

# In-memory cache for loaded sessions
_session_cache: dict[str, fastf1.core.Session] = {}


def _cache_key(year: int, round_num: int, session_type: str) -> str:
    return f"{year}_{round_num}_{session_type}"


async def get_season_events(year: int) -> list[dict]:
    schedule = fastf1.get_event_schedule(year, include_testing=False)
    events = []
    for _, row in schedule.iterrows():
        if row["RoundNumber"] == 0:
            continue
        session_types = []
        for s in ["Session1", "Session2", "Session3", "Session4", "Session5"]:
            name = row.get(s, "")
            if name and isinstance(name, str) and name.strip():
                session_types.append(name)
        events.append({
            "round_number": int(row["RoundNumber"]),
            "country": str(row.get("Country", "")),
            "event_name": str(row.get("EventName", "")),
            "location": str(row.get("Location", "")),
            "event_date": str(row.get("EventDate", "")),
            "sessions": session_types,
        })
    return events


def _load_session(year: int, round_num: int, session_type: str) -> fastf1.core.Session:
    key = _cache_key(year, round_num, session_type)
    if key in _session_cache:
        return _session_cache[key]

    session = fastf1.get_session(year, round_num, session_type)
    session.load(
        telemetry=True,
        laps=True,
        weather=True,
    )
    _session_cache[key] = session
    return session


async def get_session_info(year: int, round_num: int, session_type: str = "R") -> dict:
    session = _load_session(year, round_num, session_type)
    drivers = []
    for _, row in session.results.iterrows():
        color = str(row.get("TeamColor", "FFFFFF"))
        if not color or color == "nan":
            color = "FFFFFF"
        drivers.append({
            "abbreviation": str(row.get("Abbreviation", "")),
            "driver_number": str(row.get("DriverNumber", "")),
            "full_name": str(row.get("FullName", "")),
            "team_name": str(row.get("TeamName", "")),
            "team_color": f"#{color}",
        })
    return {
        "year": year,
        "round_number": round_num,
        "event_name": str(session.event["EventName"]),
        "circuit": str(session.event.get("Location", "")),
        "country": str(session.event.get("Country", "")),
        "session_type": session_type,
        "drivers": drivers,
    }


async def get_track_data(year: int, round_num: int, session_type: str = "R") -> dict:
    session = _load_session(year, round_num, session_type)
    circuit_info = session.get_circuit_info()

    # Get track coordinates from fastest lap telemetry
    fastest_lap = session.laps.pick_fastest()
    telemetry = fastest_lap.get_telemetry()

    x = telemetry["X"].values
    y = telemetry["Y"].values

    # Normalize to 0-1 range for frontend flexibility
    x_min, x_max = x.min(), x.max()
    y_min, y_max = y.min(), y.max()
    scale = max(x_max - x_min, y_max - y_min)

    x_norm = ((x - x_min) / scale).tolist()
    y_norm = ((y - y_min) / scale).tolist()

    rotation = float(circuit_info.rotation) if hasattr(circuit_info, "rotation") else 0.0

    return {
        "track_points": [{"x": px, "y": py} for px, py in zip(x_norm, y_norm)],
        "rotation": rotation,
        "circuit_name": str(session.event.get("Location", "")),
    }


async def get_lap_data(year: int, round_num: int, session_type: str = "R") -> list[dict]:
    session = _load_session(year, round_num, session_type)
    laps = session.laps

    result = []
    for _, lap in laps.iterrows():
        def fmt_time(td):
            if pd.isna(td):
                return None
            total = td.total_seconds()
            mins = int(total // 60)
            secs = total % 60
            if mins > 0:
                return f"{mins}:{secs:06.3f}"
            return f"{secs:.3f}"

        result.append({
            "driver": str(lap.get("Driver", "")),
            "lap_number": int(lap.get("LapNumber", 0)),
            "position": int(lap["Position"]) if pd.notna(lap.get("Position")) else None,
            "lap_time": fmt_time(lap.get("LapTime")),
            "sector1": fmt_time(lap.get("Sector1Time")),
            "sector2": fmt_time(lap.get("Sector2Time")),
            "sector3": fmt_time(lap.get("Sector3Time")),
            "compound": str(lap.get("Compound", "")) if pd.notna(lap.get("Compound")) else None,
            "tyre_life": int(lap["TyreLife"]) if pd.notna(lap.get("TyreLife")) else None,
            "pit_in": bool(lap.get("PitInTime") is not pd.NaT and pd.notna(lap.get("PitInTime"))),
            "pit_out": bool(lap.get("PitOutTime") is not pd.NaT and pd.notna(lap.get("PitOutTime"))),
        })
    return result


async def get_race_results(year: int, round_num: int, session_type: str = "R") -> list[dict]:
    session = _load_session(year, round_num, session_type)
    results = session.results

    def fmt_time(td):
        if pd.isna(td):
            return None
        total = td.total_seconds()
        mins = int(total // 60)
        secs = total % 60
        if mins > 0:
            return f"{mins}:{secs:06.3f}"
        return f"{secs:.3f}"

    output = []
    for _, row in results.iterrows():
        color = str(row.get("TeamColor", "FFFFFF"))
        if not color or color == "nan":
            color = "FFFFFF"
        pos = row.get("Position")
        grid = row.get("GridPosition")
        output.append({
            "position": int(pos) if pd.notna(pos) else None,
            "driver": str(row.get("FullName", "")),
            "abbreviation": str(row.get("Abbreviation", "")),
            "team": str(row.get("TeamName", "")),
            "team_color": f"#{color}",
            "grid_position": int(grid) if pd.notna(grid) else None,
            "status": str(row.get("Status", "")),
            "points": float(row.get("Points", 0)),
            "fastest_lap": None,
            "gap_to_leader": None,
        })
    output.sort(key=lambda d: d["position"] if d["position"] is not None else 999)
    return output


async def get_driver_positions_by_time(
    year: int, round_num: int, session_type: str = "R"
) -> list[dict]:
    """Build frame-by-frame position data for the replay engine."""
    session = _load_session(year, round_num, session_type)
    laps = session.laps
    total_laps = int(laps["LapNumber"].max()) if len(laps) > 0 else 0

    # Get position data (x, y coords over time) for each driver
    frames = []
    drivers_list = laps["Driver"].unique().tolist()

    # Collect all car position data
    driver_pos_data = {}
    for drv in drivers_list:
        drv_laps = laps.pick_drivers(drv)
        try:
            tel = drv_laps.get_telemetry()
            if tel is not None and len(tel) > 0:
                driver_pos_data[drv] = tel
        except Exception:
            continue

    if not driver_pos_data:
        return []

    # Find common time range
    # We'll sample positions at regular intervals
    all_dates = []
    for drv, tel in driver_pos_data.items():
        if "Date" in tel.columns and len(tel) > 0:
            all_dates.extend(tel["Date"].dropna().tolist())

    if not all_dates:
        return []

    min_date = min(all_dates)
    max_date = max(all_dates)
    total_seconds = (max_date - min_date).total_seconds()

    # Sample every 0.5 seconds for smooth replay
    sample_interval = 0.5
    num_samples = int(total_seconds / sample_interval)

    # Precompute normalized track coords
    x_all = []
    y_all = []
    for tel in driver_pos_data.values():
        x_all.extend(tel["X"].values.tolist())
        y_all.extend(tel["Y"].values.tolist())

    x_min, x_max = min(x_all), max(x_all)
    y_min, y_max = min(y_all), max(y_all)
    scale = max(x_max - x_min, y_max - y_min)
    if scale == 0:
        scale = 1

    # Get session results for team colors
    colors = {}
    for _, row in session.results.iterrows():
        abbr = str(row.get("Abbreviation", ""))
        color = str(row.get("TeamColor", "FFFFFF"))
        if not color or color == "nan":
            color = "FFFFFF"
        colors[abbr] = f"#{color}"

    # Build lap lookup: for each driver, which lap are they on at a given time
    driver_lap_lookup = {}
    for drv in drivers_list:
        drv_laps_df = laps.pick_drivers(drv).sort_values("LapNumber")
        lap_entries = []
        for _, lap_row in drv_laps_df.iterrows():
            lap_entries.append({
                "lap": int(lap_row["LapNumber"]),
                "compound": str(lap_row.get("Compound", "")) if pd.notna(lap_row.get("Compound")) else None,
                "tyre_life": int(lap_row["TyreLife"]) if pd.notna(lap_row.get("TyreLife")) else None,
                "position": int(lap_row["Position"]) if pd.notna(lap_row.get("Position")) else None,
            })
        driver_lap_lookup[drv] = lap_entries

    for i in range(min(num_samples, 50000)):  # cap to prevent excessive data
        t = min_date + pd.Timedelta(seconds=i * sample_interval)
        frame_drivers = []

        for drv, tel in driver_pos_data.items():
            if "Date" not in tel.columns:
                continue
            # Find nearest telemetry point
            idx = (tel["Date"] - t).abs().idxmin()
            row = tel.loc[idx]

            # Only include if within reasonable time range
            time_diff = abs((row["Date"] - t).total_seconds())
            if time_diff > 10:
                continue

            x_norm = (row["X"] - x_min) / scale
            y_norm = (row["Y"] - y_min) / scale

            # Find current lap info
            lap_info = driver_lap_lookup.get(drv, [])
            current_lap = 1
            compound = None
            tyre_life = None
            position = None
            for entry in lap_info:
                if entry["lap"] <= max(1, int(i * sample_interval / (total_seconds / total_laps)) + 1):
                    current_lap = entry["lap"]
                    compound = entry["compound"]
                    tyre_life = entry["tyre_life"]
                    position = entry["position"]

            frame_drivers.append({
                "abbr": drv,
                "x": float(x_norm),
                "y": float(y_norm),
                "color": colors.get(drv, "#FFFFFF"),
                "position": position,
                "compound": compound,
                "tyre_life": tyre_life,
            })

        # Sort by position
        frame_drivers.sort(key=lambda d: d["position"] if d["position"] else 999)

        frames.append({
            "timestamp": i * sample_interval,
            "lap": min(int(i * sample_interval / (total_seconds / total_laps)) + 1, total_laps) if total_laps > 0 else 1,
            "total_laps": total_laps,
            "drivers": frame_drivers,
            "status": "green",
        })

    return frames
