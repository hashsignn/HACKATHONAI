"""Pricing confirmation, people rules and the Signature line across departments."""

from __future__ import annotations

import pytest

from countersign.domain.errors import Conflict, Forbidden
from countersign.domain.models import CommercialOption, ComplexityTier, Consequence, Intake, Slot
from countersign.projections.state import EngagementStatus
from countersign.scenario import ENGAGEMENT_ID, JUNIOR, MANAGER
from tests.helpers import REGULATORY_TEAM, TEAM, complete_milestones, sign_off


def test_work_cannot_start_before_pricing(run_until, svc):
    run_until("opened")
    with pytest.raises(Conflict, match="pricing must be confirmed"):
        svc.start_milestone(JUNIOR, ENGAGEMENT_ID, "M1")


def test_only_a_manager_or_partner_confirms_pricing(run_until, svc):
    run_until("opened")
    with pytest.raises(Forbidden):
        svc.confirm_pricing(JUNIOR, ENGAGEMENT_ID)


def test_overriding_a_recommended_tier_needs_a_reason(run_until, svc):
    run_until("opened")
    with pytest.raises(Conflict, match="written reason"):
        svc.confirm_pricing(MANAGER, ENGAGEMENT_ID, complexity=ComplexityTier.TIER1)
    state = svc.confirm_pricing(
        MANAGER,
        ENGAGEMENT_ID,
        complexity=ComplexityTier.TIER1,
        override_reason="Standard supplier template",
    )
    assert state.pricing.overrides == ["complexity tier2 -> tier1"]
    assert state.pricing.quote["judgment_full"] == 2900


def test_pricing_is_locked_once_confirmed(run_until, svc):
    run_until("priced")
    with pytest.raises(Conflict, match="locked"):
        svc.confirm_pricing(MANAGER, ENGAGEMENT_ID)


def test_forbidden_combinations_cannot_be_opened(svc):
    with pytest.raises(Conflict, match="Independence"):
        svc.open_engagement(
            MANAGER,
            client="Audit Client AG",
            counterparty="-",
            matter="Diagnostic",
            service_id="consulting.operating_model_diagnostic",
            requested_option=CommercialOption.OUTCOME_LINKED,
            intake=Intake(is_audit_client=True),
            team=TEAM,
            document_text="brief",
        )


def test_classic_work_stays_outside_the_platform(svc):
    with pytest.raises(Conflict, match="by the hour"):
        svc.open_engagement(
            MANAGER,
            client="X",
            counterparty="Y",
            matter="Z",
            service_id="legal.contract_review",
            requested_option=CommercialOption.CLASSIC,
            intake=Intake(),
            team=TEAM,
            document_text="doc",
        )


def test_uncertified_juniors_cannot_lead_ai_assisted_work(svc):
    with pytest.raises(Conflict, match="not yet certified"):
        svc.open_engagement(
            MANAGER,
            client="X",
            counterparty="Y",
            matter="Z",
            service_id="legal.contract_review",
            requested_option=CommercialOption.PER_DELIVERABLE,
            intake=Intake(),
            team={**TEAM, Slot.JUNIOR: "nico.steiner"},
            document_text="doc",
        )


def test_regulatory_deliverables_need_two_partners(svc):
    eid = "ENG-AUDIT"
    with pytest.raises(Conflict, match="quality reviewer"):
        svc.open_engagement(
            "anna.keller",
            engagement_id=eid,
            client="Audited AG",
            counterparty="-",
            matter="FY26 statutory audit",
            service_id="audit.journal_entry_testing",
            requested_option=CommercialOption.ENGAGEMENT_FEE,
            intake=Intake(is_audit_client=True, reliance=Consequence.REGULATORY),
            team=TEAM,
            document_text="ledger",
        )
    svc.open_engagement(
        "anna.keller",
        engagement_id=eid,
        client="Audited AG",
        counterparty="-",
        matter="FY26 statutory audit",
        service_id="audit.journal_entry_testing",
        requested_option=CommercialOption.ENGAGEMENT_FEE,
        intake=Intake(is_audit_client=True, reliance=Consequence.REGULATORY),
        team=REGULATORY_TEAM,
        document_text="ledger",
    )
    state = svc.confirm_pricing("anna.keller", eid)
    assert state.pricing.final_signers == [Slot.PARTNER, Slot.QUALITY_REVIEWER]
    assert state.policy.manager_countersigns_milestones  # critical review: manager countersigns
    complete_milestones(svc, eid)
    with pytest.raises(Forbidden):
        svc.sign_deliverable(MANAGER, eid)
    state = svc.sign_deliverable("anna.keller", eid)
    assert state.status is EngagementStatus.AWAITING_SIGNATURE and not state.released
    state = svc.sign_deliverable("thomas.weber", eid)
    assert state.released and [s.slot for s in state.deliverable_signatures] == [
        Slot.PARTNER,
        Slot.QUALITY_REVIEWER,
    ]


def test_every_department_runs_end_to_end(container, svc):
    """Open, price, run and sign one deliverable in every service of the catalogue."""
    for n, s in enumerate(container.catalogue.services()):
        dept = container.catalogue.department(s.department)
        option = (
            CommercialOption.PER_DELIVERABLE
            if CommercialOption.PER_DELIVERABLE in dept.policy.options
            else dept.policy.options[0]
        )
        eid = f"ENG-{n:02d}"
        svc.open_engagement(
            "anna.keller",
            engagement_id=eid,
            client="Client AG",
            counterparty="-",
            matter=s.name,
            service_id=s.id,
            requested_option=option,
            intake=Intake(reliance=s.min_consequence),
            team=REGULATORY_TEAM,
            document_text=s.id,
        )
        svc.confirm_pricing("anna.keller", eid)
        complete_milestones(svc, eid)
        assert sign_off(svc, eid).released, s.id
