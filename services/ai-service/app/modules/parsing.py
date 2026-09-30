from __future__ import annotations

from typing import Dict, List, Optional

from app.domain import ParsedStructuredEvent, StructuredParsingResult
from app.llm import QwenLLMClient


SYMPTOM_PATTERNS = {
    "DIZZINESS": ["头晕", "头昏", "dizz"],
    "SWEATING": ["出汗", "冒汗", "sweat"],
    "TREMOR": ["手抖", "发抖", "tremor"],
    "WEAKNESS": ["乏力", "没劲", "weak"],
    "UNSTEADY_STANDING": ["站立不稳", "不稳", "摇晃"],
}

TIME_PATTERNS = {
    "MORNING": ["早上", "早餐", "晨起", "morning"],
    "NOON": ["中午", "午饭", "lunch"],
    "EVENING": ["晚上", "晚饭", "晚间", "evening"],
    "NIGHT": ["夜里", "睡前", "夜间", "night"],
}


class StructuredParsingModule:
    def __init__(self, llm_client: Optional[QwenLLMClient] = None) -> None:
        self.llm_client = llm_client or QwenLLMClient()

    def parse(self, trigger_type: str, raw_text: str, follow_up_templates: List[str]) -> StructuredParsingResult:
        text = raw_text.strip()
        lowered = text.lower()
        symptoms = self._extract_symptoms(text, lowered)
        meal_taken, meal_amount = self._extract_meal(text, lowered)
        adherence = self._extract_adherence(text, lowered)
        time_hint = self._extract_time_hint(text, lowered)

        evidence_tokens: List[str] = []
        evidence_tokens.extend(symptoms)
        if meal_amount:
            evidence_tokens.append("MEAL_%s" % meal_amount)
        if adherence["makeupMed"]:
            evidence_tokens.append("MAKEUP_MED")
        if adherence["missedMed"]:
            evidence_tokens.append("MISSED_MED")
        if time_hint:
            evidence_tokens.append("TIME_%s" % time_hint)
        if trigger_type:
            evidence_tokens.append("TRIGGER_%s" % trigger_type.upper())
        if follow_up_templates:
            evidence_tokens.append("FOLLOWUP_TEMPLATE_READY")

        evidence_count = len(evidence_tokens)
        confidence = min(0.98, 0.35 + evidence_count * 0.1)
        model_version = "parse_rules_v1"

        llm_payload = self.llm_client.extract_structured_event(trigger_type, raw_text, follow_up_templates)
        if llm_payload:
            llm_event = self._build_from_llm(llm_payload)
            symptoms = _merge_unique(symptoms, llm_event.symptoms)
            meal_taken = llm_event.meal_taken if llm_event.meal_taken is not None else meal_taken
            meal_amount = llm_event.meal_amount or meal_amount
            adherence["makeupMed"] = adherence["makeupMed"] or llm_event.adherence_makeup
            adherence["missedMed"] = adherence["missedMed"] or llm_event.adherence_missed
            time_hint = llm_event.time_hint or time_hint
            if llm_event.evidence_tokens:
                evidence_tokens = _merge_unique(evidence_tokens, llm_event.evidence_tokens)
            evidence_count = len(evidence_tokens)
            confidence = min(0.99, max(confidence, 0.55 + evidence_count * 0.08))
            model_version = "parse_qwen_hybrid_v1"

        return StructuredParsingResult(
            event=ParsedStructuredEvent(
                symptoms=symptoms,
                meal_taken=meal_taken,
                meal_amount=meal_amount,
                adherence_makeup=adherence["makeupMed"],
                adherence_missed=adherence["missedMed"],
                time_hint=time_hint,
                evidence_tokens=evidence_tokens,
            ),
            confidence=round(confidence, 2),
            model_version=model_version,
        )

    def _extract_symptoms(self, text: str, lowered: str) -> List[str]:
        result: List[str] = []
        for code, patterns in SYMPTOM_PATTERNS.items():
            if any(pattern in text or pattern in lowered for pattern in patterns):
                result.append(code)
        return result

    def _extract_meal(self, text: str, lowered: str) -> tuple:
        if "没吃完" in text or "吃得少" in text or "不足" in text or "insufficient" in lowered:
            return True, "INSUFFICIENT"
        if "没吃" in text or "未进食" in text or "skip meal" in lowered:
            return False, "MISSED"
        if any(token in text for token in ("吃完", "正常吃饭")) or "normal meal" in lowered:
            return True, "NORMAL"
        return None, None

    def _extract_adherence(self, text: str, lowered: str) -> Dict[str, bool]:
        return {
            "makeupMed": ("补服" in text) or ("补吃" in text) or ("makeup" in lowered),
            "missedMed": ("漏服" in text) or ("missed" in lowered) or ("忘吃药" in text),
        }

    def _extract_time_hint(self, text: str, lowered: str) -> str:
        for label, patterns in TIME_PATTERNS.items():
            if any(pattern in text or pattern in lowered for pattern in patterns):
                return label
        return ""

    def _build_from_llm(self, payload: Dict[str, object]) -> ParsedStructuredEvent:
        symptoms = []
        for item in payload.get("symptoms", []) or []:
            value = str(item).upper()
            if value in SYMPTOM_PATTERNS:
                symptoms.append(value)

        meal = payload.get("meal", {}) or {}
        if not isinstance(meal, dict):
            meal = {}
        meal_taken = meal.get("taken")
        meal_amount = str(meal.get("amount", "")).upper()
        if meal_amount not in {"NORMAL", "INSUFFICIENT", "MISSED"}:
            meal_amount = None

        adherence = payload.get("adherence", {}) or {}
        if not isinstance(adherence, dict):
            adherence = {}
        time_hint = str(payload.get("timeHint", "")).upper()
        if time_hint not in TIME_PATTERNS:
            time_hint = ""

        evidence_tokens = list(symptoms)
        if meal_amount:
            evidence_tokens.append("MEAL_%s" % meal_amount)
        if adherence.get("makeupMed"):
            evidence_tokens.append("MAKEUP_MED")
        if adherence.get("missedMed"):
            evidence_tokens.append("MISSED_MED")
        if time_hint:
            evidence_tokens.append("TIME_%s" % time_hint)

        return ParsedStructuredEvent(
            symptoms=_merge_unique([], symptoms),
            meal_taken=meal_taken if isinstance(meal_taken, bool) else None,
            meal_amount=meal_amount,
            adherence_makeup=bool(adherence.get("makeupMed", False)),
            adherence_missed=bool(adherence.get("missedMed", False)),
            time_hint=time_hint,
            evidence_tokens=evidence_tokens,
        )


def _merge_unique(left: List[str], right: List[str]) -> List[str]:
    merged = list(left)
    for item in right:
        if item and item not in merged:
            merged.append(item)
    return merged
