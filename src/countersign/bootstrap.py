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
from .domain.catalogue import Catalogue
from .domain.people import Directory
from .domain.pricing import PriceList
from .ledger.crypto import DevKeyring, new_salt
from .ledger.store import EventStore, utc_now
from .services.engagements import EngagementService

PACKAGE_DIR = Path(__file__).resolve().parent
REPO_DIR = PACKAGE_DIR.parents[1]
CONFIG_DIR = PACKAGE_DIR / "config"


@dataclass
class Settings:
    db_path: str = field(default_factory=lambda: os.environ.get("COUNTERSIGN_DB", ":memory:"))
    fixtures_root: Path = field(
        default_factory=lambda: Path(os.environ.get("COUNTERSIGN_FIXTURES", REPO_DIR / "fixtures"))
    )
    catalogue_dir: Path = CONFIG_DIR / "catalogue"
    price_list_path: Path = CONFIG_DIR / "price_list.toml"
    users_path: Path = CONFIG_DIR / "users.toml"
    seed: str | None = field(default_factory=lambda: os.environ.get("COUNTERSIGN_SEED") or None)

    @property
    def alpina_dir(self) -> Path:
        return self.fixtures_root / "alpina_sinogear"


@dataclass
class Container:
    settings: Settings
    store: EventStore
    catalogue: Catalogue
    prices: PriceList
    directory: Directory
    keyring: DevKeyring
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
    if not settings.fixtures_root.exists():
        raise FileNotFoundError(
            f"fixtures folder {settings.fixtures_root} not found; set COUNTERSIGN_FIXTURES"
        )
    store = EventStore(settings.db_path, clock=clock)
    catalogue = Catalogue.from_dir(settings.catalogue_dir)
    prices = PriceList.from_toml(settings.price_list_path)
    _check_prices_cover_catalogue(catalogue, prices)
    directory = Directory.from_toml(settings.users_path)
    keyring = DevKeyring()
    provider = provider or ScriptedProvider(settings.fixtures_root)
    controls = ControlLibrary.from_fixtures(settings.fixtures_root)
    service = EngagementService(
        store=store,
        catalogue=catalogue,
        prices=prices,
        provider=provider,
        controls=controls,
        directory=directory,
        keyring=keyring,
        clock=clock,
        salt_factory=salt_factory or new_salt,
    )
    return Container(
        settings, store, catalogue, prices, directory, keyring, provider, controls, service
    )


def _check_prices_cover_catalogue(catalogue: Catalogue, prices: PriceList) -> None:
    """Fail at start-up, not in front of a client, if a service has no published price."""
    for s in catalogue.services():
        try:
            prices.service(s.id)
        except KeyError as exc:
            raise ValueError(f"price list {prices.version} has no prices for {s.id}") from exc
