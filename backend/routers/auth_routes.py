from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from auth import is_auth_enabled, generate_token, check_rate_limit

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    passphrase: str


@router.get("/status")
async def auth_status():
    return {"auth_enabled": is_auth_enabled()}


@router.post("/login")
async def auth_login(request: Request, body: LoginRequest):
    ip = request.client.host if request.client else "unknown"
    if not check_rate_limit(ip):
        raise HTTPException(status_code=429, detail="Too many login attempts. Try again later.")
    token = generate_token(body.passphrase)
    if token is None:
        raise HTTPException(status_code=401, detail="Invalid passphrase")
    return {"token": token}


@router.get("/verify")
async def auth_verify():
    """Validate a cached token. Not in AUTH_SKIP_PATHS, so the auth middleware
    will reject invalid tokens with 401 before this handler runs."""
    return {"valid": True}
