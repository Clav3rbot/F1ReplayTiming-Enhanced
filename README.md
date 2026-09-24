<h1><img src="frontend/public/logo.png" width="50" align="absmiddle" /> F1 Replay Timing Enhanced</h1>

> **Disclaimer:** This project is intended for **personal, non-commercial use only**. This website is unofficial and is not associated in any way with the Formula 1 companies. F1, FORMULA ONE, FORMULA 1, FIA FORMULA ONE WORLD CHAMPIONSHIP, GRAND PRIX and related marks are trade marks of Formula One Licensing B.V.

A web app for watching Formula 1 sessions with real timing data, car positions on track, driver telemetry, and more, both live during race weekends and as replays of past sessions. Built with Next.js and FastAPI.

https://github.com/user-attachments/assets/b032324a-c6f4-42df-abab-13ed9d62ae47


## Features

- **Live timing**: connect to live F1 sessions during race weekends with real-time data from the F1 SignalR stream, including a broadcast delay slider and automatic detection of post-session replays
- **Track map** with real-time car positions from GPS telemetry, updating every 0.5 seconds with smooth interpolation, plus optional corner numbers and an elevation view
- **Driver leaderboard** showing position, gap to leader, interval, tyre compound and age, tyre history, pit stop count, grid position changes, fastest lap indicator, investigation/penalty status, and last lap time with purple/green colour coding for fastest and personal best
- **Race control messages**: steward decisions, investigations, penalties, track limits, and flag changes displayed in a resizable overlay on the track map
- **Pit position prediction**: estimates where a driver would rejoin if they pitted now, with predicted gap ahead and behind, using precomputed pit loss times per circuit with Safety Car and Virtual Safety Car adjustments
- **Telemetry** for any driver showing speed, throttle, brake, gear, and DRS plotted against track distance
- **Lap analysis panel**: lap time chart, delta comparison between two drivers, and sortable lap table
- **Picture-in-Picture**: compact floating window with track map, race control, leaderboard, and telemetry
- **Broadcast sync**: match the replay to a recording of a session, either by uploading a screenshot of the timing tower (using AI vision) or by manually entering gap times
- **Weather data** including air and track temperature, humidity, wind, and rainfall status
- **Track status flags** for green, yellow, Safety Car, Virtual Safety Car, and red flag conditions
- **Playback controls** with 0.5× to 20× speed, skip buttons (5 s, 30 s, 1 m, 5 m), lap jumping, and a progress bar
- **Session timeline**: hover the progress bar to see where the action is. An intensity curve peaks at the busiest moments (overtakes, incidents, retirements, flag changes); coloured chapters mark yellow flag, Safety Car, Virtual Safety Car and red flag periods; markers show on-track incidents and retirements. Each overlay can be toggled in Settings → Timeline
- **Qualifying view**: Q1/Q2/Q3 phase jumps, live sector time bars, lap completion notifications, and knocked-out drivers dimmed in the leaderboard
- **Guided tour** on first visit to the homepage and the player, ending with an F1 start-lights sequence that starts the replay; it can be replayed from Settings → Other
- **Next session countdown** on the homepage
- **Storage management**: see which sessions are stored and how much space they take, delete old sessions, and reprocess a session from the picker
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
| `AUTO_PRECOMPUTE` | Which session types to background-fetch on race weekends: `off`, `race`, `race+qual` (default), `all` |
| `F1_SIGNALR_PROXY` | Optional; Cloudflare Worker URL to proxy F1 SignalR connections — needed when hosting on data-centre IPs blocked by F1's CDN (e.g. Oracle Cloud, AWS) |
| `OPENROUTER_API_KEY` | Optional; enables photo sync ([get a key](https://openrouter.ai/)) |
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
```

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
```

Timing estimates: single session ~1-3 min, full race weekend ~3-5 min, full season ~2-3 hours.

The app also runs a background task that automatically detects and processes new session data on race weekends (Friday-Monday).

#### Photo Sync Feature

The broadcast sync feature lets you align the replay to a video recording. Manual sync (entering gap times) always works. To enable photo/screenshot sync (reads the timing tower from an image), set `OPENROUTER_API_KEY`. The app uses Gemini Flash via OpenRouter to read the leaderboard.

## Acknowledgements

This project is powered by [FastF1](https://github.com/theOehrly/Fast-F1), an open-source Python library for accessing Formula 1 timing and telemetry data.

Based on [F1ReplayTiming](https://github.com/adn8naiagent/F1ReplayTiming) by [@adn8naiagent](https://github.com/adn8naiagent). Significant modifications and additions (live timing system, lap analysis panel, Picture-in-Picture, session timeline highlights, guided tour, storage management, unified single-container deployment, CI/CD pipelines, extensive UI/UX improvements, and various fixes) by [Clav3rbot](https://github.com/Clav3rbot).

## License

[MIT](LICENSE)
