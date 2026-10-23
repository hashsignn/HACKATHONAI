"""Convergence pricing: Judgment by complexity plus Signature by consequence."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from countersign.domain.models import AtRisk, CommercialOption, ComplexityTier, Consequence, Intake
from countersign.domain.pricing import build_quote

T2, T3 = ComplexityTier.TIER2, ComplexityTier.TIER3


def quote(
    container,
    service,
    tier,
    consequence,
    option=CommercialOption.PER_DELIVERABLE,
    at_risk=None,
    intake=None,
):
    return build_quote(
        container.catalogue,
        container.prices,
        service,
        tier,
        consequence,
        option,
        intake or Intake(),
        at_risk,
    )


def test_alpina_quote(container):
    q = quote(container, "legal.contract_review", T2, Consequence.INTERNAL_USE)
    assert (q.judgment_full, q.signature, q.total_fixed) == (5700, 1500, 7200)
    assert q.historical_fee == 10_000 and q.saving_vs_hourly == pytest.approx(0.28)


def test_the_decks_tax_opinion_example(container):
    q = quote(container, "tax.tax_opinion", T3, Consequence.EXTERNAL_RELIANCE)
    assert (q.judgment_full, q.signature, q.total_fixed, q.historical_fee) == (
        24500,
        12000,
        36500,
        51800,
    )
    assert q.signers == ["partner"]


def test_client_platform_reduces_judgment_only(container):
    q = quote(
        container,
        "legal.contract_review",
        T2,
        Consequence.INTERNAL_USE,
        CommercialOption.CLIENT_PLATFORM,
    )
    assert q.judgment_fixed == pytest.approx(5700 * container.prices.client_platform_factor)
    assert q.signature == 1500 and q.platform_licence > 0


def test_retainer_prices_a_year_of_deliverables(container):
    q = quote(
        container, "legal.contract_review", T2, Consequence.INTERNAL_USE, CommercialOption.RETAINER
    )
    p = container.prices
    assert q.retainer_annual_fee == pytest.approx(
        p.retainer_deliverables * 7200 * (1 - p.retainer_discount)
    )
    assert q.external_billing == "retainer"


def test_audit_bills_a_fixed_engagement_fee(container):
    q = quote(
        container,
        "audit.journal_entry_testing",
        T2,
        Consequence.REGULATORY,
        CommercialOption.ENGAGEMENT_FEE,
    )
    assert q.allowed and q.external_billing == "engagement_fee"
    assert q.signers == ["partner", "quality_reviewer"]


def test_outcome_linked_puts_only_judgment_at_risk(container):
    ar = AtRisk(
        share=0.15,
        kpi="Cycle time",
        baseline=62,
        threshold=55,
        full_at=45,
        higher_is_better=False,
        measured_by="ERP",
    )
    q = quote(
        container,
        "consulting.operating_model_diagnostic",
        T2,
        Consequence.INTERNAL_USE,
        CommercialOption.OUTCOME_LINKED,
        ar,
    )
    assert q.judgment_at_risk == pytest.approx(0.15 * q.judgment_full)
    assert q.judgment_fixed + q.judgment_at_risk == pytest.approx(q.judgment_full)
    assert q.total_max == pytest.approx(q.judgment_full + q.signature)


@pytest.mark.parametrize(
    ("higher", "threshold", "full_at", "measured", "ratio"),
    [
        (True, 10, 20, 5, 0.0),
        (True, 10, 20, 15, 0.5),
        (True, 10, 20, 25, 1.0),
        (False, 55, 45, 60, 0.0),
        (False, 55, 45, 50, 0.5),
        (False, 55, 45, 40, 1.0),
        (True, 10, 10, 9.9, 0.0),
        (True, 10, 10, 10, 1.0),  # all-or-nothing trigger
    ],
)
def test_at_risk_ramp(higher, threshold, full_at, measured, ratio):
    ar = AtRisk(
        share=0.1,
        kpi="KPI",
        baseline=0,
        threshold=threshold,
        full_at=full_at,
        higher_is_better=higher,
        measured_by="data",
    )
    assert ar.payout_ratio(measured) == pytest.approx(ratio)


def test_ramp_must_point_the_right_way():
    with pytest.raises(ValidationError):
        AtRisk(
            share=0.1,
            kpi="KPI",
            baseline=0,
            threshold=55,
            full_at=45,
            higher_is_better=True,
            measured_by="data",
        )
