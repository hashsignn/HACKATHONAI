"""Replays the whole Alpina / SinoGear scenario and checks the record says what the pitch says."""

from __future__ import annotations

from countersign.projections.audit import build_trail, render_markdown
from countersign.projections.quality import reviewer_quality
from countersign.projections.state import EngagementStatus
from countersign.scenario import ENGAGEMENT_ID, JUNIOR, MANAGER


def test_full_scenario_trail(container, run_until):
    state = run_until("released")
    assert state.status is EngagementStatus.RELEASED
    assert state.pricing.review_level.value == "elevated"

    trail = build_trail(
        state, container.store.verify(ENGAGEMENT_ID), container.directory, container.keyring
    )
    assert trail.low_confidence_resolved == 2
    assert trail.spot_checks == 2
    assert trail.ai_findings_rejected == 1  # the warranty flag, with the client's email as evidence
    assert (trail.controls_caught, trail.controls_missed) == (1, 0)
    assert trail.redlines_signed == 5 and trail.ai_drafts_edited == 1
    assert trail.escalations == 0
    assert trail.chain_ok
    assert len(trail.signatures) == 5 and all(s.verified for s in trail.signatures)
    assert trail.deliverable_signed_by == ["Marco Rossi (manager)"]
    assert trail.complexity == "tier2" and trail.consequence == "internal_use"
    assert trail.pricing_confirmed_by == "Marco Rossi" and trail.pricing_overrides == []
    assert any("208, 401" in p for p in trail.learning_points)

    md = render_markdown(trail)
    assert "1 planted check: 1 caught, 0 missed" in md and "verifies" in md


def test_reviewer_record(run_until):
    state = run_until("released")
    lea = reviewer_quality(JUNIOR, [state])
    assert lea.controls_caught == 1 and lea.controls_missed == 0
    assert lea.blind_recall == 0.5
    assert lea.reason_coverage == 1.0
    assert lea.fast_approvals == 0  # the scripted reviewer takes 45 s per item
    assert lea.milestones_signed == 4
    marco = reviewer_quality(MANAGER, [state])
    assert marco.milestones_signed == 1


def test_fast_approvals_are_surfaced(run_until, svc):
    from countersign.domain.models import Decision, DecisionAction

    run_until("M1")
    state = svc.start_milestone(JUNIOR, ENGAGEMENT_ID, "M2")
    for iid in state.milestone("M2").items:  # pinned clock: zero seconds between decisions
        svc.decide(JUNIOR, ENGAGEMENT_ID, "M2", iid, Decision(action=DecisionAction.APPROVE))
    q = reviewer_quality(JUNIOR, [svc.load(ENGAGEMENT_ID)])
    assert q.fast_approvals == 4
