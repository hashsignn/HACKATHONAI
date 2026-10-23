"""The invoice, built from the record: two lines per deliverable.

* **Judgment** accrues milestone by milestone: each signed milestone earns its published
  weight of the Judgment line. A client who stops after any milestone pays only for the
  signed share. In outcome-linked engagements the at-risk part is settled once the
  outcome is measured.
* **Signature** is billed once, when the deliverable is signed by the person(s) its
  consequence requires.

Prices come from the quote locked in the ledger when pricing was confirmed, never from
whatever the price list says today. Every line points at the signature that earned it.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..domain.models import CommercialOption
from ..domain.people import Directory
from .state import EngagementState, EngagementStatus, MilestoneStatus


@dataclass(frozen=True)
class JudgmentLine:
    milestone: str
    title: str
    weight: float
    amount: float
    signed_by: str
    signed_at: str
    signature_ref: str
    ledger_n: int


@dataclass(frozen=True)
class Invoice:
    engagement_id: str
    client: str
    service: str
    option: str
    complexity: str
    consequence: str
    currency: str
    price_list_version: str
    status: str  # awaiting_pricing | interim | final | stopped
    external_billing: str  # two_lines | engagement_fee | retainer
    judgment_lines: list[JudgmentLine] = field(default_factory=list)
    judgment_accrued: float = 0.0
    judgment_full: float = 0.0
    at_risk: float = 0.0  # the at-risk part of the Judgment line
    at_risk_paid: float | None = None  # settled amount once the outcome is measured
    signature: float = 0.0  # list price of the Signature line
    signature_billed: bool = False
    signature_by: list[str] = field(default_factory=list)
    not_yet_earned: list[str] = field(default_factory=list)  # unsigned milestones
    total_due: float = 0.0  # what the client owes on this deliverable so far
    quote_total: float = 0.0  # full price at confirmation, excluding at-risk upside
    historical_fee: float = 0.0
    saving_vs_hourly: float | None = None
    notes: list[str] = field(default_factory=list)


def build_invoice(state: EngagementState, directory: Directory) -> Invoice:
    o = state.opened
    if state.pricing is None:
        return Invoice(
            engagement_id=state.id,
            client=o.client,
            service=state.service.name,
            option=o.requested_option.value,
            complexity=o.recommended_complexity.value,
            consequence=o.recommended_consequence.value,
            currency="CHF",
            price_list_version="",
            status="awaiting_pricing",
            external_billing="",
            notes=["Nothing is priced until the manager confirms the tiers."],
        )

    p = state.pricing
    q = p.quote
    option = p.option
    priced = option not in (CommercialOption.RETAINER, CommercialOption.ENGAGEMENT_FEE)
    j_fixed = q["judgment_fixed"]

    lines: list[JudgmentLine] = []
    not_earned: list[str] = []
    for key, ms in state.milestones.items():
        if ms.status(state.policy) is not MilestoneStatus.SIGNED:
            not_earned.append(key)
            continue
        last = ms.signatures[-1]
        lines.append(
            JudgmentLine(
                milestone=key,
                title=ms.spec.title,
                weight=ms.spec.weight,
                amount=round(j_fixed * ms.spec.weight, 2) if priced else 0.0,
                signed_by=", ".join(directory.get(s.signer).name for s in ms.signatures),
                signed_at=ms.signed_at or "",
                signature_ref=last.digest[:16],
                ledger_n=ms.signed_n or 0,
            )
        )
    judgment_accrued = round(sum(line.amount for line in lines), 2)
    signature_billed = state.released and priced
    signature_amount = q["signature"]
    at_risk_paid = None
    if state.outcome is not None and priced:
        at_risk_paid = round(q["judgment_at_risk"] * state.outcome.payout_ratio, 2)

    total = (
        judgment_accrued + (signature_amount if signature_billed else 0.0) + (at_risk_paid or 0.0)
    )
    status = {
        EngagementStatus.RELEASED: "final",
        EngagementStatus.STOPPED: "stopped",
    }.get(state.status, "interim")

    notes = list(q.get("notes", []))
    if state.status is EngagementStatus.STOPPED:
        notes.append(
            "The client stopped the engagement: only signed milestones are billed, and no Signature line."
        )
    if option is CommercialOption.OUTCOME_LINKED and state.released and state.outcome is None:
        notes.append("The at-risk part is settled when the outcome is measured.")

    return Invoice(
        engagement_id=state.id,
        client=o.client,
        service=state.service.name,
        option=option.value,
        complexity=p.complexity.value,
        consequence=p.consequence.value,
        currency=q["currency"],
        price_list_version=q["price_list_version"],
        status=status,
        external_billing=q["external_billing"],
        judgment_lines=lines,
        judgment_accrued=judgment_accrued,
        judgment_full=q["judgment_full"],
        at_risk=q["judgment_at_risk"],
        at_risk_paid=at_risk_paid,
        signature=signature_amount,
        signature_billed=signature_billed,
        signature_by=[directory.get(s.signer).name for s in state.deliverable_signatures],
        not_yet_earned=not_earned,
        total_due=round(total, 2) if priced else 0.0,
        quote_total=q["total_fixed"],
        historical_fee=q["historical_fee"],
        saving_vs_hourly=q["saving_vs_hourly"],
        notes=notes,
    )
