from __future__ import annotations

from app.modules.joint_events import JointEventDetectionModule
from app.modules.knowledge_base import KnowledgeBaseModule
from app.modules.timeline import TemporalAlignmentModule


def test_je001_detects_from_mvp_case(service_root, mvp_case):
    knowledge = KnowledgeBaseModule().build_context(mvp_case["medications"], trigger_type="default")
    bundle = TemporalAlignmentModule().align(
        events=mvp_case["timeline"],
        medications=mvp_case["medications"],
        profile=mvp_case["patient"],
        time_window={
            "start": "2026-03-31T08:00:00+08:00",
            "end": "2026-03-31T10:00:00+08:00",
        },
    )

    events = JointEventDetectionModule().detect(bundle, knowledge)

    assert [item.event_type for item in events] == ["JE001"]
    assert events[0].severity == 82


def test_je001_requires_low_glucose_value(mvp_case):
    knowledge = KnowledgeBaseModule().build_context(mvp_case["medications"], trigger_type="default")
    timeline = [dict(item) for item in mvp_case["timeline"]]
    timeline[-1] = {
        "type": "BG",
        "time": "2026-03-31T09:05:00+08:00",
        "payload": {"glucoseValue": 5.8, "mealPhase": "POST_BREAKFAST"},
    }
    bundle = TemporalAlignmentModule().align(
        events=timeline,
        medications=mvp_case["medications"],
        profile=mvp_case["patient"],
        time_window={
            "start": "2026-03-31T08:00:00+08:00",
            "end": "2026-03-31T10:00:00+08:00",
        },
    )

    events = JointEventDetectionModule().detect(bundle, knowledge)

    assert events == []
