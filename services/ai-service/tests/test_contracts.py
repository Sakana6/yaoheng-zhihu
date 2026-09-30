from __future__ import annotations

import json
from pathlib import Path

import jsonschema
import yaml


def _resolve_schema(node, components):
    if isinstance(node, dict) and "$ref" in node:
        ref = node["$ref"]
        name = ref.split("/")[-1]
        return _resolve_schema(components[name], components)
    if isinstance(node, dict):
        return {key: _resolve_schema(value, components) for key, value in node.items()}
    if isinstance(node, list):
        return [_resolve_schema(item, components) for item in node]
    return node


def test_http_responses_match_openapi_and_json_schemas(client, repo_root, mvp_case):
    spec = yaml.safe_load(
        (repo_root / "packages" / "contracts" / "ai" / "ai-io-spec.yaml").read_text(encoding="utf-8")
    )
    components = spec["components"]["schemas"]

    parse_response = client.post(
        "/ai/parse-event",
        json={
            "patientId": 1,
            "triggerType": "symptom",
            "rawText": "今天早上头晕，早餐没吃完，药后来补吃了",
            "context": {"currentMedications": ["二甲双胍"], "latestBg": 3.8},
        },
    ).json()
    jsonschema.validate(parse_response, _resolve_schema(components["ParseEventResponse"], components))

    detect_response = client.post(
        "/ai/detect-joint-events",
        json={
            "patientId": 1,
            "timeWindow": {"start": "2026-03-31T08:00:00+08:00", "end": "2026-03-31T10:00:00+08:00"},
            "events": mvp_case["timeline"],
            "medications": mvp_case["medications"],
            "profile": mvp_case["patient"],
        },
    ).json()
    jsonschema.validate(detect_response, _resolve_schema(components["DetectJointEventsResponse"], components))

    joint_schema = json.loads(
        (repo_root / "packages" / "contracts" / "schemas" / "joint-event.schema.json").read_text(encoding="utf-8")
    )
    jsonschema.validate(detect_response["jointEvents"][0], joint_schema)

    score_response = client.post(
        "/ai/score-risk",
        json={"patientId": 1, "jointEvents": detect_response["jointEvents"], "profile": mvp_case["patient"]},
    ).json()
    jsonschema.validate(score_response, _resolve_schema(components["ScoreRiskResponse"], components))

    risk_schema = json.loads(
        (repo_root / "packages" / "contracts" / "schemas" / "risk-score.schema.json").read_text(encoding="utf-8")
    )
    jsonschema.validate(score_response, risk_schema)

    report_response = client.post(
        "/ai/generate-report",
        json={"patientId": 1, "risk": score_response, "jointEvents": detect_response["jointEvents"]},
    ).json()
    jsonschema.validate(report_response, _resolve_schema(components["GenerateReportResponse"], components))
