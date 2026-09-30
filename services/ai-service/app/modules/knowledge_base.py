from __future__ import annotations

from typing import Any, Dict, List, Optional

from app.config import Settings, get_settings
from app.data_sources import LiveKnowledgeClient, SnapshotKnowledgeStore
from app.domain import KnowledgeContext, NormalizedMedication


class KnowledgeBaseModule:
    def __init__(
        self,
        settings: Optional[Settings] = None,
        snapshot_store: Optional[SnapshotKnowledgeStore] = None,
        live_client: Optional[LiveKnowledgeClient] = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.snapshot_store = snapshot_store or SnapshotKnowledgeStore(self.settings.kb_cache_dir)
        self.live_client = live_client or LiveKnowledgeClient(
            timeout=self.settings.kb_http_timeout,
            enable_openfda=self.settings.kb_enable_openfda,
            enable_rxnav=self.settings.kb_enable_rxnav,
        )

    def build_context(
        self,
        medications: List[Any],
        profile: Optional[Dict[str, Any]] = None,
        latest_bp: Optional[Dict[str, Any]] = None,
        latest_bg: Optional[float] = None,
        trigger_type: str = "default",
    ) -> KnowledgeContext:
        normalized_medications: List[NormalizedMedication] = []
        evidence_sources: List[str] = []

        for raw_item in medications:
            display_name = self._extract_medication_name(raw_item)
            normalized = self._normalize_medication(display_name)
            normalized_medications.append(normalized)
            if normalized.source not in evidence_sources:
                evidence_sources.append(normalized.source)

        normalized_names = [item.normalized_name for item in normalized_medications]
        interaction_hints = self.snapshot_store.get_interaction_hints(normalized_names)
        adverse_effect_hints = self.snapshot_store.get_adverse_effect_hints(normalized_names)
        for medication in normalized_medications:
            adverse_effect_hints.extend(medication.adverse_effect_hints)
        elderly_notices = self.snapshot_store.get_elderly_notices(normalized_names)

        profile = profile or {}
        if int(profile.get("age", 0) or 0) >= 75:
            elderly_notices.append("老年患者应优先复核治疗强度与耐受性")
        if latest_bg is not None and latest_bg <= 3.9:
            adverse_effect_hints.append("当前存在低血糖信号")
        if latest_bp and (
            int(latest_bp.get("systolic", 0) or 0) < 90
            or int(latest_bp.get("diastolic", 0) or 0) < 60
        ):
            adverse_effect_hints.append("当前存在低血压信号")

        follow_up_templates = self.snapshot_store.get_follow_up_templates(trigger_type)

        return KnowledgeContext(
            normalized_medications=normalized_medications,
            interaction_hints=_unique(interaction_hints),
            adverse_effect_hints=_unique(adverse_effect_hints),
            elderly_notices=_unique(elderly_notices),
            follow_up_templates=follow_up_templates,
            evidence_sources=evidence_sources,
        )

    def _extract_medication_name(self, raw_item: Any) -> str:
        if isinstance(raw_item, dict):
            for key in ("genericName", "brandName", "name", "drug"):
                value = raw_item.get(key)
                if value:
                    return str(value)
        return str(raw_item)

    def _normalize_medication(self, medication_name: str) -> NormalizedMedication:
        snapshot_hit = self.snapshot_store.lookup_drug(medication_name)
        if snapshot_hit:
            return NormalizedMedication(
                original_name=medication_name,
                normalized_name=snapshot_hit["normalizedName"],
                generic_name=snapshot_hit["genericName"],
                drug_classes=list(snapshot_hit.get("classes", [])),
                adverse_effect_hints=[],
                source=str(snapshot_hit.get("source", "snapshot")),
            )

        if self.settings.kb_mode in {"live", "hybrid"}:
            live_hit = self._safe_live_lookup(medication_name)
            if live_hit:
                return NormalizedMedication(
                    original_name=medication_name,
                    normalized_name=str(live_hit.get("normalizedName", medication_name.upper())),
                    generic_name=str(live_hit.get("genericName", medication_name)),
                    drug_classes=list(live_hit.get("classes", [])),
                    adverse_effect_hints=list(live_hit.get("adverseEffects", [])),
                    source="live_api",
                )

        return NormalizedMedication(
            original_name=medication_name,
            normalized_name=medication_name.upper(),
            generic_name=medication_name,
            drug_classes=[],
            adverse_effect_hints=[],
            source="fallback",
        )

    def _safe_live_lookup(self, medication_name: str) -> Optional[Dict[str, Any]]:
        try:
            live_hit = self.live_client.lookup_drug(medication_name)
        except Exception:
            return None

        if not live_hit:
            return None

        normalized_name = medication_name.upper()
        rxcui = live_hit.get("rxcui")
        if rxcui:
            normalized_name = normalized_name

        classes = list(live_hit.get("classes", []))
        adverse_effects = list(live_hit.get("adverseEffects", []))
        if classes or adverse_effects:
            return {
                "normalizedName": normalized_name,
                "genericName": medication_name,
                "classes": classes,
                "adverseEffects": adverse_effects,
            }
        return None


def _unique(items: List[str]) -> List[str]:
    ordered: List[str] = []
    for item in items:
        if item and item not in ordered:
            ordered.append(item)
    return ordered
