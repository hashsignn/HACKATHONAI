from __future__ import annotations

import pytest

from countersign.domain.models import Intake, ReviewLevel, Role
from countersign.domain.policy import assess


def intake(**kw) -> Intake:
    base = {
        "client_role": "buyer",
        "client_importance": "standard",
        "term_years": 1,
        "annual_value_chf": 500_000,
    }
    return Intake(**{**base, **kw})


@pytest.mark.parametrize(
    ("kw", "level"),
    [
        ({}, ReviewLevel.STANDARD),
        (
            {"client_importance": "key", "term_years": 3, "annual_value_chf": 4_200_000},
            ReviewLevel.ELEVATED,
        ),
        (
            {"client_importance": "key", "term_years": 5, "annual_value_chf": 25_000_000},
            ReviewLevel.CRITICAL,
        ),
    ],
)
def test_review_level_follows_published_rules(kw, level):
    result = assess(intake(**kw))
    assert result.policy.level is level
    assert result.rationale[-1].endswith(f"{level.value} review")


def test_critical_review_is_stricter_on_every_dial():
    std = assess(intake()).policy
    crit = assess(intake(client_importance="key", term_years=5, annual_value_chf=25_000_000)).policy
    assert crit.confidence_threshold > std.confidence_threshold
    assert crit.spot_check_rate > std.spot_check_rate
    assert crit.controls_per_engagement > std.controls_per_engagement
    assert crit.final_signer is Role.PARTNER and crit.manager_countersigns_milestones
