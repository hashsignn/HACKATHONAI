"""Step 0: turn the intake questionnaire into a review level, transparently.

The rules are deliberately simple and printed back to the user as a rationale, so
nobody has to trust a hidden score. Each level fixes the intensity of human review:
the confidence threshold below which AI output must be checked by a person, the
share of confident output that is spot-checked anyway, how many planted control
items the engagement carries, and who signs. (What a level *costs* is commercial,
so it lives in the rate card, not here.)
"""

from __future__ import annotations

from dataclasses import dataclass

from .models import Intake, ReviewLevel, Role


@dataclass(frozen=True)
class ReviewPolicy:
    level: ReviewLevel
    confidence_threshold: float  # AI items below this go to a person
    spot_check_rate: float  # share of confident AI items sampled for a person anyway
    controls_per_engagement: int  # planted control items mixed into AI output
    final_signer: Role
    manager_countersigns_milestones: bool


POLICIES: dict[ReviewLevel, ReviewPolicy] = {
    ReviewLevel.STANDARD: ReviewPolicy(ReviewLevel.STANDARD, 0.70, 0.10, 0, Role.MANAGER, False),
    ReviewLevel.ELEVATED: ReviewPolicy(ReviewLevel.ELEVATED, 0.80, 0.20, 1, Role.MANAGER, False),
    ReviewLevel.CRITICAL: ReviewPolicy(ReviewLevel.CRITICAL, 0.90, 0.50, 2, Role.PARTNER, True),
}

LARGE_DEAL_CHF = 10_000_000
LONG_TERM_YEARS = 3


@dataclass(frozen=True)
class PolicyAssessment:
    policy: ReviewPolicy
    points: int
    rationale: tuple[str, ...]


def assess(intake: Intake) -> PolicyAssessment:
    points = 0
    rationale: list[str] = []
    if intake.client_importance == "key":
        points += 1
        rationale.append("+1 key client")
    if intake.term_years >= LONG_TERM_YEARS:
        points += 1
        rationale.append(f"+1 multi-year term ({intake.term_years:g} years)")
    if intake.annual_value_chf >= LARGE_DEAL_CHF:
        points += 1
        rationale.append(f"+1 large deal (CHF {intake.annual_value_chf:,.0f} per year)")

    if points == 0:
        level = ReviewLevel.STANDARD
    elif points <= 2:
        level = ReviewLevel.ELEVATED
    else:
        level = ReviewLevel.CRITICAL
    rationale.append(f"{points} point{'' if points == 1 else 's'} in total: {level.value} review")
    return PolicyAssessment(policy=POLICIES[level], points=points, rationale=tuple(rationale))
