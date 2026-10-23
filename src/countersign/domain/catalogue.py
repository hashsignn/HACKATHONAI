"""The firm's service catalogue: departments, the services each sells, and the milestones
each service is made of.

The catalogue is configuration (one TOML file per department in ``config/catalogue``),
not code. Adding a service line means adding a file, and the same engine, ledger,
signatures and pricing apply to it. Each department also carries its **policy pack**:
which commercial options it may sell, review minimums and who must sign.
"""

from __future__ import annotations

import tomllib
from dataclasses import dataclass, field
from pathlib import Path

from .errors import NotFound
from .models import CommercialOption, Consequence, Lane, ReviewLevel, Slot


@dataclass(frozen=True)
class MilestoneSpec:
    key: str  # stable id within a service, e.g. "M3"
    slug: str  # provider lookup key, e.g. "risk_screening"
    title: str
    lane: Lane
    lead: Slot  # who leads and signs the milestone
    weight: float  # share of the Judgment line earned when this milestone is signed

    @property
    def requires_priorities(self) -> bool:
        return self.lane is Lane.HUMAN_LED


@dataclass(frozen=True)
class ServiceSpec:
    department: str
    key: str
    name: str
    deliverable: str
    min_consequence: Consequence
    outcome_linked_allowed: bool
    milestones: tuple[MilestoneSpec, ...]
    notes: str = ""

    @property
    def id(self) -> str:
        return f"{self.department}.{self.key}"

    def milestone(self, key: str) -> MilestoneSpec:
        for m in self.milestones:
            if m.key == key:
                return m
        raise NotFound(f"service {self.id} has no milestone {key!r}")

    def index_of(self, key: str) -> int:
        return [m.key for m in self.milestones].index(key)


@dataclass(frozen=True)
class PolicyPack:
    options: tuple[CommercialOption, ...]
    min_review_level: ReviewLevel = ReviewLevel.STANDARD
    max_at_risk_share: float = 0.0
    signature_slots: dict[Consequence, tuple[Slot, ...]] = field(default_factory=dict)
    rationale: tuple[str, ...] = ()


@dataclass(frozen=True)
class DepartmentSpec:
    key: str
    name: str
    summary: str
    policy: PolicyPack
    services: dict[str, ServiceSpec]


class Catalogue:
    def __init__(self, departments: dict[str, DepartmentSpec]) -> None:
        self.departments = departments

    @classmethod
    def from_dir(cls, path: Path) -> Catalogue:
        depts = {}
        for f in sorted(Path(path).glob("*.toml")):
            d = _load_department(tomllib.loads(f.read_text()), f.name)
            depts[d.key] = d
        if not depts:
            raise ValueError(f"no department files in {path}")
        return cls(depts)

    def department(self, key: str) -> DepartmentSpec:
        try:
            return self.departments[key]
        except KeyError as exc:
            raise NotFound(f"unknown department {key!r}") from exc

    def service(self, service_id: str) -> ServiceSpec:
        dept, _, key = service_id.partition(".")
        try:
            return self.department(dept).services[key]
        except KeyError as exc:
            raise NotFound(f"unknown service {service_id!r}") from exc

    def services(self) -> list[ServiceSpec]:
        return [s for d in self.departments.values() for s in d.services.values()]


def _load_department(raw: dict, source: str) -> DepartmentSpec:
    d = raw["department"]
    p = raw.get("policy", {})
    policy = PolicyPack(
        options=tuple(CommercialOption(o) for o in p["options"]),
        min_review_level=ReviewLevel(p.get("min_review_level", "standard")),
        max_at_risk_share=float(p.get("max_at_risk_share", 0.0)),
        signature_slots={
            Consequence(k): tuple(Slot(s) for s in v)
            for k, v in p.get("signature_slots", {}).items()
        },
        rationale=tuple(p.get("rationale", [])),
    )
    services = {}
    for s in raw.get("services", []):
        milestones = tuple(
            MilestoneSpec(
                key=m["key"],
                slug=m["slug"],
                title=m["title"],
                lane=Lane(m["lane"]),
                lead=Slot(m["lead"]),
                weight=float(m["weight"]),
            )
            for m in s["milestones"]
        )
        spec = ServiceSpec(
            department=d["key"],
            key=s["key"],
            name=s["name"],
            deliverable=s["deliverable"],
            min_consequence=Consequence(s.get("min_consequence", "internal_use")),
            outcome_linked_allowed=bool(s.get("outcome_linked_allowed", False)),
            milestones=milestones,
            notes=s.get("notes", ""),
        )
        _validate(spec, source)
        services[spec.key] = spec
    return DepartmentSpec(
        key=d["key"], name=d["name"], summary=d.get("summary", ""), policy=policy, services=services
    )


def _validate(spec: ServiceSpec, source: str) -> None:
    where = f"{source}: {spec.id}"
    keys = [m.key for m in spec.milestones]
    if len(keys) != len(set(keys)):
        raise ValueError(f"{where}: duplicate milestone keys")
    total = sum(m.weight for m in spec.milestones)
    if abs(total - 1.0) > 1e-6:
        raise ValueError(f"{where}: milestone weights sum to {total}, not 1")
    for m in spec.milestones:
        if m.lead not in (Slot.JUNIOR, Slot.MANAGER, Slot.PARTNER):
            raise ValueError(
                f"{where}: milestone {m.key} must be led by junior, manager or partner"
            )
