"""Policy packs: what the platform refuses to sell, and why."""

from __future__ import annotations

import pytest

from countersign.domain.guardrails import check
from countersign.domain.models import AtRisk, CommercialOption, Consequence, Intake

AT_RISK = AtRisk(
    share=0.15,
    kpi="Order-to-cash days",
    baseline=62,
    threshold=55,
    full_at=45,
    higher_is_better=False,
    measured_by="client ERP",
)


def rules(
    container, service_id, option, consequence=Consequence.INTERNAL_USE, intake=None, at_risk=None
):
    s = container.catalogue.service(service_id)
    d = container.catalogue.department(s.department)
    return {v.rule for v in check(d, s, option, consequence, intake or Intake(), at_risk)}


def test_outcome_linked_consulting_is_allowed(container):
    assert (
        rules(
            container,
            "consulting.operating_model_diagnostic",
            CommercialOption.OUTCOME_LINKED,
            at_risk=AT_RISK,
        )
        == set()
    )


@pytest.mark.parametrize(
    ("service", "option", "rule"),
    [
        (
            "consulting.operating_model_diagnostic",
            CommercialOption.OUTCOME_LINKED,
            "independence-contingent-fee",
        ),
        ("legal.contract_review", CommercialOption.CLIENT_PLATFORM, "independence-platform"),
    ],
)
def test_independence_for_audit_clients(container, service, option, rule):
    found = rules(
        container,
        service,
        option,
        intake=Intake(is_audit_client=True),
        at_risk=AT_RISK if option is CommercialOption.OUTCOME_LINKED else None,
    )
    assert rule in found


def test_due_diligence_is_never_outcome_linked(container):
    found = rules(
        container,
        "deal_advisory.financial_due_diligence",
        CommercialOption.OUTCOME_LINKED,
        Consequence.EXTERNAL_RELIANCE,
        at_risk=AT_RISK,
    )
    assert "outcome-not-for-service" in found


def test_at_risk_share_is_capped(container):
    big = AT_RISK.model_copy(update={"share": 0.4})
    assert "at-risk-too-high" in rules(
        container,
        "consulting.operating_model_diagnostic",
        CommercialOption.OUTCOME_LINKED,
        at_risk=big,
    )


def test_at_risk_needs_the_outcome_option(container):
    assert "at-risk-without-outcome" in rules(
        container,
        "consulting.operating_model_diagnostic",
        CommercialOption.PER_DELIVERABLE,
        at_risk=AT_RISK,
    )


def test_audit_sells_only_the_engagement_fee(container):
    found = rules(
        container,
        "audit.journal_entry_testing",
        CommercialOption.PER_DELIVERABLE,
        Consequence.REGULATORY,
    )
    assert found == {"option-not-offered"}


def test_consequence_cannot_go_below_the_service_minimum(container):
    found = rules(
        container,
        "tax.corporate_tax_return",
        CommercialOption.PER_DELIVERABLE,
        Consequence.INTERNAL_USE,
    )
    assert "consequence-below-minimum" in found
