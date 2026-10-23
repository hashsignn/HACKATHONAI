# Pricing: the convergence model

Every department converges on one billable unit: a **deliverable**, priced in two lines.

| Line | Pays for | Priced by | Billed |
|---|---|---|---|
| **Judgment** | What people reviewed, challenged, changed and added. The AI's research and drafting are included. | Complexity tier (1, 2, 3) | Milestone by milestone, as each is signed, by its published weight |
| **Signature** | A named person signs; KPMG carries the liability | Consequence of error (internal use, external reliance, regulatory) | Once, when the deliverable is signed |

## Why two lines

- **Judgment** shrinks as AI does more of the preparation, and it should: that is where clients expect to share the efficiency gain.
- **Signature** does not shrink with AI. Liability and professional accountability are what a client cannot get from a tool, so they keep their value, and they are priced by how bad an error would be, not by effort.
- Splitting them makes both visible: the client sees what judgment cost and what the firm's guarantee cost.

## The problem in numbers (Alpina, illustrative)

| | Hours | Revenue | Cost | Margin |
|---|---|---|---|---|
| Before AI, hourly | 40 h × CHF 250 | 10,000 | 40 h × CHF 120 = 4,800 | 5,200 (52%) |
| With AI, still hourly | 12 h × CHF 250 | 3,000 | 1,440 + ~300 AI = 1,740 | 1,260 |
| With AI, Judgment + Signature | 12 h | **7,200** | 1,740 | **5,460 (76%)** |

The client pays 28% less than before AI; KPMG keeps slightly more profit in francs, and the freed hours serve another client. The tax opinion in our deck works the same way: 184 hours at CHF 51,800 becomes Judgment CHF 24,500 plus Signature CHF 12,000, CHF 36,500 for about 45 human hours.

## How Alpina's invoice builds up

Judgment Tier 2 is CHF 5,700, earned by milestone weight; Signature (internal use) is CHF 1,500.

| Step | Weight | Earned | Signed by |
|---|---|---|---|
| M1 Key-term extraction | 10% | 570 | Lea Brunner |
| M2 Benchmark against market | 15% | 855 | Lea Brunner |
| M3 Risk screening (blind) | 35% | 1,995 | Lea Brunner |
| M4 Proposed redlines | 25% | 1,425 | Lea Brunner |
| M5 Negotiation priorities | 15% | 855 | Marco Rossi |
| **Signature**, internal use | | 1,500 | Marco Rossi |
| **Total** | | **7,200** | |

The human-judgment steps carry the largest weights. If the client stops after M2, it pays CHF 1,425 and no Signature line.

## Who sets the tiers

1. **The platform recommends**, from published rules applied to the intake:
   - *Complexity points:* +1 value at stake ≥ CHF 1m (+2 at ≥ CHF 25m), +1 multi-year, +1 cross-border, +1 bespoke. 0–1 points Tier 1, 2–4 Tier 2, 5+ Tier 3.
   - *Consequence:* who relies on the deliverable, raised to the service's minimum (a tax return is always regulatory).
2. **A named manager or partner confirms**, or overrides with a written reason. The quote, with the price-list version, is locked into the ledger. The invoice is built from that locked quote, never from today's price list.
3. **Client importance never changes the price.** A key client gets stricter review, at KPMG's cost.
4. **Quality & Risk sees every override** in the reviewer record, which is the check on pricing bias.

## Commercial options

All are variations on the same two lines. Each department's policy pack decides what it may sell, and the platform refuses the rest (see [departments.md](departments.md)).

| Option | Mechanics |
|---|---|
| Per deliverable | Judgment + Signature |
| Retainer | 12 deliverables a year at 15% off; each deliverable draws a credit and is still signed milestone by milestone |
| Client platform | The client's team prepares in KPMG's AI; KPMG reviews and signs. Judgment × 0.55, plus an annual licence. Never for audit clients. |
| Fees at risk | See below |
| Engagement fee | Audit: a fixed fee agreed upfront that does not vary with findings. The two lines are KPMG's internal build-up of that fee. |
| Classic | Hourly from timesheets, outside the platform, for clients who prefer it |

## Fees at risk (baseline outcomes)

For work whose value is a measurable improvement (Consulting, M&A lead advisory), part of the fee can depend on the result:

- **Only the Judgment line**, and at most 20% of it. The **Signature line is never at risk**: a signed opinion must not depend on the outcome it opines on.
- A **KPI with a measured baseline**, a **threshold** where payment starts and a **target** where it is complete, agreed at pricing and measured from the **client's own data**.
- Payment **ramps linearly** between threshold and target, rather than an all-or-nothing cliff, and is **capped** at the at-risk amount. (Setting threshold = target is possible and gives a trigger, but invites disputes near the line.)
- **Blocked by the platform:** any audit client (independence), all of Audit, and reports others rely on, such as financial due diligence for lenders.

Example: an operating-model diagnostic, Judgment Tier 2 CHF 52,000, 15% at risk (CHF 7,800) on order-to-cash cycle time, baseline 62 days, payment from 55 days, full at 45 days. Measured at 50 days: half the at-risk amount, CHF 3,900, is paid.

## How the prices are set

Each service has, per tier, the **historical fee** and **reference hours** from billing and timesheet history. The pricing committee anchors Judgment on that history, passes a share of the efficiency gain to the client, and weights milestones towards the human-judgment steps. Signature prices are set per department by consequence, with service overrides where the liability differs (a routine tax filing versus an opinion relied on by a bank). Each price-list version is published; engagements stay on the version they were confirmed with.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Scope grows and the fixed Judgment line loses money | A change order priced from the same price list, confirmed like the original (roadmap) |
| A small deliverable with a heavy Signature costs more than hourly | Shown openly in the quote builder; the Signature reflects liability that hourly billing underpriced |
| Prices drift from real effort | Recalibrate each price-list version from the decision record's own timing data |
| Outcome disputes | Objective KPI, client's own data, ramp instead of cliff, cap, Signature never at risk |
