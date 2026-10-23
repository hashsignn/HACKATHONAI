# ADR 3: Planted checks to detect rubber-stamping

**Status:** accepted

## Context

Requiring a click per item does not show that anyone read the item. The firm needs evidence that a reviewer checked the source, without reviewing every reviewer.

## Decision

Depending on the review level, the platform mixes plausible but false findings from a curated library into the AI's output, at a seeded random position, in the same schema as real items. Which items are planted is committed to (hash of ids and salt) when the milestone starts and revealed at the first signature attempt. A planted check that was rejected is "caught". One that was approved or rewritten is "missed": the signature is blocked and the milestone escalates to the manager, who reviews and signs instead.

## Consequences

- Rubber-stamping becomes detectable and costly at the moment it happens, not in a later audit.
- Staff should know planted checks exist (published policy), but not where. The UI says only that signing reveals whether the step held one.
- Library items must rotate, or reviewers will learn them.
- Planted items are excluded from client-facing counts and from the blind-pass gap, and reported separately.
- Outcomes feed the reviewer record. Under the Swiss FADP this is personal data and needs a clear purpose and employee information.
