"""JSON read models for the API. Pure functions of state; no writes, no secrets.

Nothing here can leak a sealed AI list or the identity of a planted control: neither
is part of the folded state until its reveal event exists in the ledger.
"""

from __future__ import annotations

from dataclasses import asdict
from typing import Any

from ..domain.people import Directory
from ..projections.audit import TrailSummary
from ..projections.billing import Invoice
from ..projections.learning import gap_analysis
from ..projections.state import EngagementState, MilestoneState


def _name(directory: Directory, uid: str | None) -> str | None:
    if uid is None:
        return None
    try:
        return directory.get(uid).name
    except Exception:  # unknown ids are shown raw rather than failing the view
        return uid


def milestone_view(
    state: EngagementState, ms: MilestoneState, directory: Directory
) -> dict[str, Any]:
    gap = gap_analysis(ms)
    return {
        "key": ms.spec.key,
        "title": ms.spec.title,
        "lane": ms.spec.lane.value,
        "signer_role": ms.spec.signer_role.value,
        "status": ms.status(state.policy).value,
        "started": ms.started,
        "provider": ms.provider,
        "sealed": {"count": ms.sealed_count, "commitment": ms.sealed_commitment}
        if ms.sealed_commitment
        else None,
        "revealed": ms.revealed,
        "blind_findings": [f.model_dump(mode="json") for f in ms.blind_findings or []],
        "blind_by": _name(directory, ms.blind_by),
        "items": [
            {
                **s.item.model_dump(mode="json"),
                "decision": s.decision.model_dump(mode="json") if s.decision else None,
                "decided_by": _name(directory, s.decided_by),
                "decided_at": s.decided_at,
                "effective_action": s.effective_action,
                "needs_decision": s.needs_decision,
                "control_outcome": s.control_outcome,
            }
            for s in ms.items.values()
        ],
        "pending": len(ms.pending_items),
        "controls": ms.controls.model_dump(mode="json") if ms.controls else None,
        "accepts_controls": ms.spec.lane.accepts_controls,
        "escalation": ms.escalation.model_dump(mode="json") if ms.escalation else None,
        "priorities": [a.model_dump(mode="json") for a in ms.priorities or []],
        "priorities_by": _name(directory, ms.priorities_by),
        "required_signers": [
            {
                "role": r.value,
                "user": state.member(r),
                "name": _name(directory, state.member(r)),
                "signed": r in ms.signed_roles(),
            }
            for r in ms.required_signer_roles(state.policy)
        ],
        "signatures": [
            {**sig.model_dump(mode="json"), "signer_name": _name(directory, sig.signer)}
            for sig in ms.signatures
        ],
        "signed_at": ms.signed_at,
        "gap": None if gap is None else {**asdict(gap), "recall": gap.recall},
    }


def engagement_view(state: EngagementState, directory: Directory) -> dict[str, Any]:
    o = state.opened
    return {
        "id": state.id,
        "client": o.client,
        "counterparty": o.counterparty,
        "matter": o.matter,
        "workflow": state.workflow.key,
        "workflow_title": state.workflow.title,
        "tier": o.tier.value,
        "review_level": o.review_level.value,
        "review_rationale": o.policy_rationale,
        "policy": {
            "confidence_threshold": state.policy.confidence_threshold,
            "spot_check_rate": state.policy.spot_check_rate,
            "controls_per_engagement": state.policy.controls_per_engagement,
            "final_signer": state.policy.final_signer.value,
        },
        "intake": o.intake.model_dump(mode="json"),
        "team": {r.value: {"id": uid, "name": _name(directory, uid)} for r, uid in o.team.items()},
        "status": state.status.value,
        "milestones": [milestone_view(state, ms, directory) for ms in state.milestones.values()],
        "released": None
        if not state.released
        else {
            **state.released.model_dump(mode="json"),
            "signer_name": _name(directory, state.released.signer),
            "at": state.released_at,
        },
        "stopped": None
        if not state.stopped
        else {"reason": state.stopped.reason, "at": state.stopped_at},
        "ledger": {"length": state.n, "head": state.head_hash},
    }


def invoice_view(inv: Invoice) -> dict[str, Any]:
    return {**asdict(inv), "saving_vs_hourly": inv.saving_vs_hourly}


def trail_view(t: TrailSummary) -> dict[str, Any]:
    return {**asdict(t), "headlines": t.headlines()}
