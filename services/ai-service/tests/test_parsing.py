from __future__ import annotations

from app.modules.parsing import StructuredParsingModule


def test_parse_event_extracts_real_evidence_without_defaulting():
    module = StructuredParsingModule()

    result = module.parse("symptom", "今天早上头晕，早餐没吃完，药后来补吃了", ["模板1"])

    assert result.event.symptoms == ["DIZZINESS"]
    assert result.event.meal_taken is True
    assert result.event.meal_amount == "INSUFFICIENT"
    assert result.event.adherence_makeup is True
    assert result.event.adherence_missed is False
    assert result.event.time_hint == "MORNING"


def test_parse_event_keeps_missing_fields_missing():
    module = StructuredParsingModule()

    result = module.parse("symptom", "今天状态还可以", ["模板1"])

    assert result.event.symptoms == []
    assert result.event.meal_taken is None
    assert result.event.meal_amount is None
    assert result.event.time_hint == ""
