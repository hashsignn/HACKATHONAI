"""Planted checks: rubber-stamping is detected and escalated, not just discouraged."""

from __future__ import annotations

import json

import pytest

from countersign.api.views import engagement_view
from countersign.domain.errors import Forbidden
from countersign.domain.models import BlindFinding, Decision, DecisionAction, ReasonCode
from countersign.projections.state import MilestoneStatus
from countersign.scenario import ENGAGEMENT_ID, JUNIOR, MANAGER

APPROVE = Decision(action=DecisionAction.APPROVE)
CONTROL_TITLE = "Supplier can exit on 30 days' notice"


def _open_m3(run_until, svc):
    run_until("M3-sealed")
    return svc.submit_blind_assessment(
        JUNIOR, ENGAGEMENT_ID, "M3", [BlindFinding(risk_code="403", description="Price resets")]
    )


def _control_id(state) -> str:
    return next(i for i, s in state.milestone("M3").items.items() if s.item.title == CONTROL_TITLE)


def test_control_is_indistinguishable_before_signing(run_until, svc, container):
    state = _open_m3(run_until, svc)
    view = engagement_view(state, container.directory)
    m3 = next(m for m in view["milestones"] if m["key"] == "M3")
    control = next(i for i in m3["items"] if i["title"] == CONTROL_TITLE)
    other = next(i for i in m3["items"] if i["title"] != CONTROL_TITLE)
    assert set(control) == set(other)
    assert control["control_outcome"] is None and m3["controls"] is None
    assert "salt" not in json.dumps(m3) and "controls:" not in json.dumps(view)


def test_rubber_stamping_escalates_to_the_manager(run_until, svc, container):
    state = _open_m3(run_until, svc)
    for iid in state.milestone("M3").items:
        state = svc.decide(JUNIOR, ENGAGEMENT_ID, "M3", iid, APPROVE)

    outcome = svc.sign_milestone(JUNIOR, ENGAGEMENT_ID, "M3")
    assert not outcome.signed and outcome.escalated
    state = svc.load(ENGAGEMENT_ID)
    ms = state.milestone("M3")
    assert ms.status(state.policy) is MilestoneStatus.ESCALATED
    assert ms.items[_control_id(state)].control_outcome == "missed"

    # The junior can no longer change decisions or sign.
    with pytest.raises(Forbidden):
        svc.decide(
            JUNIOR,
            ENGAGEMENT_ID,
            "M3",
            _control_id(state),
            Decision(action=DecisionAction.REJECT, reason_code=ReasonCode.NOT_IN_SOURCE),
        )
    with pytest.raises(Forbidden):
        svc.sign_milestone(JUNIOR, ENGAGEMENT_ID, "M3")

    # The manager reviews, corrects and signs.
    svc.decide(
        MANAGER,
        ENGAGEMENT_ID,
        "M3",
        _control_id(state),
        Decision(action=DecisionAction.REJECT, reason_code=ReasonCode.NOT_IN_SOURCE),
    )
    signed = svc.sign_milestone(MANAGER, ENGAGEMENT_ID, "M3")
    assert signed.signed and signed.signature.escalated and signed.signature.signer == MANAGER


def test_caught_control_lets_the_junior_sign(run_until):
    state = run_until("M3")
    ms = state.milestone("M3")
    assert ms.controls is not None and ms.controls.passed
    assert ms.signatures[0].signer == JUNIOR and not ms.signatures[0].escalated


def test_standard_review_plants_no_controls(svc, contract):
    from countersign.domain.models import CommercialOption, Intake
    from tests.helpers import TEAM

    svc.open_engagement(
        "marco.rossi",
        engagement_id="ENG-STD",
        client="Small Co",
        counterparty="Vendor",
        matter="Standard supply terms",
        service_id="legal.contract_review",
        requested_option=CommercialOption.PER_DELIVERABLE,
        intake=Intake(),
        team=TEAM,
        document_text=contract,
    )
    state = svc.confirm_pricing("marco.rossi", "ENG-STD")
    assert state.policy.controls_per_engagement == 0
