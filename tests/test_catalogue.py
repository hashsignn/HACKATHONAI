"""The firm catalogue: every department and service is well-formed and priced."""

from __future__ import annotations

import pytest

from countersign.domain.catalogue import Catalogue
from countersign.domain.models import ComplexityTier, Consequence

DEPARTMENTS = {"audit", "consulting", "deal_advisory", "legal", "risk_esg", "tax"}


def test_all_six_departments_load(container):
    assert set(container.catalogue.departments) == DEPARTMENTS
    assert len(container.catalogue.services()) >= 9


def test_every_service_is_well_formed_and_priced(container):
    for s in container.catalogue.services():
        assert abs(sum(m.weight for m in s.milestones) - 1) < 1e-9, s.id
        dept_prices, prices = container.prices.service(s.id)
        assert set(prices.judgment) == set(ComplexityTier), s.id
        assert set(prices.historical_fee) == set(ComplexityTier), s.id
        assert set(prices.signature or dept_prices.signature) == set(Consequence), s.id


def test_every_department_states_its_policy(container):
    for d in container.catalogue.departments.values():
        assert d.policy.options, d.key
        assert d.policy.rationale, d.key


def test_bad_weights_are_rejected_at_load(tmp_path):
    (tmp_path / "x.toml").write_text(
        '[department]\nkey="x"\nname="X"\n[policy]\noptions=["per_deliverable"]\n'
        '[[services]]\nkey="s"\nname="S"\ndeliverable="d"\n'
        '[[services.milestones]]\nkey="M1"\nslug="a"\ntitle="A"\nlane="human_led"\nlead="manager"\nweight=0.5\n'
    )
    with pytest.raises(ValueError, match="weights sum"):
        Catalogue.from_dir(tmp_path)


def test_department_doc_is_generated_from_config(container):
    from pathlib import Path

    from countersign.catalogue_doc import render

    committed = (Path(__file__).parents[1] / "docs" / "departments.md").read_text()
    assert committed == render(container.catalogue, container.prices), (
        "docs/departments.md is stale: run `make docs`"
    )
