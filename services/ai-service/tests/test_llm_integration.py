from __future__ import annotations

from app.modules.parsing import StructuredParsingModule
from app.modules.reporting import ReportGenerationModule
from app.domain import JointEventCandidate, RiskScoreResult


class FakeLLMClient:
    def __init__(self, parse_payload=None, report_payload=None):
        self.parse_payload = parse_payload
        self.report_payload = report_payload

    def extract_structured_event(self, trigger_type, raw_text, follow_up_templates):
        _ = (trigger_type, raw_text, follow_up_templates)
        return self.parse_payload

    def rewrite_report(self, family_version, doctor_version):
        _ = (family_version, doctor_version)
        return self.report_payload


def test_llm_parse_augments_rule_result():
    module = StructuredParsingModule(
        llm_client=FakeLLMClient(
            parse_payload={
                "symptoms": ["DIZZINESS", "SWEATING"],
                "meal": {"taken": True, "amount": "INSUFFICIENT"},
                "adherence": {"makeupMed": True, "missedMed": False},
                "timeHint": "MORNING",
            }
        )
    )

    result = module.parse("symptom", "今天早上头晕，早餐没吃完，药后来补吃了", ["模板1"])

    assert result.model_version == "parse_qwen_hybrid_v1"
    assert result.event.symptoms == ["DIZZINESS", "SWEATING"]


def test_llm_report_rewrites_when_valid():
    module = ReportGenerationModule(
        llm_client=FakeLLMClient(
            report_payload={
                "familyVersion": {
                    "title": "家属提示",
                    "actions": ["继续观察", "近期门诊复核降糖强度"],
                },
                "doctorVersion": {
                    "title": "复查摘要",
                    "summary": ["命中 JE001"],
                    "evidence": ["早餐摄入不足", "血糖低值"],
                },
            }
        )
    )

    report = module.generate(
        risk=RiskScoreResult(
            deintensification_score=82,
            interaction_score=20,
            behavior_score=61,
            joint_event_score=88,
            review_priority="CLINIC_REVIEW",
            reasons=["早餐摄入不足后仍发生与降糖治疗相关的不适事件"],
            model_version="risk_rules_v1",
        ),
        joint_events=[
            JointEventCandidate(
                event_type="JE001",
                severity=82,
                evidence={"symptoms": ["DIZZINESS"], "glucose": 3.8},
                risk_directions=["DEINTENSIFICATION", "JOINT_EVENT"],
            )
        ],
    )

    assert report["modelVersion"] == "report_qwen_hybrid_v1"
    assert report["familyVersion"]["title"] == "家属提示"
