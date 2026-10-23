# Countersign pitch showcase

A presenter-driven, animated walk through the Alpina / SinoGear contract review. It runs from the files alone, with no backend and no network, so a hackathon venue's wifi cannot break it.

```bash
open showcase/index.html     # or: make showcase, then http://localhost:8080
```

Violet is what the AI said. Ink blue is what a person decided.

## Modes

| Mode | How | What happens |
|---|---|---|
| Live (default) | `L` | Every human action waits for you. Click the pulsing element, or press → and the cursor does it. |
| Auto | `A`, or `index.html?auto` | A cursor performs the actions and scenes advance on their own, about 3 minutes end to end. |

Press → to start (it also unlocks sound). → next, ← back, `R` restart, `S` sound, `F` fullscreen. The dots in the top bar jump to any scene. A clicker that sends PageDown/PageUp works too.

URL options: `?scene=6` to open at a scene, `?mute`, `?autostart`.

## Scenes (target 3:20 with narration)

| # | Scene | What the jury sees |
|---|---|---|
| 0 | Intro | The AI crawls in, says hi, and spreads like ink into the product |
| 1 | Agent swarm | Five agents take in the email, data room, ERP export, roadmap and Annex C |
| 2 | Contract received | The structured contract with confidence scores; two terms flagged for a human |
| 3 | Price locked | Tier 2 recommended with reasons; Marco confirms; client importance never raises the price |
| 4 | Handoff to Lea | The AI's five-milestone plan; Lea adds her own check without changing the price |
| 5 | Lea at work | Spot-check and correct M1, confirm the M2 benchmark |
| 6 | Blind first pass | The AI's list stays sealed until Lea commits her own; then the diff |
| 7 | Planted check | A false AI finding; Lea checks clause 14.2 and rejects it |
| 8 | Bespoke edits | Lea rewrites the AI's redline with a reason; Marco orders the priorities |
| 9 | Milestones signed | Five signatures, each earning its share of the Judgment line |
| 10 | Deliverable signed | Marco signs; the Signature line and who signs by consequence |
| 11 | Done | The win |
| 12 | Pricing | Hourly before AI, hourly with AI, and Judgment + Signature |
| 13 | Client view | Alpina's one-page trail and the hash chain verifying |
| 14 | Whole firm | Six departments, nine services, one unit; closing line |

All figures come from the fixture and price list in this repository (illustrative, Tier 2, CHF).
