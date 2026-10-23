from __future__ import annotations

import itertools
from datetime import UTC, datetime

import pytest

from countersign.bootstrap import Container, Settings, build_container
from countersign.clock import Clock
from countersign.scenario import load_contract, run_alpina

START = datetime(2026, 10, 21, 7, 0, tzinfo=UTC)


def make_container(seed_salts: bool = True) -> tuple[Container, Clock]:
    clock = Clock(START)
    counter = itertools.count()
    salts = (lambda: f"salt-{next(counter):04d}") if seed_salts else None
    container = build_container(
        Settings(db_path=":memory:", seed=None), clock=clock, salt_factory=salts
    )
    return container, clock


@pytest.fixture
def env() -> tuple[Container, Clock]:
    return make_container()


@pytest.fixture
def container(env) -> Container:
    return env[0]


@pytest.fixture
def clock(env) -> Clock:
    return env[1]


@pytest.fixture
def svc(container):
    return container.service


@pytest.fixture
def contract(container) -> str:
    return load_contract(container.settings.fixture_dir)


@pytest.fixture
def run_until(svc, contract, clock):
    def _run(stage: str):
        return run_alpina(svc, contract, until=stage, tick=clock.advance)

    return _run
