"""Composition root: the one place that wires concrete adapters together."""

from __future__ import annotations

import os
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from .ai.controls import ControlLibrary
from .ai.provider import AIProvider
from .ai.scripted import ScriptedProvider
from .domain.people import Directory
from .ledger.crypto import DevKeyring, new_salt
from .ledger.store import EventStore, utc_now
from .projections.billing import RateCard
from .services.engagements import EngagementService

PACKAGE_DIR = Path(__file__).resolve().parent
REPO_DIR = PACKAGE_DIR.parents[1]


@dataclass
class Settings:
    db_path: str = field(default_factory=lambda: os.environ.get("COUNTERSIGN_DB", ":memory:"))
    fixture_dir: Path = field(
        default_factory=lambda: Path(
            os.environ.get("COUNTERSIGN_FIXTURES", REPO_DIR / "fixtures" / "alpina_sinogear")
        )
    )
    rate_card_path: Path = PACKAGE_DIR / "config" / "rate_card.toml"
    users_path: Path = PACKAGE_DIR / "config" / "users.toml"
    seed: str | None = field(default_factory=lambda: os.environ.get("COUNTERSIGN_SEED") or None)


@dataclass
class Container:
    settings: Settings
    store: EventStore
    directory: Directory
    keyring: DevKeyring
    rate_card: RateCard
    provider: AIProvider
    controls: ControlLibrary
    service: EngagementService


def build_container(
    settings: Settings | None = None,
    clock: Callable[[], datetime] = utc_now,
    provider: AIProvider | None = None,
    salt_factory: Callable[[], str] | None = None,
) -> Container:
    settings = settings or Settings()
    if not settings.fixture_dir.exists():
        raise FileNotFoundError(
            f"fixture directory {settings.fixture_dir} not found; set COUNTERSIGN_FIXTURES"
        )
    store = EventStore(settings.db_path, clock=clock)
    directory = Directory.from_toml(settings.users_path)
    keyring = DevKeyring()
    rate_card = RateCard.from_toml(settings.rate_card_path)
    provider = provider or ScriptedProvider(settings.fixture_dir)
    controls = ControlLibrary.from_fixture(settings.fixture_dir)
    service = EngagementService(
        store=store,
        provider=provider,
        controls=controls,
        directory=directory,
        keyring=keyring,
        rate_card_version=rate_card.version,
        clock=clock,
        salt_factory=salt_factory or new_salt,
    )
    return Container(settings, store, directory, keyring, rate_card, provider, controls, service)
