"""Core vocabulary: roles, team slots, tiers, lanes, proposals, decisions, intake.

Everything here is a plain value object. Behaviour lives in ``services`` (commands)
and ``projections`` (read models); this module only defines what the words mean.
"""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Role(StrEnum):
    JUNIOR = "junior"
    MANAGER = "manager"
    PARTNER = "partner"
    CLIENT = "client"
    AUDITOR = "auditor"

    @property
    def seniority(self) -> int:
        return {
            Role.CLIENT: 0,
            Role.AUDITOR: 0,
            Role.JUNIOR: 1,
            Role.MANAGER: 2,
            Role.PARTNER: 3,
        }[self]

    def at_least(self, other: Role) -> bool:
        """True if this role may act wherever ``other`` may (internal staff only)."""
        if self in (Role.CLIENT, Role.AUDITOR):
            return False
        return self.seniority >= other.seniority


class Slot(StrEnum):
    """A position on an engagement team. A person's ``Role`` is their rank; a slot is the
    job they hold on this engagement, with the minimum rank it needs."""

    JUNIOR = "junior"
    MANAGER = "manager"
    PARTNER = "partner"
    QUALITY_REVIEWER = "quality_reviewer"  # second partner for regulatory deliverables
    CLIENT = "client"

    @property
    def min_role(self) -> Role:
        return {
            Slot.JUNIOR: Role.JUNIOR,
            Slot.MANAGER: Role.MANAGER,
            Slot.PARTNER: Role.PARTNER,
            Slot.QUALITY_REVIEWER: Role.PARTNER,
            Slot.CLIENT: Role.CLIENT,
        }[self]


class Consequence(StrEnum):
    """Who relies on the deliverable, and therefore how bad an error would be.
    Prices the Signature line and sets who must sign."""

    INTERNAL_USE = "internal_use"
    EXTERNAL_RELIANCE = "external_reliance"
    REGULATORY = "regulatory"

    @property
    def rank(self) -> int:
        return list(Consequence).index(self)


class ComplexityTier(StrEnum):
    """How hard the thinking is. Prices the Judgment line."""

    TIER1 = "tier1"
    TIER2 = "tier2"
    TIER3 = "tier3"

    @property
    def label(self) -> str:
        return f"Tier {self.value[-1]}"


class CommercialOption(StrEnum):
    """How the client buys. Which options a service may use is set by its policy pack."""

    CLASSIC = "classic"  # hourly, billed from timesheets in the existing system
    PER_DELIVERABLE = "per_deliverable"  # Judgment line + Signature line
    RETAINER = "retainer"  # annual retainer covering a number of deliverables
    CLIENT_PLATFORM = "client_platform"  # client runs KPMG's AI; KPMG reviews and signs
    OUTCOME_LINKED = "outcome_linked"  # per deliverable, with part of Judgment at risk
    ENGAGEMENT_FEE = "engagement_fee"  # audit: fixed engagement fee; the two lines are internal


class ReviewLevel(StrEnum):
    STANDARD = "standard"
    ELEVATED = "elevated"
    CRITICAL = "critical"


class Lane(StrEnum):
    """Who leads a milestone, and therefore which gates the platform enforces."""

    AI_LED_SPOT_CHECK = "ai_led_spot_check"  # AI output accepted unless low-confidence/sampled
    AI_DRAFTS_HUMAN_CONFIRMS = "ai_drafts_human_confirms"  # every item needs a human decision
    HUMAN_LED_BLIND = "human_led_blind"  # human writes own view before AI list is unsealed
    AI_DRAFTS_HUMAN_EDITS = "ai_drafts_human_edits"  # human may rewrite each draft
    HUMAN_LED = "human_led"  # human decides; AI supplies reference data only

    @property
    def is_blind(self) -> bool:
        return self is Lane.HUMAN_LED_BLIND

    @property
    def allows_edit(self) -> bool:
        return self is Lane.AI_DRAFTS_HUMAN_EDITS

    @property
    def accepts_controls(self) -> bool:
        """Lanes where a planted control item is meaningful (a human judges each item)."""
        return self in (
            Lane.AI_DRAFTS_HUMAN_CONFIRMS,
            Lane.HUMAN_LED_BLIND,
            Lane.AI_DRAFTS_HUMAN_EDITS,
        )


class ProposalKind(StrEnum):
    EXTRACTION = "extraction"
    DEVIATION = "deviation"
    RISK = "risk"
    REDLINE = "redline"
    REFERENCE = "reference"  # informational only, never needs a decision


class Route(StrEnum):
    """How an item was routed when it entered the record."""

    AUTO_ACCEPTED = "auto_accepted"  # high confidence in an AI-led lane
    SPOT_CHECK = "spot_check"  # randomly sampled for human verification
    LOW_CONFIDENCE = "low_confidence"  # below the review-level threshold
    HUMAN_REVIEW = "human_review"  # lane requires a decision on every item
    INFORMATIONAL = "informational"  # reference data, no decision

    @property
    def needs_decision(self) -> bool:
        return self in (Route.SPOT_CHECK, Route.LOW_CONFIDENCE, Route.HUMAN_REVIEW)


class DecisionAction(StrEnum):
    APPROVE = "approve"
    REJECT = "reject"
    EDIT = "edit"


class ReasonCode(StrEnum):
    """Tick-box reasons, so a reason is never more than one click away."""

    VERIFIED_AGAINST_SOURCE = "verified_against_source"
    CLIENT_INSTRUCTION = "client_instruction"
    MARKET_PRACTICE = "market_practice"
    NOT_IN_SOURCE = "not_in_source"
    BELOW_MATERIALITY = "below_materiality"
    DUPLICATE = "duplicate"
    BETTER_FIT_FOR_CLIENT = "better_fit_for_client"
    OTHER = "other"


class ProposalDraft(BaseModel):
    """What an AI provider returns. Providers never assign ids or routing."""

    model_config = ConfigDict(frozen=True)

    kind: ProposalKind
    title: str
    detail: str
    clause_ref: str | None = None
    confidence: float = Field(ge=0.0, le=1.0)
    risk_code: str | None = None
    data: dict = Field(default_factory=dict)


class Item(ProposalDraft):
    """A proposal once it has entered the record: it has an id and a route.

    ``Item`` deliberately carries no "is this a planted control?" flag. That fact is
    sealed separately and only revealed at sign-off (see ``services.controls``).
    """

    id: str
    route: Route


class Decision(BaseModel):
    """A human decision on one item. Rejections and edits always carry a reason."""

    action: DecisionAction
    reason_code: ReasonCode | None = None
    reason_text: str | None = Field(default=None, max_length=2000)
    revised_text: str | None = Field(default=None, max_length=4000)
    resolved_value: str | None = Field(default=None, max_length=500)
    evidence_ref: str | None = Field(default=None, max_length=300)
    follow_up: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def _reason_rules(self) -> Decision:
        has_reason = self.reason_code is not None or bool(
            self.reason_text and self.reason_text.strip()
        )
        if self.action in (DecisionAction.REJECT, DecisionAction.EDIT) and not has_reason:
            raise ValueError(
                f"a {self.action.value} needs a reason (tick a reason code or write one)"
            )
        if self.reason_code is ReasonCode.OTHER and not (
            self.reason_text and self.reason_text.strip()
        ):
            raise ValueError("reason code 'other' needs a short written reason")
        if self.action is DecisionAction.EDIT and not (
            self.revised_text and self.revised_text.strip()
        ):
            raise ValueError("an edit needs the revised text")
        return self


class BlindFinding(BaseModel):
    """One risk the reviewer identified before seeing the AI's list."""

    risk_code: str | None = Field(default=None, max_length=20)
    description: str = Field(min_length=3, max_length=1000)


class Priority(StrEnum):
    MUST_HAVE = "must_have"
    TRADE_OFF = "trade_off"
    NICE_TO_HAVE = "nice_to_have"


class Conclusion(BaseModel):
    """One point a person decides in a human-led milestone: a negotiation ask in Legal,
    an audit conclusion in Audit, a recommendation in Consulting."""

    label: str = Field(min_length=2, max_length=300)
    priority: Priority | None = None
    ref_item_id: str | None = None
    note: str | None = Field(default=None, max_length=1000)


class Intake(BaseModel):
    """The client-team questionnaire (Step 0). The same questions for every department."""

    client_position: str | None = Field(default=None, max_length=100)  # e.g. buyer, seller
    priorities: list[str] = Field(default_factory=list, max_length=10)
    client_importance: str = Field(default="standard", pattern="^(standard|key)$")
    is_audit_client: bool = False
    reliance: Consequence = Consequence.INTERNAL_USE
    value_at_stake_chf: float = Field(default=0, ge=0)
    duration_years: float = Field(default=0, ge=0, le=50)  # 0 for a one-off deliverable
    cross_border: bool = False
    bespoke: bool = False  # non-standard terms, novel issues, custom structures
    notes: str | None = Field(default=None, max_length=2000)


class AtRisk(BaseModel):
    """Fees at risk: part of the Judgment line depends on a measured outcome.

    Payment ramps linearly from ``threshold`` (nothing at risk is paid) to ``full_at``
    (all of it is paid). Setting both equal gives an all-or-nothing trigger. For KPIs
    where lower is better (cycle time, cost), ``full_at`` lies below ``threshold``.
    """

    share: float = Field(gt=0, le=1)
    kpi: str = Field(min_length=3, max_length=200)
    unit: str = Field(default="", max_length=30)
    baseline: float  # measured before the engagement, for the record
    threshold: float
    full_at: float
    higher_is_better: bool = True
    measured_by: str = Field(min_length=3, max_length=200)  # whose data settles it

    @model_validator(mode="after")
    def _ramp(self) -> AtRisk:
        if self.higher_is_better and self.full_at < self.threshold:
            raise ValueError("full_at must be at or above threshold when higher is better")
        if not self.higher_is_better and self.full_at > self.threshold:
            raise ValueError("full_at must be at or below threshold when lower is better")
        return self

    def payout_ratio(self, measured: float) -> float:
        sign = 1 if self.higher_is_better else -1
        gain = sign * (measured - self.threshold)
        span = sign * (self.full_at - self.threshold)
        if span == 0:
            return 1.0 if gain >= 0 else 0.0
        return min(1.0, max(0.0, gain / span))
