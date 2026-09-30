from __future__ import annotations

from typing import Any, Dict


class ProfileModule:
    def build_features(self, profile: Dict[str, Any]) -> Dict[str, Any]:
        disease_tags = profile.get("diseaseTags", [])
        medications = profile.get("currentMedications", [])
        return {
            "age": int(profile.get("age", 0) or 0),
            "comorbidity_count": len(disease_tags) if isinstance(disease_tags, list) else 0,
            "total_medication_count": len(medications) if isinstance(medications, list) else 0,
            "low_bg_count_14d": int(profile.get("lowBgCount14d", 0) or 0),
            "low_bp_count_14d": int(profile.get("lowBpCount14d", 0) or 0),
            "missed_med_count_14d": int(profile.get("missedMedCount14d", 0) or 0),
            "response_rate": float(profile.get("responseRate", 1.0) or 1.0),
        }

    def apply_weight_adjustment(self, scores: Dict[str, int], features: Dict[str, Any]) -> Dict[str, int]:
        adjusted = dict(scores)
        if features.get("low_bg_count_14d", 0) >= 3:
            adjusted["deintensificationScore"] = min(100, adjusted["deintensificationScore"] + 5)
        if features.get("low_bp_count_14d", 0) >= 3:
            adjusted["deintensificationScore"] = min(100, adjusted["deintensificationScore"] + 4)
        if features.get("missed_med_count_14d", 0) >= 4:
            adjusted["behaviorScore"] = min(100, adjusted["behaviorScore"] + 8)
        if features.get("response_rate", 1.0) < 0.5 and adjusted["jointEventScore"] > 60:
            adjusted["jointEventScore"] = min(100, adjusted["jointEventScore"] + 5)
        return adjusted
