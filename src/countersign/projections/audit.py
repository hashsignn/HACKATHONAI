"""The client's one-page trail: what the AI did, what people decided, who signed.

Built only from the ledger, plus two independent checks a client or auditor can rerun:
the hash chain verifies, and every signature verifies against the signer's public key.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..domain.models import DecisionAction, ProposalKind, Route
from ..domain.people import Directory
from ..ledger.crypto import DevKeyring
from ..ledger.store import ChainVerification
from .learning import gap_analysis
from .state import EngagementState


@dataclass(frozen=True)
class SignatureEntry:
    milestone: str
    title: str
    signer: str
    role: str
    signed_at: str
    digest: str
    escalated: bool
    verified: bool


@dataclass(frozen=True)
class TrailSummary:
    engagement_id: str
    client: str
    counterparty: str
    matter: str
    service: str
    department: str
    review_level: str
    review_rationale: list[str]
    complexity: str
    consequence: str
    pricing_confirmed_by: str | None
    pricing_overrides: list[str]
    status: str
    ai_items: int = 0
    auto_accepted: int = 0
    spot_checks: int = 0
    low_confidence_resolved: int = 0
    ai_findings_rejected: int = 0
    ai_drafts_edited: int = 0
    controls_caught: int = 0
    controls_missed: int = 0
    escalations: int = 0
    redlines_signed: int = 0
    blind_findings: int = 0
    learning_points: list[str] = field(default_factory=list)
    signatures: list[SignatureEntry] = field(default_factory=list)
    deliverable_signed_by: list[str] = field(default_factory=list)
    chain_ok: bool = False
    chain_length: int = 0
    chain_head: str = ""

    def headlines(self) -> list[str]:
        lines = [
            f"{_n(self.low_confidence_resolved, 'low-confidence AI item')} resolved by a person",
            f"{_n(self.spot_checks, 'confident AI item')} spot-checked by a person anyway",
            f"{_n(self.ai_findings_rejected, 'AI finding')} rejected with a written reason",
            f"{_n(self.controls_caught + self.controls_missed, 'planted check')}: "
            f"{self.controls_caught} caught, {self.controls_missed} missed",
            f"{_n(self.redlines_signed, 'redline')} signed by name, {self.ai_drafts_edited} rewritten by a person",
        ]
        if self.escalations:
            lines.append(f"{_n(self.escalations, 'milestone')} escalated to a manager")
        return lines


def _n(count: int, noun: str) -> str:
    return f"{count} {noun}{'' if count == 1 else 's'}"


def build_trail(
    state: EngagementState, chain: ChainVerification, directory: Directory, keyring: DevKeyring
) -> TrailSummary:
    counts = dict.fromkeys(
        (
            "ai_items",
            "auto_accepted",
            "spot_checks",
            "low_confidence_resolved",
            "ai_findings_rejected",
            "ai_drafts_edited",
            "controls_caught",
            "controls_missed",
            "escalations",
            "redlines_signed",
            "blind_findings",
        ),
        0,
    )
    learning: list[str] = []
    signatures: list[SignatureEntry] = []

    for key, ms in state.milestones.items():
        for s in ms.items.values():
            if s.item.route is Route.INFORMATIONAL:
                continue
            if s.control_outcome is not None:
                counts[
                    "controls_caught" if s.control_outcome == "caught" else "controls_missed"
                ] += 1
                continue
            counts["ai_items"] += 1
            if s.item.route is Route.AUTO_ACCEPTED and s.decision is None:
                counts["auto_accepted"] += 1
            if s.item.route is Route.SPOT_CHECK and s.decision is not None:
                counts["spot_checks"] += 1
            if s.item.route is Route.LOW_CONFIDENCE and s.decision is not None:
                counts["low_confidence_resolved"] += 1
            if s.decision is not None and s.decision.action is DecisionAction.REJECT:
                counts["ai_findings_rejected"] += 1
            if s.decision is not None and s.decision.action is DecisionAction.EDIT:
                counts["ai_drafts_edited"] += 1
            if (
                s.item.kind is ProposalKind.REDLINE
                and ms.signatures
                and s.decision is not None
                and s.decision.action is not DecisionAction.REJECT
            ):
                counts["redlines_signed"] += 1
        if ms.escalation:
            counts["escalations"] += 1
        if ms.blind_findings:
            counts["blind_findings"] += len(ms.blind_findings)
        gap = gap_analysis(ms)
        if gap and gap.ai_only:
            learning.append(
                f"{key}: the AI raised risk {', '.join(gap.ai_only)}, which the reviewer's own first pass missed"
            )
        if gap and gap.human_only:
            learning.append(
                f"{key}: the reviewer raised risk {', '.join(gap.human_only)}, which the AI missed (sent to the model team)"
            )
        for sig in ms.signatures:
            signatures.append(
                SignatureEntry(
                    milestone=key,
                    title=ms.spec.title,
                    signer=directory.get(sig.signer).name,
                    role=sig.slot.value.replace("_", " "),
                    signed_at=_signed_at(state, key, sig.digest),
                    digest=sig.digest,
                    escalated=sig.escalated,
                    verified=keyring.verify(sig.signer, sig.digest, sig.signature),
                )
            )

    deliverable_signed_by = []
    for sig in state.deliverable_signatures:
        ok = keyring.verify(sig.signer, sig.digest, sig.signature)
        label = sig.slot.value.replace("_", " ")
        deliverable_signed_by.append(
            f"{directory.get(sig.signer).name} ({label})" + ("" if ok else " [SIGNATURE INVALID]")
        )
    p = state.pricing

    return TrailSummary(
        engagement_id=state.id,
        client=state.opened.client,
        counterparty=state.opened.counterparty,
        matter=state.opened.matter,
        service=state.service.name,
        department=state.department.name,
        review_level=p.review_level.value if p else "not set",
        review_rationale=list(p.review_rationale) if p else [],
        complexity=(p.complexity if p else state.opened.recommended_complexity).value,
        consequence=(p.consequence if p else state.opened.recommended_consequence).value,
        pricing_confirmed_by=directory.get(state.pricing_by).name if state.pricing_by else None,
        pricing_overrides=list(p.overrides) if p else [],
        status=state.status.value,
        learning_points=learning,
        signatures=signatures,
        deliverable_signed_by=deliverable_signed_by,
        chain_ok=chain.ok,
        chain_length=chain.length,
        chain_head=chain.head_hash,
        **counts,
    )


def _signed_at(state: EngagementState, milestone: str, digest: str) -> str:
    for e in state.events:
        if (
            e.type == "milestone_signed"
            and e.payload.get("milestone") == milestone
            and e.payload.get("digest") == digest
        ):
            return e.occurred_at
    return ""


def render_markdown(t: TrailSummary) -> str:
    out = [
        f"# Decision trail: {t.matter}",
        "",
        f"**Client:** {t.client}  ",
        f"**Counterparty:** {t.counterparty}  ",
        f"**Engagement:** {t.engagement_id} ({t.status})  ",
        f"**Service:** {t.department}, {t.service}  ",
        f"**Priced as:** Judgment {t.complexity.replace('tier', 'Tier ')}, Signature "
        f"{t.consequence.replace('_', ' ')}; confirmed by {t.pricing_confirmed_by or 'nobody yet'}"
        + (f" (overrides: {'; '.join(t.pricing_overrides)})" if t.pricing_overrides else "")
        + "  ",
        f"**Review level:** {t.review_level} ({'; '.join(t.review_rationale)})",
        "",
        "## What people did with the AI's work",
        "",
        *[f"- {h}" for h in t.headlines()],
        "",
        "## Signatures",
        "",
        "| Milestone | Signed by | As | Digest | Verified |",
        "|---|---|---|---|---|",
        *[
            f"| {s.milestone} {s.title}{' (escalated)' if s.escalated else ''} | {s.signer} | {s.role} | "
            f"`{s.digest[:12]}` | {'yes' if s.verified else 'NO'} |"
            for s in t.signatures
        ],
        "",
    ]
    if t.deliverable_signed_by:
        out += [f"**Deliverable signed by:** {', '.join(t.deliverable_signed_by)}", ""]
    if t.learning_points:
        out += ["## Learning points", "", *[f"- {p}" for p in t.learning_points], ""]
    out += [
        "## Integrity",
        "",
        f"Hash chain of {t.chain_length} events {'verifies' if t.chain_ok else 'FAILS verification'}; "
        f"head `{t.chain_head[:16]}`.",
        "",
    ]
    return "\n".join(out)
