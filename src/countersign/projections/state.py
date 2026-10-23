"""Current state of an engagement, rebuilt by folding its events in order.

This is the only place that interprets the event stream for writes. Commands in
``services`` read this state, check their invariants against it, and append events.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum

from ..domain import events as ev
from ..domain.catalogue import Catalogue, DepartmentSpec, MilestoneSpec, ServiceSpec
from ..domain.models import BlindFinding, Conclusion, Decision, Item, Route, Slot
from ..domain.policy import POLICIES, ReviewPolicy
from ..ledger.store import StoredEvent


class MilestoneStatus(StrEnum):
    NOT_STARTED = "not_started"
    AWAITING_BLIND_ASSESSMENT = "awaiting_blind_assessment"
    IN_REVIEW = "in_review"
    ESCALATED = "escalated"
    READY_TO_SIGN = "ready_to_sign"
    SIGNED = "signed"


class EngagementStatus(StrEnum):
    AWAITING_PRICING = "awaiting_pricing"
    OPEN = "open"
    AWAITING_SIGNATURE = "awaiting_signature"  # every milestone signed, deliverable not yet
    RELEASED = "released"
    STOPPED = "stopped"


@dataclass
class ItemState:
    item: Item
    decision: Decision | None = None
    decided_by: str | None = None
    decided_at: str | None = None
    latency_ms: int | None = None
    # every decision ever taken on the item: (actor, decision, latency in ms)
    history: list[tuple[str, Decision, int | None]] = field(default_factory=list)
    control_outcome: str | None = None  # set only after planted checks are revealed

    @property
    def needs_decision(self) -> bool:
        return self.item.route.needs_decision

    @property
    def effective_action(self) -> str:
        if self.decision is not None:
            return self.decision.action.value
        if self.item.route is Route.AUTO_ACCEPTED:
            return "auto_accepted"
        if self.item.route is Route.INFORMATIONAL:
            return "informational"
        return "pending"


@dataclass
class MilestoneState:
    spec: MilestoneSpec
    started: bool = False
    provider: str | None = None
    provider_version: str | None = None
    sealed_commitment: str | None = None
    sealed_count: int = 0
    revealed: bool = False
    reveal_salt: str | None = None
    blind_findings: list[BlindFinding] | None = None
    blind_by: str | None = None
    items: dict[str, ItemState] = field(default_factory=dict)
    controls_commitment: str | None = None
    controls: ev.ControlsEvaluated | None = None
    escalation: ev.MilestoneEscalated | None = None
    conclusions: list[Conclusion] | None = None
    conclusions_by: str | None = None
    signatures: list[ev.MilestoneSigned] = field(default_factory=list)
    signed_at: str | None = None
    signed_n: int | None = None

    @property
    def is_blind(self) -> bool:
        return self.spec.lane.is_blind

    @property
    def pending_items(self) -> list[ItemState]:
        return [s for s in self.items.values() if s.needs_decision and s.decision is None]

    @property
    def decisions_complete(self) -> bool:
        if not self.started or (self.is_blind and not self.revealed):
            return False
        if self.pending_items:
            return False
        return not (self.spec.requires_priorities and not self.conclusions)

    def required_signer_slots(self, policy: ReviewPolicy) -> list[Slot]:
        if self.escalation is not None:
            return [self.escalation.required_slot]
        slots = [self.spec.lead]
        if policy.manager_countersigns_milestones and self.spec.lead is Slot.JUNIOR:
            slots.append(Slot.MANAGER)
        return slots

    def signed_slots(self) -> set[Slot]:
        return {s.slot for s in self.signatures}

    def is_signed(self, policy: ReviewPolicy | None) -> bool:
        if policy is None or not self.signatures:
            return False
        return set(self.required_signer_slots(policy)) <= self.signed_slots()

    def status(self, policy: ReviewPolicy | None) -> MilestoneStatus:
        if self.is_signed(policy):
            return MilestoneStatus.SIGNED
        if not self.started:
            return MilestoneStatus.NOT_STARTED
        if self.is_blind and not self.revealed:
            return MilestoneStatus.AWAITING_BLIND_ASSESSMENT
        if self.escalation is not None:
            return MilestoneStatus.ESCALATED
        if self.decisions_complete:
            return MilestoneStatus.READY_TO_SIGN
        return MilestoneStatus.IN_REVIEW


@dataclass
class EngagementState:
    opened: ev.EngagementOpened
    service: ServiceSpec
    department: DepartmentSpec
    milestones: dict[str, MilestoneState]
    events: list[StoredEvent]
    pricing: ev.PricingConfirmed | None = None
    pricing_by: str | None = None
    deliverable_signatures: list[ev.DeliverableSigned] = field(default_factory=list)
    released_at: str | None = None
    outcome: ev.OutcomeMeasured | None = None
    outcome_by: str | None = None
    stopped: ev.EngagementStopped | None = None
    stopped_at: str | None = None
    last_action_at: dict[tuple[str, str], datetime] = field(default_factory=dict)

    @property
    def id(self) -> str:
        return self.opened.engagement_id

    @property
    def n(self) -> int:
        return len(self.events)

    @property
    def head_hash(self) -> str:
        return self.events[-1].hash

    @property
    def policy(self) -> ReviewPolicy | None:
        return POLICIES[self.pricing.review_level] if self.pricing else None

    @property
    def all_milestones_signed(self) -> bool:
        return all(
            m.status(self.policy) is MilestoneStatus.SIGNED for m in self.milestones.values()
        )

    @property
    def released(self) -> bool:
        return self.released_at is not None

    @property
    def status(self) -> EngagementStatus:
        if self.released:
            return EngagementStatus.RELEASED
        if self.stopped:
            return EngagementStatus.STOPPED
        if self.pricing is None:
            return EngagementStatus.AWAITING_PRICING
        if self.all_milestones_signed:
            return EngagementStatus.AWAITING_SIGNATURE
        return EngagementStatus.OPEN

    def milestone(self, key: str) -> MilestoneState:
        self.service.milestone(key)  # raises NotFound for unknown keys
        return self.milestones[key]

    def member(self, slot: Slot) -> str | None:
        return self.opened.team.get(slot)

    def slots_of(self, user_id: str) -> list[Slot]:
        return [s for s, u in self.opened.team.items() if u == user_id]

    def final_signers_outstanding(self) -> list[Slot]:
        if self.pricing is None:
            return []
        done = {s.slot for s in self.deliverable_signatures}
        return [s for s in self.pricing.final_signers if s not in done]


def build_state(events: list[StoredEvent], catalogue: Catalogue) -> EngagementState:
    first = events[0].event
    if not isinstance(first, ev.EngagementOpened):
        raise ValueError("an engagement history must start with engagement_opened")
    service = catalogue.service(first.service_id)
    state = EngagementState(
        opened=first,
        service=service,
        department=catalogue.department(service.department),
        milestones={m.key: MilestoneState(spec=m) for m in service.milestones},
        events=list(events),
    )
    for stored in events[1:]:
        _apply(state, stored)
    return state


def _apply(state: EngagementState, stored: StoredEvent) -> None:
    e = stored.event
    milestone_key = getattr(e, "milestone", None)
    if milestone_key is not None:
        state.last_action_at[(stored.actor, milestone_key)] = stored.timestamp
    ms = state.milestones.get(milestone_key) if milestone_key else None

    match e:
        case ev.PricingConfirmed():
            state.pricing, state.pricing_by = e, stored.actor
        case ev.MilestoneStarted():
            ms.started = True
            ms.provider, ms.provider_version = e.provider, e.provider_version
            ms.controls_commitment = e.controls_commitment
        case ev.ProposalsGenerated():
            ms.items = {i.id: ItemState(item=i) for i in e.items}
        case ev.ProposalsSealed():
            ms.sealed_commitment, ms.sealed_count = e.commitment, e.count
        case ev.BlindAssessmentSubmitted():
            ms.blind_findings, ms.blind_by = list(e.findings), stored.actor
        case ev.ProposalsRevealed():
            ms.items = {i.id: ItemState(item=i) for i in e.items}
            ms.revealed, ms.reveal_salt = True, e.salt
        case ev.ItemDecided():
            s = ms.items[e.item_id]
            s.decision, s.decided_by, s.decided_at = e.decision, stored.actor, stored.occurred_at
            s.latency_ms = e.latency_ms
            s.history.append((stored.actor, e.decision, e.latency_ms))
        case ev.ControlsEvaluated():
            ms.controls = e
            for item_id, outcome in e.outcomes.items():
                ms.items[item_id].control_outcome = outcome
        case ev.MilestoneEscalated():
            ms.escalation = e
        case ev.ConclusionsRecorded():
            ms.conclusions, ms.conclusions_by = list(e.conclusions), stored.actor
        case ev.MilestoneSigned():
            ms.signatures.append(e)
            if ms.is_signed(state.policy):
                ms.signed_at, ms.signed_n = stored.occurred_at, stored.n
        case ev.DeliverableSigned():
            state.deliverable_signatures.append(e)
        case ev.DeliverableReleased():
            state.released_at = stored.occurred_at
        case ev.OutcomeMeasured():
            state.outcome, state.outcome_by = e, stored.actor
        case ev.EngagementStopped():
            state.stopped, state.stopped_at = e, stored.occurred_at
        case _:
            raise ValueError(f"unexpected event {stored.type!r} at n={stored.n}")
