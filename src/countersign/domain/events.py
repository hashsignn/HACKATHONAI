"""The decision record's event types.

Every state change is one of these events, appended to the hash-chained ledger.
Current state, invoices, the client's audit trail and reviewer metrics are all
*derived* from this list (see ``projections``), which is what makes one record
serve as audit trail, billing basis and evidence for staff evaluation at once.

The ledger envelope (sequence, actor, timestamp, hashes) is added by ``ledger.store``;
these models are only the payloads.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, Field, TypeAdapter

from .models import (
    BlindFinding,
    Decision,
    Intake,
    Item,
    NegotiationAsk,
    ReviewLevel,
    Role,
    Tier,
)


class EngagementOpened(BaseModel):
    type: Literal["engagement_opened"] = "engagement_opened"
    engagement_id: str
    client: str
    counterparty: str
    matter: str
    workflow: str
    tier: Tier
    intake: Intake
    review_level: ReviewLevel
    policy_rationale: list[str]
    team: dict[Role, str]  # role -> user id
    rate_card_version: str
    contract_digest: str  # sha256 of the document under review


class MilestoneStarted(BaseModel):
    type: Literal["milestone_started"] = "milestone_started"
    milestone: str
    provider: str
    provider_version: str
    controls_commitment: str | None = None  # sealed list of planted control item ids


class ProposalsGenerated(BaseModel):
    type: Literal["proposals_generated"] = "proposals_generated"
    milestone: str
    items: list[Item]


class ProposalsSealed(BaseModel):
    """Blind lane: only a commitment to the AI's list is published at first."""

    type: Literal["proposals_sealed"] = "proposals_sealed"
    milestone: str
    count: int
    commitment: str


class BlindAssessmentSubmitted(BaseModel):
    type: Literal["blind_assessment_submitted"] = "blind_assessment_submitted"
    milestone: str
    findings: list[BlindFinding]


class ProposalsRevealed(BaseModel):
    type: Literal["proposals_revealed"] = "proposals_revealed"
    milestone: str
    items: list[Item]
    salt: str  # lets anyone recompute the earlier commitment


class ItemDecided(BaseModel):
    type: Literal["item_decided"] = "item_decided"
    milestone: str
    item_id: str
    decision: Decision
    latency_ms: int | None = None  # time since the reviewer's previous action in this milestone


class ControlsEvaluated(BaseModel):
    """Reveal of the planted control items and whether each was caught."""

    type: Literal["controls_evaluated"] = "controls_evaluated"
    milestone: str
    control_item_ids: list[str]
    salt: str
    outcomes: dict[str, Literal["caught", "missed"]]
    passed: bool


class MilestoneEscalated(BaseModel):
    type: Literal["milestone_escalated"] = "milestone_escalated"
    milestone: str
    reason: str
    required_role: Role


class PrioritiesSet(BaseModel):
    type: Literal["priorities_set"] = "priorities_set"
    milestone: str
    asks: list[NegotiationAsk]


class MilestoneSigned(BaseModel):
    type: Literal["milestone_signed"] = "milestone_signed"
    milestone: str
    signer: str
    role: Role
    digest: str  # sha256 over the milestone's items, decisions and the ledger head
    signature: str  # Ed25519 over the digest, hex
    key_id: str
    escalated: bool = False


class EngagementReleased(BaseModel):
    type: Literal["engagement_released"] = "engagement_released"
    signer: str
    role: Role
    digest: str
    signature: str
    key_id: str


class EngagementStopped(BaseModel):
    """Client go/no-go: stop after any signed milestone and pay only for those."""

    type: Literal["engagement_stopped"] = "engagement_stopped"
    reason: str


DomainEvent = Annotated[
    EngagementOpened
    | MilestoneStarted
    | ProposalsGenerated
    | ProposalsSealed
    | BlindAssessmentSubmitted
    | ProposalsRevealed
    | ItemDecided
    | ControlsEvaluated
    | MilestoneEscalated
    | PrioritiesSet
    | MilestoneSigned
    | EngagementReleased
    | EngagementStopped,
    Field(discriminator="type"),
]

_ADAPTER: TypeAdapter[DomainEvent] = TypeAdapter(DomainEvent)


def parse_event(payload: dict) -> DomainEvent:
    return _ADAPTER.validate_python(payload)
