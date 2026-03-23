import hmac
from fastapi import Request, HTTPException
from src.config import settings


async def verify_internal_key(request: Request):
    key = request.headers.get("X-Internal-Key") or ""
    # hmac.compare_digest prevents timing attacks — always runs in constant time
    # regardless of where the strings diverge.  Without this, an attacker can
    # measure response latency to deduce characters of INTERNAL_KEY one at a time.
    if not hmac.compare_digest(key.encode(), settings.INTERNAL_KEY.encode()):
        raise HTTPException(status_code=401, detail="Unauthorized")
