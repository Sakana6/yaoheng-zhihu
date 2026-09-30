from __future__ import annotations

from typing import Callable, Dict, List, Optional

from app.domain import JointEventCandidate, KnowledgeContext, TemporalBundle, TimelineEvent


Detector = Callable[[TemporalBundle, KnowledgeContext], Optional[JointEventCandidate]]
GLUCOSE_DRUG_CLASSES = {"GLUCOSE_LOWERING", "BIGUANIDE", "SULFONYLUREA"}
BP_DRUG_CLASSES = {"BP_LOWERING", "ARB", "ACEI", "CCB"}
TYPICAL_LOW_BG_SYMPTOMS = {"DIZZINESS", "SWEATING", "TREMOR"}
LOW_BP_SYMPTOMS = {"DIZZINESS", "WEAKNESS", "UNSTEADY_STANDING"}


class JointEventDetectionModule:
    def __init__(self) -> None:
        self.detectors: Dict[str, Detector] = {
            "JE001": self._detect_je001,
            "JE002": self._detect_je002,
            "JE003": self._detect_je003,
            "JE004": self._detect_je004,
            "JE005": self._detect_je005,
            "JE006": self._placeholder,
            "JE007": self._placeholder,
            "JE008": self._placeholder,
            "JE009": self._placeholder,
            "JE010": self._placeholder,
        }

    def detect(self, bundle: TemporalBundle, knowledge: KnowledgeContext) -> List[JointEventCandidate]:
        joint_events: List[JointEventCandidate] = []
        for event_type, detector in self.detectors.items():
            candidate = detector(bundle, knowledge)
            if candidate:
                joint_events.append(candidate)
        return joint_events

    def _detect_je001(self, bundle: TemporalBundle, knowledge: KnowledgeContext) -> Optional[JointEventCandidate]:
        if not self._has_medication_class(knowledge, GLUCOSE_DRUG_CLASSES):
            return None
        if bundle.time_window.label not in {"MEDICATION_OR_MEAL", "GENERAL"}:
            return None

        meal = self._first_meal(bundle, "INSUFFICIENT")
        glucose_event = self._lowest_glucose(bundle)
        symptoms = self._symptom_codes(bundle)
        if not meal or not glucose_event:
            return None
        if glucose_event.payload.get("glucoseValue", 99) > 3.9:
            return None
        if not TYPICAL_LOW_BG_SYMPTOMS.intersection(symptoms):
            return None

        return JointEventCandidate(
            event_type="JE001",
            severity=82,
            evidence={
                "meal": "INSUFFICIENT",
                "symptoms": sorted(TYPICAL_LOW_BG_SYMPTOMS.intersection(symptoms)),
                "glucose": glucose_event.payload.get("glucoseValue"),
                "medications": [item.generic_name for item in knowledge.normalized_medications if set(item.drug_classes) & GLUCOSE_DRUG_CLASSES],
                "reasonHints": [
                    "早餐摄入不足后仍发生与降糖治疗相关的不适事件",
                    "症状与血糖低值共同支持近期复核降糖强度",
                ],
                "timeWindow": {
                    "start": bundle.time_window.start.isoformat(),
                    "end": bundle.time_window.end.isoformat(),
                },
            },
            risk_directions=["DEINTENSIFICATION", "JOINT_EVENT"],
            reasons=[
                "早餐摄入不足后仍处于降糖治疗背景",
                "出现头晕/出汗/手抖并伴随低血糖值",
            ],
        )

    def _detect_je002(self, bundle: TemporalBundle, knowledge: KnowledgeContext) -> Optional[JointEventCandidate]:
        if not self._has_medication_class(knowledge, BP_DRUG_CLASSES):
            return None
        bp_event = self._lowest_bp(bundle)
        symptoms = self._symptom_codes(bundle)
        if not bp_event:
            return None
        systolic = int(bp_event.payload.get("systolic", 0) or 0)
        diastolic = int(bp_event.payload.get("diastolic", 0) or 0)
        if systolic >= 90 and diastolic >= 60:
            return None
        if not LOW_BP_SYMPTOMS.intersection(symptoms):
            return None
        return JointEventCandidate(
            event_type="JE002",
            severity=78,
            evidence={
                "bloodPressure": {"systolic": systolic, "diastolic": diastolic},
                "symptoms": sorted(LOW_BP_SYMPTOMS.intersection(symptoms)),
                "reasonHints": ["低压信号与头晕/站立不稳共同提示需复核降压强度"],
            },
            risk_directions=["DEINTENSIFICATION", "JOINT_EVENT"],
            reasons=["低压信号与头晕/站立不稳共同提示需复核降压强度"],
        )

    def _detect_je003(self, bundle: TemporalBundle, knowledge: KnowledgeContext) -> Optional[JointEventCandidate]:
        adherence_events = bundle.grouped_events.get("ADHERENCE", [])
        if len(knowledge.normalized_medications) < 2 or not adherence_events:
            return None
        event_types = {str(item.payload.get("eventType", "")).upper() for item in adherence_events}
        has_anomaly = bool(event_types.intersection({"MISSED", "MAKEUP"}))
        bg_values = [float(item.payload.get("glucoseValue")) for item in bundle.grouped_events.get("BG", []) if item.payload.get("glucoseValue") is not None]
        fluctuation = (max(bg_values) - min(bg_values)) >= 2 if len(bg_values) >= 2 else False
        if not has_anomaly or not fluctuation:
            return None
        return JointEventCandidate(
            event_type="JE003",
            severity=68,
            evidence={
                "adherenceEvents": sorted(event_types),
                "glucoseValues": bg_values,
                "medicationCount": len(knowledge.normalized_medications),
                "reasonHints": ["多药并用背景下出现漏服/补服且指标波动增大"],
            },
            risk_directions=["INTERACTION", "TEMPORAL_BEHAVIOR"],
            reasons=["多药并用背景下出现漏服/补服且指标波动增大"],
        )

    def _detect_je004(self, bundle: TemporalBundle, knowledge: KnowledgeContext) -> Optional[JointEventCandidate]:
        if bundle.time_window.label != "NIGHT_TO_MORNING":
            return None
        symptoms = self._symptom_codes(bundle)
        adherence_events = bundle.grouped_events.get("ADHERENCE", [])
        had_night_medication = any(item.event_time.hour >= 20 for item in adherence_events)
        morning_symptoms = bool(LOW_BP_SYMPTOMS.intersection(symptoms) or TYPICAL_LOW_BG_SYMPTOMS.intersection(symptoms))
        if not had_night_medication or not morning_symptoms:
            return None
        return JointEventCandidate(
            event_type="JE004",
            severity=72,
            evidence={
                "nightMedication": had_night_medication,
                "symptoms": sorted(symptoms),
                "reasonHints": ["夜间服药后次晨出现不适，需复核给药时序"],
            },
            risk_directions=["TEMPORAL_BEHAVIOR", "JOINT_EVENT"],
            reasons=["夜间服药后次晨出现不适，需复核给药时序"],
        )

    def _detect_je005(self, bundle: TemporalBundle, knowledge: KnowledgeContext) -> Optional[JointEventCandidate]:
        if not self._has_medication_class(knowledge, GLUCOSE_DRUG_CLASSES):
            return None
        low_bg_count = int(bundle.profile.get("lowBgCount14d", 0) or 0)
        symptoms = self._symptom_codes(bundle)
        if low_bg_count < 2:
            return None
        if not TYPICAL_LOW_BG_SYMPTOMS.intersection(symptoms):
            return None
        return JointEventCandidate(
            event_type="JE005",
            severity=80,
            evidence={
                "lowBgCount14d": low_bg_count,
                "symptoms": sorted(TYPICAL_LOW_BG_SYMPTOMS.intersection(symptoms)),
                "reasonHints": ["近14天低糖趋势叠加当前症状，需复核降糖强度"],
            },
            risk_directions=["DEINTENSIFICATION", "JOINT_EVENT"],
            reasons=["近14天低糖趋势叠加当前症状，需复核降糖强度"],
        )

    def _placeholder(self, bundle: TemporalBundle, knowledge: KnowledgeContext) -> Optional[JointEventCandidate]:
        _ = bundle
        _ = knowledge
        return None

    def _has_medication_class(self, knowledge: KnowledgeContext, target_classes: set) -> bool:
        for item in knowledge.normalized_medications:
            if set(item.drug_classes).intersection(target_classes):
                return True
        return False

    def _first_meal(self, bundle: TemporalBundle, intake_level: str) -> Optional[TimelineEvent]:
        for item in bundle.grouped_events.get("MEAL", []):
            if str(item.payload.get("intakeLevel", "")).upper() == intake_level:
                return item
        return None

    def _lowest_glucose(self, bundle: TemporalBundle) -> Optional[TimelineEvent]:
        glucose_events = [item for item in bundle.grouped_events.get("BG", []) if item.payload.get("glucoseValue") is not None]
        if not glucose_events:
            return None
        return min(glucose_events, key=lambda item: float(item.payload.get("glucoseValue")))

    def _lowest_bp(self, bundle: TemporalBundle) -> Optional[TimelineEvent]:
        bp_events = bundle.grouped_events.get("BP", [])
        if not bp_events:
            return None
        return min(bp_events, key=lambda item: (int(item.payload.get("systolic", 999)), int(item.payload.get("diastolic", 999))))

    def _symptom_codes(self, bundle: TemporalBundle) -> set:
        symptoms = set()
        for item in bundle.grouped_events.get("SYMPTOM", []):
            for code in item.payload.get("symptomCodes", []):
                symptoms.add(str(code).upper())
        return symptoms
