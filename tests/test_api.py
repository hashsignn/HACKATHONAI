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
    assert client.get(f"{E}/invoice", headers=h("alpina.client")).json()["total"] == 1800
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


def test_open_engagement_over_http(client):
    body = {
        "client": "Test AG",
        "counterparty": "Vendor",
        "matter": "Small deal",
        "intake": {
            "client_role": "buyer",
            "client_importance": "standard",
            "term_years": 1,
            "annual_value_chf": 1,
        },
        "team": {"junior": "lea.brunner", "manager": "marco.rossi"},
        "contract_text": "Clause 1.",
    }
    r = client.post("/api/engagements", headers=h("marco.rossi"), json=body)
    assert r.status_code == 201 and r.json()["review_level"] == "standard"
    bad = {**body, "team": {"junior": "marco.rossi", "manager": "marco.rossi"}}
    assert client.post("/api/engagements", headers=h("marco.rossi"), json=bad).status_code == 409


def test_demo_reset(client):
    assert client.post("/api/demo/reset?stage=released").json() == {"reset_to": "released"}
    assert client.get(f"{E}/invoice", headers=h("alpina.client")).json()["total"] == 7200
    assert client.post("/api/demo/reset?stage=nope").status_code == 404


def test_console_is_served(client):
    r = client.get("/")
    assert r.status_code == 200 and "Countersign" in r.text
