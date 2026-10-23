"""Application service: every command a person can issue, with its invariants.

Each command follows the same shape:

    state = load(engagement)            # fold the ledger
    check who may act and what is allowed in this state
    append events (with the expected history length)

Nothing else writes to the ledger, so every rule below holds for the API, the demo
script and the tests alike, in every department.

Lifecycle of an engagement:

    open (intake + recommendation)
      -> confirm pricing (named manager or partner; guardrails; quote locked)
      -> milestones, in order: run AI, (blind pass), decide, sign      [Judgment line]
      -> sign the deliverable (signer(s) set by consequence)          [Signature line]
      -> (outcome-linked only) record the measured outcome
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
from ..domain.catalogue import Catalogue, MilestoneSpec
from ..domain.errors import Conflict, Forbidden, IntegrityError, NotFound, SealedError
from ..domain.guardrails import check
from ..domain.models import (
    AtRisk,
    BlindFinding,
    CommercialOption,
    ComplexityTier,
    Conclusion,
    Consequence,
    Decision,
    DecisionAction,
    Intake,
    Item,
    Lane,
    ProposalKind,
    Role,
    Route,
    Slot,
)
from ..domain.people import Directory, User
from ..domain.policy import ReviewPolicy, final_signer_slots, recommend, review_policy
from ..domain.pricing import PriceList, build_quote
from ..ledger.crypto import DevKeyring, canonical_json, commitment, new_salt, sha256_hex
from ..ledger.store import EventStore, utc_now
from ..projections.state import (
    EngagementState,
    EngagementStatus,
    MilestoneState,
    MilestoneStatus,
    build_state,
)

AI_ASSISTED_LANES = {
    Lane.AI_LED_SPOT_CHECK,
    Lane.AI_DRAFTS_HUMAN_CONFIRMS,
    Lane.HUMAN_LED_BLIND,
    Lane.AI_DRAFTS_HUMAN_EDITS,
}


@dataclass(frozen=True)
class SignOutcome:
    signed: bool
    escalated: bool
    message: str
    controls: ev.ControlsEvaluated | None = None
    signature: ev.MilestoneSigned | None = None


def milestone_digest(state: EngagementState, ms: MilestoneState) -> str:
    """What a milestone signature commits to: every item and decision in the milestone,
    the blind pass, the conclusions, prior signatures, and the ledger head."""
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
        "conclusions": [c.model_dump(mode="json") for c in ms.conclusions or []],
        "controls": ms.controls.model_dump(mode="json") if ms.controls else None,
        "prior_signatures": [s.digest for s in ms.signatures],
        "ledger_head": state.head_hash,
    }
    return sha256_hex(canonical_json(snapshot))


def deliverable_digest(state: EngagementState) -> str:
    """What the Signature line commits to: every milestone signature, the confirmed
    pricing, prior deliverable signatures and the ledger head."""
    snapshot = {
        "engagement_id": state.id,
        "milestones": {k: [s.digest for s in m.signatures] for k, m in state.milestones.items()},
        "pricing": state.pricing.model_dump(mode="json") if state.pricing else None,
        "prior_signatures": [s.digest for s in state.deliverable_signatures],
        "ledger_head": state.head_hash,
    }
    return sha256_hex(canonical_json(snapshot))


class EngagementService:
    def __init__(
        self,
        store: EventStore,
        catalogue: Catalogue,
        prices: PriceList,
        provider: AIProvider,
        controls: ControlLibrary,
        directory: Directory,
        keyring: DevKeyring,
        clock: Callable[[], datetime] = utc_now,
        id_factory: Callable[[], str] | None = None,
        salt_factory: Callable[[], str] = new_salt,
    ) -> None:
        self.store = store
        self.catalogue = catalogue
        self.prices = prices
        self.provider = provider
        self.controls = controls
        self.directory = directory
        self.keyring = keyring
        self.clock = clock
        self._new_id = id_factory or (lambda: f"ENG-{secrets.token_hex(4).upper()}")
        self._new_salt = salt_factory

    # ------------------------------------------------------------------ reads
    def load(self, engagement_id: str) -> EngagementState:
        return build_state(self.store.load(engagement_id), self.catalogue)

    # ----------------------------------------------------------- opening a job
    def open_engagement(
        self,
        actor_id: str,
        *,
        client: str,
        counterparty: str,
        matter: str,
        service_id: str,
        intake: Intake,
        requested_option: CommercialOption,
        team: dict[Slot, str],
        document_text: str,
        engagement_id: str | None = None,
    ) -> EngagementState:
        actor = self.directory.get(actor_id)
        if not actor.role.at_least(Role.JUNIOR):
            raise Forbidden("only engagement staff can open an engagement")
        service = self.catalogue.service(service_id)
        if requested_option is CommercialOption.CLASSIC:
            raise Conflict(
                "Classic engagements are billed by the hour in the existing system, not run here"
            )
        rec = recommend(intake, service)
        self._check_team(team, service.milestones, rec.consequence, service.department)
        if actor_id not in team.values():
            raise Forbidden("you can only open an engagement you are staffed on")
        dept = self.catalogue.department(service.department)
        blocking = [
            v
            for v in check(dept, service, requested_option, rec.consequence, intake)
            if v.rule != "at-risk-missing"  # the KPI is agreed at pricing, not at intake
        ]
        if blocking:
            raise Conflict(" ".join(v.message for v in blocking))

        eid = engagement_id or self._new_id()
        if self.store.exists(eid):
            raise Conflict(f"engagement {eid} already exists")
        opened = ev.EngagementOpened(
            engagement_id=eid,
            client=client,
            counterparty=counterparty,
            matter=matter,
            service_id=service.id,
            intake=intake,
            requested_option=requested_option,
            recommended_complexity=rec.complexity,
            complexity_rationale=list(rec.complexity_rationale),
            recommended_consequence=rec.consequence,
            consequence_rationale=list(rec.consequence_rationale),
            team=team,
            document_digest=sha256_hex(document_text.encode()),
        )
        self.store.append(eid, actor_id, [opened], expected_n=0)
        return self.load(eid)

    def confirm_pricing(
        self,
        actor_id: str,
        engagement_id: str,
        *,
        complexity: ComplexityTier | None = None,
        consequence: Consequence | None = None,
        option: CommercialOption | None = None,
        at_risk: AtRisk | None = None,
        override_reason: str | None = None,
    ) -> EngagementState:
        """A named manager or partner fixes tiers and option. The platform only recommends."""
        state = self.load(engagement_id)
        actor = self._staff(state, actor_id)
        if state.pricing is not None:
            raise Conflict("pricing is already confirmed; it is locked for the engagement")
        if state.status is EngagementStatus.STOPPED:
            raise Conflict("engagement is stopped")
        if not actor.role.at_least(Role.MANAGER):
            raise Forbidden("pricing is confirmed by the engagement manager or partner")
        o = state.opened
        complexity = complexity or o.recommended_complexity
        consequence = consequence or o.recommended_consequence
        option = option or o.requested_option

        overrides = []
        if complexity is not o.recommended_complexity:
            overrides.append(f"complexity {o.recommended_complexity.value} -> {complexity.value}")
        if consequence is not o.recommended_consequence:
            overrides.append(
                f"consequence {o.recommended_consequence.value} -> {consequence.value}"
            )
        if overrides and not (override_reason and override_reason.strip()):
            raise Conflict("overriding the recommended tiers needs a written reason")

        quote = build_quote(
            self.catalogue,
            self.prices,
            o.service_id,
            complexity,
            consequence,
            option,
            o.intake,
            at_risk,
        )
        if not quote.allowed:
            raise Conflict(" ".join(v["message"] for v in quote.violations))
        signers = final_signer_slots(consequence, state.department.policy)
        self._check_team(
            o.team, state.service.milestones, consequence, state.department.key, signers
        )
        review = review_policy(consequence, complexity, o.intake, state.department.policy)

        self.store.append(
            engagement_id,
            actor_id,
            [
                ev.PricingConfirmed(
                    complexity=complexity,
                    consequence=consequence,
                    option=option,
                    at_risk=at_risk,
                    overrides=overrides,
                    override_reason=override_reason if overrides else None,
                    review_level=review.policy.level,
                    review_rationale=list(review.rationale),
                    final_signers=list(signers),
                    quote=quote.as_dict(),
                )
            ],
            expected_n=state.n,
        )
        return self.load(engagement_id)

    # -------------------------------------------------------------- milestones
    def start_milestone(self, actor_id: str, engagement_id: str, key: str) -> EngagementState:
        state = self.load(engagement_id)
        actor = self._staff(state, actor_id)
        self._require_open(state)
        ms = state.milestone(key)
        spec = ms.spec
        if not actor.role.at_least(spec.lead.min_role):
            raise Forbidden(f"{spec.title} is led by a {spec.lead.value} or above")
        if ms.started:
            raise Conflict(f"{key} has already started")
        idx = state.service.index_of(key)
        if idx > 0:
            prev = state.milestones[state.service.milestones[idx - 1].key]
            if prev.status(state.policy) is not MilestoneStatus.SIGNED:
                raise Conflict(f"{prev.spec.key} must be signed before {key} can start")
        if not self.provider.supports(state.service):
            raise NotFound(f"no AI agent is bound for {state.service.name} in this prototype")

        drafts = self.provider.propose(state.service, spec, self._context(state))
        planned = self.controls.plan(state.service, state.policy.controls_per_engagement).get(
            key, []
        )
        merged, control_idx = mix_in(drafts, planned, seed=f"{engagement_id}:{key}")
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
        if actor_id != state.member(ms.spec.lead):
            raise Forbidden("the blind first pass is written by the assigned reviewer")
        if not findings:
            raise Conflict("write at least one finding before the AI list is unsealed")

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
            need = ms.escalation.required_slot
            if not actor.role.at_least(need.min_role):
                raise Forbidden(f"{key} is escalated; only a {need.value} can decide")
        elif not actor.role.at_least(ms.spec.lead.min_role):
            raise Forbidden(f"decisions in {key} are made by a {ms.spec.lead.value} or above")
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

    def record_conclusions(
        self, actor_id: str, engagement_id: str, key: str, conclusions: list[Conclusion]
    ) -> EngagementState:
        state = self.load(engagement_id)
        actor = self._staff(state, actor_id)
        self._require_open(state)
        ms = state.milestone(key)
        if not ms.spec.requires_priorities:
            raise Conflict(f"{key} is not a human-led milestone")
        if not ms.started or ms.status(state.policy) is MilestoneStatus.SIGNED:
            raise Conflict(f"{key} is not open for conclusions")
        if not actor.role.at_least(ms.spec.lead.min_role):
            raise Forbidden(f"conclusions in {key} are recorded by a {ms.spec.lead.value} or above")
        if not conclusions:
            raise Conflict("record at least one conclusion")
        known = {iid for m in state.milestones.values() for iid in m.items}
        unknown = [
            c.ref_item_id for c in conclusions if c.ref_item_id and c.ref_item_id not in known
        ]
        if unknown:
            raise NotFound(f"unknown item reference(s): {', '.join(unknown)}")
        self.store.append(
            engagement_id,
            actor_id,
            [ev.ConclusionsRecorded(milestone=key, conclusions=conclusions)],
            expected_n=state.n,
        )
        return self.load(engagement_id)

    def sign_milestone(self, actor_id: str, engagement_id: str, key: str) -> SignOutcome:
        state = self.load(engagement_id)
        actor = self._staff(state, actor_id)
        self._require_open(state)
        ms = state.milestone(key)
        if ms.status(state.policy) is MilestoneStatus.SIGNED:
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
            s for s in ms.required_signer_slots(state.policy) if s not in ms.signed_slots()
        ]
        slot = next((s for s in outstanding if state.member(s) == actor_id), None)
        if slot is None:
            names = ", ".join(f"{s.value} ({state.member(s)})" for s in outstanding)
            raise Forbidden(f"{key} must be signed by: {names}")
        if ms.spec.lane in AI_ASSISTED_LANES and not actor.ai_certified:
            raise Forbidden(f"{actor.name} is not certified to sign AI-assisted work")

        # First signature attempt: reveal and score the planted checks.
        if ms.controls_commitment and ms.controls is None:
            evaluated = self._evaluate_controls(state, ms)
            to_append: list = [evaluated]
            if not evaluated.passed:
                to_append.append(
                    ev.MilestoneEscalated(
                        milestone=key,
                        reason="a planted check was approved, so the source was not verified",
                        required_slot=Slot.MANAGER,
                    )
                )
            self.store.append(engagement_id, actor_id, to_append, expected_n=state.n)
            if not evaluated.passed:
                manager = self.directory.get(state.member(Slot.MANAGER)).name
                return SignOutcome(
                    signed=False,
                    escalated=True,
                    controls=evaluated,
                    message=f"Signature blocked: {key} contained a planted check that was approved. "
                    f"Escalated to the manager, {manager}.",
                )
            state = self.load(engagement_id)
            ms = state.milestone(key)

        digest = milestone_digest(state, ms)
        sig = self.keyring.sign(actor_id, digest)
        signed = ev.MilestoneSigned(
            milestone=key,
            signer=actor_id,
            slot=slot,
            role=actor.role,
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
            message=f"{key} signed by {actor.name} ({slot.value.replace('_', ' ')}).",
        )

    # ------------------------------------------------------- Signature line
    def sign_deliverable(self, actor_id: str, engagement_id: str) -> EngagementState:
        state = self.load(engagement_id)
        actor = self._staff(state, actor_id)
        if state.status is not EngagementStatus.AWAITING_SIGNATURE:
            unsigned = [
                k
                for k, m in state.milestones.items()
                if m.status(state.policy) is not MilestoneStatus.SIGNED
            ]
            if unsigned:
                raise Conflict(
                    f"cannot sign the deliverable: unsigned milestone(s) {', '.join(unsigned)}"
                )
            raise Conflict(f"engagement is {state.status.value.replace('_', ' ')}")
        outstanding = state.final_signers_outstanding()
        slot = next((s for s in outstanding if state.member(s) == actor_id), None)
        if slot is None:
            names = ", ".join(
                f"{s.value.replace('_', ' ')} ({state.member(s)})" for s in outstanding
            )
            raise Forbidden(f"the deliverable is signed by: {names}")
        digest = deliverable_digest(state)
        sig = self.keyring.sign(actor_id, digest)
        events: list = [
            ev.DeliverableSigned(
                signer=actor_id,
                slot=slot,
                role=actor.role,
                digest=digest,
                signature=sig.signature,
                key_id=sig.key_id,
            )
        ]
        if outstanding == [slot]:
            events.append(ev.DeliverableReleased())
        self.store.append(engagement_id, actor_id, events, expected_n=state.n)
        return self.load(engagement_id)

    def record_outcome(
        self, actor_id: str, engagement_id: str, value: float, evidence_ref: str
    ) -> EngagementState:
        """Settle the at-risk part of an outcome-linked Judgment line from measured data."""
        state = self.load(engagement_id)
        actor = self.directory.get(actor_id)
        if state.pricing is None or state.pricing.option is not CommercialOption.OUTCOME_LINKED:
            raise Conflict("only outcome-linked engagements have an outcome to record")
        if not state.released:
            raise Conflict("the outcome is recorded after the deliverable is signed")
        if state.outcome is not None:
            raise Conflict("the outcome is already recorded")
        on_team = actor_id in state.opened.team.values()
        if not on_team or not (actor.role is Role.CLIENT or actor.role.at_least(Role.MANAGER)):
            raise Forbidden("the outcome is recorded by the client or the engagement manager")
        ratio = state.pricing.at_risk.payout_ratio(value)
        self.store.append(
            engagement_id,
            actor_id,
            [
                ev.OutcomeMeasured(
                    value=value, evidence_ref=evidence_ref, payout_ratio=round(ratio, 4)
                )
            ],
            expected_n=state.n,
        )
        return self.load(engagement_id)

    def stop(self, actor_id: str, engagement_id: str, reason: str) -> EngagementState:
        state = self.load(engagement_id)
        if state.status in (EngagementStatus.RELEASED, EngagementStatus.STOPPED):
            raise Conflict(f"engagement is {state.status.value}")
        actor = self.directory.get(actor_id)
        allowed = actor_id == state.member(Slot.CLIENT) or (
            actor.role.at_least(Role.MANAGER) and actor_id in state.opened.team.values()
        )
        if not allowed:
            raise Forbidden("only the client or the engagement manager can stop an engagement")
        self.store.append(
            engagement_id, actor_id, [ev.EngagementStopped(reason=reason)], expected_n=state.n
        )
        return self.load(engagement_id)

    # ---------------------------------------------------------------- helpers
    def _check_team(
        self,
        team: dict[Slot, str],
        milestones: tuple[MilestoneSpec, ...],
        consequence: Consequence,
        department: str,
        signers: tuple[Slot, ...] | None = None,
    ) -> None:
        dept = self.catalogue.department(department)
        signers = signers or final_signer_slots(consequence, dept.policy)
        required = {Slot.MANAGER, *signers, *(m.lead for m in milestones)}
        missing = sorted(s.value.replace("_", " ") for s in required if s not in team)
        if missing:
            raise Conflict(f"team is missing: {', '.join(missing)}")
        for slot, uid in team.items():
            user = self.directory.get(uid)
            if slot is Slot.CLIENT:
                if user.role is not Role.CLIENT:
                    raise Conflict(f"{uid} is not a client user")
                continue
            if not user.role.at_least(slot.min_role):
                raise Conflict(f"{user.name} cannot hold the {slot.value.replace('_', ' ')} slot")
            leads_ai = any(m.lead is slot and m.lane in AI_ASSISTED_LANES for m in milestones)
            if leads_ai and not user.ai_certified:
                raise Conflict(
                    f"{user.name} is not yet certified for AI-assisted review; staff a certified "
                    "reviewer, or keep this person on Classic work until certified"
                )
        if Slot.QUALITY_REVIEWER in team and team[Slot.QUALITY_REVIEWER] in (
            team.get(Slot.PARTNER),
            team.get(Slot.MANAGER),
        ):
            raise Conflict(
                "the quality reviewer must be a different partner from the engagement team"
            )

    def _staff(self, state: EngagementState, actor_id: str) -> User:
        actor = self.directory.get(actor_id)
        if actor_id not in state.opened.team.values() or not actor.role.at_least(Role.JUNIOR):
            raise Forbidden(f"{actor_id} is not staffed on {state.id}")
        return actor

    @staticmethod
    def _require_open(state: EngagementState) -> None:
        if state.status is EngagementStatus.AWAITING_PRICING:
            raise Conflict("pricing must be confirmed by the manager before work starts")
        if state.status is not EngagementStatus.OPEN:
            raise Conflict(f"engagement is {state.status.value.replace('_', ' ')}")

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
            service_id=state.service.id,
            client_position=state.opened.intake.client_position,
            client_priorities=tuple(state.opened.intake.priorities),
            document_ref=f"docstore://{state.id}/{state.opened.document_digest[:12]}",
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
            raise IntegrityError(
                f"planted-check list for {ms.spec.key} does not match its commitment"
            )
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
