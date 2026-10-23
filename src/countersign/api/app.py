"""HTTP API and static console.

Authentication is a stand-in: the caller names themselves in the ``X-User`` header and
is looked up in the directory. Production replaces this one dependency with the firm's
SSO (OIDC); every authorisation rule below stays the same because it lives in the
service layer and in the explicit read checks here.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, Header, Request
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from ..bootstrap import PACKAGE_DIR, Container, Settings, build_container
from ..clock import Clock
from ..domain.errors import (
    Conflict,
    DomainError,
    Forbidden,
    IntegrityError,
    NotFound,
    SealedError,
)
from ..domain.models import BlindFinding, Decision, Intake, NegotiationAsk, ReasonCode, Role, Tier
from ..domain.people import User
from ..projections.audit import build_trail, render_markdown
from ..projections.billing import build_invoice
from ..projections.quality import reviewer_quality
from ..projections.state import EngagementState
from ..scenario import STAGES, load_contract, run_alpina
from .views import engagement_view, invoice_view, trail_view

WEB_DIR = PACKAGE_DIR / "web"


class OpenEngagementRequest(BaseModel):
    client: str = Field(min_length=2, max_length=200)
    counterparty: str = Field(min_length=2, max_length=200)
    matter: str = Field(min_length=2, max_length=500)
    workflow: str = "spa_contract_review"
    tier: Tier = Tier.ASSISTED
    intake: Intake
    team: dict[Role, str]
    contract_text: str = Field(min_length=1)


class BlindAssessmentRequest(BaseModel):
    findings: list[BlindFinding] = Field(min_length=1, max_length=30)


class PrioritiesRequest(BaseModel):
    asks: list[NegotiationAsk] = Field(min_length=1, max_length=30)


class StopRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


def current_user(request: Request, x_user: Annotated[str | None, Header()] = None) -> User:
    """Identity stand-in: production swaps this for SSO (OIDC) without touching the rules."""
    return request.app.state.container.directory.get(x_user)


UserDep = Annotated[User, Depends(current_user)]

_STATUS = {
    NotFound: 404,
    Forbidden: 403,
    SealedError: 423,
    Conflict: 409,
    IntegrityError: 500,
}


def create_app(settings: Settings | None = None, container: Container | None = None) -> FastAPI:
    settings = settings or Settings()
    container = container or _seeded_container(settings, settings.seed)
    app = FastAPI(
        title="Countersign",
        version="0.1.0",
        description="Every AI step decided, reasoned and signed by a named person. "
        "The signed milestone is the billable unit.",
    )
    app.state.container = container

    def C() -> Container:
        return app.state.container

    @app.exception_handler(DomainError)
    async def _domain_error(_: Request, exc: DomainError) -> JSONResponse:
        status = next((s for cls, s in _STATUS.items() if isinstance(exc, cls)), 400)
        return JSONResponse({"error": type(exc).__name__, "detail": str(exc)}, status_code=status)

    def readable(eid: str, user: User, *, internal: bool = True) -> EngagementState:
        state = C().service.load(eid)
        on_team = user.id in state.opened.team.values()
        if user.role is Role.AUDITOR:
            return state
        if internal and (not on_team or user.role is Role.CLIENT):
            raise Forbidden(
                "internal working view is limited to the engagement team and Quality & Risk"
            )
        if not internal and not on_team:
            raise Forbidden("not your engagement")
        return state

    # ------------------------------------------------------------ reference
    @app.get("/api/users")
    def users() -> list[dict]:
        return [{"id": u.id, "name": u.name, "role": u.role.value} for u in C().directory.all()]

    @app.get("/api/meta")
    def meta() -> dict:
        taxonomy_path = C().settings.fixture_dir / "risk_taxonomy.json"
        taxonomy = json.loads(taxonomy_path.read_text())["codes"] if taxonomy_path.exists() else {}
        return {
            "reason_codes": [r.value for r in ReasonCode],
            "risk_taxonomy": taxonomy,
            "seed_stages": STAGES,
            "demo": bool(settings.seed),
        }

    # ------------------------------------------------------------ engagements
    @app.get("/api/engagements")
    def list_engagements(user: UserDep) -> list[dict]:
        out = []
        for eid in C().store.engagement_ids():
            state = C().service.load(eid)
            if user.role is Role.AUDITOR or user.id in state.opened.team.values():
                out.append(
                    {
                        "id": eid,
                        "client": state.opened.client,
                        "matter": state.opened.matter,
                        "status": state.status.value,
                        "review_level": state.opened.review_level.value,
                    }
                )
        return out

    @app.post("/api/engagements", status_code=201)
    def open_engagement(body: OpenEngagementRequest, user: UserDep) -> dict:
        state = C().service.open_engagement(
            user.id,
            client=body.client,
            counterparty=body.counterparty,
            matter=body.matter,
            workflow=body.workflow,
            tier=body.tier,
            intake=body.intake,
            team=body.team,
            contract_text=body.contract_text,
        )
        return engagement_view(state, C().directory)

    @app.get("/api/engagements/{eid}")
    def get_engagement(eid: str, user: UserDep) -> dict:
        return engagement_view(readable(eid, user), C().directory)

    @app.post("/api/engagements/{eid}/milestones/{key}/start")
    def start(eid: str, key: str, user: UserDep) -> dict:
        return engagement_view(C().service.start_milestone(user.id, eid, key), C().directory)

    @app.post("/api/engagements/{eid}/milestones/{key}/blind-assessment")
    def blind(eid: str, key: str, body: BlindAssessmentRequest, user: UserDep) -> dict:
        return engagement_view(
            C().service.submit_blind_assessment(user.id, eid, key, body.findings), C().directory
        )

    @app.post("/api/engagements/{eid}/milestones/{key}/items/{item_id}/decision")
    def decide(eid: str, key: str, item_id: str, body: Decision, user: UserDep) -> dict:
        return engagement_view(C().service.decide(user.id, eid, key, item_id, body), C().directory)

    @app.post("/api/engagements/{eid}/milestones/{key}/priorities")
    def priorities(eid: str, key: str, body: PrioritiesRequest, user: UserDep) -> dict:
        return engagement_view(
            C().service.set_priorities(user.id, eid, key, body.asks), C().directory
        )

    @app.post("/api/engagements/{eid}/milestones/{key}/sign")
    def sign(eid: str, key: str, user: UserDep) -> dict:
        outcome = C().service.sign_milestone(user.id, eid, key)
        return {
            "signed": outcome.signed,
            "escalated": outcome.escalated,
            "message": outcome.message,
            "controls": outcome.controls.model_dump(mode="json") if outcome.controls else None,
            "engagement": engagement_view(C().service.load(eid), C().directory),
        }

    @app.post("/api/engagements/{eid}/release")
    def release(eid: str, user: UserDep) -> dict:
        return engagement_view(C().service.release(user.id, eid), C().directory)

    @app.post("/api/engagements/{eid}/stop")
    def stop(eid: str, body: StopRequest, user: UserDep) -> dict:
        return engagement_view(C().service.stop(user.id, eid, body.reason), C().directory)

    # ------------------------------------------------- the three readers of one record
    @app.get("/api/engagements/{eid}/invoice")
    def invoice(eid: str, user: UserDep) -> dict:
        state = readable(eid, user, internal=False)
        return invoice_view(build_invoice(state, C().rate_card, C().directory))

    @app.get("/api/engagements/{eid}/trail")
    def trail(eid: str, user: UserDep) -> dict:
        state = readable(eid, user, internal=False)
        return trail_view(build_trail(state, C().store.verify(eid), C().directory, C().keyring))

    @app.get("/api/engagements/{eid}/trail.md", response_class=PlainTextResponse)
    def trail_md(eid: str, user: UserDep) -> str:
        state = readable(eid, user, internal=False)
        return render_markdown(
            build_trail(state, C().store.verify(eid), C().directory, C().keyring)
        )

    @app.get("/api/reviewers/{uid}/quality")
    def quality(uid: str, user: UserDep) -> dict:
        if user.id != uid and not (user.role is Role.AUDITOR or user.role.at_least(Role.MANAGER)):
            raise Forbidden(
                "reviewer metrics are visible to the reviewer, managers and Quality & Risk"
            )
        states = [C().service.load(eid) for eid in C().store.engagement_ids()]
        return reviewer_quality(uid, states).as_dict()

    # --------------------------------------------------------------- backstage
    @app.get("/api/engagements/{eid}/ledger")
    def ledger(eid: str, user: UserDep) -> list[dict]:
        state = C().service.load(eid)
        backstage = user.role is Role.AUDITOR or (
            user.role.at_least(Role.MANAGER) and user.id in state.opened.team.values()
        )
        if not backstage:
            raise Forbidden(
                "the raw ledger is visible to the engagement's management and Quality & Risk"
            )
        return [
            {
                "n": e.n,
                "type": e.type,
                "actor": e.actor,
                "occurred_at": e.occurred_at,
                "payload": e.payload,
                "prev_hash": e.prev_hash,
                "hash": e.hash,
            }
            for e in C().store.load(eid)
        ]

    @app.get("/api/engagements/{eid}/ledger/verify")
    def verify(eid: str, user: UserDep) -> dict:
        readable(eid, user, internal=False)
        v = C().store.verify(eid)
        return {
            "ok": v.ok,
            "length": v.length,
            "head_hash": v.head_hash,
            "first_bad_n": v.first_bad_n,
            "reason": v.reason,
        }

    @app.get("/api/engagements/{eid}/activity")
    def activity(eid: str, user: UserDep) -> list[dict]:
        """Ledger feed for the console: event types, actors and hashes, without payloads."""
        readable(eid, user)
        return [
            {
                "n": e.n,
                "type": e.type,
                "actor": C().directory.get(e.actor).name,
                "occurred_at": e.occurred_at,
                "milestone": e.payload.get("milestone"),
                "hash": e.hash,
            }
            for e in C().store.load(eid)
        ]

    # ------------------------------------------------------------------ demo
    @app.post("/api/demo/reset")
    def demo_reset(stage: str = "M2") -> dict:
        """Rebuild the in-memory demo at a scenario stage. Only in demo (seeded) mode."""
        if not settings.seed:
            raise Forbidden(
                "demo reset is only available when the server runs with COUNTERSIGN_SEED"
            )
        if stage not in STAGES:
            raise NotFound(f"unknown stage {stage!r}; choose from {', '.join(STAGES)}")
        app.state.container = _seeded_container(settings, stage)
        return {"reset_to": stage}

    # ------------------------------------------------------------------ console
    if Path(WEB_DIR).exists():
        app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")

        @app.get("/", include_in_schema=False)
        def index() -> FileResponse:
            return FileResponse(WEB_DIR / "index.html")

    return app


def _seeded_container(settings: Settings, stage: str | None) -> Container:
    """Build a container; if a stage is given, replay the Alpina scenario up to it on a
    pinned clock that started six hours ago, then hand over to real time."""
    if not stage:
        return build_container(settings)
    clock = Clock(datetime.now(UTC) - timedelta(hours=6))
    container = build_container(settings, clock=clock)
    run_alpina(
        container.service, load_contract(settings.fixture_dir), until=stage, tick=clock.advance
    )
    clock.release()
    return container
