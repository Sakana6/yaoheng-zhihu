from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass
class Settings:
    service_port: int
    model_version: str
    kb_mode: str
    kb_cache_dir: Path
    kb_http_timeout: float
    kb_enable_openfda: bool
    kb_enable_rxnav: bool
    llm_base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    llm_model: str = "qwen-plus"
    llm_api_key: str = ""


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _load_env_file() -> None:
    app_dir = Path(__file__).resolve().parent
    service_root = app_dir.parent
    env_path = service_root / ".env.local"
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


def get_settings() -> Settings:
    _load_env_file()
    app_dir = Path(__file__).resolve().parent
    service_root = app_dir.parent
    default_cache_dir = service_root / "data" / "knowledge"

    return Settings(
        service_port=int(os.getenv("AI_SERVICE_PORT", "8000")),
        model_version=os.getenv("AI_MODEL_VERSION", "parse_v1"),
        kb_mode=os.getenv("AI_KB_MODE", "hybrid").strip().lower(),
        kb_cache_dir=Path(os.getenv("AI_KB_CACHE_DIR", str(default_cache_dir))).resolve(),
        kb_http_timeout=float(os.getenv("AI_KB_HTTP_TIMEOUT", "5.0")),
        kb_enable_openfda=_env_bool("AI_KB_ENABLE_OPENFDA", True),
        kb_enable_rxnav=_env_bool("AI_KB_ENABLE_RXNAV", True),
        llm_base_url=os.getenv("AI_LLM_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1"),
        llm_model=os.getenv("AI_LLM_MODEL", "qwen-plus"),
        llm_api_key=os.getenv("DASHSCOPE_API_KEY", ""),
    )
