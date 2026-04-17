import asyncio
import os
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from auth import is_auth_enabled, verify_token
from routers import sessions, track, laps, results, replay, telemetry, sync, live, live_status
from routers import auth_routes
from services.auto_precompute import auto_precompute_loop

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Start background auto-precompute task
    task = asyncio.create_task(auto_precompute_loop())
    logger.info("Auto-precompute background task scheduled")
    yield
    # Cancel on shutdown
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(
    title="F1 Replay Timing API",
    description="Formula 1 race replay and telemetry data API",
    version="2.0.0",
    lifespan=lifespan,
)

# Optional CORS — only needed when running frontend dev server separately
frontend_url = os.environ.get("FRONTEND_URL")
if frontend_url:
    from fastapi.middleware.cors import CORSMiddleware
    extra_origins = [o.strip() for o in os.environ.get("EXTRA_ORIGINS", "").split(",") if o.strip()]
    allowed_origins = [frontend_url, "http://localhost:3000"] + extra_origins
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

# Auth middleware (skip auth endpoints, health, and WebSocket upgrades)
AUTH_SKIP_PATHS = {"/api/auth/status", "/api/auth/login", "/api/health"}


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    if not is_auth_enabled():
        return await call_next(request)
    # Only protect API routes (frontend pages/assets are public)
    if not request.url.path.startswith("/api/"):
        return await call_next(request)
    if request.url.path in AUTH_SKIP_PATHS:
        return await call_next(request)
    # Let CORS preflight through — CORSMiddleware handles these
    if request.method == "OPTIONS":
        return await call_next(request)
    # WebSocket upgrades are handled separately in the replay router
    if request.headers.get("upgrade", "").lower() == "websocket":
        return await call_next(request)
    token = request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
    if not verify_token(token):
        return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
    return await call_next(request)


# Routers
app.include_router(auth_routes.router)
app.include_router(sessions.router)
app.include_router(track.router)
app.include_router(laps.router)
app.include_router(results.router)
app.include_router(replay.router)
app.include_router(telemetry.router)
app.include_router(sync.router)
app.include_router(live.router)
app.include_router(live_status.router)


@app.get("/api/health")
async def health():
    return {"status": "ok"}


# ─── Old URL redirects (backward compatibility) ───

@app.get("/replay/{year}/{round_num}")
async def redirect_replay(year: int, round_num: int, type: str = "R"):
    return RedirectResponse(f"/replay?year={year}&round={round_num}&type={type}", status_code=301)


@app.get("/live/{year}/{round_num}")
async def redirect_live(year: int, round_num: int, type: str = "R"):
    return RedirectResponse(f"/live?year={year}&round={round_num}&type={type}", status_code=301)


@app.get("/results/{year}/{round_num}")
async def redirect_results(year: int, round_num: int, type: str = "R"):
    return RedirectResponse(f"/results?year={year}&round={round_num}&type={type}", status_code=301)


# ─── Frontend static files ───

STATIC_DIR = Path(os.environ.get("STATIC_DIR", "/app/static"))

_STATIC_RESOLVED: Path | None = None


def _safe_static_path(rel: str) -> Path | None:
    """Resolve rel against STATIC_DIR; return None if the path escapes the root."""
    global _STATIC_RESOLVED
    if _STATIC_RESOLVED is None:
        _STATIC_RESOLVED = STATIC_DIR.resolve()
    try:
        candidate = (STATIC_DIR / rel).resolve()
        if candidate.is_relative_to(_STATIC_RESOLVED):
            return candidate
    except (OSError, ValueError):
        pass
    return None


if STATIC_DIR.exists():
    next_static = STATIC_DIR / "_next"
    if next_static.exists():
        app.mount("/_next", StaticFiles(directory=str(next_static)), name="next-static")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        """Serve frontend static files with SPA fallback."""
        for rel in [full_path, f"{full_path}.html", f"{full_path}/index.html"]:
            p = _safe_static_path(rel)
            if p and p.is_file():
                return FileResponse(str(p))
        root_index = STATIC_DIR / "index.html"
        if root_index.is_file():
            return FileResponse(str(root_index))
        return JSONResponse(status_code=404, content={"detail": "Not found"})
