# Trust+ billing animation

A presenter-driven animation of how Trust+ calculates a fee, in under two minutes:

> **Fee = Σ (tasks × HAAS lane rate) + value-added fee** (every business except audit)

Open `billing/index.html` in a browser (no install, no internet), or run `python3 -m http.server 8080 -d billing`.

| # | Scene | What it shows |
|---|---|---|
| 0 | Intro | Black screen, the AI says hi, blue paint reveals the product |
| 1 | Why hours break | Hourly revenue collapses as AI cuts the hours |
| 2 | Project → tasks | A fictional bank's KYC backlog remediation split into 30 tasks |
| 3 | Tasks → HAAS lanes | Each task sorted into lane A (AI-led, ≈ CHF 1k), B (mixed, ≈ 3k) or C (human-led, ≈ 8k) |
| 4 | Layer 1 | Σ tasks × lane rate = CHF 85,000; the fee meter fills |
| 5 | Layer 2 | Objectives agreed up front, measured, then the 20% value-added fee is earned |
| 6 | Four businesses | Same formula; audit lowest, advisory highest; audit has no value fee |
| 7 | Invoice + decision record | What we did, what you gained, and the record that links them |
| 8 | Try it | Live calculator for Q&A, and the one-line summary |

Keys: → next (also performs the next click), ← back, `A` auto, `L` live, `R` restart, `S` sound, `F` fullscreen.

All names, task counts and figures are illustrative.
