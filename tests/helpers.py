"""Test helpers: a generic AI provider for services without fixtures, and a driver that
runs any engagement through every milestone the way a careful team would."""

from __future__ import annotations

from countersign.ai.provider import ProviderContext
from countersign.ai.scripted import ScriptedProvider
from countersign.domain.catalogue import MilestoneSpec, ServiceSpec
from countersign.domain.models import (
    BlindFinding,
    Conclusion,
    Decision,
    DecisionAction,
    Lane,
    ProposalDraft,
    ProposalKind,
    ReasonCode,
    Slot,
)
from countersign.projections.state import EngagementState
from countersign.services.engagements import EngagementService


class CompositeProvider:
    """Scripted fixtures where they exist, two plain proposals per milestone elsewhere."""

    name = "test-composite"
    version = "test"

    def __init__(self, scripted: ScriptedProvider) -> None:
        self._scripted = scripted

    def supports(self, service: ServiceSpec) -> bool:
        return True

    def propose(
        self, service: ServiceSpec, milestone: MilestoneSpec, ctx: ProviderContext
    ) -> list[ProposalDraft]:
        if self._scripted.supports(service):
            return self._scripted.propose(service, milestone, ctx)
        if milestone.lane is Lane.HUMAN_LED:
            return [
                ProposalDraft(
                    kind=ProposalKind.REFERENCE, title="Reference range", detail="x", confidence=0.9
                )
            ]
        return [
            ProposalDraft(
                kind=ProposalKind.RISK,
                title=f"{milestone.key} finding {i}",
                detail="x",
                confidence=0.95,
                risk_code=f"9{i}",
            )
            for i in (1, 2)
        ]


def complete_milestones(svc: EngagementService, eid: str) -> EngagementState:
    """Run every milestone: AI, blind pass, a decision on every open item, sign."""
    state = svc.load(eid)
    for spec in state.service.milestones:
        lead = state.member(spec.lead)
        svc.start_milestone(lead, eid, spec.key)
        if spec.lane is Lane.HUMAN_LED_BLIND:
            svc.submit_blind_assessment(
                lead, eid, spec.key, [BlindFinding(risk_code="91", description="own view")]
            )
        state = svc.load(eid)
        for iid, item in state.milestone(spec.key).items.items():
            if item.needs_decision:
                svc.decide(
                    lead,
                    eid,
                    spec.key,
                    iid,
                    Decision(
                        action=DecisionAction.APPROVE,
                        reason_code=ReasonCode.VERIFIED_AGAINST_SOURCE,
                    ),
                )
        if spec.requires_priorities:
            svc.record_conclusions(lead, eid, spec.key, [Conclusion(label="Conclusion")])
        state = svc.load(eid)
        for slot in state.milestone(spec.key).required_signer_slots(state.policy):
            svc.sign_milestone(state.member(slot), eid, spec.key)
        state = svc.load(eid)
    return state


def sign_off(svc: EngagementService, eid: str) -> EngagementState:
    state = svc.load(eid)
    for slot in list(state.final_signers_outstanding()):
        state = svc.sign_deliverable(state.member(slot), eid)
    return state


TEAM = {
    Slot.JUNIOR: "lea.brunner",
    Slot.MANAGER: "marco.rossi",
    Slot.PARTNER: "anna.keller",
    Slot.CLIENT: "alpina.client",
}
REGULATORY_TEAM = {**TEAM, Slot.QUALITY_REVIEWER: "thomas.weber"}
