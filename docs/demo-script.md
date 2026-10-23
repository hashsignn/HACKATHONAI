# Live demo script (about 4 minutes)

```bash
make serve          # http://localhost:8000, Alpina seeded just before the blind pass
```

**Demo → Reset to stage** rewinds to any point: intake done, pricing confirmed, extraction signed, benchmark signed, risk screening with the AI list sealed, risk screening signed, redlines signed, priorities signed, deliverable signed.

## 1. One unit for the whole firm (40 s)

*Firm tab, acting as Dr. Anna Keller (partner).*

- The catalogue: six departments, nine services, each made of milestones with a lane saying who leads. Every price is Judgment plus Signature, shown against the old hourly fee.
- Quote builder: an operating-model diagnostic with 15% of Judgment at risk on order-to-cash days. The Signature line is never at risk.
- Tick **Audit client**: refused, "Independence: fees for an audit client may not depend on outcomes." Switch the service to **Financial due diligence** with an outcome-linked fee: refused, because lenders rely on it. The policy pack decides what may be sold.

## 2. Who decides the price (30 s)

*Reset to "Intake done, pricing not confirmed". Engagement tab, acting as Marco Rossi (manager).*

- Step 0 shows the intake and the platform's recommendation with its reasons: Tier 2 (value, multi-year, cross-border, bespoke) and internal use.
- "Client importance never raises the price. Alpina is a key client, so review is stricter, at KPMG's cost."
- **Confirm and lock the price.** The quote is now on the record with Marco's name: CHF 5,700 Judgment plus CHF 1,500 Signature.

## 3. The blind first pass (45 s)

*Reset to "Risk screening, AI list sealed". Acting as Lea Brunner (junior).*

- "The AI's list is sealed. Its fingerprint is already on the record, so it cannot change after Lea answers."
- Enter **403** discretionary price changes and **306** no acceptance inspection. Submit.
- The gap panel: both found 403 and 306; **only the AI found 401 (hold-up) and 208 (counterparty credit)**. That gap is Lea's learning record.

## 4. Judgment, with reasons, and the Judgment line (45 s)

- Approve the four real risks.
- On **"Supplier can exit on 30 days' notice"**: clause 14.2 says 180 days. **Reject → Not in the source.**
- **Sign M3.** The seal stamps in; the planted check was caught; the invoice adds CHF 1,995 (35% of Judgment).

Optional contrast: reset, approve everything, sign. The signature is blocked and the step escalates to Marco.

## 5. The Signature line and the three readers (60 s)

*Reset to "Priorities signed". Acting as Marco Rossi, open Signature, **Sign the deliverable**.*

- The Signature line is billed: CHF 7,200 in total against CHF 10,000 hourly. "Internal use, so the manager signs. Regulatory work needs a partner and a second partner."
- **Acting as Alpina Pumps AG (client):** the one-page trail. Who checked what, who signed, chain verifies.
- **Acting as Quality & Risk:** Lea's record (planted check 1 of 1, blind-pass recall 50%, 100% of decisions with a reason) and the raw ledger. No single score, by design.

## If asked "can't someone edit the database?"

`make demo` changes who made one past decision and shows the chain failing at exactly that event.
