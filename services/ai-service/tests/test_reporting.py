from __future__ import annotations

from app.domain import JointEventCandidate, RiskScoreResult
from app.modules.reporting import ReportGenerationModule


def test_reporting_mentions_evidence_and_actions():
    report = ReportGenerationModule().generate(
        risk=RiskScoreResult(
            deintensification_score=82,
            interaction_score=20,
            behavior_score=61,
            joint_event_score=88,
            review_priority="CLINIC_REVIEW",
            reasons=[
                "早餐摄入不足后仍发生与降糖治疗相关的不适事件",
                "症状与血糖低值共同支持近期复核降糖强度",
            ],
            model_version="risk_rules_v1",
        ),
        joint_events=[
            JointEventCandidate(
                event_type="JE001",
                severity=82,
                evidence={"symptoms": ["DIZZINESS", "SWEATING", "TREMOR"], "glucose": 3.8},
                risk_directions=["DEINTENSIFICATION", "JOINT_EVENT"],
            )
        ],
    )

    assert "近期门诊复核降糖强度" in report["familyVersion"]["actions"]
    assert any("JE001" in item for item in report["doctorVersion"]["summary"])
    assert any("3.8" in item for item in report["doctorVersion"]["evidence"])
