"""The port every AI backend implements.

The platform never depends on a specific model. A provider receives the milestone
and the context it is allowed to see, and returns drafts with a confidence score.
Routing, ids, sealing and planted controls are the platform's job, not the model's,
so swapping the backend cannot weaken any human-review gate.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from ..domain.models import ProposalDraft
from ..domain.workflow import MilestoneSpec


@dataclass(frozen=True)
class ProviderContext:
    engagement_id: str
    workflow: str
    client_role: str
    client_priorities: tuple[str, ...]
    document_ref: str  # pointer into the firm's document store, never the raw file
    # milestone key -> titles of items a person approved in that signed milestone
    prior_decisions: dict[str, list[str]] = field(default_factory=dict)


class AIProvider(Protocol):
    name: str
    version: str

    def propose(self, milestone: MilestoneSpec, ctx: ProviderContext) -> list[ProposalDraft]: ...


class ContractAgentAdapter:
    """Integration point for the firm's existing contract-AI agent and benchmark database.

    Deliberately unimplemented in the prototype. In production this calls the agent
    running inside the firm's private environment (no client data leaves it), maps its
    output to ``ProposalDraft`` and passes through its own confidence scores.
    """

    name = "kpmg-contract-agent"
    version = "unbound"

    def propose(self, milestone: MilestoneSpec, ctx: ProviderContext) -> list[ProposalDraft]:
        raise NotImplementedError(
            "Bind this adapter to the firm's contract-AI endpoint; the prototype uses ScriptedProvider."
        )
