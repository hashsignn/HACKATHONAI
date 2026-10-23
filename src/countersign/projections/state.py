"""Current state of an engagement, rebuilt by folding its events in order.

This is the only place that interprets the event stream for writes. Commands in
``services`` read this state, check their invariants against it, and append events.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum

from ..domain import events as ev
from ..domain.models import (
    BlindFinding,
    Decision,
    Item,
    NegotiationAsk,
    Role,
    Route,
)
from ..domain.policy import POLICIES, ReviewPolicy
from ..domain.workflow import MilestoneSpec, WorkflowSpec, get_workflow
from ..ledger.store import StoredEvent


class MilestoneStatus(StrEnum):
    NOT_STARTED = "not_started"
    AWAITING_BLIND_ASSESSMENT = "awaiting_blind_assessment"
    IN_REVIEW = "in_review"
    ESCALATED = "escalated"
    READY_TO_SIGN = "ready_to_sign"
    SIGNED = "signed"


class EngagementStatus(StrEnum):
    OPEN = "open"
    RELEASED = "released"
    STOPPED = "stopped"


@dataclass
class ItemState:
    item: Item
    decision: Decision | None = None
    decided_by: str | None = None
    decided_at: str | None = None
    latency_ms: int | None = None
    history: list[tuple[str, Decision, int | None]] = field(
        default_factory=list
    )  # actor, decision, latency
    control_outcome: str | None = None  # set only after controls are revealed

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
    priorities: list[NegotiationAsk] | None = None
    priorities_by: str | None = None
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
        return not (self.spec.requires_priorities and not self.priorities)

    def required_signer_roles(self, policy: ReviewPolicy) -> list[Role]:
        if self.escalation is not None:
            return [self.escalation.required_role]
        roles = [self.spec.signer_role]
        if policy.manager_countersigns_milestones and self.spec.signer_role is Role.JUNIOR:
            roles.append(Role.MANAGER)
        return roles

    def signed_roles(self) -> set[Role]:
        return {s.role for s in self.signatures}

    def is_signed(self, policy: ReviewPolicy) -> bool:
        return (
            bool(self.signatures) and set(self.required_signer_roles(policy)) <= self.signed_roles()
        )

    def status(self, policy: ReviewPolicy) -> MilestoneStatus:
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
    workflow: WorkflowSpec
    policy: ReviewPolicy
    milestones: dict[str, MilestoneState]
    events: list[StoredEvent]
    released: ev.EngagementReleased | None = None
    released_at: str | None = None
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
    def status(self) -> EngagementStatus:
        if self.released:
            return EngagementStatus.RELEASED
        if self.stopped:
            return EngagementStatus.STOPPED
        return EngagementStatus.OPEN

    def milestone(self, key: str) -> MilestoneState:
        self.workflow.milestone(key)  # raises NotFound for unknown keys
        return self.milestones[key]

    def member(self, role: Role) -> str | None:
        return self.opened.team.get(role)


def build_state(events: list[StoredEvent]) -> EngagementState:
    first = events[0].event
    if not isinstance(first, ev.EngagementOpened):
        raise ValueError("an engagement history must start with engagement_opened")
    workflow = get_workflow(first.workflow)
    state = EngagementState(
        opened=first,
        workflow=workflow,
        policy=POLICIES[first.review_level],
        milestones={m.key: MilestoneState(spec=m) for m in workflow.milestones},
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
        case ev.PrioritiesSet():
            ms.priorities, ms.priorities_by = list(e.asks), stored.actor
        case ev.MilestoneSigned():
            ms.signatures.append(e)
            if ms.is_signed(state.policy):
                ms.signed_at, ms.signed_n = stored.occurred_at, stored.n
        case ev.EngagementReleased():
            state.released, state.released_at = e, stored.occurred_at
        case ev.EngagementStopped():
            state.stopped, state.stopped_at = e, stored.occurred_at
        case _:
            raise ValueError(f"unexpected event {stored.type!r} at n={stored.n}")
