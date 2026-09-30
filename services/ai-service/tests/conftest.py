from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(autouse=True)
def disable_external_llm(monkeypatch):
    monkeypatch.setenv("DASHSCOPE_API_KEY", "")
    monkeypatch.setenv("AI_LLM_MODEL", "qwen-plus")
    monkeypatch.setenv("AI_LLM_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")


@pytest.fixture
def service_root() -> Path:
    return Path(__file__).resolve().parent.parent


@pytest.fixture
def repo_root(service_root: Path) -> Path:
    return service_root.parent.parent


@pytest.fixture
def mvp_case(repo_root: Path) -> dict:
    case_path = repo_root / "packages" / "contracts" / "examples" / "mvp-demo-case.json"
    return json.loads(case_path.read_text(encoding="utf-8"))


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)
