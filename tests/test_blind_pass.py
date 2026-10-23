"""The junior writes their own risks before the AI's list can be seen."""

from __future__ import annotations

import pytest

from countersign.domain.errors import Forbidden, IntegrityError, SealedError
from countersign.domain.models import BlindFinding, Decision, DecisionAction
from countersign.ledger.crypto import commitment
from countersign.projections.state import MilestoneStatus
from countersign.scenario import ENGAGEMENT_ID, JUNIOR, MANAGER

FINDINGS = [BlindFinding(risk_code="403", description="Discretionary price resets")]


def test_ai_list_is_sealed_until_the_reviewer_answers(run_until, svc):
    state = run_until("M3-sealed")
    ms = state.milestone("M3")
    assert ms.status(state.policy) is MilestoneStatus.AWAITING_BLIND_ASSESSMENT
    assert ms.items == {}  # nothing of the AI's list is in readable state
    assert ms.sealed_count == 5 and ms.sealed_commitment
    with pytest.raises(SealedError):
        svc.decide(JUNIOR, ENGAGEMENT_ID, "M3", "M3-01", Decision(action=DecisionAction.APPROVE))


def test_only_the_assigned_reviewer_writes_the_blind_pass(run_until, svc):
    run_until("M3-sealed")
    with pytest.raises(Forbidden):
        svc.submit_blind_assessment(MANAGER, ENGAGEMENT_ID, "M3", FINDINGS)


def test_revealed_list_matches_the_earlier_commitment(run_until, svc):
    sealed = run_until("M3-sealed").milestone("M3").sealed_commitment
    state = svc.submit_blind_assessment(JUNIOR, ENGAGEMENT_ID, "M3", FINDINGS)
    ms = state.milestone("M3")
    content = [s.item.model_dump(mode="json") for s in ms.items.values()]
    assert commitment(content, ms.reveal_salt) == sealed
    assert ms.blind_findings == FINDINGS
    assert ms.status(state.policy) is MilestoneStatus.IN_REVIEW


def test_a_swapped_ai_list_is_refused_at_reveal(container, run_until, svc):
    run_until("M3-sealed")
    container.store._raw_execute_for_tests(
        "UPDATE vault SET content = replace(content, 'Hold-up', 'Nothing to see') WHERE key = 'proposals:M3'"
    )
    with pytest.raises(IntegrityError):
        svc.submit_blind_assessment(JUNIOR, ENGAGEMENT_ID, "M3", FINDINGS)


def test_gap_analysis_records_learning_points(run_until):
    from countersign.projections.learning import gap_analysis

    state = run_until("M3")
    gap = gap_analysis(state.milestone("M3"))
    assert gap.matched == ("306", "403")
    assert gap.ai_only == ("208", "401")
    assert gap.human_only == ()
    assert gap.recall == 0.5
