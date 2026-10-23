"""Application service: every command a person can issue, with its invariants.

Each command follows the same shape:

    state = load(engagement)            # fold the ledger
    check who may act and what is allowed in this state
    append events (with the expected history length)

Nothing else writes to the ledger, so every rule below holds for the API, the demo
script and the tests alike.
"""

from __future__ import annotations

import random
import secrets
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime

from ..ai.controls import ControlLibrary, mix_in
from ..ai.provider import AIProvider, ProviderContext
from ..domain import events as ev
from ..domain.errors import Conflict, Forbidden, IntegrityError, NotFound, SealedError
from ..domain.models import (
    BlindFinding,
    Decision,
    DecisionAction,
    Intake,
    Item,
    Lane,
    NegotiationAsk,
    ProposalKind,
    Role,
    Route,
    Tier,
)
from ..domain.people import Directory, User
from ..domain.policy import ReviewPolicy, assess
from ..domain.workflow import MilestoneSpec, get_workflow
from ..ledger.crypto import DevKeyring, canonical_json, commitment, new_salt, sha256_hex
from ..ledger.store import EventStore, utc_now
from ..projections.state import (
    EngagementState,
    EngagementStatus,
    MilestoneState,
    MilestoneStatus,
    build_state,
)


@dataclass(frozen=True)
class SignOutcome:
    signed: bool
    escalated: bool
    message: str
    controls: ev.ControlsEvaluated | None = None
    signature: ev.MilestoneSigned | None = None


def milestone_digest(state: EngagementState, ms: MilestoneState) -> str:
    """What a signature commits to: every item and decision in the milestone, the blind
    pass, the priorities, prior signatures, and the ledger head at the moment of signing."""
    snapshot = {
        "engagement_id": state.id,
        "milestone": ms.spec.key,
        "items": [
            {
                "item": s.item.model_dump(mode="json"),
                "decision": s.decision.model_dump(mode="json") if s.decision else None,
                "decided_by": s.decided_by,
            }
            for s in ms.items.values()
        ],
        "blind_findings": [f.model_dump(mode="json") for f in ms.blind_findings or []],
        "priorities": [a.model_dump(mode="json") for a in ms.priorities or []],
        "controls": ms.controls.model_dump(mode="json") if ms.controls else None,
        "prior_signatures": [s.digest for s in ms.signatures],
        "ledger_head": state.head_hash,
    }
    return sha256_hex(canonical_json(snapshot))


def release_digest(state: EngagementState) -> str:
    snapshot = {
        "engagement_id": state.id,
        "milestones": {k: [s.digest for s in m.signatures] for k, m in state.milestones.items()},
        "ledger_head": state.head_hash,
    }
    return sha256_hex(canonical_json(snapshot))


class EngagementService:
    def __init__(
        self,
        store: EventStore,
        provider: AIProvider,
        controls: ControlLibrary,
        directory: Directory,
        keyring: DevKeyring,
        rate_card_version: str,
        clock: Callable[[], datetime] = utc_now,
        id_factory: Callable[[], str] | None = None,
        salt_factory: Callable[[], str] = new_salt,
    ) -> None:
        self.store = store
        self.provider = provider
        self.controls = controls
        self.directory = directory
        self.keyring = keyring
        self.rate_card_version = rate_card_version
        self.clock = clock
        self._new_id = id_factory or (lambda: f"ENG-{secrets.token_hex(4).upper()}")
        self._new_salt = salt_factory

    # ------------------------------------------------------------------ reads
    def load(self, engagement_id: str) -> EngagementState:
        return build_state(self.store.load(engagement_id))

    # --------------------------------------------------------------- commands
    def open_engagement(
        self,
        actor_id: str,
        *,
        client: str,
        counterparty: str,
        matter: str,
        workflow: str,
        tier: Tier,
        intake: Intake,
        team: dict[Role, str],
        contract_text: str,
        engagement_id: str | None = None,
    ) -> EngagementState:
        actor = self.directory.get(actor_id)
        if not actor.role.at_least(Role.JUNIOR):
            raise Forbidden("only engagement staff can open an engagement")
        get_workflow(workflow)
        assessment = assess(intake)
        policy = assessment.policy
        required = {Role.JUNIOR, Role.MANAGER, policy.final_signer}
        missing = [r.value for r in required if r not in team]
        if missing:
            raise Conflict(
                f"team is missing: {', '.join(sorted(missing))} (required at {policy.level.value} review)"
            )
        for role, uid in team.items():
            if self.directory.get(uid).role is not role:
                raise Conflict(f"{uid} is not a {role.value}")
        if actor_id not in team.values():
            raise Forbidden("you can only open an engagement you are staffed on")

        eid = engagement_id or self._new_id()
        if self.store.exists(eid):
            raise Conflict(f"engagement {eid} already exists")
        opened = ev.EngagementOpened(
            engagement_id=eid,
            client=client,
            counterparty=counterparty,
            matter=matter,
            workflow=workflow,
            tier=tier,
            intake=intake,
            review_level=policy.level,
            policy_rationale=list(assessment.rationale),
            team=team,
            rate_card_version=self.rate_card_version,
            contract_digest=sha256_hex(contract_text.encode()),
        )
        self.store.append(eid, actor_id, [opened], expected_n=0)
        return self.load(eid)

    def start_milestone(self, actor_id: str, engagement_id: str, key: str) -> EngagementState:
        state = self.load(engagement_id)
        actor = self._staff(state, actor_id)
        self._require_open(state)
        ms = state.milestone(key)
        spec = ms.spec
        if not actor.role.at_least(spec.signer_role):
            raise Forbidden(f"{spec.title} is led by a {spec.signer_role.value} or above")
        if ms.started:
            raise Conflict(f"{key} has already started")
        idx = state.workflow.index_of(key)
        if idx > 0:
            prev = state.milestones[state.workflow.milestones[idx - 1].key]
            if prev.status(state.policy) is not MilestoneStatus.SIGNED:
                raise Conflict(f"{prev.spec.key} must be signed before {key} can start")

        drafts = self.provider.propose(spec, self._context(state))
        planned_controls = self.controls.plan(
            state.workflow, state.policy.controls_per_engagement
        ).get(key, [])
        merged, control_idx = mix_in(drafts, planned_controls, seed=f"{engagement_id}:{key}")
        items = self._route(engagement_id, spec, state.policy, merged)

        controls_commitment = None
        if control_idx:
            control_ids = [items[i].id for i in control_idx]
            salt = self._new_salt()
            controls_commitment = commitment(control_ids, salt)
            self.store.vault_put(engagement_id, f"controls:{key}", control_ids, salt)

        events: list = [
            ev.MilestoneStarted(
                milestone=key,
                provider=self.provider.name,
                provider_version=self.provider.version,
                controls_commitment=controls_commitment,
            )
        ]
        if spec.lane.is_blind:
            content = [i.model_dump(mode="json") for i in items]
            salt = self._new_salt()
            self.store.vault_put(engagement_id, f"proposals:{key}", content, salt)
            events.append(
                ev.ProposalsSealed(
                    milestone=key, count=len(items), commitment=commitment(content, salt)
                )
            )
        else:
            events.append(ev.ProposalsGenerated(milestone=key, items=items))
        self.store.append(engagement_id, actor_id, events, expected_n=state.n)
        return self.load(engagement_id)

    def submit_blind_assessment(
        self, actor_id: str, engagement_id: str, key: str, findings: list[BlindFinding]
    ) -> EngagementState:
        state = self.load(engagement_id)
        self._require_open(state)
        ms = state.milestone(key)
        if not ms.spec.lane.is_blind:
            raise Conflict(f"{key} is not a blind-pass milestone")
        if ms.status(state.policy) is not MilestoneStatus.AWAITING_BLIND_ASSESSMENT:
            raise Conflict(f"{key} is not waiting for a blind assessment")
        if actor_id != state.member(ms.spec.signer_role):
            raise Forbidden("the blind first pass is written by the assigned reviewer")
        if not findings:
            raise Conflict("write at least one risk before the AI list is unsealed")

        content, salt = self.store.vault_get(engagement_id, f"proposals:{key}")
        if commitment(content, salt) != ms.sealed_commitment:
            raise IntegrityError(f"sealed AI list for {key} does not match its commitment")
        items = [Item.model_validate(c) for c in content]
        self.store.append(
            engagement_id,
            actor_id,
            [
                ev.BlindAssessmentSubmitted(milestone=key, findings=findings),
                ev.ProposalsRevealed(milestone=key, items=items, salt=salt),
            ],
            expected_n=state.n,
        )
        return self.load(engagement_id)

    def decide(
        self, actor_id: str, engagement_id: str, key: str, item_id: str, decision: Decision
    ) -> EngagementState:
        state = self.load(engagement_id)
        actor = self._staff(state, actor_id)
        self._require_open(state)
        ms = state.milestone(key)
        status = ms.status(state.policy)
        if status is MilestoneStatus.SIGNED:
            raise Conflict(f"{key} is signed; decisions are final")
        if status is MilestoneStatus.AWAITING_BLIND_ASSESSMENT:
            raise SealedError("submit your own assessment first; the AI list is still sealed")
        if status is MilestoneStatus.NOT_STARTED:
            raise Conflict(f"{key} has not started")
        if ms.escalation is not None:
            if not actor.role.at_least(ms.escalation.required_role):
                raise Forbidden(
                    f"{key} is escalated; only a {ms.escalation.required_role.value} can decide"
                )
        elif not actor.role.at_least(ms.spec.signer_role):
            raise Forbidden(
                f"decisions in {key} are made by a {ms.spec.signer_role.value} or above"
            )
        if item_id not in ms.items:
            raise NotFound(f"no item {item_id} in {key}")
        item = ms.items[item_id].item
        if item.route is Route.INFORMATIONAL:
            raise Conflict("reference items are information only and take no decision")
        if decision.action is DecisionAction.EDIT and not ms.spec.lane.allows_edit:
            raise Conflict(f"items in {key} can be approved or rejected, not rewritten")

        last = state.last_action_at.get((actor_id, key))
        latency_ms = int((self.clock() - last).total_seconds() * 1000) if last else None
        self.store.append(
            engagement_id,
            actor_id,
            [
                ev.ItemDecided(
                    milestone=key, item_id=item_id, decision=decision, latency_ms=latency_ms
                )
            ],
            expected_n=state.n,
        )
        return self.load(engagement_id)

    def set_priorities(
        self, actor_id: str, engagement_id: str, key: str, asks: list[NegotiationAsk]
    ) -> EngagementState:
        state = self.load(engagement_id)
        actor = self._staff(state, actor_id)
        self._require_open(state)
        ms = state.milestone(key)
        if not ms.spec.requires_priorities:
            raise Conflict(f"{key} does not take negotiation priorities")
        if not ms.started or ms.status(state.policy) is MilestoneStatus.SIGNED:
            raise Conflict(f"{key} is not open for priorities")
        if not actor.role.at_least(ms.spec.signer_role):
            raise Forbidden(
                f"negotiation priorities are set by a {ms.spec.signer_role.value} or above"
            )
        if not asks:
            raise Conflict("rank at least one ask")
        known = {iid for m in state.milestones.values() for iid in m.items}
        unknown = [a.ref_item_id for a in asks if a.ref_item_id and a.ref_item_id not in known]
        if unknown:
            raise NotFound(f"unknown item reference(s): {', '.join(unknown)}")
        self.store.append(
            engagement_id,
            actor_id,
            [ev.PrioritiesSet(milestone=key, asks=asks)],
            expected_n=state.n,
        )
        return self.load(engagement_id)

    def sign_milestone(self, actor_id: str, engagement_id: str, key: str) -> SignOutcome:
        state = self.load(engagement_id)
        actor = self._staff(state, actor_id)
        self._require_open(state)
        ms = state.milestone(key)
        status = ms.status(state.policy)
        if status is MilestoneStatus.SIGNED:
            raise Conflict(f"{key} is already signed")
        if not ms.decisions_complete:
            pending = len(ms.pending_items)
            what = (
                f"{pending} item(s) still need a decision"
                if pending
                else "the milestone is incomplete"
            )
            raise Conflict(f"cannot sign {key}: {what}")

        outstanding = [
            r for r in ms.required_signer_roles(state.policy) if r not in ms.signed_roles()
        ]
        role = next((r for r in outstanding if state.member(r) == actor_id), None)
        if role is None:
            names = ", ".join(f"{r.value} ({state.member(r)})" for r in outstanding)
            raise Forbidden(f"{key} must be signed by: {names}")

        # First signature attempt: reveal and score the planted controls.
        if ms.controls_commitment and ms.controls is None:
            evaluated = self._evaluate_controls(state, ms)
            to_append: list = [evaluated]
            if not evaluated.passed:
                to_append.append(
                    ev.MilestoneEscalated(
                        milestone=key,
                        reason="a planted check was approved, so the source was not verified",
                        required_role=Role.MANAGER,
                    )
                )
            self.store.append(engagement_id, actor_id, to_append, expected_n=state.n)
            if not evaluated.passed:
                return SignOutcome(
                    signed=False,
                    escalated=True,
                    controls=evaluated,
                    message=f"Signature blocked: {key} contained a planted check that was approved. "
                    f"Escalated to the manager, {self.directory.get(state.member(Role.MANAGER)).name}.",
                )
            state = self.load(engagement_id)
            ms = state.milestone(key)

        digest = milestone_digest(state, ms)
        sig = self.keyring.sign(actor_id, digest)
        signed = ev.MilestoneSigned(
            milestone=key,
            signer=actor_id,
            role=role,
            digest=digest,
            signature=sig.signature,
            key_id=sig.key_id,
            escalated=ms.escalation is not None,
        )
        self.store.append(engagement_id, actor_id, [signed], expected_n=state.n)
        return SignOutcome(
            signed=True,
            escalated=ms.escalation is not None,
            controls=ms.controls,
            signature=signed,
            message=f"{key} signed by {actor.name} ({role.value}).",
        )

    def release(self, actor_id: str, engagement_id: str) -> EngagementState:
        state = self.load(engagement_id)
        self._require_open(state)
        final_role = state.policy.final_signer
        if actor_id != state.member(final_role):
            raise Forbidden(f"the final report is signed by the engagement {final_role.value}")
        unsigned = [
            k
            for k, m in state.milestones.items()
            if m.status(state.policy) is not MilestoneStatus.SIGNED
        ]
        if unsigned:
            raise Conflict(f"cannot release: unsigned milestone(s) {', '.join(unsigned)}")
        digest = release_digest(state)
        sig = self.keyring.sign(actor_id, digest)
        self.store.append(
            engagement_id,
            actor_id,
            [
                ev.EngagementReleased(
                    signer=actor_id,
                    role=final_role,
                    digest=digest,
                    signature=sig.signature,
                    key_id=sig.key_id,
                )
            ],
            expected_n=state.n,
        )
        return self.load(engagement_id)

    def stop(self, actor_id: str, engagement_id: str, reason: str) -> EngagementState:
        state = self.load(engagement_id)
        self._require_open(state)
        actor = self.directory.get(actor_id)
        allowed = actor_id == state.member(Role.CLIENT) or (
            actor.role.at_least(Role.MANAGER) and actor_id in state.opened.team.values()
        )
        if not allowed:
            raise Forbidden("only the client or the engagement manager can stop an engagement")
        self.store.append(
            engagement_id, actor_id, [ev.EngagementStopped(reason=reason)], expected_n=state.n
        )
        return self.load(engagement_id)

    # ---------------------------------------------------------------- helpers
    def _staff(self, state: EngagementState, actor_id: str) -> User:
        actor = self.directory.get(actor_id)
        if actor_id not in state.opened.team.values() or not actor.role.at_least(Role.JUNIOR):
            raise Forbidden(f"{actor_id} is not staffed on {state.id}")
        return actor

    @staticmethod
    def _require_open(state: EngagementState) -> None:
        if state.status is not EngagementStatus.OPEN:
            raise Conflict(f"engagement is {state.status.value}")

    def _context(self, state: EngagementState) -> ProviderContext:
        approved = {
            k: [
                s.item.title
                for s in m.items.values()
                if s.effective_action in ("approve", "edit", "auto_accepted")
            ]
            for k, m in state.milestones.items()
            if m.status(state.policy) is MilestoneStatus.SIGNED
        }
        return ProviderContext(
            engagement_id=state.id,
            workflow=state.workflow.key,
            client_role=state.opened.intake.client_role,
            client_priorities=tuple(state.opened.intake.priorities),
            document_ref=f"docstore://{state.id}/{state.opened.contract_digest[:12]}",
            prior_decisions=approved,
        )

    @staticmethod
    def _route(
        engagement_id: str, spec: MilestoneSpec, policy: ReviewPolicy, drafts: list
    ) -> list[Item]:
        ids = [f"{spec.key}-{i + 1:02d}" for i in range(len(drafts))]
        routes: list[Route]
        if spec.lane is Lane.AI_LED_SPOT_CHECK:
            routes = [
                Route.LOW_CONFIDENCE
                if d.confidence < policy.confidence_threshold
                else Route.AUTO_ACCEPTED
                for d in drafts
            ]
            confident = [i for i, r in enumerate(routes) if r is Route.AUTO_ACCEPTED]
            if confident:
                k = max(1, round(policy.spot_check_rate * len(confident)))
                for i in random.Random(f"{engagement_id}:{spec.key}:spot").sample(confident, k):
                    routes[i] = Route.SPOT_CHECK
        elif spec.lane is Lane.HUMAN_LED:
            routes = [
                Route.INFORMATIONAL if d.kind is ProposalKind.REFERENCE else Route.HUMAN_REVIEW
                for d in drafts
            ]
        else:
            routes = [Route.HUMAN_REVIEW for _ in drafts]
        return [
            Item(id=i, route=r, **d.model_dump())
            for i, r, d in zip(ids, routes, drafts, strict=True)
        ]

    def _evaluate_controls(
        self, state: EngagementState, ms: MilestoneState
    ) -> ev.ControlsEvaluated:
        control_ids, salt = self.store.vault_get(state.id, f"controls:{ms.spec.key}")
        if commitment(control_ids, salt) != ms.controls_commitment:
            raise IntegrityError(f"control list for {ms.spec.key} does not match its commitment")
        outcomes = {}
        for cid in control_ids:
            decision = ms.items[cid].decision
            outcomes[cid] = (
                "caught" if decision and decision.action is DecisionAction.REJECT else "missed"
            )
        return ev.ControlsEvaluated(
            milestone=ms.spec.key,
            control_item_ids=control_ids,
            salt=salt,
            outcomes=outcomes,
            passed=all(o == "caught" for o in outcomes.values()),
        )
