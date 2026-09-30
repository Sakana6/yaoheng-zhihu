from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from openai import OpenAI

from app.config import Settings, get_settings


class QwenLLMClient:
    def __init__(self, settings: Optional[Settings] = None, client: Optional[OpenAI] = None) -> None:
        self.settings = settings or get_settings()
        self._enabled = bool(self.settings.llm_api_key)
        self.client = client or (
            OpenAI(api_key=self.settings.llm_api_key, base_url=self.settings.llm_base_url)
            if self._enabled
            else None
        )

    @property
    def enabled(self) -> bool:
        return self._enabled and self.client is not None

    def extract_structured_event(
        self,
        trigger_type: str,
        raw_text: str,
        follow_up_templates: List[str],
    ) -> Optional[Dict[str, Any]]:
        if not self.enabled:
            return None

        prompt = (
            "你是医疗事件结构化助手。"
            "只输出 JSON，不要解释。"
            "字段限定为 symptoms, meal, adherence, timeHint。"
            "symptoms 仅允许 DIZZINESS,SWEATING,TREMOR,WEAKNESS,UNSTEADY_STANDING。"
            "meal.amount 仅允许 NORMAL,INSUFFICIENT,MISSED。"
            "adherence 字段仅允许 makeupMed, missedMed。"
            "timeHint 仅允许 MORNING,NOON,EVENING,NIGHT，未知时输出空字符串。"
        )
        user_content = {
            "triggerType": trigger_type,
            "rawText": raw_text,
            "followUpTemplates": follow_up_templates,
        }
        return self._json_completion(prompt, user_content)

    def rewrite_report(
        self,
        family_version: Dict[str, Any],
        doctor_version: Dict[str, Any],
    ) -> Optional[Dict[str, Any]]:
        if not self.enabled:
            return None

        prompt = (
            "你是医疗随访报告润色助手。"
            "只输出 JSON，不要解释。"
            "输出格式必须为 familyVersion 和 doctorVersion。"
            "familyVersion 仅保留 title, actions。"
            "doctorVersion 仅保留 title, summary, evidence。"
            "不能添加诊断结论或改药建议。"
        )
        user_content = {
            "familyVersion": family_version,
            "doctorVersion": doctor_version,
        }
        return self._json_completion(prompt, user_content)

    def _json_completion(self, system_prompt: str, user_payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        try:
            response = self.client.chat.completions.create(
                model=self.settings.llm_model,
                temperature=0.1,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)},
                ],
                response_format={"type": "json_object"},
            )
            content = response.choices[0].message.content
            if not content:
                return None
            return json.loads(content)
        except Exception:
            return None
