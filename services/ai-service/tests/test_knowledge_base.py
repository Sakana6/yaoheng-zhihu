from __future__ import annotations

import json

from app.config import Settings
from app.data_sources import SnapshotKnowledgeStore
from app.modules.knowledge_base import KnowledgeBaseModule


class FixtureLiveClient:
    def __init__(self, payload):
        self.payload = payload

    def lookup_drug(self, drug_name: str):
        _ = drug_name
        return self.payload


def test_knowledge_base_snapshot_mode(service_root):
    settings = Settings(
        service_port=8000,
        model_version="parse_v1",
        kb_mode="snapshot",
        kb_cache_dir=service_root / "data" / "knowledge",
        kb_http_timeout=5.0,
        kb_enable_openfda=True,
        kb_enable_rxnav=True,
    )
    module = KnowledgeBaseModule(settings=settings)

    context = module.build_context(["二甲双胍", "缬沙坦"], trigger_type="symptom")

    assert context.normalized_medications[0].normalized_name == "METFORMIN"
    assert "餐次不足时需关注降糖治疗相关低糖风险" in context.adverse_effect_hints
    assert context.follow_up_templates


def test_knowledge_base_hybrid_mode_uses_live_fixture_when_snapshot_misses(service_root):
    payload = json.loads(
        (service_root / "tests" / "fixtures" / "live" / "rxnorm_lookup_unknownformin.json").read_text(encoding="utf-8")
    )
    settings = Settings(
        service_port=8000,
        model_version="parse_v1",
        kb_mode="hybrid",
        kb_cache_dir=service_root / "data" / "knowledge",
        kb_http_timeout=5.0,
        kb_enable_openfda=True,
        kb_enable_rxnav=True,
    )
    module = KnowledgeBaseModule(
        settings=settings,
        snapshot_store=SnapshotKnowledgeStore(settings.kb_cache_dir),
        live_client=FixtureLiveClient(payload),
    )

    context = module.build_context(["Unknownformin"], trigger_type="bg")

    assert context.normalized_medications[0].source == "live_api"
    assert "公开标签提示需关注低糖风险" in context.adverse_effect_hints


def test_knowledge_base_live_failure_degrades_to_fallback(service_root):
    class BrokenLiveClient:
        def lookup_drug(self, drug_name: str):
            _ = drug_name
            raise RuntimeError("network timeout")

    settings = Settings(
        service_port=8000,
        model_version="parse_v1",
        kb_mode="live",
        kb_cache_dir=service_root / "data" / "knowledge",
        kb_http_timeout=5.0,
        kb_enable_openfda=True,
        kb_enable_rxnav=True,
    )
    module = KnowledgeBaseModule(
        settings=settings,
        snapshot_store=SnapshotKnowledgeStore(settings.kb_cache_dir),
        live_client=BrokenLiveClient(),
    )

    context = module.build_context(["Unknownformin"], trigger_type="bg")

    assert context.normalized_medications[0].source == "fallback"
