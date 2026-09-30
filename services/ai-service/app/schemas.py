from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


ReviewPriority = Literal["OBSERVE", "RETEST_SOON", "CLINIC_REVIEW", "HIGH_PRIORITY"]
RiskDirection = Literal[
    "DEINTENSIFICATION",
    "INTERACTION",
    "TEMPORAL_BEHAVIOR",
    "JOINT_EVENT",
]
JointEventType = Literal[
    "JE001",
    "JE002",
    "JE003",
    "JE004",
    "JE005",
    "JE006",
    "JE007",
    "JE008",
    "JE009",
    "JE010",
]


class StructuredEvent(BaseModel):
    symptoms: List[str] = Field(default_factory=list)
    meal: Dict[str, Any] = Field(default_factory=dict)
    adherence: Dict[str, Any] = Field(default_factory=dict)
    timeHint: Optional[str] = None


class ParseEventRequest(BaseModel):
    patientId: int
    triggerType: str
    rawText: str
    context: Dict[str, Any]


class ParseEventResponse(BaseModel):
    structuredEvent: StructuredEvent
    confidence: float
    modelVersion: str


class JointEvent(BaseModel):
    eventType: JointEventType
    severity: int
    evidence: Dict[str, Any]
    riskDirections: List[RiskDirection]


class DetectJointEventsRequest(BaseModel):
    patientId: int
    timeWindow: Dict[str, Any]
    events: List[Dict[str, Any]]
    medications: List[Dict[str, Any]]
    profile: Dict[str, Any]


class DetectJointEventsResponse(BaseModel):
    jointEvents: List[JointEvent]
    modelVersion: str


class ScoreRiskRequest(BaseModel):
    patientId: int
    jointEvents: List[JointEvent]
    profile: Dict[str, Any]


class ScoreRiskResponse(BaseModel):
    deintensificationScore: int
    interactionScore: int
    behaviorScore: int
    jointEventScore: int
    reviewPriority: ReviewPriority
    reasons: List[str]
    modelVersion: str


class GenerateReportRequest(BaseModel):
    patientId: int
    risk: ScoreRiskResponse
    jointEvents: List[JointEvent]


class GenerateReportResponse(BaseModel):
    familyVersion: Dict[str, Any]
    doctorVersion: Dict[str, Any]
    modelVersion: str
