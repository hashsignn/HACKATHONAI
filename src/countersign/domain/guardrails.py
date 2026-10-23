"""Policy-pack guardrails: commercial combinations the platform refuses to sell.

Checked when a quote is built, when an engagement opens and when its pricing is
confirmed, so a forbidden combination cannot reach a client. Every violation names the
rule and says why, in plain words.
"""

from __future__ import annotations

from dataclasses import dataclass

from .catalogue import DepartmentSpec, ServiceSpec
from .models import AtRisk, CommercialOption, Consequence, Intake


@dataclass(frozen=True)
class Violation:
    rule: str
    message: str


def check(
    dept: DepartmentSpec,
    service: ServiceSpec,
    option: CommercialOption,
    consequence: Consequence,
    intake: Intake,
    at_risk: AtRisk | None = None,
) -> list[Violation]:
    out: list[Violation] = []
    pack = dept.policy

    if option not in pack.options:
        offered = ", ".join(o.value.replace("_", " ") for o in pack.options)
        out.append(
            Violation(
                "option-not-offered",
                f"{dept.name} does not sell {option.value.replace('_', ' ')}. Offered: {offered}.",
            )
        )

    if intake.is_audit_client and option is CommercialOption.OUTCOME_LINKED:
        out.append(
            Violation(
                "independence-contingent-fee",
                "Independence: fees for an audit client may not depend on outcomes.",
            )
        )
    if intake.is_audit_client and option is CommercialOption.CLIENT_PLATFORM:
        out.append(
            Violation(
                "independence-platform",
                "Independence: an audit client may not run KPMG's AI platform on its own records.",
            )
        )

    if option is CommercialOption.OUTCOME_LINKED:
        if not service.outcome_linked_allowed:
            out.append(
                Violation(
                    "outcome-not-for-service",
                    f"Outcome-linked fees are not allowed for {service.name.lower()}: others rely on it, so it must not depend on the result.",
                )
            )
        if at_risk is None:
            out.append(
                Violation(
                    "at-risk-missing",
                    "An outcome-linked fee needs the KPI, threshold, target and whose data settles it.",
                )
            )
        elif at_risk.share > pack.max_at_risk_share:
            out.append(
                Violation(
                    "at-risk-too-high",
                    f"At most {pack.max_at_risk_share:.0%} of the Judgment line may be at risk in {dept.name}.",
                )
            )
    elif at_risk is not None:
        out.append(
            Violation(
                "at-risk-without-outcome",
                "Fees at risk are only possible with the outcome-linked option.",
            )
        )

    if consequence.rank < service.min_consequence.rank:
        out.append(
            Violation(
                "consequence-below-minimum",
                f"{service.name} is relied on at least as {service.min_consequence.value.replace('_', ' ')}.",
            )
        )
    return out
