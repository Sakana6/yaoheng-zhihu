from __future__ import annotations

from app.domain import JointEventCandidate
from app.modules.risk_scoring import RiskScoringModule


def test_risk_scoring_matches_je001_scores():
    result = RiskScoringModule().score(
        [
            JointEventCandidate(
                event_type="JE001",
                severity=82,
                evidence={"reasonHints": []},
                risk_directions=["DEINTENSIFICATION", "JOINT_EVENT"],
                reasons=[
                    "早餐摄入不足后仍发生与降糖治疗相关的不适事件",
                    "症状与血糖低值共同支持近期复核降糖强度",
                ],
            )
        ]
    )

    assert result.deintensification_score == 82
    assert result.interaction_score == 20
    assert result.behavior_score == 61
    assert result.joint_event_score == 88
    assert result.review_priority == "CLINIC_REVIEW"
