from __future__ import annotations

import sys
from pathlib import Path

import uvicorn

SERVICE_ROOT = Path(__file__).resolve().parent.parent
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.config import get_settings


def main() -> None:
    settings = get_settings()
    uvicorn.run("app.main:app", host="0.0.0.0", port=settings.service_port, reload=False)


if __name__ == "__main__":
    main()
