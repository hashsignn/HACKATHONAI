"""Blind-pass gap analysis: what the reviewer saw that the AI did not, and vice versa.

Matching is on the risk-taxonomy code, so it is exact and explainable. AI findings
the reviewer rejected drop out (a rejected AI finding is a false positive, not something
the reviewer "missed"), and planted controls are excluded once revealed. Undecided AI
findings still count, so the comparison is meaningful from the moment the list opens.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..domain.models import DecisionAction
from .state import MilestoneState


@dataclass(frozen=True)
class GapAnalysis:
    human_codes: tuple[str, ...]
    ai_codes: tuple[str, ...]
    matched: tuple[str, ...]
    ai_only: tuple[str, ...]  # learning points for the reviewer
    human_only: tuple[str, ...]  # feedback for the AI / benchmark team

    @property
    def recall(self) -> float | None:
        """Share of the accepted AI risks the reviewer had already found on their own."""
        return len(self.matched) / len(self.ai_codes) if self.ai_codes else None


def gap_analysis(ms: MilestoneState) -> GapAnalysis | None:
    if not ms.is_blind or not ms.revealed or ms.blind_findings is None:
        return None
    human = {f.risk_code for f in ms.blind_findings if f.risk_code}
    ai = {
        s.item.risk_code
        for s in ms.items.values()
        if s.item.risk_code
        and s.control_outcome is None
        and (s.decision is None or s.decision.action is not DecisionAction.REJECT)
    }
    return GapAnalysis(
        human_codes=tuple(sorted(human)),
        ai_codes=tuple(sorted(ai)),
        matched=tuple(sorted(human & ai)),
        ai_only=tuple(sorted(ai - human)),
        human_only=tuple(sorted(human - ai)),
    )
