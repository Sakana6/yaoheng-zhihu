from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional


@dataclass
class NormalizedMedication:
    original_name: str
    normalized_name: str
    generic_name: str
    drug_classes: List[str] = field(default_factory=list)
    adverse_effect_hints: List[str] = field(default_factory=list)
    source: str = "snapshot"


@dataclass
class KnowledgeContext:
    normalized_medications: List[NormalizedMedication]
    interaction_hints: List[str] = field(default_factory=list)
    adverse_effect_hints: List[str] = field(default_factory=list)
    elderly_notices: List[str] = field(default_factory=list)
    follow_up_templates: List[str] = field(default_factory=list)
    evidence_sources: List[str] = field(default_factory=list)


@dataclass
class ParsedStructuredEvent:
    symptoms: List[str] = field(default_factory=list)
    meal_taken: Optional[bool] = None
    meal_amount: Optional[str] = None
    adherence_makeup: bool = False
    adherence_missed: bool = False
    time_hint: Optional[str] = None
    evidence_tokens: List[str] = field(default_factory=list)


@dataclass
class StructuredParsingResult:
    event: ParsedStructuredEvent
    confidence: float
    model_version: str


@dataclass
class TimelineEvent:
    event_type: str
    event_time: datetime
    payload: Dict[str, Any]
    raw: Dict[str, Any]


@dataclass
class TemporalWindow:
    start: datetime
    end: datetime
    label: str


@dataclass
class TemporalBundle:
    events: List[TimelineEvent]
    medications: List[Dict[str, Any]]
    profile: Dict[str, Any]
    time_window: TemporalWindow
    grouped_events: Dict[str, List[TimelineEvent]] = field(default_factory=dict)


@dataclass
class JointEventCandidate:
    event_type: str
    severity: int
    evidence: Dict[str, Any]
    risk_directions: List[str]
    reasons: List[str] = field(default_factory=list)


@dataclass
class RiskScoreResult:
    deintensification_score: int
    interaction_score: int
    behavior_score: int
    joint_event_score: int
    review_priority: str
    reasons: List[str]
    model_version: str
