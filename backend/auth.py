"""
JWT authentication dependency for FastAPI.

Validates Supabase-issued tokens by calling supabase.auth.get_user() — this
works regardless of whether the project uses HS256 or RS256, and always
re-validates against Supabase's auth server.

Falls back to unauthenticated (dev) mode when SUPABASE_URL / SUPABASE_SERVICE_KEY
are not set — a warning is logged once per process.

Usage:
    from auth import get_current_user_optional

    @app.post("/some-write-endpoint")
    async def handler(req: MyModel, user: dict | None = Depends(get_current_user_optional)):
        user_id = user["id"] if user else None
        ...
"""

import logging
import os
from typing import Optional

from fastapi import Header, HTTPException

log = logging.getLogger("scout")

_auth_warned = False


def _is_configured() -> bool:
    return bool(
        os.getenv("SUPABASE_URL", "").strip()
        and os.getenv("SUPABASE_SERVICE_KEY", "").strip()
    )


async def get_current_user_optional(
    authorization: Optional[str] = Header(default=None),
) -> Optional[dict]:
    """
    Returns the Supabase user dict (contains ``id`` = user UUID) when a valid
    Bearer token is present.

    Returns ``None`` when:
    - No Authorization header was sent (unauthenticated / public access), or
    - Supabase is not configured (dev / no-DB mode).

    Raises HTTP 401 when a token is present but invalid / expired.
    """
    global _auth_warned

    if not _is_configured():
        if not _auth_warned:
            log.warning(
                "[auth] SUPABASE_URL/SUPABASE_SERVICE_KEY not configured — "
                "JWT validation is disabled.  Set these values in .env for production."
            )
            _auth_warned = True
        return None  # unauthenticated dev mode

    if not authorization:
        return None

    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        return None

    try:
        from supabase import create_client  # type: ignore

        client = create_client(
            os.getenv("SUPABASE_URL", ""),
            os.getenv("SUPABASE_SERVICE_KEY", ""),
        )
        response = client.auth.get_user(token)
        if not response or not response.user:
            raise HTTPException(status_code=401, detail="Invalid or expired token")
        # Return a dict with 'sub' for backward compat + 'id' as primary key
        user = response.user
        return {"sub": user.id, "id": user.id, "email": user.email}

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=401, detail=f"Token validation failed: {exc}")
