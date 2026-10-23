"""Step 0: tiers, review intensity and signers follow published rules."""

from __future__ import annotations

import pytest

from countersign.domain.models import (
    CommercialOption,
    ComplexityTier,
    Consequence,
    Intake,
    ReviewLevel,
    Slot,
)
from countersign.domain.policy import final_signer_slots, recommend, review_policy
from countersign.domain.pricing import build_quote

ALPINA = Intake(
    client_position="buyer",
    client_importance="key",
    reliance=Consequence.INTERNAL_USE,
    value_at_stake_chf=12_600_000,
    duration_years=3,
    cross_border=True,
    bespoke=True,
)


def test_alpina_is_tier2_internal_use(container):
    rec = recommend(ALPINA, container.catalogue.service("legal.contract_review"))
    assert rec.complexity is ComplexityTier.TIER2 and rec.complexity_points == 4
    assert rec.consequence is Consequence.INTERNAL_USE


@pytest.mark.parametrize(
    ("kw", "tier"),
    [
        ({}, ComplexityTier.TIER1),
        ({"value_at_stake_chf": 2_000_000, "cross_border": True}, ComplexityTier.TIER2),
        (
            {
                "value_at_stake_chf": 30_000_000,
                "duration_years": 5,
                "cross_border": True,
                "bespoke": True,
            },
            ComplexityTier.TIER3,
        ),
    ],
)
def test_complexity_points(container, kw, tier):
    assert (
        recommend(Intake(**kw), container.catalogue.service("legal.contract_review")).complexity
        is tier
    )


def test_consequence_is_raised_to_the_service_minimum(container):
    rec = recommend(
        Intake(reliance=Consequence.INTERNAL_USE),
        container.catalogue.service("tax.corporate_tax_return"),
    )
    assert rec.consequence is Consequence.REGULATORY
    assert "minimum" in rec.consequence_rationale[-1]


@pytest.mark.parametrize(
    ("dept", "consequence", "importance", "level"),
    [
        ("legal", Consequence.INTERNAL_USE, "standard", ReviewLevel.STANDARD),
        ("legal", Consequence.INTERNAL_USE, "key", ReviewLevel.ELEVATED),
        ("legal", Consequence.EXTERNAL_RELIANCE, "standard", ReviewLevel.ELEVATED),
        ("legal", Consequence.REGULATORY, "key", ReviewLevel.CRITICAL),
        ("audit", Consequence.INTERNAL_USE, "standard", ReviewLevel.ELEVATED),  # department minimum
    ],
)
def test_review_level(container, dept, consequence, importance, level):
    pack = container.catalogue.department(dept).policy
    r = review_policy(consequence, ComplexityTier.TIER1, Intake(client_importance=importance), pack)
    assert r.policy.level is level


def test_signers_follow_consequence(container):
    legal = container.catalogue.department("legal").policy
    audit = container.catalogue.department("audit").policy
    assert final_signer_slots(Consequence.INTERNAL_USE, legal) == (Slot.MANAGER,)
    assert final_signer_slots(Consequence.EXTERNAL_RELIANCE, legal) == (Slot.PARTNER,)
    assert final_signer_slots(Consequence.REGULATORY, legal) == (
        Slot.PARTNER,
        Slot.QUALITY_REVIEWER,
    )
    assert final_signer_slots(Consequence.INTERNAL_USE, audit) == (Slot.PARTNER,)


def test_client_importance_never_changes_the_price(container):
    def total(importance: str) -> float:
        intake = ALPINA.model_copy(update={"client_importance": importance})
        return build_quote(
            container.catalogue,
            container.prices,
            "legal.contract_review",
            ComplexityTier.TIER2,
            Consequence.INTERNAL_USE,
            CommercialOption.PER_DELIVERABLE,
            intake,
        ).total_fixed

    assert total("key") == total("standard")
