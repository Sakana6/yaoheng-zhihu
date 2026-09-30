from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional

from app.domain import JointEventCandidate, RiskScoreResult
from app.llm import QwenLLMClient


class ReportGenerationModule:
    def __init__(self, llm_client: Optional[QwenLLMClient] = None) -> None:
        self.llm_client = llm_client or QwenLLMClient()

    def generate(self, risk: RiskScoreResult, joint_events: List[JointEventCandidate]) -> dict:
        now = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        family_actions = self._build_family_actions(risk)
        doctor_summary = self._build_doctor_summary(risk, joint_events)
        doctor_evidence = self._build_doctor_evidence(risk, joint_events)
        report = {
            "familyVersion": {
                "title": "%s 风险提醒" % now,
                "actions": family_actions,
            },
            "doctorVersion": {
                "title": "复查摘要",
                "summary": doctor_summary,
                "evidence": doctor_evidence,
            },
            "modelVersion": "report_rules_v1",
        }
        llm_report = self.llm_client.rewrite_report(report["familyVersion"], report["doctorVersion"])
        if llm_report:
            family_version = llm_report.get("familyVersion", {})
            doctor_version = llm_report.get("doctorVersion", {})
            if _valid_report_section(family_version, doctor_version):
                report["familyVersion"] = family_version
                report["doctorVersion"] = doctor_version
                report["modelVersion"] = "report_qwen_hybrid_v1"
        return report

    def _build_family_actions(self, risk: RiskScoreResult) -> List[str]:
        actions = ["继续补录今日记录并留意餐次、服药和测量时间"]
        if risk.review_priority in {"CLINIC_REVIEW", "HIGH_PRIORITY"}:
            actions.append("近期门诊复核降糖强度")
        else:
            actions.append("按计划复测并继续观察")
        return actions

    def _build_doctor_summary(self, risk: RiskScoreResult, joint_events: List[JointEventCandidate]) -> List[str]:
        summary = [
            "复查优先级：%s" % risk.review_priority,
            "去强化治疗风险分：%s" % risk.deintensification_score,
            "联合事件风险分：%s" % risk.joint_event_score,
        ]
        for event in joint_events:
            if event.event_type == "JE001":
                summary.append("命中 JE001：进食不足叠加低血糖症状和低值信号")
        return summary

    def _build_doctor_evidence(self, risk: RiskScoreResult, joint_events: List[JointEventCandidate]) -> List[str]:
        evidence = list(risk.reasons)
        for event in joint_events:
            if event.event_type == "JE001":
                symptoms = event.evidence.get("symptoms", [])
                glucose = event.evidence.get("glucose")
                evidence.append("出现%s并伴随血糖低值 %s" % ("/".join(symptoms), glucose))
        return evidence


def _valid_report_section(family_version: dict, doctor_version: dict) -> bool:
    if not isinstance(family_version, dict) or not isinstance(doctor_version, dict):
        return False
    if not isinstance(family_version.get("title"), str):
        return False
    if not isinstance(family_version.get("actions"), list):
        return False
    if not isinstance(doctor_version.get("title"), str):
        return False
    if not isinstance(doctor_version.get("summary"), list):
        return False
    if not isinstance(doctor_version.get("evidence"), list):
        return False
    return True
