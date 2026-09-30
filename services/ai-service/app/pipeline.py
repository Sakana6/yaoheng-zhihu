from __future__ import annotations

from app.domain import JointEventCandidate
from app.modules.joint_events import JointEventDetectionModule
from app.modules.knowledge_base import KnowledgeBaseModule
from app.modules.parsing import StructuredParsingModule
from app.modules.profile import ProfileModule
from app.modules.reporting import ReportGenerationModule
from app.modules.risk_scoring import RiskScoringModule
from app.modules.timeline import TemporalAlignmentModule
from app.schemas import (
    DetectJointEventsRequest,
    DetectJointEventsResponse,
    GenerateReportRequest,
    GenerateReportResponse,
    JointEvent,
    ParseEventRequest,
    ParseEventResponse,
    ScoreRiskRequest,
    ScoreRiskResponse,
)


class AISkeletonPipeline:
    def __init__(self) -> None:
        self.knowledge_base = KnowledgeBaseModule()
        self.parser = StructuredParsingModule()
        self.timeline = TemporalAlignmentModule()
        self.joint_event_detector = JointEventDetectionModule()
        self.profile_module = ProfileModule()
        self.risk_scorer = RiskScoringModule()
        self.report_generator = ReportGenerationModule()

    def parse_event(self, request: ParseEventRequest) -> ParseEventResponse:
        knowledge = self.knowledge_base.build_context(
            medications=request.context.get("currentMedications", []),
            latest_bp=request.context.get("latestBp"),
            latest_bg=request.context.get("latestBg"),
            trigger_type=request.triggerType,
        )
        parsed = self.parser.parse(request.triggerType, request.rawText, knowledge.follow_up_templates)
        meal = {}
        if parsed.event.meal_taken is not None:
            meal["taken"] = parsed.event.meal_taken
        if parsed.event.meal_amount:
            meal["amount"] = parsed.event.meal_amount

        structured_event = {
            "symptoms": parsed.event.symptoms,
            "meal": meal,
            "adherence": {
                "makeupMed": parsed.event.adherence_makeup,
                "missedMed": parsed.event.adherence_missed,
            },
        }
        if parsed.event.time_hint:
            structured_event["timeHint"] = parsed.event.time_hint

        return ParseEventResponse(
            structuredEvent=structured_event,
            confidence=parsed.confidence,
            modelVersion=parsed.model_version,
        )

    def detect_joint_events(self, request: DetectJointEventsRequest) -> DetectJointEventsResponse:
        knowledge = self.knowledge_base.build_context(
            medications=request.medications,
            profile=request.profile,
            trigger_type="default",
        )
        bundle = self.timeline.align(
            events=request.events,
            medications=request.medications,
            profile=request.profile,
            time_window=request.timeWindow,
        )
        candidates = self.joint_event_detector.detect(bundle, knowledge)
        return DetectJointEventsResponse(
            jointEvents=[self._to_joint_event(candidate) for candidate in candidates],
            modelVersion="joint_event_rules_v1",
        )

    def score_risk(self, request: ScoreRiskRequest) -> ScoreRiskResponse:
        profile_features = self.profile_module.build_features(request.profile)
        candidates = [self._from_joint_event(item) for item in request.jointEvents]
        base_response = self.risk_scorer.score(candidates)
        adjusted_scores = self.profile_module.apply_weight_adjustment(
            scores={
                "deintensificationScore": base_response.deintensification_score,
                "interactionScore": base_response.interaction_score,
                "behaviorScore": base_response.behavior_score,
                "jointEventScore": base_response.joint_event_score,
            },
            features=profile_features,
        )

        return ScoreRiskResponse(
            deintensificationScore=adjusted_scores["deintensificationScore"],
            interactionScore=adjusted_scores["interactionScore"],
            behaviorScore=adjusted_scores["behaviorScore"],
            jointEventScore=adjusted_scores["jointEventScore"],
            reviewPriority=self.risk_scorer.map_review_priority(adjusted_scores),
            reasons=base_response.reasons,
            modelVersion="risk_rules_v1",
        )

    def generate_report(self, request: GenerateReportRequest) -> GenerateReportResponse:
        report = self.report_generator.generate(
            risk=self._from_risk_response(request.risk),
            joint_events=[self._from_joint_event(item) for item in request.jointEvents],
        )
        return GenerateReportResponse(**report)

    def _to_joint_event(self, candidate: JointEventCandidate) -> JointEvent:
        return JointEvent(
            eventType=candidate.event_type,
            severity=candidate.severity,
            evidence=candidate.evidence,
            riskDirections=candidate.risk_directions,
        )

    def _from_joint_event(self, item: JointEvent) -> JointEventCandidate:
        return JointEventCandidate(
            event_type=item.eventType,
            severity=item.severity,
            evidence=item.evidence,
            risk_directions=list(item.riskDirections),
            reasons=list(item.evidence.get("reasonHints", [])),
        )

    def _from_risk_response(self, risk: ScoreRiskResponse):
        from app.domain import RiskScoreResult

        return RiskScoreResult(
            deintensification_score=risk.deintensificationScore,
            interaction_score=risk.interactionScore,
            behavior_score=risk.behaviorScore,
            joint_event_score=risk.jointEventScore,
            review_priority=risk.reviewPriority,
            reasons=list(risk.reasons),
            model_version=risk.modelVersion,
        )


pipeline = AISkeletonPipeline()
