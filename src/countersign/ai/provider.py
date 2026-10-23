"""The port every AI backend implements.

The platform never depends on a specific model. A provider receives the service, the
milestone and the context it is allowed to see, and returns drafts with a confidence
score. Routing, ids, sealing and planted checks are the platform's job, not the
model's, so swapping the backend cannot weaken any human-review gate.

Each department binds its own agents behind this port (a contract agent for Legal, a
journal-entry analytics engine for Audit, a tax engine for Tax), all running inside the
firm's private environment.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from ..domain.catalogue import MilestoneSpec, ServiceSpec
from ..domain.models import ProposalDraft


@dataclass(frozen=True)
class ProviderContext:
    engagement_id: str
    service_id: str
    client_position: str | None
    client_priorities: tuple[str, ...]
    document_ref: str  # pointer into the firm's document store, never the raw file
    # milestone key -> titles of items a person approved in that signed milestone
    prior_decisions: dict[str, list[str]] = field(default_factory=dict)


class AIProvider(Protocol):
    name: str
    version: str

    def supports(self, service: ServiceSpec) -> bool: ...

    def propose(
        self, service: ServiceSpec, milestone: MilestoneSpec, ctx: ProviderContext
    ) -> list[ProposalDraft]: ...


class FirmAgentAdapter:
    """Integration point for the firm's existing agents and benchmark databases.

    Deliberately unbound in the prototype. In production each department registers its
    agent endpoint here; the adapter calls it inside the firm's private environment (no
    client data leaves it), maps the output to ``ProposalDraft`` and passes through the
    agent's own confidence scores.
    """

    name = "firm-agent"
    version = "unbound"

    def supports(self, service: ServiceSpec) -> bool:
        return False

    def propose(
        self, service: ServiceSpec, milestone: MilestoneSpec, ctx: ProviderContext
    ) -> list[ProposalDraft]:
        raise NotImplementedError(
            "Bind this adapter to the department's agent endpoint; the prototype uses ScriptedProvider."
        )
