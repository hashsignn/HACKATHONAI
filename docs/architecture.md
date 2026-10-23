# Architecture

## Design goals

1. **No AI output counts until a named person has decided on it.** The platform, not the model or the UI, enforces this.
2. **One record serves billing, the client and staff evaluation.** If these were three systems, they would drift apart and each could be argued with.
3. **The record is evidence.** Anyone holding a copy can check that nothing was edited after the fact, and who signed what.
4. **The model is replaceable.** Swapping the AI backend must not weaken any human-review gate.

## Layers

| Layer | Responsibility | Depends on |
|---|---|---|
| `domain` | Vocabulary (roles, lanes, routes, decisions), review policy, workflow templates, event types | nothing |
| `ledger` | Hash-chained append-only event store, sealed vault, commitments, signatures | `domain` |
| `ai` | Provider port, scripted provider, planted-check library | `domain` |
| `services` | Commands: load state, check rules, append events | all of the above |
| `projections` | Read models folded from events: state, invoice, client trail, reviewer record, gap analysis | `domain`, `ledger` |
| `api` | HTTP, identity stand-in, read permissions, JSON views | `services`, `projections` |
| `web` | Console; offers only the actions the server would accept | `api` |

`bootstrap.py` is the composition root: the only place concrete adapters (SQLite store, scripted provider, dev keyring) are chosen.

## The flow of one milestone

```mermaid
sequenceDiagram
  actor Junior
  participant S as Service
  participant AI as AI provider
  participant V as Sealed vault
  participant L as Ledger
  Junior->>S: start M3 (risk screening)
  S->>AI: propose(M3, context)
  AI-->>S: drafts with confidence
  S->>S: mix in planted check, assign ids, route
  S->>V: store AI list + salt; store planted-check ids + salt
  S->>L: milestone_started (check commitment), proposals_sealed (list commitment)
  Junior->>S: submit own risks
  S->>V: read list, recompute commitment, must match
  S->>L: blind_assessment_submitted, proposals_revealed (list + salt)
  loop each item
    Junior->>S: approve / reject with reason
    S->>L: item_decided
  end
  Junior->>S: sign
  S->>V: read planted-check ids, verify commitment
  S->>L: controls_evaluated (reveal)
  alt check caught
    S->>L: milestone_signed (Ed25519 over digest incl. ledger head)
  else check approved
    S->>L: milestone_escalated (manager must review and sign)
  end
```

## Event catalogue

| Event | Written when | Key fields |
|---|---|---|
| `engagement_opened` | intake submitted | intake, review level and rationale, team, tier, rate-card version, contract digest |
| `milestone_started` | AI run for a step | provider and version, commitment to planted-check ids |
| `proposals_generated` | non-blind lanes | items with id, route, confidence, clause |
| `proposals_sealed` | blind lane | item count, commitment only |
| `blind_assessment_submitted` | reviewer's own risks | findings with risk codes |
| `proposals_revealed` | right after the blind pass | items and salt, so the commitment can be rechecked |
| `item_decided` | each human decision | action, reason code/text, evidence, revision, latency |
| `controls_evaluated` | first signature attempt | planted-check ids, salt, caught or missed |
| `milestone_escalated` | a planted check was approved | required role |
| `priorities_set` | manager ranks the asks | must-have, trade-off, nice-to-have |
| `milestone_signed` | each signature | signer, role, digest, signature, key id |
| `engagement_released` | final report signed | signer, digest over all milestone signatures |
| `engagement_stopped` | client go/no-go | reason |

Each stored event also carries `n` (position in the engagement), actor, timestamp, `prev_hash` and `hash = sha256(canonical JSON of all of these)`.

## Rules and where they are enforced

| Rule | Enforced in | Test |
|---|---|---|
| History cannot be edited or deleted | SQLite triggers | `test_ledger.py::test_database_refuses_to_rewrite_history` |
| Edits that bypass the triggers are detected and located | `EventStore.verify` | `test_ledger.py::test_tampering_that_bypasses_the_triggers_is_detected_and_located` |
| Concurrent writers cannot interleave | expected-length check + unique `(engagement, n)` | `test_ledger.py::test_stale_writer_is_rejected` |
| Review level follows published rules | `domain/policy.py` | `test_policy.py` |
| Low-confidence AI items and a random sample go to a person | `EngagementService._route` | `test_decisions.py::test_low_confidence_items_route_to_a_person` |
| Rejections and rewrites need a reason | `Decision` validator | `test_decisions.py::test_reject_and_edit_need_a_reason` |
| AI list sealed until the blind pass; reveal must match the commitment | `submit_blind_assessment`, `decide` | `test_blind_pass.py` |
| Planted checks look like every other item | views carry no check flag before reveal | `test_controls.py::test_control_is_indistinguishable_before_signing` |
| Approving a planted check escalates to the manager | `sign_milestone` | `test_controls.py::test_rubber_stamping_escalates_to_the_manager` |
| Steps run in order; nothing is signed with open items | `start_milestone`, `sign_milestone` | `test_decisions.py` |
| Signatures are by the assigned person and verify | `sign_milestone`, `DevKeyring` | `test_decisions.py::test_signature_is_by_name_and_verifies` |
| Only signed milestones are billable; price locked at opening | `build_invoice` | `test_billing.py` |
| Client can stop after any signed step | `stop` | `test_billing.py::test_client_can_stop_and_pays_only_for_signed_steps` |
| Same inputs give the same record | deterministic routing, seeded placement | `test_ledger.py::test_same_inputs_give_the_same_record` |

## Who can see what

| Reader | Working view | Client trail and invoice | Raw ledger | Reviewer record |
|---|---|---|---|---|
| Junior on the team | yes | yes | no | own only |
| Manager or partner on the team | yes | yes | yes | yes |
| Client on the team | no | yes | no | no |
| Quality & Risk | yes | yes | yes | yes |

No reader, including Quality & Risk, can see a sealed AI list or which item is a planted check before its reveal event: that information is not in the ledger until then.

## Path to production

| Prototype | Production |
|---|---|
| `ScriptedProvider` | `ContractAgentAdapter` bound to the firm's contract-AI agent and benchmark database inside its private environment |
| `X-User` header | SSO (OIDC) with the same role model |
| `DevKeyring` | Keys in PKI/HSM, or a qualified e-signature service (Swiss ZertES) |
| SQLite | Postgres with the same triggers and chain; chain head anchored in each client deliverable |
| State rebuilt per request | Materialised projections, rebuilt from events when they change |
| One workflow template | A template per service line (NDA triage, lease review, financial due diligence) |
