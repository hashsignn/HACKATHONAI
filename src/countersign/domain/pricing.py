"""Convergence pricing: every deliverable is priced in two lines.

* **Judgment**: a flat fee by complexity tier. The AI's research and drafting are
  included, never billed separately. It is earned milestone by milestone as each one
  is signed, in proportion to the milestone's published weight.
* **Signature**: a named person signs and KPMG carries the liability. Priced by
  consequence of error (internal use, external reliance, regulatory) and billed once,
  when the deliverable is signed.

The commercial options are variations on the same two lines, so every department
converges on one unit:

=================  ===========================================================
per deliverable    Judgment + Signature
outcome linked     part of Judgment at risk against a KPI; Signature never at risk
client platform    the client's team prepares in KPMG's AI; reduced Judgment
retainer           a year of deliverables at a discount; each draws one credit
engagement fee     audit: fixed fee to the client; the two lines are internal
classic            hourly, as today, outside the platform
=================  ===========================================================
"""

from __future__ import annotations

import tomllib
from dataclasses import asdict, dataclass, field
from pathlib import Path

from .catalogue import Catalogue
from .guardrails import Violation, check
from .models import AtRisk, CommercialOption, ComplexityTier, Consequence, Intake
from .policy import final_signer_slots, review_policy


@dataclass(frozen=True)
class ServicePrices:
    judgment: dict[ComplexityTier, float]
    historical_fee: dict[ComplexityTier, float]
    reference_hours: dict[ComplexityTier, float]
    signature: dict[Consequence, float] | None  # overrides the department's


@dataclass(frozen=True)
class DepartmentPrices:
    signature: dict[Consequence, float]
    platform_licence: float
    services: dict[str, ServicePrices]


@dataclass(frozen=True)
class PriceList:
    version: str
    currency: str
    client_platform_factor: float
    retainer_discount: float
    retainer_deliverables: int
    departments: dict[str, DepartmentPrices]

    @classmethod
    def from_toml(cls, path: Path) -> PriceList:
        raw = tomllib.loads(Path(path).read_text())

        def tiers(d: dict) -> dict[ComplexityTier, float]:
            return {ComplexityTier(k): float(v) for k, v in d.items()}

        def cons(d: dict) -> dict[Consequence, float]:
            return {Consequence(k): float(v) for k, v in d.items()}

        depts = {}
        for key, d in raw["departments"].items():
            services = {
                skey: ServicePrices(
                    judgment=tiers(s["judgment"]),
                    historical_fee=tiers(s["historical_fee"]),
                    reference_hours=tiers(s["reference_hours"]),
                    signature=cons(s["signature"]) if "signature" in s else None,
                )
                for skey, s in d.get("services", {}).items()
            }
            depts[key] = DepartmentPrices(
                cons(d["signature"]), float(d.get("platform_licence", 0)), services
            )
        return cls(
            version=raw["version"],
            currency=raw["currency"],
            client_platform_factor=float(raw["client_platform_factor"]),
            retainer_discount=float(raw["retainer_discount"]),
            retainer_deliverables=int(raw["retainer_deliverables"]),
            departments=depts,
        )

    def service(self, service_id: str) -> tuple[DepartmentPrices, ServicePrices]:
        dept, _, key = service_id.partition(".")
        d = self.departments[dept]
        return d, d.services[key]


@dataclass(frozen=True)
class Quote:
    """A priced deliverable. Stored verbatim in the ledger when pricing is confirmed."""

    service_id: str
    service_name: str
    department: str
    option: str
    complexity: str
    consequence: str
    currency: str
    price_list_version: str
    judgment_full: float  # list price of the Judgment line for this tier
    judgment_fixed: float  # Judgment earned per signed milestone (after platform/at-risk)
    judgment_at_risk: float  # paid only as far as the KPI is met
    signature: float
    total_fixed: float  # what the client pays for one deliverable, excluding at-risk upside
    total_max: float  # including the full at-risk amount
    external_billing: str  # "two_lines" | "engagement_fee" | "retainer" | "hourly"
    historical_fee: float  # same deliverable billed hourly before AI
    reference_hours: float
    saving_vs_hourly: float | None
    review_level: str
    signers: list[str]
    retainer_annual_fee: float | None = None
    platform_licence: float | None = None
    at_risk: dict | None = None
    violations: list[dict] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    @property
    def allowed(self) -> bool:
        return not self.violations

    def as_dict(self) -> dict:
        return asdict(self)


def build_quote(
    catalogue: Catalogue,
    prices: PriceList,
    service_id: str,
    complexity: ComplexityTier,
    consequence: Consequence,
    option: CommercialOption,
    intake: Intake,
    at_risk: AtRisk | None = None,
) -> Quote:
    service = catalogue.service(service_id)
    dept = catalogue.department(service.department)
    dprices, sprices = prices.service(service_id)
    violations: list[Violation] = check(dept, service, option, consequence, intake, at_risk)

    j_full = sprices.judgment[complexity]
    signature = (sprices.signature or dprices.signature)[consequence]
    historical = sprices.historical_fee[complexity]
    j_fixed, j_risk = j_full, 0.0
    external = "two_lines"
    retainer_fee = licence = None
    notes: list[str] = []

    if option is CommercialOption.CLIENT_PLATFORM:
        j_fixed = round(j_full * prices.client_platform_factor, 2)
        licence = dprices.platform_licence
        notes.append(
            f"The client's team prepares in KPMG's AI; KPMG reviews and signs. Platform licence "
            f"{prices.currency} {licence:,.0f} a year, billed separately."
        )
    elif option is CommercialOption.OUTCOME_LINKED and at_risk is not None:
        j_risk = round(j_full * at_risk.share, 2)
        j_fixed = round(j_full - j_risk, 2)
        notes.append(
            f"{at_risk.share:.0%} of Judgment is at risk on '{at_risk.kpi}': nothing below "
            f"{at_risk.threshold:g}{at_risk.unit}, all of it at {at_risk.full_at:g}{at_risk.unit}, "
            f"measured from {at_risk.measured_by}. The Signature line is never at risk."
        )
    elif option is CommercialOption.RETAINER:
        external = "retainer"
        n = prices.retainer_deliverables
        retainer_fee = round(n * (j_full + signature) * (1 - prices.retainer_discount), 2)
        notes.append(
            f"Annual retainer covering {n} deliverables: {prices.currency} {retainer_fee:,.0f}. "
            "Each deliverable draws one credit and is still signed milestone by milestone."
        )
    elif option is CommercialOption.ENGAGEMENT_FEE:
        external = "engagement_fee"
        notes.append(
            "The client pays a fixed engagement fee agreed upfront, which does not vary with "
            "findings. Judgment and Signature are KPMG's internal build-up of that fee."
        )
    elif option is CommercialOption.CLASSIC:
        external = "hourly"
        notes.append("Billed by the hour from timesheets, as today, outside the platform.")

    total_fixed = j_fixed + signature
    if option is CommercialOption.CLASSIC:
        total_fixed = historical
    review = review_policy(consequence, complexity, intake, dept.policy)
    saving = (
        None
        if option is CommercialOption.CLASSIC or historical <= 0
        else 1 - (total_fixed + j_risk) / historical
    )

    return Quote(
        service_id=service.id,
        service_name=service.name,
        department=dept.name,
        option=option.value,
        complexity=complexity.value,
        consequence=consequence.value,
        currency=prices.currency,
        price_list_version=prices.version,
        judgment_full=j_full,
        judgment_fixed=j_fixed,
        judgment_at_risk=j_risk,
        signature=signature,
        total_fixed=total_fixed,
        total_max=total_fixed + j_risk,
        external_billing=external,
        historical_fee=historical,
        reference_hours=sprices.reference_hours[complexity],
        saving_vs_hourly=None if saving is None else round(saving, 4),
        review_level=review.policy.level.value,
        signers=[s.value for s in final_signer_slots(consequence, dept.policy)],
        retainer_annual_fee=retainer_fee,
        platform_licence=licence,
        at_risk=at_risk.model_dump() if at_risk else None,
        violations=[asdict(v) for v in violations],
        notes=notes,
    )
