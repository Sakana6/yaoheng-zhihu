from __future__ import annotations

from app.pipeline import pipeline
from app.schemas import DetectJointEventsRequest


def test_health_endpoint(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_ai_endpoints_work_for_mvp_case(client, mvp_case):
    parse_response = client.post(
        "/ai/parse-event",
        json={
            "patientId": 1,
            "triggerType": "symptom",
            "rawText": "今天早上头晕，早餐没吃完，药后来补吃了",
            "context": {
                "currentMedications": ["二甲双胍", "缬沙坦"],
                "latestBg": 3.8,
            },
        },
    )
    assert parse_response.status_code == 200
    assert parse_response.json()["structuredEvent"]["symptoms"] == ["DIZZINESS"]

    detect_request = {
        "patientId": mvp_case["patient"]["id"],
        "timeWindow": {
            "start": "2026-03-31T08:00:00+08:00",
            "end": "2026-03-31T10:00:00+08:00",
        },
        "events": mvp_case["timeline"],
        "medications": mvp_case["medications"],
        "profile": mvp_case["patient"],
    }
    detect_response = client.post("/ai/detect-joint-events", json=detect_request)
    assert detect_response.status_code == 200
    assert detect_response.json()["jointEvents"][0]["eventType"] == "JE001"

    score_response = client.post(
        "/ai/score-risk",
        json={
            "patientId": 1,
            "jointEvents": detect_response.json()["jointEvents"],
            "profile": mvp_case["patient"],
        },
    )
    assert score_response.status_code == 200
    assert score_response.json()["reviewPriority"] == "CLINIC_REVIEW"

    report_response = client.post(
        "/ai/generate-report",
        json={
            "patientId": 1,
            "risk": score_response.json(),
            "jointEvents": detect_response.json()["jointEvents"],
        },
    )
    assert report_response.status_code == 200
    assert report_response.json()["doctorVersion"]["title"] == "复查摘要"
