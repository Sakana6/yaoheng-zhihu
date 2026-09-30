from __future__ import annotations

from app.pipeline import pipeline
from app.schemas import DetectJointEventsRequest, GenerateReportRequest, ScoreRiskRequest


def test_mvp_golden_case_matches_expected_outputs(mvp_case):
    detect_response = pipeline.detect_joint_events(
        DetectJointEventsRequest(
            patientId=mvp_case["patient"]["id"],
            timeWindow={"start": "2026-03-31T08:00:00+08:00", "end": "2026-03-31T10:00:00+08:00"},
            events=mvp_case["timeline"],
            medications=mvp_case["medications"],
            profile=mvp_case["patient"],
        )
    )
    score_response = pipeline.score_risk(
        ScoreRiskRequest(
            patientId=mvp_case["patient"]["id"],
            jointEvents=detect_response.jointEvents,
            profile=mvp_case["patient"],
        )
    )
    report_response = pipeline.generate_report(
        GenerateReportRequest(
            patientId=mvp_case["patient"]["id"],
            risk=score_response,
            jointEvents=detect_response.jointEvents,
        )
    )

    assert detect_response.jointEvents[0].eventType == "JE001"
    assert detect_response.jointEvents[0].severity == 82
    assert detect_response.jointEvents[0].riskDirections == ["DEINTENSIFICATION", "JOINT_EVENT"]

    assert score_response.deintensificationScore == 82
    assert score_response.interactionScore == 20
    assert score_response.behaviorScore == 61
    assert score_response.jointEventScore == 88
    assert score_response.reviewPriority == "CLINIC_REVIEW"

    evidence_text = "\n".join(report_response.doctorVersion["summary"] + report_response.doctorVersion["evidence"])
    assert "进食不足" in evidence_text or "早餐摄入不足" in evidence_text
    assert "低血糖" in evidence_text or "血糖低值" in evidence_text
    assert "复核降糖强度" in evidence_text
