"""Planted control items: the platform's answer to rubber-stamping.

A control is a plausible but *false* AI proposal (it cites a clause that does not say
what the proposal claims). It is mixed into the AI's output at a random position and
looks exactly like any other item. The correct handling is to reject it; a reviewer who
approves it has not checked the source, and the milestone is escalated.

Controls come from a curated library per workflow. In production the library is
maintained by the quality team and items are rotated so reviewers cannot learn them.
"""

from __future__ import annotations

import json
import random
from dataclasses import dataclass
from pathlib import Path

from ..domain.models import Lane, ProposalDraft
from ..domain.workflow import WorkflowSpec

# Where controls go first: the lanes where judgment matters most.
PLACEMENT_ORDER = (Lane.HUMAN_LED_BLIND, Lane.AI_DRAFTS_HUMAN_CONFIRMS, Lane.AI_DRAFTS_HUMAN_EDITS)


@dataclass(frozen=True)
class ControlTemplate:
    milestone_slug: str
    draft: ProposalDraft


class ControlLibrary:
    def __init__(self, templates: list[ControlTemplate]) -> None:
        self._templates = templates

    @classmethod
    def from_fixture(cls, fixture_dir: Path) -> ControlLibrary:
        path = Path(fixture_dir) / "controls.json"
        if not path.exists():
            return cls([])
        raw = json.loads(path.read_text())
        return cls(
            [
                ControlTemplate(c["milestone"], ProposalDraft.model_validate(c["draft"]))
                for c in raw["controls"]
            ]
        )

    def plan(self, workflow: WorkflowSpec, count: int) -> dict[str, list[ProposalDraft]]:
        """Decide which milestones receive controls. Deterministic for a given library."""
        plan: dict[str, list[ProposalDraft]] = {}
        if count <= 0:
            return plan
        eligible = [m for lane in PLACEMENT_ORDER for m in workflow.milestones if m.lane is lane]
        remaining = count
        for m in eligible:
            available = [t.draft for t in self._templates if t.milestone_slug == m.slug]
            if not available:
                continue
            take = available[: min(remaining, 1)]  # at most one control per milestone
            plan[m.key] = take
            remaining -= len(take)
            if remaining == 0:
                break
        return plan


def mix_in(
    drafts: list[ProposalDraft], controls: list[ProposalDraft], seed: str
) -> tuple[list[ProposalDraft], list[int]]:
    """Insert controls at seeded random positions. Returns the merged list and control indexes."""
    rng = random.Random(seed)
    merged: list[tuple[ProposalDraft, bool]] = [(d, False) for d in drafts]
    for c in controls:
        merged.insert(rng.randint(0, len(merged)), (c, True))
    return [d for d, _ in merged], [i for i, (_, is_c) in enumerate(merged) if is_c]
