# Pricing: the signed milestone as the billable unit

## The problem in numbers (Alpina case, illustrative)

| | Hours | Revenue | Cost | Margin |
|---|---|---|---|---|
| Before AI, hourly | 40 h × CHF 250 | 10,000 | 40 h × CHF 120 = 4,800 | 5,200 (52%) |
| With AI, still hourly | 12 h × CHF 250 | 3,000 | 1,440 + ~300 AI = 1,740 | 1,260 |
| With AI, per signed milestone | 12 h | **7,200** | 1,740 | **5,460 (76%)** |

The client pays 28% less than before AI. KPMG keeps slightly more profit in francs, and the 28 freed hours serve another client.

## The formula

```
milestone price = published base rate × review-level multiplier
invoice         = sum over SIGNED milestones only
```

| Milestone | Lane | Base rate (CHF) | Reference hours before AI |
|---|---|---|---|
| M1 Key-term extraction | AI-led, spot-checked | 500 | 8 |
| M2 Benchmark | AI drafts, person confirms | 1,000 | 8 |
| M3 Risk screening | Human-led, blind first pass | 2,000 | 12 |
| M4 Redlines | AI drafts, person edits | 1,500 | 8 |
| M5 Negotiation priorities | Human-led (manager) | 1,000 | 4 |
| **Total** | | **6,000** | **40** |

Review level multiplier: standard 1.0, elevated 1.2, critical 1.5. Alpina is elevated (key client, multi-year term): 6,000 × 1.2 = **CHF 7,200**.

The human-led steps carry the highest rates. The price follows judgment, not AI output.

## How the rates are set

1. **Reference hours** come from the firm's historical timesheets for each task type (median, pre-AI).
2. The pricing committee anchors each rate on `reference hours × reference rate`, passes a share of the efficiency gain to the client, and weights the result towards the human-judgment steps.
3. Rates and multipliers are **published** in a versioned rate card. An engagement is priced on the version current when it opened; the invoice refuses any other version. Nobody sets a price case by case, which answers "who decides the price, and could it be biased?".

## The three tiers

| Tier | For | Billing | In this prototype |
|---|---|---|---|
| Classic | Clients wary of generative AI | Hourly, as today | Stays in the existing billing system |
| Assisted | Most engagements | Fixed price per signed milestone; client decides after each one whether to continue | Built |
| Agent-led | Repeat volume (e.g. all supplier contracts) | Annual subscription covering N engagements; each one draws a credit, still signed milestone by milestone | Built (credits) |

## Why not outcome-based fees

Outcome-based fees ("pay if the negotiation saves X") push the adviser to tell the client what it wants to hear, invite disputes about what success means, and run into auditor-independence rules for audit clients. Stage-gated fixed fees give the client control (stop after any signed step) without tying the fee to the answer.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Scope grows (missing annex, much longer contract) and the fixed fee loses money | Change order priced from the same rate card, approved by the manager and the client (roadmap) |
| Bespoke strategy work does not fit fixed steps | It stays in the Classic tier |
| Rates drift from real effort | Recalibrate each rate-card version from the decision record's own timing data |
