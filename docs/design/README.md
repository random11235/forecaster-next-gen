# Design docs

The Forecaster tells an engineering manager (EM) when a milestone will finish. It runs a Monte Carlo simulation over the EM's pace (a range, or typed counts per period) and the range its ambiguity could grow the milestone by. v1 is for a single team. v1 ships two builds: a local server started with one command, and a browser build, one file sent to testers, that keeps each viewer's inputs in their own browser.

**The MVP comes first.** The MVP is what is built: one milestone per team, forecast from what the EM types in: its start date, tickets remaining and a pace (a range, or typed counts) per period of the team's cadence, grown by the range of its ambiguity. Where it overrides v1's design (epics, commits, pull-backs, blocked epics, per-epic ambiguity, team facts, workflow settings, measured pace and growth, sample data), each doc says so near its top and at the sections it sets aside.

Read [`architecture.md`](architecture.md) first, an index of the architecture's parts, then the doc for the module you're changing.

## Contents

| Doc                                                  | What it covers                                                                                                                                                                                                                                  |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`prd-v1.md`](prd-v1.md)                             | The product requirements for v1, for sharing its intent: problem, goals and non-goals, users, requirements, success metrics, risks. A copy of the [Claude Doc](https://claude.ai/artifact/9oT8Z1jUP5mGQa6v2KAkvn), which also has the diagrams. |
| [`architecture.md`](architecture.md)                 | The system as a whole: v1 assumptions, principles, folder structure, dependency rules, test seams, language choice, security, and what is deferred beyond v1.                                                                                   |
| [`engine.md`](engine.md)                             | `engine/` (Seam A): the `simulateCase` contract, one trial, the swappable samplers, and what the engine reports when data is thin.                                                                                                              |
| [`forecast-model.md`](forecast-model.md)             | `samples/` and `forecast/` (Seam B's logic): the settings and calibration ledger, with the rules for growth.                                                                                                                                    |
| [`forecast-model-facts.md`](forecast-model-facts.md) | The forecast model's facts and derived samples, with the rules for committing, pull-backs and blocked epics.                                                                                                                                    |
| [`frontend-essentials.md`](frontend-essentials.md)   | The screens: what each shows and why.                                                                                                                                                                                                           |

## Elsewhere in `docs/`

- [`../adr/`](../adr/): decisions, and why they were made.
- [`../research/`](../research/): the evidence behind the decisions.
- [`../agents/`](../agents/): how agents work in this repo: tickets, triage labels, domain docs, demos.
- [`../demos/`](../demos/): screenshots that tickets ship in their PRs.
- [`redesign-1b/`](redesign-1b/): UI prototypes for the screens' look.

## Where terms live

[`GLOSSARY.md`](../../GLOSSARY.md) says what a term means. The design docs give the rules and the reasons.
