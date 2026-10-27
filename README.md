<h1><img src="frontend/public/logo.png" width="50" align="absmiddle" /> F1 Replay Timing Enhanced</h1>

> **Disclaimer:** This project is intended for **personal, non-commercial use only**. This website is unofficial and is not associated in any way with the Formula 1 companies. F1, FORMULA ONE, FORMULA 1, FIA FORMULA ONE WORLD CHAMPIONSHIP, GRAND PRIX and related marks are trade marks of Formula One Licensing B.V.

A web app for watching Formula 1 sessions with real timing data, car positions on track, driver telemetry, and more, both live during race weekends and as replays of past sessions. Built with Next.js and FastAPI.

> [!IMPORTANT]
> **Since October 2026, F1's timing data needs an F1 TV subscription (Access or higher).** Every replay is downloaded from F1's archive through FastF1, which answers 401 without an F1 TV token (see [FastF1 #978](https://github.com/theOehrly/Fast-F1/issues/978)). Sessions you've already downloaded keep working, and so does live timing.
>
> **What you need to do:**
> 1. Update dependencies: `pip install -r requirements.txt` (FastF1 3.9), or rebuild the Docker image.
> 2. Set `F1_USERNAME` and `F1_PASSWORD` to your F1 TV account, in `backend/.env` or the container's environment. FastF1 signs in and renews the token by itself.
> 3. On a cloud server or behind a VPN, F1 refuses downloads (HTTP 403) even when signed in: route them through the Cloudflare Worker (`F1_SIGNALR_PROXY`, which forwards the token) or process sessions on another computer.
> 4. Optional, for sessions processed before this update: `python precompute.py <year> --radio-audio-only` adds team radio audio and `--minisectors-only` adds qualifying mini-sectors.
>
> Without an account, the [`reduced-mode`](https://github.com/Clav3rbot/F1ReplayTiming-Enhanced/tree/reduced-mode) branch serves only the sessions already stored, keeps live timing, and draws the live track outline from [OpenF1](https://openf1.org).

https://github.com/user-attachments/assets/a80e5ee4-7287-4135-a004-42de8663d9a7

## Features

- **Live timing**: connect to live F1 sessions during race weekends with real-time data from the F1 SignalR stream, including a broadcast delay slider and automatic detection of post-session replays. With the server signed in to F1 TV (`F1_USERNAME` / `F1_PASSWORD`), live timing gets the real car positions and telemetry: the telemetry readout, lap history with the last lap column and lap cards, Lap Analysis (Sectors, and Compare with speed traces, gap and track dominance for laps completed since you connected), mini-sectors on the leaderboard and map, marshal sector flags, OUT on out-laps, and team radio audio. Without a sign-in, car dots are estimated from mini-sector timing. If F1 refuses the connection, the page says why instead of waiting
- **Track map** with real-time car positions from GPS telemetry, updating every 0.5 seconds with smooth interpolation, plus optional corner numbers and an elevation view. Drivers selected on the leaderboard keep their name on the map when driver names are hidden
- **Driver leaderboard** showing position, gap to leader, interval, tyre compound and age, tyre history, pit stop count, grid position changes, fastest lap indicator, investigation/penalty status, and last lap time (in every session type) with purple/green colour coding for fastest and personal best
- **Race control messages**: steward decisions, investigations, penalties, track limits, and flag changes displayed in a resizable overlay on the track map
- **Pit position prediction**: estimates where a driver would rejoin if they pitted now, with predicted gap ahead and behind, using precomputed pit loss times per circuit with Safety Car and Virtual Safety Car adjustments
- **Telemetry** readout for the selected drivers: speed, throttle, brake, gear, RPM, and DRS
- **Team radio**: the radio clips F1 publishes for each session, transcribed to text and shown as a broadcast-style card on the track map, in replays and live, with the clip's audio (replays at 1× speed). The Whisper model is chosen in Settings → Team Radio
- **Lap analysis panel**: in races, a lap time chart, delta comparison between two drivers, and sortable lap table. In qualifying and practice, a Sectors tab: the session's best sectors and theoretical lap, each driver's ideal lap against their best, and a driver's laps with sector times in purple (session best) and green (personal best), filtered by Q1/Q2/Q3; click a lap to see it on the track map, mini-sector by mini-sector as F1 timed it. In every session, a Compare tab with the speed trace: two drivers' best laps so far, overlaid, with their sector times, the difference and the gap along the lap (approximate, rebuilt from distance and speed and pinned to the official sector times), or their current laps drawn as the replay plays. Speed plus throttle, brake, gear, and RPM traces against track distance, with corner numbers, corner minimum and straight-line maximum speeds and sector splits (teammates are dashed); hover or drag along the charts to read both laps at that point, and turn on track dominance to colour the track map by the faster driver in each of 25 parts of the lap, with a count of the parts each won. Laps the stewards delete are struck through, with the reason, from the moment race control announces it, and don't count as bests
- **Picture-in-Picture**: compact floating window with track map, race control, leaderboard, and telemetry
- **Broadcast sync**: match the replay to a recording of a session, either by uploading a screenshot of the timing tower (using AI vision) or by manually entering gap times
- **Weather data** including air and track temperature, humidity, wind, and rainfall status
- **Track status flags** for green, yellow, Safety Car, Virtual Safety Car, and red flag conditions
- **Playback controls** with 0.5× to 20× speed, skip buttons (5 s, 30 s, 1 m, 5 m), lap jumping, and a progress bar
- **Session timeline**: hover the progress bar to see where the action is. An intensity curve peaks at the busiest moments (overtakes, incidents, retirements, flag changes); coloured chapters mark yellow flag, Safety Car, Virtual Safety Car and red flag periods; markers show on-track incidents and retirements. Each overlay can be toggled in Settings → Timeline
- **Qualifying view**: Q1/Q2/Q3 phase jumps, live sector time bars, broadcast-style lap cards as each lap ends (position, lap time, sectors, and the gap to the fastest lap, with personal bests and new fastest laps highlighted), and a leaderboard that keeps the drivers still in the segment on top and moves the knocked-out ones below an "Eliminated" divider. The leaderboard's sector markers fill in mini-sector by mini-sector, coloured as F1 shows them, and Show Sectors draws the same mini-sectors on the track map (switch back to the three sectors next to the button); OUT replaces them while a driver is on an out-lap. With no driver selected, Show Sectors follows the leader
- **Guided tour** on first visit to the homepage and the player, ending with an F1 start-lights sequence that starts the replay; it can be replayed from Settings → Other
- **Next session countdown** on the homepage
- **Storage management**: see which sessions are stored and how much space they take, delete old sessions, and reprocess a session from the picker. Sessions that failed to download in the background or reprocess are listed on the home page with why and a Retry button
- **Session support** for races, qualifying, sprint qualifying, and practice sessions from 2024 onwards
- **Passphrase authentication** to optionally restrict access when publicly hosted

## Architecture

- **Frontend**: Next.js (React) with Tailwind CSS, compiled to a static export
- **Backend**: FastAPI (Python), serves pre-computed data from local storage or Cloudflare R2, and also serves the frontend static files
- **Data source**: [FastF1](https://github.com/theOehrly/Fast-F1) (used during data processing only, not at runtime)
- **Deployment**: single unified container on port 8000

Session data is processed once and stored locally (or in R2). You can either pre-compute data in bulk ahead of time, or let the app process sessions on demand when you first select them.

## Self-Hosting

### Option A: Docker (recommended)

Requires [Docker](https://docs.docker.com/get-docker/).

```bash
git clone <repo-url>
cd F1ReplayTiming
docker build -t f1replay .
docker run -p 8000:8000 -v f1data:/data f1replay
```

Open http://localhost:8000. Select any past session and it will be processed on demand.

#### Environment variables

| Variable | Purpose |
|---|---|
| `DATA_DIR` | Local path for processed session data (default: `/data`) |
| `STORAGE_MODE` | `local` (default) or `r2` to store session data in Cloudflare R2 |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET_NAME` | Cloudflare R2 credentials, required when `STORAGE_MODE=r2` |
| `PORT` | Port the app listens on inside the container (default: `8000`) — map the same port on both sides: `-e PORT=9000 -p 9000:9000` |
| `F1_USERNAME` / `F1_PASSWORD` | Your F1 TV account (Access or higher), needed to download sessions since October 2026 |
| `AUTO_PRECOMPUTE` | Which session types to background-fetch on race weekends: `off`, `race`, `race+qual` (default), `all` |
| `F1_SIGNALR_PROXY` | Optional; Cloudflare Worker URL to proxy F1 SignalR connections and archive downloads (it forwards the F1 TV token) — needed when hosting on data-centre IPs F1 blocks (e.g. Oracle Cloud, AWS) |
| `F1_SIGNALR_PROXY_KEY` | Optional; shared secret sent to the worker as `X-Proxy-Key`. Set the same value as the worker's `PROXY_KEY` secret so nobody else can use your proxy |
| `OPENROUTER_API_KEY` | Optional; enables photo sync ([get a key](https://openrouter.ai/)) |
| `TEAM_RADIO_MODEL` / `TEAM_RADIO_LIVE_MODEL` | Optional; Whisper model for team radio captions in replays / live timing (`tiny.en`, `base.en`, `small.en` (default), `medium.en`, `large-v3-turbo`). Set here, the app shows it locked; otherwise choose in Settings → Team Radio |
| `AUTH_ENABLED` / `AUTH_PASSPHRASE` | Optional; restrict access with a passphrase |
| `ALLOW_REPROCESS` | Optional; `true`/`false` to force-enable or disable reprocessing and deleting sessions from the UI. Defaults to enabled only when `AUTH_ENABLED` is on |
| `FRONTEND_URL` / `EXTRA_ORIGINS` | Optional; allowed CORS origins when the site is opened from another address (see examples below). `EXTRA_ORIGINS` takes a comma-separated list |

Pass variables with `-e`:
```bash
docker run -p 8000:8000 -v f1data:/data \
  -e OPENROUTER_API_KEY=sk-... \
  -e AUTH_ENABLED=true \
  -e AUTH_PASSPHRASE=mypassphrase \
  f1replay
```

**Accessing from other devices on your network:**
```bash
docker run -p 8000:8000 -v f1data:/data \
  -e FRONTEND_URL=http://192.168.1.50:8000 \
  f1replay
```

**Behind a reverse proxy (e.g. Cloudflare Tunnel, nginx):**
```bash
docker run -p 8000:8000 -v f1data:/data \
  -e FRONTEND_URL=https://f1.example.com \
  f1replay
```

#### Pre-computing session data

Session data is persisted in the Docker volume and survives restarts. To process data in bulk before browsing:

```bash
# Process a specific race weekend
docker exec <container> python precompute.py 2026 --round 1

# Process only the race session
docker exec <container> python precompute.py 2026 --round 1 --session R

# Process an entire season (takes several hours)
docker exec <container> python precompute.py 2025 --skip-existing

# Process multiple years
docker exec <container> python precompute.py 2024 2025 --skip-existing

# Add to sessions processed before these features (no full reprocess)
docker exec <container> python precompute.py 2026 --radio-audio-only   # team radio audio
docker exec <container> python precompute.py 2026 --minisectors-only   # qualifying mini-sectors
```

Downloads pause 60 seconds between sessions to stay within F1's limits (`--gap` to change it).

### Option B: Manual setup

#### Prerequisites

- Python 3.10+
- Node.js 18+
- An [OpenRouter](https://openrouter.ai/) API key (optional, enables photo sync; manual entry works without it)

#### 1. Clone and configure

```bash
git clone <repo-url>
cd F1ReplayTiming
```

Copy and edit the example env files:

```bash
cp .env.example backend/.env
```

**`backend/.env`** key variables:
```
DATA_DIR=./data
F1_USERNAME=your-f1-tv-email
F1_PASSWORD=your-f1-tv-password
# Optional
OPENROUTER_API_KEY=
AUTH_ENABLED=false
AUTH_PASSPHRASE=
```

#### 2. Install and run

```bash
# Backend
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

Backend at http://localhost:8000, frontend at http://localhost:3000.

#### 3. Getting session data

**On-demand (recommended for getting started):** select any past session from the homepage. The app processes it automatically using FastF1. First load takes **1-3 minutes**; subsequent loads are instant.

**Bulk pre-compute:**
```bash
cd backend
source venv/bin/activate

python precompute.py 2026 --round 1            # single race weekend
python precompute.py 2026 --round 1 --session R  # race only
python precompute.py 2025 --skip-existing      # full season (~2-3 hours)
python precompute.py 2024 2025 --skip-existing # multiple years
python precompute.py 2026 --radio-audio-only   # add team radio audio to stored sessions
python precompute.py 2026 --minisectors-only   # add mini-sectors to stored qualifying
```

Timing estimates: single session ~1-3 min, full race weekend ~3-5 min, full season ~2-3 hours.

The app also runs a background task that automatically detects and processes new session data on race weekends (Friday-Monday).

#### Photo Sync Feature

The broadcast sync feature lets you align the replay to a video recording. Manual sync (entering gap times) always works. To enable photo/screenshot sync (reads the timing tower from an image), set `OPENROUTER_API_KEY`. The app uses Gemini Flash via OpenRouter to read the leaderboard.

#### Team Radio

F1 publishes a selection of team radio clips per session as audio only. The backend transcribes them locally with [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (`small.en` model by default, one CPU thread), so no API key or paid service is needed.

- A newly processed session is transcribed in the background. A session processed before this feature is transcribed the first time someone opens its replay; the captions appear a few minutes later without reloading.
- Expect a few seconds per clip on a small ARM server, around 3 to 5 minutes for a race.
- The first transcription downloads the model (about 480 MB) into the FastF1 cache directory.
- Transcripts are English and machine-made, so some words will be wrong, and they don't say who is speaking (driver or engineer).
- Each clip's audio is stored with the session, so replays play it from your server (F1's copy needs an F1 TV token). It plays at 1× speed only, so sped-up replays don't talk over themselves. Add it to sessions transcribed before with `python precompute.py <year> --radio-audio-only`.
- Captions and audio can be turned off in Settings → Team Radio. The same tab picks the Whisper model for replays and for live timing (a new model downloads in the background, with progress, and captions keep using the current one until it's ready). Changing the model needs `AUTH_ENABLED` or `ALLOW_REPROCESS=true`.
- In live timing, the clip's audio plays from the server too (kept in memory while the caption is on screen).

## Acknowledgements

This project is powered by [FastF1](https://github.com/theOehrly/Fast-F1), an open-source Python library for accessing Formula 1 timing and telemetry data.

Based on [F1ReplayTiming](https://github.com/adn8naiagent/F1ReplayTiming) by [@adn8naiagent](https://github.com/adn8naiagent). Significant modifications and additions (live timing system, lap analysis panel, Picture-in-Picture, session timeline highlights, guided tour, storage management, unified single-container deployment, CI/CD pipelines, extensive UI/UX improvements, and various fixes) by [Clav3rbot](https://github.com/Clav3rbot).

## License

[MIT](LICENSE)
