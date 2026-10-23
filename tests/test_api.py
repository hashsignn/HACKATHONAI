"""HTTP layer: status codes, read permissions, demo reset."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from countersign.api.app import create_app
from countersign.bootstrap import Settings
from countersign.scenario import ENGAGEMENT_ID

E = f"/api/engagements/{ENGAGEMENT_ID}"


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(create_app(Settings(db_path=":memory:", seed="M3-sealed")))


def h(user: str) -> dict:
    return {"X-User": user}


def test_unknown_user_is_refused(client):
    assert client.get(E, headers=h("nobody")).status_code == 403
    assert client.get(E).status_code == 403


def test_sealed_list_returns_423(client):
    r = client.post(
        f"{E}/milestones/M3/items/M3-01/decision",
        headers=h("lea.brunner"),
        json={"action": "approve"},
    )
    assert r.status_code == 423 and r.json()["error"] == "SealedError"


def test_invalid_decision_returns_422(client):
    r = client.post(
        f"{E}/milestones/M3/items/M3-01/decision",
        headers=h("lea.brunner"),
        json={"action": "reject"},
    )
    assert r.status_code == 422


def test_read_permissions(client):
    assert client.get(E, headers=h("alpina.client")).status_code == 403  # internal working view
    assert client.get(f"{E}/trail", headers=h("alpina.client")).status_code == 200
    assert client.get(f"{E}/invoice", headers=h("alpina.client")).json()["total_due"] == 570 + 855
    assert client.get(f"{E}/ledger", headers=h("lea.brunner")).status_code == 403
    assert client.get(f"{E}/ledger", headers=h("marco.rossi")).status_code == 200
    assert client.get(f"{E}/ledger", headers=h("qr.backstage")).status_code == 200
    assert (
        client.get("/api/reviewers/lea.brunner/quality", headers=h("lea.brunner")).status_code
        == 200
    )
    assert (
        client.get("/api/reviewers/marco.rossi/quality", headers=h("lea.brunner")).status_code
        == 403
    )


def test_open_and_price_an_engagement_over_http(client):
    body = {
        "client": "Test AG",
        "counterparty": "Vendor",
        "matter": "NDA",
        "service_id": "legal.nda_triage",
        "requested_option": "per_deliverable",
        "intake": {"reliance": "internal_use"},
        "team": {"junior": "lea.brunner", "manager": "marco.rossi"},
        "document_text": "Clause 1.",
    }
    r = client.post("/api/engagements", headers=h("marco.rossi"), json=body)
    assert r.status_code == 201 and r.json()["status"] == "awaiting_pricing"
    eid = r.json()["id"]
    r = client.post(f"/api/engagements/{eid}/pricing", headers=h("marco.rossi"), json={})
    assert r.status_code == 200 and r.json()["pricing"]["quote"]["total_fixed"] == 450 + 250
    bad = {**body, "team": {"junior": "nico.steiner", "manager": "marco.rossi"}}
    assert client.post("/api/engagements", headers=h("marco.rossi"), json=bad).status_code == 409


def test_quote_applies_guardrails(client):
    body = {
        "service_id": "consulting.operating_model_diagnostic",
        "option": "outcome_linked",
        "intake": {"is_audit_client": True},
        "at_risk": {
            "share": 0.15,
            "kpi": "Cycle time",
            "baseline": 62,
            "threshold": 55,
            "full_at": 45,
            "higher_is_better": False,
            "measured_by": "ERP",
        },
    }
    r = client.post("/api/quote", json=body).json()
    assert not r["allowed"]
    assert r["quote"]["violations"][0]["rule"] == "independence-contingent-fee"
    ok = client.post("/api/quote", json={**body, "intake": {}}).json()
    assert ok["allowed"] and ok["quote"]["judgment_at_risk"] > 0


def test_catalogue_lists_every_department(client):
    depts = client.get("/api/catalogue").json()["departments"]
    assert {d["key"] for d in depts} == {
        "audit",
        "consulting",
        "deal_advisory",
        "legal",
        "risk_esg",
        "tax",
    }


def test_demo_reset(client):
    assert client.post("/api/demo/reset?stage=released").json() == {"reset_to": "released"}
    assert client.get(f"{E}/invoice", headers=h("alpina.client")).json()["total_due"] == 7200
    assert client.post("/api/demo/reset?stage=nope").status_code == 404


def test_console_is_served(client):
    r = client.get("/")
    assert r.status_code == 200 and "Countersign" in r.text
