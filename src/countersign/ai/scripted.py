"""A deterministic provider backed by JSON fixtures.

Used for the demo and the tests: the same scenario replays identically every time,
and no model or client data is needed to show the platform's behaviour. Each fixture
folder declares the service it scripts; services without one report that clearly.
"""

from __future__ import annotations

import json
from pathlib import Path

from ..domain.catalogue import MilestoneSpec, ServiceSpec
from ..domain.errors import NotFound
from ..domain.models import ProposalDraft
from .provider import ProviderContext


class ScriptedProvider:
    name = "scripted-fixture"

    def __init__(self, fixtures_root: Path) -> None:
        self._outputs: dict[str, dict[str, list[ProposalDraft]]] = {}
        versions = []
        for f in sorted(Path(fixtures_root).glob("*/ai_outputs.json")):
            raw = json.loads(f.read_text())
            self._outputs[raw["service"]] = {
                slug: [ProposalDraft.model_validate(d) for d in drafts]
                for slug, drafts in raw["milestones"].items()
            }
            versions.append(raw.get("version", f.parent.name))
        self.version = "+".join(versions) or "none"

    def supports(self, service: ServiceSpec) -> bool:
        return service.id in self._outputs

    def propose(
        self, service: ServiceSpec, milestone: MilestoneSpec, ctx: ProviderContext
    ) -> list[ProposalDraft]:
        try:
            return list(self._outputs[service.id][milestone.slug])
        except KeyError as exc:
            raise NotFound(
                f"no scripted AI output for {service.id} / {milestone.slug}; "
                "in production the department's agent is bound here"
            ) from exc
