# ADR 2: Blind first pass with commit and reveal

**Status:** accepted

## Context

If a junior sees the AI's risk list first, they anchor on it, and the firm loses both the independent check and the junior's training. "Please think first" in a UI is easy to skip. The jury raised exactly this: juniors using AI to skip the work.

## Decision

In human-led blind milestones the AI runs as usual, but its list goes into a sealed vault. The ledger receives only a commitment, `sha256(salt || canonical list)`, and the item count. The service refuses decisions on the milestone until the assigned reviewer submits their own findings. On submission it reads the vault, recomputes the commitment, refuses if it differs, and appends the reveal event with the list and salt.

## Consequences

- The junior cannot see the list early: it is not in any readable state, view or ledger event.
- Nobody can swap the AI's list after seeing the junior's answer; anyone can recheck the commitment from the reveal.
- Matching the two lists by risk-taxonomy code makes the gap exact and explainable: AI-only codes become learning points for the junior, human-only codes go back to the model team.
- Free-text findings without a code are recorded but not matched.
