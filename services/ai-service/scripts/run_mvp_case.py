from __future__ import annotations

import json
import sys
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parent.parent
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.pipeline import pipeline
from app.schemas import DetectJointEventsRequest, GenerateReportRequest, ScoreRiskRequest


def main() -> None:
    service_root = SERVICE_ROOT
    repo_root = service_root.parent.parent
    case_path = repo_root / "packages" / "contracts" / "examples" / "mvp-demo-case.json"
    case = json.loads(case_path.read_text(encoding="utf-8"))

    detect_response = pipeline.detect_joint_events(
        DetectJointEventsRequest(
            patientId=case["patient"]["id"],
            timeWindow={
                "start": case["timeline"][0]["time"],
                "end": "2026-03-31T10:00:00+08:00",
            },
            events=case["timeline"],
            medications=case["medications"],
            profile=case["patient"],
        )
    )
    score_response = pipeline.score_risk(
        ScoreRiskRequest(
            patientId=case["patient"]["id"],
            jointEvents=detect_response.jointEvents,
            profile=case["patient"],
        )
    )
    report_response = pipeline.generate_report(
        GenerateReportRequest(
            patientId=case["patient"]["id"],
            risk=score_response,
            jointEvents=detect_response.jointEvents,
        )
    )

    result = {
        "jointEvents": [item.model_dump() for item in detect_response.jointEvents],
        "risk": score_response.model_dump(),
        "doctorVersion": report_response.doctorVersion,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
