"""Reviewer quality: evidence for staff evaluation, derived from the same record.

There is intentionally no single "judgment score". Each component is shown on its
own, so it can be discussed in a review conversation and is harder to game. Fast
approvals are a prompt for a conversation, not a penalty.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..domain.models import DecisionAction, Route
from .learning import gap_analysis
from .state import EngagementState

FAST_APPROVAL_MS = 4_000


@dataclass
class ReviewerQuality:
    user_id: str
    engagements: set[str] = field(default_factory=set)
    decisions: int = 0
    approvals: int = 0
    rejections: int = 0
    edits: int = 0
    with_reason: int = 0
    fast_approvals: int = 0
    controls_caught: int = 0
    controls_missed: int = 0
    blind_passes: int = 0
    blind_matched: int = 0
    blind_ai_only: int = 0
    blind_human_only: int = 0
    milestones_signed: int = 0

    @property
    def reason_coverage(self) -> float | None:
        return self.with_reason / self.decisions if self.decisions else None

    @property
    def blind_recall(self) -> float | None:
        denom = self.blind_matched + self.blind_ai_only
        return self.blind_matched / denom if denom else None

    def as_dict(self) -> dict:
        return {
            "user_id": self.user_id,
            "engagements": len(self.engagements),
            "decisions": self.decisions,
            "approvals": self.approvals,
            "rejections": self.rejections,
            "edits": self.edits,
            "reason_coverage": self.reason_coverage,
            "fast_approvals": self.fast_approvals,
            "controls_caught": self.controls_caught,
            "controls_missed": self.controls_missed,
            "blind_passes": self.blind_passes,
            "blind_recall": self.blind_recall,
            "own_insights_ai_missed": self.blind_human_only,
            "milestones_signed": self.milestones_signed,
        }


def reviewer_quality(user_id: str, states: list[EngagementState]) -> ReviewerQuality:
    q = ReviewerQuality(user_id=user_id)
    for state in states:
        for ms in state.milestones.values():
            for s in ms.items.values():
                if s.item.route is Route.INFORMATIONAL:
                    continue
                for actor, d, latency in s.history:
                    if actor != user_id:
                        continue
                    q.engagements.add(state.id)
                    q.decisions += 1
                    if d.reason_code or (d.reason_text and d.reason_text.strip()):
                        q.with_reason += 1
                    if d.action is DecisionAction.APPROVE:
                        q.approvals += 1
                        if latency is not None and latency < FAST_APPROVAL_MS:
                            q.fast_approvals += 1
                    elif d.action is DecisionAction.REJECT:
                        q.rejections += 1
                    else:
                        q.edits += 1
            if ms.controls:
                for cid, outcome in ms.controls.outcomes.items():
                    first = ms.items[cid].history[0][0] if ms.items[cid].history else None
                    if first == user_id:
                        if outcome == "caught":
                            q.controls_caught += 1
                        else:
                            q.controls_missed += 1
            if ms.blind_by == user_id:
                gap = gap_analysis(ms)
                q.blind_passes += 1
                if gap:
                    q.blind_matched += len(gap.matched)
                    q.blind_ai_only += len(gap.ai_only)
                    q.blind_human_only += len(gap.human_only)
            q.milestones_signed += sum(1 for sig in ms.signatures if sig.signer == user_id)
    return q
