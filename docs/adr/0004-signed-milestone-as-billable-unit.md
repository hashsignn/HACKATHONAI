# ADR 4: The signed milestone is the billable unit

**Status:** accepted

## Context

KPMG Challenge 3 asks what to bill when AI agents do much of the work. Hours shrink as the AI improves. Outcome fees create bias and independence problems. Per-token or per-document pricing bills the AI, which the client could buy elsewhere.

## Decision

The client pays for **signed milestones**: a step of the engagement in which a named person decided on every AI proposal that needed it and signed the result. Each milestone has a published base rate; the review level adds a published multiplier; the engagement is locked to the rate-card version at opening. Unsigned work is never billable. The client may stop after any signed milestone.

## Consequences

- Revenue tracks delivered, accountable judgment rather than time or tokens; efficiency gains raise margin instead of cutting revenue.
- Every invoice line references a signature digest and ledger position, so billing disputes resolve against the record.
- Pricing needs calibration per workflow template (see [pricing](../pricing.md)), and a change-order mechanism for scope growth (roadmap).
- Bespoke work that does not decompose into milestones stays hourly (Classic tier).
