from datetime import datetime, timezone

from fastapi import APIRouter


router = APIRouter(prefix="/health", tags=["health"])


@router.get("")
def health_check() -> dict[str, str]:
    return {
        "service": "ai-service",
        "status": "ok",
        "stage": "layered-skeleton",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
