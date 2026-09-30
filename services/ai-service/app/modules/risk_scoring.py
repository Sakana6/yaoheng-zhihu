from __future__ import annotations

from typing import Dict, List

from app.domain import JointEventCandidate, RiskScoreResult


TEMPLATE_SCORES = {
    "JE001": {"deintensificationScore": 82, "interactionScore": 20, "behaviorScore": 61, "jointEventScore": 88},
    "JE002": {"deintensificationScore": 76, "interactionScore": 18, "behaviorScore": 42, "jointEventScore": 74},
    "JE003": {"deintensificationScore": 28, "interactionScore": 62, "behaviorScore": 76, "jointEventScore": 64},
    "JE004": {"deintensificationScore": 48, "interactionScore": 18, "behaviorScore": 70, "jointEventScore": 72},
    "JE005": {"deintensificationScore": 80, "interactionScore": 15, "behaviorScore": 55, "jointEventScore": 83}
}


class RiskScoringModule:
    def score(self, joint_events: List[JointEventCandidate]) -> RiskScoreResult:
        scores = {
            "deintensificationScore": 0,
            "interactionScore": 0,
            "behaviorScore": 0,
            "jointEventScore": 0,
        }
        reasons: List[str] = []

        for joint_event in joint_events:
            template_scores = TEMPLATE_SCORES.get(joint_event.event_type, {})
            for key, value in template_scores.items():
                scores[key] = max(scores[key], int(value))
            for reason in joint_event.reasons:
                if reason not in reasons:
                    reasons.append(reason)

        if not reasons:
            reasons.append("当前未命中高风险联合事件，建议继续观察")

        review_priority = self.map_review_priority(scores)
        return RiskScoreResult(
            deintensification_score=scores["deintensificationScore"],
            interaction_score=scores["interactionScore"],
            behavior_score=scores["behaviorScore"],
            joint_event_score=scores["jointEventScore"],
            review_priority=review_priority,
            reasons=reasons,
            model_version="risk_rules_v1",
        )

    def map_review_priority(self, scores: Dict[str, int]) -> str:
        review_priority_score = int(
            scores["deintensificationScore"] * 0.35
            + scores["interactionScore"] * 0.15
            + scores["behaviorScore"] * 0.15
            + scores["jointEventScore"] * 0.35
        )

        if review_priority_score >= 85:
            return "HIGH_PRIORITY"
        if review_priority_score >= 65:
            return "CLINIC_REVIEW"
        if review_priority_score >= 40:
            return "RETEST_SOON"
        return "OBSERVE"
