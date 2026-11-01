# Design docs

The Forecaster tells an engineering manager (EM) when a milestone will finish. It runs a Monte Carlo simulation over the team's measured pace and the growth of its epics, v1 is for a single team; its spec is [issue #84](https://github.com/random11235/forecaster-next-gen/issues/84). v1 ships two builds: a local server started with one command, and a browser build, one page published for testers, that keeps each viewer's inputs in their own browser.

**The MVP comes first.** The MVP ([#84](https://github.com/random11235/forecaster-next-gen/issues/84)) is what is built: one milestone per team, forecast from what the EM types in: its start date, tickets remaining and a pace (a range, or typed counts) per period of the team's cadence, grown by the range of its ambiguity. Where it overrides v1's design (epics, commits, pull-backs, blocked epics, per-epic ambiguity, team facts, workflow settings, measured pace and growth, sample data), each doc says so near its top and at the sections it sets aside.

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
