# Changelog

All notable changes to F1 Timing Replay will be documented in this file.

## 1.2.0 - 2026-03-14

### New Features
- **Live Timing** — real-time timing data via F1 SignalR stream, with broadcast delay slider, post-session replay check, and PiP window support
- **Race Control Messages** — live feed of steward decisions, investigations, penalties, track limits, and flag changes accessible via the RC button on the track map (available in both live and replay modes)
- **Driver Indicators** — investigation (warning triangle) and penalty (circled exclamation) icons on the leaderboard, with automatic clearing when stewards resolve incidents

### Improvements
- **Docker images published to GHCR** — pre-built images are now automatically published to GitHub Container Registry on each release, so users can deploy with just a `docker-compose.yml` without cloning the repo
- PiP window track map and driver positions now continue updating when switching windows (contributed by [@Clav3rbot](https://github.com/Clav3rbot))
- Session picker shows session start times in the user's local timezone (contributed by [@Clav3rbot](https://github.com/Clav3rbot))
- Improved Docker Compose configuration with clearer comments on port and URL customisation

### Known Limitations
- **Live timing: no track positions or telemetry** — Driver positions on the track map and telemetry data are not available during live sessions. Position data requires an authenticated F1 TV subscription. Full track positions and telemetry become available in replay mode once session data is processed (typically 1–2 hours after the session).

### Note
- Race control messages in replay mode require a re-run of precompute for each session to take effect.
- Best lap time and gap to leader columns for practice/qualifying require a re-run of precompute for existing sessions. Live sessions work immediately.

## 1.1.0 - 2026-03-10

### New Features
- Docker Compose support for self-hosting — run the full app with `docker compose up`
- Picture-in-Picture popup window with collapsible track map, telemetry, and leaderboard sections (contributed by [@Clav3rbot](https://github.com/Clav3rbot))
- Clipboard paste support for leaderboard sync — users can now paste a screenshot of the F1 TV broadcast leaderboard directly from clipboard (Ctrl+V) instead of uploading a file, with a visual Ctrl+V hint in the UI (contributed by [@Clav3rbot](https://github.com/Clav3rbot))

### Improvements
- Season schedule data is now fetched on demand from FastF1 when not already in storage, removing the need to run precompute before using the app
- Leaderboard interval/leader toggle replaced with a clickable pill on the P1 row
- Leaderboard no longer wastes horizontal space when scaled down to fit shorter viewports
- Pit prediction now appears from lap 5 onwards (previously lap 15)
- Session picker shows a LIVE banner and session badges when a session is active or starting soon
- Penalty indicator on leaderboard now clears when the penalty is served
- Sector overlay on track map for qualifying sessions

## 1.0.1 - 2026-03-07

### Improvements
- Improved mobile layout, including track map rendering and playback controls
- Starting grid positions now fall back to qualifying result data when grid position data is unavailable
- Retired drivers now remain on the leaderboard in their final position, marked as "Out"
- Overall improvements to interval timing, including handling of lapped drivers
- Minor UI consistency fixes

### Bug Fixes
- Drivers with unavailable position data are now temporarily hidden from the track map and restored automatically when data resumes

### Security
- Upgraded Next.js 14 to 15 and React 18 to 19

### Note
For the position data, starting grid position, retired driver, and interval timing fixes to take effect, you'll need to re-run precompute for any Race sessions.
