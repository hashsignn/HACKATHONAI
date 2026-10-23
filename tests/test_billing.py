"""The invoice: Judgment earned per signed milestone, Signature billed when signed."""

from __future__ import annotations

import pytest

from countersign.domain.errors import Conflict
from countersign.domain.models import AtRisk, CommercialOption, Consequence, Intake
from countersign.projections.billing import build_invoice
from countersign.scenario import CLIENT, ENGAGEMENT_ID, JUNIOR
from tests.helpers import TEAM, complete_milestones, sign_off


def test_alpina_invoice_matches_the_pitch(container, run_until):
    state = run_until("released")
    inv = build_invoice(state, container.directory)
    assert [line.amount for line in inv.judgment_lines] == [570, 855, 1995, 1425, 855]
    assert inv.judgment_accrued == 5700 and inv.signature_billed and inv.signature == 1500
    assert inv.total_due == 7200 and inv.status == "final"
    assert inv.saving_vs_hourly == pytest.approx(0.28)
    digests = {s.digest[:16] for m in state.milestones.values() for s in m.signatures}
    assert {line.signature_ref for line in inv.judgment_lines} <= digests


def test_nothing_is_billed_before_pricing(container, run_until):
    inv = build_invoice(run_until("opened"), container.directory)
    assert inv.status == "awaiting_pricing" and inv.total_due == 0


def test_signature_is_billed_only_when_signed(container, run_until):
    inv = build_invoice(run_until("M5"), container.directory)
    assert inv.judgment_accrued == 5700 and not inv.signature_billed and inv.total_due == 5700


def test_client_can_stop_and_pays_only_signed_judgment(container, run_until, svc):
    run_until("M2")
    state = svc.stop(CLIENT, ENGAGEMENT_ID, "Deal on hold")
    inv = build_invoice(state, container.directory)
    assert inv.status == "stopped" and inv.total_due == 570 + 855 and not inv.signature_billed
    with pytest.raises(Conflict, match="stopped"):
        svc.start_milestone(JUNIOR, ENGAGEMENT_ID, "M3")


def test_outcome_linked_engagement_settles_the_at_risk_part(container, svc, contract):
    eid = "ENG-CONSULT"
    svc.open_engagement(
        "marco.rossi",
        engagement_id=eid,
        client="Alpina Pumps AG",
        counterparty="-",
        matter="Order-to-cash diagnostic",
        service_id="consulting.operating_model_diagnostic",
        requested_option=CommercialOption.OUTCOME_LINKED,
        intake=Intake(value_at_stake_chf=5_000_000, cross_border=True),
        team=TEAM,
        document_text="brief",
    )
    ar = AtRisk(
        share=0.15,
        kpi="Order-to-cash days",
        unit=" days",
        baseline=62,
        threshold=55,
        full_at=45,
        higher_is_better=False,
        measured_by="the client's ERP",
    )
    svc.confirm_pricing("marco.rossi", eid, at_risk=ar)
    complete_milestones(svc, eid)
    state = sign_off(svc, eid)
    before = build_invoice(state, container.directory)
    assert (
        before.at_risk_paid is None
        and before.total_due == before.judgment_accrued + before.signature
    )
    state = svc.record_outcome(CLIENT, eid, 50, "ERP report Q2")
    inv = build_invoice(state, container.directory)
    assert inv.at_risk_paid == pytest.approx(inv.at_risk * 0.5)
    assert inv.total_due == pytest.approx(inv.judgment_accrued + inv.signature + inv.at_risk * 0.5)
    with pytest.raises(Conflict, match="already"):
        svc.record_outcome(CLIENT, eid, 40, "again")


def test_retainer_draws_a_credit_instead_of_billing(container, svc, contract):
    eid = "ENG-RET"
    svc.open_engagement(
        "marco.rossi",
        engagement_id=eid,
        client="Alpina Pumps AG",
        counterparty="Vendor",
        matter="NDA",
        service_id="legal.nda_triage",
        requested_option=CommercialOption.RETAINER,
        intake=Intake(),
        team=TEAM,
        document_text="nda",
    )
    svc.confirm_pricing("marco.rossi", eid)
    complete_milestones(svc, eid)
    inv = build_invoice(sign_off(svc, eid), container.directory)
    assert inv.total_due == 0 and inv.external_billing == "retainer" and inv.status == "final"


def test_invoice_uses_the_price_locked_at_confirmation(container, run_until):
    state = run_until("released")
    container.service.prices = (
        None  # the live price list is never consulted for a locked engagement
    )
    assert build_invoice(state, container.directory).total_due == 7200
    assert state.pricing.quote["price_list_version"] == "2026.10"
    assert state.pricing.consequence is Consequence.INTERNAL_USE
