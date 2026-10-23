"""A deterministic provider backed by JSON fixtures.

Used for the demo and the tests: the same scenario replays identically every time,
and no model or client data is needed to show the platform's behaviour.
"""

from __future__ import annotations

import json
from pathlib import Path

from ..domain.errors import NotFound
from ..domain.models import ProposalDraft
from ..domain.workflow import MilestoneSpec
from .provider import ProviderContext


class ScriptedProvider:
    name = "scripted-fixture"

    def __init__(self, fixture_dir: Path) -> None:
        self._dir = Path(fixture_dir)
        raw = json.loads((self._dir / "ai_outputs.json").read_text())
        self.version = raw.get("version", "fixture")
        self._outputs: dict[str, list[ProposalDraft]] = {
            slug: [ProposalDraft.model_validate(d) for d in drafts]
            for slug, drafts in raw["milestones"].items()
        }

    def propose(self, milestone: MilestoneSpec, ctx: ProviderContext) -> list[ProposalDraft]:
        try:
            return list(self._outputs[milestone.slug])
        except KeyError as exc:
            raise NotFound(f"fixture has no output for milestone {milestone.slug!r}") from exc
