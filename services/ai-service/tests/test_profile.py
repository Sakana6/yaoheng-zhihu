from __future__ import annotations

from app.modules.profile import ProfileModule


def test_profile_weight_adjustment_caps_scores():
    module = ProfileModule()

    adjusted = module.apply_weight_adjustment(
        {
            "deintensificationScore": 98,
            "interactionScore": 20,
            "behaviorScore": 95,
            "jointEventScore": 97,
        },
        {
            "low_bg_count_14d": 3,
            "low_bp_count_14d": 3,
            "missed_med_count_14d": 5,
            "response_rate": 0.4,
        },
    )

    assert adjusted["deintensificationScore"] == 100
    assert adjusted["behaviorScore"] == 100
    assert adjusted["jointEventScore"] == 100
