# ADR 4: Judgment plus Signature is the billable unit

**Status:** accepted (supersedes the first prototype's per-milestone rate card)

## Context

KPMG Challenge 3 asks what to bill when AI agents do much of the work. Hours shrink as the AI improves, in every department. Outcome fees create bias and independence problems. Per-token or per-document pricing bills the AI, which the client could buy elsewhere. The team's pitch converges on the "Signature model": a judgment fee and a signature fee per deliverable.

## Decision

Every deliverable is priced in two lines from a published price list:

- **Judgment**, a flat fee by complexity tier, with the AI's work included. It is earned milestone by milestone as each step is signed, by the milestone's published weight.
- **Signature**, priced by consequence of error, billed once when the person(s) the consequence requires sign the deliverable.

The quote is locked into the ledger when a named manager confirms the tiers. Unsigned work is never billable; the client can stop after any signed milestone.

## Consequences

- Revenue follows signed judgment and liability, not time or tokens; efficiency raises margin instead of cutting revenue.
- One unit works in every department; departments differ only in configuration (milestones, prices, policy pack).
- Every invoice line points at a signature digest and ledger position.
- A small deliverable with a heavy Signature can cost more than its hourly equivalent. The quote shows this openly.
- Bespoke work that does not decompose into milestones stays Classic (hourly).
