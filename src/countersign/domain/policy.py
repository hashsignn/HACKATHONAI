"""Step 0: from the intake questionnaire to tiers, review intensity and signers.

Everything here is a published rule, printed back as a rationale, so nobody has to
trust a hidden score. The platform *recommends*; a named manager confirms or overrides
on the record (see ``services.engagements.confirm_pricing``).

Two dimensions drive both the price and the review:

* **Complexity** (how hard the thinking is) sets the Judgment tier.
* **Consequence** (who relies on the deliverable) sets the Signature tier, who must sign,
  and how strict the review is.

Client importance never changes the price. It can only make KPMG review harder, at
KPMG's own cost.
"""

from __future__ import annotations

from dataclasses import dataclass

from .catalogue import PolicyPack, ServiceSpec
from .models import ComplexityTier, Consequence, Intake, ReviewLevel, Slot


@dataclass(frozen=True)
class ReviewPolicy:
    level: ReviewLevel
    confidence_threshold: float  # AI items below this go to a person
    spot_check_rate: float  # share of confident AI items sampled for a person anyway
    controls_per_engagement: int  # planted checks mixed into AI output
    manager_countersigns_milestones: bool


POLICIES: dict[ReviewLevel, ReviewPolicy] = {
    ReviewLevel.STANDARD: ReviewPolicy(ReviewLevel.STANDARD, 0.70, 0.10, 0, False),
    ReviewLevel.ELEVATED: ReviewPolicy(ReviewLevel.ELEVATED, 0.80, 0.20, 1, False),
    ReviewLevel.CRITICAL: ReviewPolicy(ReviewLevel.CRITICAL, 0.90, 0.50, 2, True),
}

LEVELS = list(ReviewLevel)

LARGE_VALUE_CHF = 1_000_000
VERY_LARGE_VALUE_CHF = 25_000_000
LONG_TERM_YEARS = 3

DEFAULT_SIGNATURE_SLOTS: dict[Consequence, tuple[Slot, ...]] = {
    Consequence.INTERNAL_USE: (Slot.MANAGER,),
    Consequence.EXTERNAL_RELIANCE: (Slot.PARTNER,),
    Consequence.REGULATORY: (Slot.PARTNER, Slot.QUALITY_REVIEWER),
}


@dataclass(frozen=True)
class Recommendation:
    complexity: ComplexityTier
    complexity_points: int
    complexity_rationale: tuple[str, ...]
    consequence: Consequence
    consequence_rationale: tuple[str, ...]


def recommend(intake: Intake, service: ServiceSpec) -> Recommendation:
    points = 0
    why: list[str] = []
    if intake.value_at_stake_chf >= VERY_LARGE_VALUE_CHF:
        points += 2
        why.append(f"+2 value at stake CHF {intake.value_at_stake_chf:,.0f}")
    elif intake.value_at_stake_chf >= LARGE_VALUE_CHF:
        points += 1
        why.append(f"+1 value at stake CHF {intake.value_at_stake_chf:,.0f}")
    if intake.duration_years >= LONG_TERM_YEARS:
        points += 1
        why.append(f"+1 multi-year ({intake.duration_years:g} years)")
    if intake.cross_border:
        points += 1
        why.append("+1 cross-border")
    if intake.bespoke:
        points += 1
        why.append("+1 bespoke terms or novel issues")
    if points <= 1:
        tier = ComplexityTier.TIER1
    elif points <= 4:
        tier = ComplexityTier.TIER2
    else:
        tier = ComplexityTier.TIER3
    why.append(f"{points} point{'' if points == 1 else 's'}: {tier.label}")

    consequence = intake.reliance
    c_why = [f"client relies on it for {_words(intake.reliance)}"]
    if consequence.rank < service.min_consequence.rank:
        consequence = service.min_consequence
        c_why.append(f"raised to {_words(consequence)}, the minimum for {service.name.lower()}")
    return Recommendation(tier, points, tuple(why), consequence, tuple(c_why))


@dataclass(frozen=True)
class ReviewAssessment:
    policy: ReviewPolicy
    rationale: tuple[str, ...]


def review_policy(
    consequence: Consequence, complexity: ComplexityTier, intake: Intake, pack: PolicyPack
) -> ReviewAssessment:
    base = {
        Consequence.INTERNAL_USE: ReviewLevel.STANDARD,
        Consequence.EXTERNAL_RELIANCE: ReviewLevel.ELEVATED,
        Consequence.REGULATORY: ReviewLevel.CRITICAL,
    }[consequence]
    idx = LEVELS.index(base)
    why = [f"{base.value} for {_words(consequence)}"]
    if intake.client_importance == "key" or complexity is ComplexityTier.TIER3:
        reason = "key client" if intake.client_importance == "key" else "Tier 3 complexity"
        if idx < len(LEVELS) - 1:
            idx += 1
            why.append(f"one step stricter for {reason}, at KPMG's cost, not the client's")
    if idx < LEVELS.index(pack.min_review_level):
        idx = LEVELS.index(pack.min_review_level)
        why.append(f"department minimum: {pack.min_review_level.value}")
    level = LEVELS[idx]
    why.append(f"review level: {level.value}")
    return ReviewAssessment(POLICIES[level], tuple(why))


def final_signer_slots(consequence: Consequence, pack: PolicyPack) -> tuple[Slot, ...]:
    return pack.signature_slots.get(consequence, DEFAULT_SIGNATURE_SLOTS[consequence])


def _words(c: Consequence) -> str:
    return c.value.replace("_", " ")
