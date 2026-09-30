from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def main() -> int:
    service_root = Path(__file__).resolve().parent.parent
    command = [sys.executable, "-m", "pytest", "tests", "-q"]
    return subprocess.call(command, cwd=str(service_root))


if __name__ == "__main__":
    raise SystemExit(main())
