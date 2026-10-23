"""The decision record's event types.

Every state change is one of these events, appended to the hash-chained ledger.
Current state, the invoice, the client's trail and reviewer metrics are all *derived*
from this list (see ``projections``), which is what makes one record serve as audit
trail, billing basis and evidence for staff evaluation at once.

The ledger envelope (sequence, actor, timestamp, hashes) is added by ``ledger.store``;
these models are only the payloads.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, Field, TypeAdapter

from .models import (
    AtRisk,
    BlindFinding,
    CommercialOption,
    ComplexityTier,
    Conclusion,
    Consequence,
    Decision,
    Intake,
    Item,
    ReviewLevel,
    Role,
    Slot,
)


class EngagementOpened(BaseModel):
    """Intake recorded, with the platform's recommendation. Nothing is priced yet."""

    type: Literal["engagement_opened"] = "engagement_opened"
    engagement_id: str
    client: str
    counterparty: str
    matter: str
    service_id: str
    intake: Intake
    requested_option: CommercialOption
    recommended_complexity: ComplexityTier
    complexity_rationale: list[str]
    recommended_consequence: Consequence
    consequence_rationale: list[str]
    team: dict[Slot, str]  # slot -> user id
    document_digest: str  # sha256 of the document under review


class PricingConfirmed(BaseModel):
    """A named manager or partner fixes the tiers and the commercial option.

    Any departure from the recommendation needs a reason. The quote is stored verbatim,
    so the invoice can never drift from what was agreed.
    """

    type: Literal["pricing_confirmed"] = "pricing_confirmed"
    complexity: ComplexityTier
    consequence: Consequence
    option: CommercialOption
    at_risk: AtRisk | None = None
    overrides: list[str] = Field(default_factory=list)
    override_reason: str | None = None
    review_level: ReviewLevel
    review_rationale: list[str]
    final_signers: list[Slot]
    quote: dict


class MilestoneStarted(BaseModel):
    type: Literal["milestone_started"] = "milestone_started"
    milestone: str
    provider: str
    provider_version: str
    controls_commitment: str | None = None  # sealed list of planted-check item ids


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
    """Reveal of the planted checks and whether each was caught."""

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
    required_slot: Slot


class ConclusionsRecorded(BaseModel):
    type: Literal["conclusions_recorded"] = "conclusions_recorded"
    milestone: str
    conclusions: list[Conclusion]


class MilestoneSigned(BaseModel):
    type: Literal["milestone_signed"] = "milestone_signed"
    milestone: str
    signer: str
    slot: Slot
    role: Role
    digest: str  # sha256 over the milestone's items, decisions and the ledger head
    signature: str  # Ed25519 over the digest, hex
    key_id: str
    escalated: bool = False


class DeliverableSigned(BaseModel):
    """The Signature line: a named person signs the deliverable and KPMG carries the
    liability. Regulatory deliverables need two of these (partner and quality reviewer)."""

    type: Literal["deliverable_signed"] = "deliverable_signed"
    signer: str
    slot: Slot
    role: Role
    digest: str
    signature: str
    key_id: str


class DeliverableReleased(BaseModel):
    type: Literal["deliverable_released"] = "deliverable_released"


class OutcomeMeasured(BaseModel):
    """Settles the at-risk part of an outcome-linked Judgment line."""

    type: Literal["outcome_measured"] = "outcome_measured"
    value: float
    evidence_ref: str
    payout_ratio: float


class EngagementStopped(BaseModel):
    """Client go/no-go: stop after any signed milestone and pay only for those."""

    type: Literal["engagement_stopped"] = "engagement_stopped"
    reason: str


DomainEvent = Annotated[
    EngagementOpened
    | PricingConfirmed
    | MilestoneStarted
    | ProposalsGenerated
    | ProposalsSealed
    | BlindAssessmentSubmitted
    | ProposalsRevealed
    | ItemDecided
    | ControlsEvaluated
    | MilestoneEscalated
    | ConclusionsRecorded
    | MilestoneSigned
    | DeliverableSigned
    | DeliverableReleased
    | OutcomeMeasured
    | EngagementStopped,
    Field(discriminator="type"),
]

_ADAPTER: TypeAdapter[DomainEvent] = TypeAdapter(DomainEvent)


def parse_event(payload: dict) -> DomainEvent:
    return _ADAPTER.validate_python(payload)
