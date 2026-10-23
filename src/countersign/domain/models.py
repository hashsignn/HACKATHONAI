"""Core vocabulary of the domain: roles, lanes, review levels, proposals and decisions.

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


class Tier(StrEnum):
    """Commercial tier the client bought. Classic (hourly) stays in the existing
    time-and-billing system and is deliberately not modelled here."""

    ASSISTED = "assisted"  # fixed price per signed milestone
    AGENT_LED = "agent_led"  # annual subscription; milestones draw down credits


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


class NegotiationAsk(BaseModel):
    label: str = Field(min_length=2, max_length=300)
    priority: Priority
    ref_item_id: str | None = None
    note: str | None = Field(default=None, max_length=1000)


class Intake(BaseModel):
    """The client-team questionnaire (Step 0)."""

    client_role: str = Field(pattern="^(buyer|seller)$")
    priorities: list[str] = Field(default_factory=list, max_length=10)
    client_importance: str = Field(pattern="^(standard|key)$")
    term_years: float = Field(gt=0, le=50)
    annual_value_chf: float = Field(ge=0)
    notes: str | None = Field(default=None, max_length=2000)
