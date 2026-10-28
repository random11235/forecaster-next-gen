# Design docs

The Forecaster tells an engineering manager (EM) when a milestone will finish. It runs a Monte Carlo simulation over the team's measured pace and the growth of its epics, and runs locally from one command. v1 is for a single team; its spec is [issue #6](https://github.com/random11235/forecaster-next-gen/issues/6).

Read [`architecture.md`](architecture.md) first, then the doc for the module you're changing.

## Contents

| Doc | What it covers |
|---|---|
| [`architecture.md`](architecture.md) | The system as a whole: v1 assumptions, principles, folder structure, dependency rules, test seams, language choice, security, and what is deferred beyond v1. |
| [`engine.md`](engine.md) | `engine/` (Seam A): the `simulateCase` contract, one trial, the swappable samplers, and what the engine reports when data is thin. |
| [`forecast-model.md`](forecast-model.md) | `samples/` and `forecast/` (Seam B's logic): the facts, derived samples, settings and calibration ledger, with the rules for committing, pull-backs and growth. |
| [`frontend-essentials.md`](frontend-essentials.md) | The screens: what each shows and why. |

## Elsewhere in `docs/`

- [`../adr/`](../adr/): decisions, and why they were made.
- [`../research/`](../research/): the evidence behind the decisions.
- [`../agents/`](../agents/): how agents work in this repo: tickets, triage labels, domain docs, demos.
- [`../demos/`](../demos/): screenshots that tickets ship in their PRs.
- [`redesign-1b/`](redesign-1b/): UI prototypes for the screens' look.

## Where terms live

[`GLOSSARY.md`](../../GLOSSARY.md) says what a term means. The design docs give the rules and the reasons.
