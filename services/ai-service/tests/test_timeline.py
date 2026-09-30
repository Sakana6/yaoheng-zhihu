from __future__ import annotations

from app.modules.timeline import TemporalAlignmentModule


def test_timeline_filters_events_by_window(mvp_case):
    module = TemporalAlignmentModule()
    bundle = module.align(
        events=mvp_case["timeline"],
        medications=mvp_case["medications"],
        profile=mvp_case["patient"],
        time_window={
            "start": "2026-03-31T08:00:00+08:00",
            "end": "2026-03-31T09:06:00+08:00",
        },
    )

    assert bundle.time_window.label == "MEDICATION_OR_MEAL"
    assert len(bundle.events) == 4
    assert [item.event_type for item in bundle.events] == ["MEAL", "ADHERENCE", "SYMPTOM", "BG"]
