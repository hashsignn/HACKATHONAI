"""Planted checks: the platform's answer to rubber-stamping.

A planted check is a plausible but *false* AI proposal (it cites a clause or record that
does not say what the proposal claims). It is mixed into the AI's output at a random
position and looks exactly like any other item. The correct handling is to reject it; a
reviewer who approves it has not checked the source, and the milestone is escalated.

Checks come from a curated library per service. In production the library is
maintained by Quality & Risk and rotated so reviewers cannot learn it.
"""

from __future__ import annotations

import json
import random
from dataclasses import dataclass
from pathlib import Path

from ..domain.catalogue import ServiceSpec
from ..domain.models import Lane, ProposalDraft

# Where checks go first: the lanes where judgment matters most.
PLACEMENT_ORDER = (Lane.HUMAN_LED_BLIND, Lane.AI_DRAFTS_HUMAN_CONFIRMS, Lane.AI_DRAFTS_HUMAN_EDITS)


@dataclass(frozen=True)
class ControlTemplate:
    service_id: str
    milestone_slug: str
    draft: ProposalDraft


class ControlLibrary:
    def __init__(self, templates: list[ControlTemplate]) -> None:
        self._templates = templates

    @classmethod
    def from_fixtures(cls, fixtures_root: Path) -> ControlLibrary:
        templates = []
        for f in sorted(Path(fixtures_root).glob("*/controls.json")):
            raw = json.loads(f.read_text())
            templates += [
                ControlTemplate(
                    raw["service"], c["milestone"], ProposalDraft.model_validate(c["draft"])
                )
                for c in raw["controls"]
            ]
        return cls(templates)

    def plan(self, service: ServiceSpec, count: int) -> dict[str, list[ProposalDraft]]:
        """Decide which milestones receive checks. Deterministic for a given library."""
        plan: dict[str, list[ProposalDraft]] = {}
        if count <= 0:
            return plan
        eligible = [m for lane in PLACEMENT_ORDER for m in service.milestones if m.lane is lane]
        remaining = count
        for m in eligible:
            available = [
                t.draft
                for t in self._templates
                if t.service_id == service.id and t.milestone_slug == m.slug
            ]
            if not available:
                continue
            plan[m.key] = available[:1]  # at most one check per milestone
            remaining -= 1
            if remaining == 0:
                break
        return plan


def mix_in(
    drafts: list[ProposalDraft], controls: list[ProposalDraft], seed: str
) -> tuple[list[ProposalDraft], list[int]]:
    """Insert checks at seeded random positions. Returns the merged list and check indexes."""
    rng = random.Random(seed)
    merged: list[tuple[ProposalDraft, bool]] = [(d, False) for d in drafts]
    for c in controls:
        merged.insert(rng.randint(0, len(merged)), (c, True))
    return [d for d, _ in merged], [i for i, (_, is_c) in enumerate(merged) if is_c]
