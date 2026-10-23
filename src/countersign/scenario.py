"""The Alpina Pumps / SinoGear scenario, scripted as the people in it would act.

Used three ways: the CLI demo replays it end to end, the server can seed it up to any
stage so a live demo starts at the interesting moment, and the end-to-end test checks
that the record it produces says exactly what the pitch claims.

Items are located by title, never by id: ids depend on where planted controls land.
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

from .domain.models import (
    BlindFinding,
    Decision,
    DecisionAction,
    Intake,
    NegotiationAsk,
    Priority,
    ReasonCode,
    Role,
    Route,
    Tier,
)
from .projections.state import EngagementState
from .services.engagements import EngagementService

ENGAGEMENT_ID = "ENG-ALPINA-SG-001"
JUNIOR, MANAGER, PARTNER, CLIENT = "lea.brunner", "marco.rossi", "anna.keller", "alpina.client"

STAGES = ("opened", "M1", "M2", "M3-sealed", "M3", "M4", "M5", "released")

Tick = Callable[[float], None]

APPROVE_VERIFIED = Decision(
    action=DecisionAction.APPROVE, reason_code=ReasonCode.VERIFIED_AGAINST_SOURCE
)


def _item_id(state: EngagementState, key: str, title: str) -> str:
    for iid, s in state.milestone(key).items.items():
        if s.item.title == title:
            return iid
    raise KeyError(f"no item titled {title!r} in {key}")


def _decide(
    svc: EngagementService, tick: Tick, actor: str, key: str, title: str, decision: Decision
) -> EngagementState:
    tick(45)
    state = svc.load(ENGAGEMENT_ID)
    return svc.decide(actor, ENGAGEMENT_ID, key, _item_id(state, key, title), decision)


def run_alpina(
    svc: EngagementService,
    contract_text: str,
    until: str = "released",
    tick: Tick = lambda _s: None,
) -> EngagementState:
    if until not in STAGES:
        raise ValueError(f"unknown stage {until!r}; choose from {', '.join(STAGES)}")
    stop_at = STAGES.index(until)

    # Step 0: intake questionnaire -> review level
    svc.open_engagement(
        MANAGER,
        engagement_id=ENGAGEMENT_ID,
        client="Alpina Pumps AG",
        counterparty="SinoGear Ltd",
        matter="3-year supply agreement for MH-200 motor housings (supplier draft v1)",
        workflow="spa_contract_review",
        tier=Tier.ASSISTED,
        intake=Intake(
            client_role="buyer",
            priorities=["security of supply", "quality", "stable prices"],
            client_importance="key",
            term_years=3,
            annual_value_chf=4_200_000,
            notes="Alpina redesigns its pumps around the housings; SinoGear builds dedicated tooling.",
        ),
        team={
            Role.JUNIOR: JUNIOR,
            Role.MANAGER: MANAGER,
            Role.PARTNER: PARTNER,
            Role.CLIENT: CLIENT,
        },
        contract_text=contract_text,
    )
    if stop_at == STAGES.index("opened"):
        return svc.load(ENGAGEMENT_ID)

    # Step 1: extraction (AI-led, people check low-confidence and sampled items)
    tick(120)
    state = svc.start_milestone(JUNIOR, ENGAGEMENT_ID, "M1")
    _decide(
        svc,
        tick,
        JUNIOR,
        "M1",
        "Price adjustment",
        Decision(
            action=DecisionAction.APPROVE,
            reason_code=ReasonCode.VERIFIED_AGAINST_SOURCE,
            resolved_value="Annex C obtained from the client: supplier may reset the price once a year at its discretion.",
            follow_up="Asked Alpina for the missing Annex C (received same day).",
        ),
    )
    _decide(
        svc,
        tick,
        JUNIOR,
        "M1",
        "Delivery schedule",
        Decision(
            action=DecisionAction.APPROVE,
            reason_code=ReasonCode.VERIFIED_AGAINST_SOURCE,
            resolved_value="No lead time defined ('reasonable period after call-off'). Carry into benchmark and redlines.",
        ),
    )
    state = svc.load(ENGAGEMENT_ID)
    for s in state.milestone("M1").items.values():
        if s.item.route is Route.SPOT_CHECK:
            _decide(svc, tick, JUNIOR, "M1", s.item.title, APPROVE_VERIFIED)
    tick(30)
    svc.sign_milestone(JUNIOR, ENGAGEMENT_ID, "M1")
    if stop_at == STAGES.index("M1"):
        return svc.load(ENGAGEMENT_ID)

    # Step 2: benchmark (AI drafts, a person confirms every item)
    tick(300)
    svc.start_milestone(JUNIOR, ENGAGEMENT_ID, "M2")
    _decide(
        svc,
        tick,
        JUNIOR,
        "M2",
        "Warranty below market",
        Decision(
            action=DecisionAction.REJECT,
            reason_code=ReasonCode.CLIENT_INSTRUCTION,
            reason_text="Alpina accepts short warranties on standard parts.",
            evidence_ref="Client email, 14 Oct 2026",
        ),
    )
    for title in (
        "Delay damages cap below market",
        "Discretionary annual price changes",
        "Liability cap below market",
    ):
        _decide(
            svc,
            tick,
            JUNIOR,
            "M2",
            title,
            Decision(action=DecisionAction.APPROVE, reason_code=ReasonCode.MARKET_PRACTICE),
        )
    tick(30)
    svc.sign_milestone(JUNIOR, ENGAGEMENT_ID, "M2")
    if stop_at == STAGES.index("M2"):
        return svc.load(ENGAGEMENT_ID)

    # Step 3: risk screening (blind first pass, then the sealed AI list is revealed)
    tick(300)
    svc.start_milestone(JUNIOR, ENGAGEMENT_ID, "M3")
    if stop_at == STAGES.index("M3-sealed"):
        return svc.load(ENGAGEMENT_ID)
    tick(600)
    svc.submit_blind_assessment(
        JUNIOR,
        ENGAGEMENT_ID,
        "M3",
        [
            BlindFinding(
                risk_code="403",
                description="Supplier can change the price each year at its discretion (Annex C).",
            ),
            BlindFinding(
                risk_code="306",
                description="No acceptance inspection: defects could surface only after warranty.",
            ),
        ],
    )
    for title in (
        "Price can rise at the supplier's discretion",
        "No acceptance inspection",
        "Hold-up after redesign",
        "Warranty claims may be uncollectible",
    ):
        _decide(svc, tick, JUNIOR, "M3", title, APPROVE_VERIFIED)
    _decide(
        svc,
        tick,
        JUNIOR,
        "M3",
        "Supplier can exit on 30 days' notice",
        Decision(
            action=DecisionAction.REJECT,
            reason_code=ReasonCode.NOT_IN_SOURCE,
            reason_text="Clause 14.2 gives either party 180 days' notice, and only after year 1.",
        ),
    )
    tick(60)
    svc.sign_milestone(JUNIOR, ENGAGEMENT_ID, "M3")
    if stop_at == STAGES.index("M3"):
        return svc.load(ENGAGEMENT_ID)

    # Step 4: redlines (AI drafts, a person edits)
    tick(300)
    svc.start_milestone(JUNIOR, ENGAGEMENT_ID, "M4")
    _decide(
        svc,
        tick,
        JUNIOR,
        "M4",
        "Index-linked price escalator",
        Decision(
            action=DecisionAction.EDIT,
            reason_code=ReasonCode.BETTER_FIT_FOR_CLIENT,
            reason_text="Housings are cast aluminium; a metals index tracks Alpina's own cost base better than PPI.",
            revised_text=(
                "The unit price is adjusted once per contract year by 70% of the change in the LME aluminium "
                "cash-settlement price (twelve-month average), capped at +/-6%."
            ),
        ),
    )
    for title in (
        "Acceptance inspection window",
        "Higher delay damages and shortfall discount",
        "Minimum supply commitment and tooling ownership",
        "Parent guarantee or performance bond",
    ):
        _decide(
            svc,
            tick,
            JUNIOR,
            "M4",
            title,
            Decision(action=DecisionAction.APPROVE, reason_code=ReasonCode.MARKET_PRACTICE),
        )
    tick(30)
    svc.sign_milestone(JUNIOR, ENGAGEMENT_ID, "M4")
    if stop_at == STAGES.index("M4"):
        return svc.load(ENGAGEMENT_ID)

    # Step 5: negotiation priorities (human-led by the manager; AI supplies ranges only)
    tick(600)
    svc.start_milestone(MANAGER, ENGAGEMENT_ID, "M5")
    state = svc.load(ENGAGEMENT_ID)
    escalator = _item_id(state, "M4", "Index-linked price escalator")
    supply = _item_id(state, "M4", "Minimum supply commitment and tooling ownership")
    delay = _item_id(state, "M4", "Higher delay damages and shortfall discount")
    tick(900)
    svc.set_priorities(
        MANAGER,
        ENGAGEMENT_ID,
        "M5",
        [
            NegotiationAsk(
                label="Index-linked price escalator (LME aluminium)",
                priority=Priority.MUST_HAVE,
                ref_item_id=escalator,
            ),
            NegotiationAsk(
                label="Tooling ownership passes to Alpina on exit",
                priority=Priority.MUST_HAVE,
                ref_item_id=supply,
            ),
            NegotiationAsk(
                label="Minimum supply commitment",
                priority=Priority.TRADE_OFF,
                ref_item_id=supply,
                note="Offer a longer term (5 years) in exchange for the supply commitment.",
            ),
            NegotiationAsk(
                label="Higher delay damages", priority=Priority.NICE_TO_HAVE, ref_item_id=delay
            ),
        ],
    )
    tick(60)
    svc.sign_milestone(MANAGER, ENGAGEMENT_ID, "M5")
    if stop_at == STAGES.index("M5"):
        return svc.load(ENGAGEMENT_ID)

    # Step 6: final sign-off
    tick(300)
    return svc.release(MANAGER, ENGAGEMENT_ID)


def load_contract(fixture_dir: Path) -> str:
    return (Path(fixture_dir) / "contract.md").read_text()
