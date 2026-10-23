"""JSON read models for the API. Pure functions of state; no writes, no secrets.

Nothing here can leak a sealed AI list or the identity of a planted check: neither is
part of the folded state until its reveal event exists in the ledger.
"""

from __future__ import annotations

from dataclasses import asdict
from typing import Any

from ..domain.catalogue import Catalogue
from ..domain.people import Directory
from ..domain.policy import POLICIES
from ..domain.pricing import PriceList
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
    policy = state.policy
    return {
        "key": ms.spec.key,
        "title": ms.spec.title,
        "lane": ms.spec.lane.value,
        "lead": ms.spec.lead.value,
        "weight": ms.spec.weight,
        "status": ms.status(policy).value,
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
        "conclusions": [c.model_dump(mode="json") for c in ms.conclusions or []],
        "conclusions_by": _name(directory, ms.conclusions_by),
        "required_signers": []
        if policy is None
        else [
            {
                "slot": s.value,
                "user": state.member(s),
                "name": _name(directory, state.member(s)),
                "signed": s in ms.signed_slots(),
            }
            for s in ms.required_signer_slots(policy)
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
    p = state.pricing
    policy = state.policy
    return {
        "id": state.id,
        "client": o.client,
        "counterparty": o.counterparty,
        "matter": o.matter,
        "service_id": state.service.id,
        "service": state.service.name,
        "deliverable": state.service.deliverable,
        "department": state.department.name,
        "intake": o.intake.model_dump(mode="json"),
        "recommendation": {
            "complexity": o.recommended_complexity.value,
            "complexity_rationale": o.complexity_rationale,
            "consequence": o.recommended_consequence.value,
            "consequence_rationale": o.consequence_rationale,
            "option": o.requested_option.value,
        },
        "pricing": None
        if p is None
        else {
            **p.model_dump(mode="json"),
            "confirmed_by": _name(directory, state.pricing_by),
        },
        "policy": None
        if policy is None
        else {
            "level": policy.level.value,
            "confidence_threshold": policy.confidence_threshold,
            "spot_check_rate": policy.spot_check_rate,
            "controls_per_engagement": policy.controls_per_engagement,
        },
        "team": {s.value: {"id": uid, "name": _name(directory, uid)} for s, uid in o.team.items()},
        "status": state.status.value,
        "milestones": [milestone_view(state, ms, directory) for ms in state.milestones.values()],
        "final_signers_outstanding": [
            {"slot": s.value, "user": state.member(s), "name": _name(directory, state.member(s))}
            for s in state.final_signers_outstanding()
        ],
        "deliverable_signatures": [
            {**s.model_dump(mode="json"), "signer_name": _name(directory, s.signer)}
            for s in state.deliverable_signatures
        ],
        "released_at": state.released_at,
        "outcome": None
        if state.outcome is None
        else {
            **state.outcome.model_dump(mode="json"),
            "recorded_by": _name(directory, state.outcome_by),
        },
        "stopped": None
        if not state.stopped
        else {"reason": state.stopped.reason, "at": state.stopped_at},
        "ledger": {"length": state.n, "head": state.head_hash},
    }


def catalogue_view(catalogue: Catalogue, prices: PriceList) -> dict[str, Any]:
    depts = []
    for d in catalogue.departments.values():
        dp = prices.departments[d.key]
        depts.append(
            {
                "key": d.key,
                "name": d.name,
                "summary": d.summary,
                "policy": {
                    "options": [o.value for o in d.policy.options],
                    "min_review_level": d.policy.min_review_level.value,
                    "max_at_risk_share": d.policy.max_at_risk_share,
                    "rationale": list(d.policy.rationale),
                    "signature_slots": {
                        k.value: [s.value for s in v] for k, v in d.policy.signature_slots.items()
                    },
                },
                "services": [
                    {
                        "id": s.id,
                        "name": s.name,
                        "deliverable": s.deliverable,
                        "min_consequence": s.min_consequence.value,
                        "outcome_linked_allowed": s.outcome_linked_allowed,
                        "notes": s.notes,
                        "milestones": [
                            {
                                "key": m.key,
                                "title": m.title,
                                "lane": m.lane.value,
                                "lead": m.lead.value,
                                "weight": m.weight,
                            }
                            for m in s.milestones
                        ],
                        "prices": {
                            "judgment": {
                                k.value: v for k, v in dp.services[s.key].judgment.items()
                            },
                            "signature": {
                                k.value: v
                                for k, v in (dp.services[s.key].signature or dp.signature).items()
                            },
                            "historical_fee": {
                                k.value: v for k, v in dp.services[s.key].historical_fee.items()
                            },
                            "reference_hours": {
                                k.value: v for k, v in dp.services[s.key].reference_hours.items()
                            },
                        },
                    }
                    for s in d.services.values()
                ],
            }
        )
    return {
        "price_list_version": prices.version,
        "currency": prices.currency,
        "client_platform_factor": prices.client_platform_factor,
        "retainer_discount": prices.retainer_discount,
        "retainer_deliverables": prices.retainer_deliverables,
        "review_levels": {
            k.value: {
                "confidence_threshold": v.confidence_threshold,
                "spot_check_rate": v.spot_check_rate,
                "controls_per_engagement": v.controls_per_engagement,
                "manager_countersigns_milestones": v.manager_countersigns_milestones,
            }
            for k, v in POLICIES.items()
        },
        "departments": depts,
    }


def invoice_view(inv: Invoice) -> dict[str, Any]:
    return asdict(inv)


def trail_view(t: TrailSummary) -> dict[str, Any]:
    return {**asdict(t), "headlines": t.headlines()}
