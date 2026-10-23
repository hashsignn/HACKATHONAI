"""Gates on individual decisions and on signing."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from countersign.domain.errors import Conflict, Forbidden
from countersign.domain.models import Decision, DecisionAction, ReasonCode, Route
from countersign.scenario import CLIENT, ENGAGEMENT_ID, JUNIOR, MANAGER


def test_reject_and_edit_need_a_reason():
    with pytest.raises(ValidationError, match="needs a reason"):
        Decision(action=DecisionAction.REJECT)
    with pytest.raises(ValidationError, match="needs a reason"):
        Decision(action=DecisionAction.EDIT, revised_text="new text")
    with pytest.raises(ValidationError, match="revised text"):
        Decision(action=DecisionAction.EDIT, reason_code=ReasonCode.MARKET_PRACTICE)
    with pytest.raises(ValidationError, match="short written reason"):
        Decision(action=DecisionAction.REJECT, reason_code=ReasonCode.OTHER)
    Decision(action=DecisionAction.APPROVE)  # approvals may be silent


def test_low_confidence_items_route_to_a_person(run_until, svc):
    run_until("opened")
    state = svc.start_milestone(JUNIOR, ENGAGEMENT_ID, "M1")
    routes = {s.item.title: s.item.route for s in state.milestone("M1").items.values()}
    assert routes["Price adjustment"] is Route.LOW_CONFIDENCE
    assert routes["Delivery schedule"] is Route.LOW_CONFIDENCE
    # 20% of the 9 confident items, rounded, are sampled for a person anyway
    assert sum(r is Route.SPOT_CHECK for r in routes.values()) == 2
    assert sum(r is Route.AUTO_ACCEPTED for r in routes.values()) == 7


def test_cannot_sign_with_open_items(run_until, svc):
    run_until("opened")
    svc.start_milestone(JUNIOR, ENGAGEMENT_ID, "M1")
    with pytest.raises(Conflict, match="still need a decision"):
        svc.sign_milestone(JUNIOR, ENGAGEMENT_ID, "M1")


def test_milestones_run_in_order(run_until, svc):
    run_until("opened")
    with pytest.raises(Conflict, match="must be signed"):
        svc.start_milestone(JUNIOR, ENGAGEMENT_ID, "M2")


def test_signed_milestones_are_final(run_until, svc):
    state = run_until("M2")
    iid = next(iter(state.milestone("M2").items))
    with pytest.raises(Conflict, match="decisions are final"):
        svc.decide(JUNIOR, ENGAGEMENT_ID, "M2", iid, Decision(action=DecisionAction.APPROVE))


def test_rewrites_only_where_the_lane_allows(run_until, svc):
    state = run_until("M1")
    svc.start_milestone(JUNIOR, ENGAGEMENT_ID, "M2")
    iid = next(iter(svc.load(ENGAGEMENT_ID).milestone("M2").items))
    edit = Decision(
        action=DecisionAction.EDIT, reason_code=ReasonCode.OTHER, reason_text="x", revised_text="y"
    )
    with pytest.raises(Conflict, match="not rewritten"):
        svc.decide(JUNIOR, ENGAGEMENT_ID, "M2", iid, edit)
    assert state  # M1 signed earlier


def test_people_outside_the_team_or_role_cannot_act(run_until, svc):
    run_until("M1")
    svc.start_milestone(JUNIOR, ENGAGEMENT_ID, "M2")
    iid = next(iter(svc.load(ENGAGEMENT_ID).milestone("M2").items))
    with pytest.raises(Forbidden):
        svc.decide(CLIENT, ENGAGEMENT_ID, "M2", iid, Decision(action=DecisionAction.APPROVE))
    with pytest.raises(Forbidden):
        svc.decide(
            "qr.backstage", ENGAGEMENT_ID, "M2", iid, Decision(action=DecisionAction.APPROVE)
        )


def test_signature_is_by_name_and_verifies(container, run_until):
    state = run_until("M1")
    sig = state.milestone("M1").signatures[0]
    assert sig.signer == JUNIOR
    assert container.keyring.verify(JUNIOR, sig.digest, sig.signature)
    assert not container.keyring.verify(MANAGER, sig.digest, sig.signature)


def test_only_the_final_signer_releases(run_until, svc):
    run_until("M5")
    with pytest.raises(Forbidden):
        svc.release(JUNIOR, ENGAGEMENT_ID)
    state = svc.release(MANAGER, ENGAGEMENT_ID)
    assert state.released and state.released.signer == MANAGER
