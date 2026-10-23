"""Workflow templates: the ordered milestones for one type of engagement.

A template is configuration, not code: adding a new service line (e.g. an NDA triage
or a lease review) means adding a ``WorkflowSpec``, not touching the engine.
"""

from __future__ import annotations

from dataclasses import dataclass

from .errors import NotFound
from .models import Lane, Role


@dataclass(frozen=True)
class MilestoneSpec:
    key: str  # stable id, e.g. "M3"
    slug: str  # provider lookup key, e.g. "risk_screening"
    title: str
    lane: Lane
    signer_role: Role
    billable: bool = True
    requires_priorities: bool = False  # human-led negotiation step


@dataclass(frozen=True)
class WorkflowSpec:
    key: str
    title: str
    milestones: tuple[MilestoneSpec, ...]

    def milestone(self, key: str) -> MilestoneSpec:
        for m in self.milestones:
            if m.key == key:
                return m
        raise NotFound(f"workflow {self.key!r} has no milestone {key!r}")

    def index_of(self, key: str) -> int:
        return [m.key for m in self.milestones].index(key)


SPA_CONTRACT_REVIEW = WorkflowSpec(
    key="spa_contract_review",
    title="Sales and purchase agreement review (buyer side)",
    milestones=(
        MilestoneSpec(
            "M1", "extraction", "Key-term extraction", Lane.AI_LED_SPOT_CHECK, Role.JUNIOR
        ),
        MilestoneSpec(
            "M2",
            "benchmark",
            "Benchmark against market terms",
            Lane.AI_DRAFTS_HUMAN_CONFIRMS,
            Role.JUNIOR,
        ),
        MilestoneSpec("M3", "risk_screening", "Risk screening", Lane.HUMAN_LED_BLIND, Role.JUNIOR),
        MilestoneSpec(
            "M4", "redlines", "Proposed redlines", Lane.AI_DRAFTS_HUMAN_EDITS, Role.JUNIOR
        ),
        MilestoneSpec(
            "M5",
            "negotiation_priorities",
            "Negotiation priorities",
            Lane.HUMAN_LED,
            Role.MANAGER,
            requires_priorities=True,
        ),
    ),
)

WORKFLOWS: dict[str, WorkflowSpec] = {SPA_CONTRACT_REVIEW.key: SPA_CONTRACT_REVIEW}


def get_workflow(key: str) -> WorkflowSpec:
    try:
        return WORKFLOWS[key]
    except KeyError as exc:
        raise NotFound(f"unknown workflow {key!r}") from exc
