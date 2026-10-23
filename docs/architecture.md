# Architecture

## Design goals

1. **No AI output counts until a named person has decided on it.** The platform, not the model or the UI, enforces this.
2. **One unit and one engine for the whole firm.** A new service line is configuration (a catalogue entry, prices, a policy pack), not new code.
3. **One record serves billing, the client and staff evaluation.** If these were three systems, they would drift apart and each could be argued with.
4. **The record is evidence.** Anyone holding a copy can check that nothing was edited after the fact, and who signed what.
5. **Forbidden combinations cannot be sold.** Independence and reliance rules are enforced where quotes are built, not remembered by people.
6. **The model is replaceable.** Swapping a department's AI backend must not weaken any human-review gate.

## Layers

| Layer | Responsibility | Depends on |
|---|---|---|
| `config` | Service catalogue (one TOML per department), price list, people | nothing |
| `domain` | Vocabulary; catalogue loader; policy (tiers, review intensity, signers); guardrails; pricing; event types | nothing |
| `ledger` | Hash-chained append-only event store, sealed vault, commitments, signatures | `domain` |
| `ai` | Provider port, scripted provider, planted-check library | `domain` |
| `services` | Commands: load state, check rules, append events | all of the above |
| `projections` | Read models folded from events: state, two-line invoice, client trail, reviewer record, gap analysis | `domain`, `ledger` |
| `api` | HTTP, identity stand-in, read permissions, JSON views, quote endpoint | `services`, `projections` |
| `web` | Console: Engagement view and Firm view | `api` |

`bootstrap.py` is the composition root: the only place concrete adapters (SQLite store, providers, dev keyring) are chosen. It refuses to start if any catalogue service lacks a published price.

## Firm-wide configuration

```
config/catalogue/<department>.toml
  [department]   name, summary
  [policy]       options it may sell, minimum review level, max share at risk,
                 who signs per consequence, rationale shown to users
  [[services]]   name, deliverable, minimum consequence, outcome-linked allowed?
    [[milestones]]  key, title, lane, lead slot, weight of the Judgment line
config/price_list.toml
  per department: Signature by consequence, platform licence
  per service:    Judgment by tier, historical fee and reference hours by tier, optional Signature override
```

Six departments ship today: Audit & Assurance, Tax, Legal, Deal Advisory, Consulting, Risk & ESG ([departments.md](departments.md), generated from these files).

## Lifecycle of one engagement

```mermaid
sequenceDiagram
  actor Manager
  actor Junior
  actor Signer
  participant S as Service
  participant L as Ledger
  Manager->>S: open (intake)
  S->>S: recommend tiers; guardrails
  S->>L: engagement_opened (recommendation + reasons)
  Manager->>S: confirm pricing (or override with reason)
  S->>S: guardrails; quote; review level; signers by consequence
  S->>L: pricing_confirmed (quote locked)
  loop each milestone, in order
    Junior->>S: run AI, blind pass, decide with reasons, sign
    S->>L: milestone events + milestone_signed  (Judgment earned by weight)
  end
  Signer->>S: sign deliverable (one or two signers)
  S->>L: deliverable_signed, deliverable_released  (Signature billed)
```

## The blind pass and planted checks inside one milestone

```mermaid
sequenceDiagram
  actor Junior
  participant S as Service
  participant AI as AI provider
  participant V as Sealed vault
  participant L as Ledger
  Junior->>S: start milestone
  S->>AI: propose(service, milestone, context)
  AI-->>S: drafts with confidence
  S->>S: mix in planted check, assign ids, route by confidence
  S->>V: AI list + salt; planted-check ids + salt
  S->>L: milestone_started (check commitment), proposals_sealed (list commitment)
  Junior->>S: own findings
  S->>V: recompute commitment; must match
  S->>L: blind_assessment_submitted, proposals_revealed
  Junior->>S: decisions with reasons
  Junior->>S: sign
  S->>L: controls_evaluated (reveal)
  alt check caught
    S->>L: milestone_signed
  else check approved
    S->>L: milestone_escalated (manager reviews and signs)
  end
```

## Event catalogue

| Event | Written when | Key fields |
|---|---|---|
| `engagement_opened` | intake | service, intake, requested option, recommended tiers with reasons, team slots, document digest |
| `pricing_confirmed` | manager or partner confirms | tiers, option, fees at risk, overrides and reason, review level, final signers, **locked quote** |
| `milestone_started` | AI run for a step | provider and version, commitment to planted-check ids |
| `proposals_generated` / `proposals_sealed` | AI output recorded / sealed (blind lane) | items, or count and commitment |
| `blind_assessment_submitted`, `proposals_revealed` | reviewer's own findings, then the reveal | findings; items and salt |
| `item_decided` | each human decision | action, reason code/text, evidence, revision, latency |
| `controls_evaluated`, `milestone_escalated` | first signature attempt | planted-check ids, salt, outcome; required slot |
| `conclusions_recorded` | human-led step | ranked conclusions (e.g. negotiation asks) |
| `milestone_signed` | each milestone signature | signer, slot, role, digest, signature, key id |
| `deliverable_signed`, `deliverable_released` | the Signature line | signer, slot, digest over every milestone signature and the locked price |
| `outcome_measured` | fees at risk settled | measured value, evidence, payout ratio |
| `engagement_stopped` | client go/no-go | reason |

Each stored event also carries `n`, actor, timestamp, `prev_hash` and `hash = sha256(canonical JSON of all of these)`.

## Rules and where they are enforced

| Rule | Enforced in | Test |
|---|---|---|
| History cannot be edited; edits around the database are detected and located | SQLite triggers; `EventStore.verify` | `test_ledger.py` |
| Concurrent writers cannot interleave | expected-length check + unique `(engagement, n)` | `test_ledger.py::test_stale_writer_is_rejected` |
| Every service is well-formed and priced; docs match config | catalogue loader; start-up check | `test_catalogue.py` |
| Tiers, review level and signers follow published rules; importance never raises price | `domain/policy.py` | `test_policy.py` |
| Forbidden combinations are refused (independence, reliance, caps) | `domain/guardrails.py`, at quote, open and confirmation | `test_guardrails.py`, `test_lifecycle.py` |
| Two lines priced from the price list; fees-at-risk ramp | `domain/pricing.py`, `AtRisk` | `test_pricing.py` |
| A named manager confirms pricing; overrides need a reason; the quote is locked | `confirm_pricing` | `test_lifecycle.py` |
| No work before pricing; steps in order; nothing signed with open items | `start_milestone`, `sign_milestone` | `test_decisions.py`, `test_lifecycle.py` |
| Only certified staff lead and sign AI-assisted work | `_check_team`, `sign_milestone` | `test_lifecycle.py::test_uncertified_juniors_cannot_lead_ai_assisted_work` |
| Low-confidence items and a sample go to a person; reasons for rejections | `_route`, `Decision` | `test_decisions.py` |
| AI list sealed until the blind pass; reveal matches commitment | `submit_blind_assessment` | `test_blind_pass.py` |
| Planted checks are indistinguishable; approving one escalates | views; `sign_milestone` | `test_controls.py` |
| Deliverable signed by the slots its consequence requires (two partners for regulatory) | `sign_deliverable` | `test_lifecycle.py::test_regulatory_deliverables_need_two_partners` |
| Judgment earned per signed milestone; Signature on release; stop pays signed share only; at-risk settled from measured data | `build_invoice`, `record_outcome` | `test_billing.py` |
| Every service in every department runs end to end | all of the above | `test_lifecycle.py::test_every_department_runs_end_to_end` |

## Who can see what

| Reader | Working view | Client trail and invoice | Raw ledger | Reviewer record | Catalogue and quotes |
|---|---|---|---|---|---|
| Junior on the team | yes | yes | no | own only | yes |
| Manager or partner on the team | yes | yes | yes | yes | yes |
| Client on the team | no | yes | no | no | no |
| Quality & Risk | yes | yes | yes | yes | yes |

No reader can see a sealed AI list or which item is a planted check before its reveal event: that information is not in the ledger until then.

## Path to production

| Prototype | Production |
|---|---|
| `ScriptedProvider` for Legal | `FirmAgentAdapter` bound per department to the firm's agents and benchmark databases, inside its private environment |
| `X-User` header | SSO (OIDC); certifications from the learning system |
| `DevKeyring` | Keys in PKI/HSM, or a qualified e-signature service (Swiss ZertES) |
| SQLite | Postgres with the same triggers and chain; chain head anchored in each client deliverable |
| Simplified independence flag | Integration with the firm's independence clearance system |
| State rebuilt per request | Materialised projections, rebuilt from events when they change |
