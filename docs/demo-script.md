# Live demo script (about 3 minutes)

Start the console seeded just before the blind pass:

```bash
make serve          # http://localhost:8000
```

Use **Demo → Reset to stage** to rehearse any part again. Stages: intake done, extraction signed, benchmark signed, risk screening with the AI list sealed, risk screening signed, redlines signed, priorities signed, report released.

## 1. Where we are (20 s)

*Acting as Lea Brunner (junior).*

- Left rail: five milestones, each with a lane saying who leads. Two are signed and already on the invoice (CHF 600 and CHF 1,200).
- Click **Intake**: the review level came from published rules (key client, multi-year term: elevated). Elevated means 80% confidence threshold, 20% spot checks, one planted check, manager signs the final report.

## 2. The blind first pass (45 s)

Click **Risk screening**.

- "The AI's list is sealed. Its fingerprint is already on the record, so it cannot change after Lea answers."
- Enter two risks: **403** discretionary price changes, **306** no acceptance inspection. Submit.
- The gap panel appears: both found 403 and 306; **only the AI found 401 (hold-up) and 208 (counterparty credit)**. That gap is Lea's learning record.

## 3. Judgment, with reasons (45 s)

- Approve the four real risks.
- On **"Supplier can exit on 30 days' notice"**: open the contract, clause 14.2 says 180 days. **Reject → Not in the contract**, add the clause.
- Click **Sign M3 as Lea Brunner**. The seal stamps in, and the panel says the planted check was caught. The invoice adds CHF 2,400.

Optional contrast: reset to "risk screening, AI list sealed", approve everything, sign. The signature is blocked and the step escalates to Marco Rossi.

## 4. The three readers of one record (45 s)

- **Acting as Alpina Pumps AG (client)**: the one-page trail. Two low-confidence items resolved by a person, one AI finding rejected with a reason, one planted check caught, signatures verified, chain verifies.
- **Acting as Quality & Risk**: Lea's record. 100% of decisions with a reason, planted check 1 of 1, blind-pass recall 50%. No single score, by design. Raw ledger: each event carries the previous hash.
- Point at the invoice: "Full review quoted at CHF 7,200. Billed hourly before AI: CHF 10,000. The client pays 28% less, and every franc points to a signature."

## 5. If asked "can't someone edit the database?"

In a terminal: `make demo`. The last block changes who made one past decision and shows the chain failing at exactly that event.
