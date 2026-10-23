# ADR 1: One hash-chained event ledger as the source of truth

**Status:** accepted

## Context

The same facts (what the AI proposed, what a person decided and why, who signed) must drive three things: the invoice, the client's audit trail and staff evaluation. If each kept its own tables, they would drift, and any one of them could be disputed. The record also has to be credible as evidence to a client.

## Decision

Every state change is an immutable event appended to a per-engagement chain. Each event stores the hash of the previous one; its own hash covers its position, type, actor, timestamp, payload and that link. The database rejects `UPDATE` and `DELETE` with triggers. Writers pass the history length they decided on, so concurrent commands fail instead of interleaving. State, invoice, trail and reviewer record are projections folded from the events.

## Consequences

- Edits through the application are impossible; edits around it are detected by `verify`, which names the first altered event.
- Signatures include the ledger head, so a signature commits to the whole history before it.
- "Undo" is a new event (e.g. a changed decision), never a rewrite. History is complete by construction.
- Projections are rebuilt per request in the prototype; production would materialise them.
- A chain proves internal consistency, not that the operator did not regenerate everything. Anchoring the head hash in each client deliverable closes that gap.
