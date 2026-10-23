"""The signed milestone is the billable unit."""

from __future__ import annotations

import dataclasses

import pytest

from countersign.domain.errors import Conflict
from countersign.domain.models import Intake, Role, Tier
from countersign.projections.billing import build_invoice
from countersign.scenario import CLIENT, ENGAGEMENT_ID, JUNIOR, MANAGER


def test_alpina_invoice_matches_the_pitch(container, run_until):
    state = run_until("released")
    inv = build_invoice(state, container.rate_card, container.directory)
    assert [line.amount for line in inv.lines] == [600, 1200, 2400, 1800, 1200]
    assert inv.total == 7200
    assert inv.quote_hourly_equivalent == 10_000
    assert inv.saving_vs_hourly == pytest.approx(0.28)
    assert inv.status == "final"
    # Every franc points at a signature on the record.
    digests = {s.digest[:16] for m in state.milestones.values() for s in m.signatures}
    assert {line.signature_ref for line in inv.lines} <= digests


def test_nothing_unsigned_is_billable(container, run_until):
    state = run_until("M3-sealed")
    inv = build_invoice(state, container.rate_card, container.directory)
    assert inv.total == 1800 and inv.not_billed == ["M3", "M4", "M5"] and inv.status == "interim"


def test_client_can_stop_and_pays_only_for_signed_steps(container, run_until, svc):
    run_until("M2")
    state = svc.stop(CLIENT, ENGAGEMENT_ID, "Deal on hold")
    inv = build_invoice(state, container.rate_card, container.directory)
    assert inv.status == "stopped" and inv.total == 1800
    with pytest.raises(Conflict, match="stopped"):
        svc.start_milestone(JUNIOR, ENGAGEMENT_ID, "M3")


def test_agent_led_tier_draws_on_the_subscription(container, svc, contract):
    state = svc.open_engagement(
        MANAGER,
        client="Alpina Pumps AG",
        counterparty="Other Ltd",
        matter="Second supplier",
        workflow="spa_contract_review",
        tier=Tier.AGENT_LED,
        intake=Intake(
            client_role="buyer", client_importance="key", term_years=2, annual_value_chf=1_000_000
        ),
        team={Role.JUNIOR: JUNIOR, Role.MANAGER: MANAGER},
        contract_text=contract,
        engagement_id="ENG-SUB",
    )
    inv = build_invoice(state, container.rate_card, container.directory)
    assert inv.total == 0 and "subscription" in inv.note and inv.saving_vs_hourly is None


def test_invoice_uses_the_rate_card_locked_at_opening(container, run_until):
    state = run_until("M1")
    newer = dataclasses.replace(container.rate_card, version="2027.01")
    with pytest.raises(ValueError, match="locked"):
        build_invoice(state, newer, container.directory)
