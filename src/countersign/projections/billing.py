"""Invoice = signed milestones x published rate card. Nothing unsigned is billable.

Every invoice line points at the signature (digest) and ledger position that created
it, so a client can trace each franc to a named person's signed judgment.
"""

from __future__ import annotations

import tomllib
from dataclasses import dataclass, field
from pathlib import Path

from ..domain.models import Tier
from ..domain.people import Directory
from .state import EngagementState, EngagementStatus, MilestoneStatus


@dataclass(frozen=True)
class MilestoneRate:
    price: float
    reference_hours: float


@dataclass(frozen=True)
class RateCard:
    version: str
    currency: str
    reference_hourly_rate: float
    review_multipliers: dict[str, float]
    workflows: dict[str, dict[str, MilestoneRate]]
    subscription_annual_fee: float
    subscription_included_engagements: int

    @classmethod
    def from_toml(cls, path: Path) -> RateCard:
        raw = tomllib.loads(Path(path).read_text())
        return cls(
            version=raw["version"],
            currency=raw["currency"],
            reference_hourly_rate=float(raw["reference_hourly_rate"]),
            review_multipliers={k: float(v) for k, v in raw["review_multipliers"].items()},
            workflows={
                wf: {
                    k: MilestoneRate(float(m["price"]), float(m["reference_hours"]))
                    for k, m in spec["milestones"].items()
                }
                for wf, spec in raw["workflows"].items()
            },
            subscription_annual_fee=float(raw["subscription"]["annual_fee"]),
            subscription_included_engagements=int(raw["subscription"]["included_engagements"]),
        )

    def rate(self, workflow: str, milestone: str) -> MilestoneRate:
        return self.workflows[workflow][milestone]


@dataclass(frozen=True)
class InvoiceLine:
    milestone: str
    title: str
    base_price: float
    multiplier: float
    amount: float
    signed_by: str
    signed_at: str
    signature_ref: str
    ledger_n: int


@dataclass(frozen=True)
class Invoice:
    engagement_id: str
    client: str
    tier: str
    review_level: str
    review_multiplier: float
    currency: str
    rate_card_version: str
    status: str  # interim | final | stopped
    lines: list[InvoiceLine]
    not_billed: list[str] = field(default_factory=list)  # unsigned milestones
    total: float = 0.0
    hourly_equivalent: float = 0.0  # what the signed scope cost under historical hourly billing
    quote_total: float = 0.0  # price of the full engagement if every milestone is signed
    quote_hourly_equivalent: float = 0.0  # the full engagement under historical hourly billing
    note: str | None = None

    @property
    def saving_vs_hourly(self) -> float | None:
        """Client saving on the full engagement versus pre-AI hourly billing (assisted tier)."""
        if self.quote_hourly_equivalent <= 0 or self.tier != Tier.ASSISTED.value:
            return None
        return 1 - self.quote_total / self.quote_hourly_equivalent


def build_invoice(state: EngagementState, card: RateCard, directory: Directory) -> Invoice:
    if card.version != state.opened.rate_card_version:
        raise ValueError(
            f"engagement was priced on rate card {state.opened.rate_card_version}, "
            f"not {card.version}; load the locked version"
        )
    multiplier = card.review_multipliers[state.opened.review_level.value]
    tier = state.opened.tier
    lines: list[InvoiceLine] = []
    not_billed: list[str] = []
    hourly_equivalent = 0.0
    quote_total = 0.0
    quote_hourly = 0.0

    for key, ms in state.milestones.items():
        if not ms.spec.billable:
            continue
        rate = card.rate(state.workflow.key, key)
        quote_total += rate.price * multiplier
        quote_hourly += rate.reference_hours * card.reference_hourly_rate
        if ms.status(state.policy) is not MilestoneStatus.SIGNED:
            not_billed.append(key)
            continue
        hourly_equivalent += rate.reference_hours * card.reference_hourly_rate
        final_sig = ms.signatures[-1]
        amount = round(rate.price * multiplier, 2) if tier is Tier.ASSISTED else 0.0
        lines.append(
            InvoiceLine(
                milestone=key,
                title=ms.spec.title,
                base_price=rate.price,
                multiplier=multiplier,
                amount=amount,
                signed_by=", ".join(directory.get(s.signer).name for s in ms.signatures),
                signed_at=ms.signed_at or "",
                signature_ref=final_sig.digest[:16],
                ledger_n=ms.signed_n or 0,
            )
        )

    status = {
        EngagementStatus.RELEASED: "final",
        EngagementStatus.STOPPED: "stopped",
        EngagementStatus.OPEN: "interim",
    }[state.status]
    note = None
    if tier is Tier.AGENT_LED:
        per_engagement = card.subscription_annual_fee / card.subscription_included_engagements
        note = (
            f"Covered by the agent-led subscription: draws 1 of {card.subscription_included_engagements} "
            f"included engagements (about {card.currency} {per_engagement:,.0f} each)."
        )
    elif state.status is EngagementStatus.STOPPED:
        note = "Client stopped the engagement; only signed milestones are billed."

    return Invoice(
        engagement_id=state.id,
        client=state.opened.client,
        tier=tier.value,
        review_level=state.opened.review_level.value,
        review_multiplier=multiplier,
        currency=card.currency,
        rate_card_version=state.opened.rate_card_version,
        status=status,
        lines=lines,
        not_billed=not_billed,
        total=round(sum(line.amount for line in lines), 2),
        hourly_equivalent=hourly_equivalent,
        quote_total=round(quote_total, 2),
        quote_hourly_equivalent=quote_hourly,
        note=note,
    )
