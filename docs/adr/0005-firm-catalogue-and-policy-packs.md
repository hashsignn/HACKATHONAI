# ADR 5: A firm-wide service catalogue with policy packs

**Status:** accepted

## Context

The billable-hour problem hits every department, but each has different services and different rules: audit independence, reliance by lenders on due diligence, regulatory filings in tax. Building one tool per department would fragment the record and the price logic; one tool with the rules in people's heads would eventually sell something it must not.

## Decision

Departments, services, milestones and lanes are **configuration** (`config/catalogue/*.toml`), loaded and validated at start-up. Each department carries a **policy pack**: the commercial options it may sell, minimum review level, maximum share of fees at risk, who signs per consequence, and the rationale shown to users. **Guardrails** (`domain/guardrails.py`) evaluate a policy pack against a proposed sale at three points: when a quote is built, when an engagement opens and when pricing is confirmed.

## Consequences

- A new service line is a configuration change plus prices; the engine, ledger, signatures and invoice apply unchanged.
- Forbidden combinations (an outcome fee for an audit client, an outcome-linked due-diligence report) cannot reach a client, and the refusal says why in plain words.
- The department catalogue document is generated from the same files, and a test fails if it drifts.
- Real independence clearance is richer than an "audit client" flag; production integrates with the firm's clearance system.
