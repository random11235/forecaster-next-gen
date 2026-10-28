# Architecture: design

Design date: 2026-10-14. Updated 2026-10-18 with the design grill decisions (Q1–Q31). Status: draft for v1. The v1 spec is [issue #6](https://github.com/random11235/forecaster-next-gen/issues/6).

This covers the Forecaster as a whole: v1's assumptions, the principles every module follows, the folder structure and its dependency rules, the test seams, the language choice, security, and what is deferred beyond v1. Read it first. The engine (Seam A) is in [`engine.md`](engine.md), the data, samples and settings behind `forecast/` (Seam B) in [`forecast-model.md`](forecast-model.md), and the screens in [`frontend-essentials.md`](frontend-essentials.md).

This builds on the recommendations in [`../research/forecasting-approaches.md`](../research/forecasting-approaches.md) ("Implications for a new tool") and the stores in [`../research/EM_usecase-arch.excalidraw`](../research/EM_usecase-arch.excalidraw).

The engine is built and tested in isolation first (build order: engine → app on canned data → Jira → GitHub → capacity). The app design ([`frontend-essentials.md`](frontend-essentials.md)) need not match it until the app is built.

---

## v1 assumptions

- **Single team, run locally.** The tool is a local web app started with one command, holding its data in a local SQLite file. There is no aggregator and no access control in v1.
- **Capacity is fixed** for the whole forecast, until the capacity calendar (see [Deferred](#deferred-beyond-v1)).
- **No risks or added-scope events** are modelled.
- **One reference class per team.** Growth and epic-size samples are pooled per team. The EM expresses how well each epic is understood through its ambiguity level (see [Settings](forecast-model.md#layer-3-settings)), not through separate reference classes.
- **Counts, not story points.** Throughput and scope are measured in tickets.
- **Pace counts only children of the milestone's epics.** KTLO, bugs and tickets outside the milestone's epics are excluded. Time spent on them shows up as slower milestone pace, which is what the forecast needs.
- **Pace is earned, not assumed.** Nothing from before installation is used automatically. Pace starts as a manual range; see [Pace](forecast-model.md#pace) for when measured pace is offered.
- **Committing an epic is manual.** See [Committing](forecast-model.md#committing).

The data model is designed so that each of these can be relaxed later without re-ingesting data (see [Deferred](#deferred-beyond-v1)).

---

## Principles

1. **Keep the layers apart** (described in [`forecast-model.md`](forecast-model.md#data-model)):
   - observed facts from the ticketing tool (append-only)
   - derived samples (can be recomputed, so they can live in the cache)
   - user settings
   - forecasts (never changed once written)
2. **The engine is a pure function: `simulateCase(SimulationCase) → ForecastResult`.** It does no I/O, uses no clock, and gets all its randomness from a seed in the case. That makes forecasts reproducible, and it makes the calibration ledger trustworthy.
3. **Store samples, not summaries.** Keep the raw growth ratios and weekly throughputs, not just a mean or min/max. That keeps the tail, and it lets you change the sampling method later.
4. **Key data by team, not by user.** Throughput belongs to a team. v1 has one team, but keeping every store keyed by `teamId` means a later multi-team phase needs no migration.
5. **Measured data suggests; the EM decides.** Wherever measured data could replace an EM input (pace, the medium growth range), the tool shows it as a suggestion and switches only when the EM accepts.

---

## Folder structure

```
src/
  model/                  # Layer 1: ingested entity types, no logic
    team.ts
    workItem.ts           # WorkItem, WorkItemEvent, Facts
    milestone.ts          # Milestone: defined by the EM, not ingested
    workflow.ts           # WorkflowSettings: the EM's status mapping, commit label, blocked rule
    epicCommit.ts         # EpicCommit: the EM's commit of an epic and its baseline
    ambiguity.ts          # Ambiguity, AmbiguityRanges and each epic's level: set by the EM

  samples/                # Layer 2: pure derivations from model/
    commits.ts            # commits that stand: in the tool or by the commit label, after pull-back resets
    throughput.ts         # WorkItems → daily ThroughputSample[] since installation (milestone epics only)
    finishedEpics.ts      # commits that stand + work items → the committed epics now done, with baseline and final count
    growth.ts             # commits + final counts → GrowthSample[]
    epicSize.ts           # finished epics → EpicSizeSample[]
    cycleTime.ts          # started → done; spread and ageing

  engine/                 # pure: no I/O, no DB, no clock; see src/engine/ for its files
    index.ts              # exports simulateCase, periodEndDate and the types only

  forecast/               # the only module that knows both stored data and the engine
    teamFacts.ts          # team facts: stored facts and the commits that stand, read under the team's WorkflowSettings, once per call
    milestoneEpics.ts     # a milestone's epics as they stand: items now, commit, in progress, blocked; the baseline growth applies to
    inputs.ts             # Seam B: stored data → the Inputs screen's view; its edits (milestone, workflow, pace) and their rules
    milestoneDefinition.ts  # behind inputs.ts: the milestone's view and edits, including committing an epic
    workflowSettings.ts   # behind inputs.ts: the workflow settings view and edit
    growth.ts             # behind inputs.ts: ambiguity ranges and levels, measured growth; each epic's growth and its source
    pace.ts               # behind inputs.ts: weekly pace since installation, the measured-pace gate and switch; the pace a forecast uses
    buildCase.ts          # the pace applied, ambiguity ranges, provisional baselines, limits
    settings.ts           # ForecastSettings and AmbiguityRanges defaults
    suggestions.ts        # suggested pace range, measured medium range, switch offers
    diagnostics.ts        # sample counts, pace variation text, warnings (e.g. in progress but not committed), provenance (ThroughputScope, GrowthSource)
    milestoneForecastView.ts  # Seam B: stored data → the Milestone forecast screen's view

  ledger/                 # Layer 5
    forecastLog.ts
    outcomes.ts           # record actuals; compute PIT and hit rates

  secrets/                # credential storage interface; v1: OS keychain
  connectors/             # jira/ (first), github/ (second) → model/ types; read-only
  storage/                # interfaces; v1: SQLite file
  sample/                 # canned sample data, loaded on first launch when storage is empty
  app/                    # local server (localhost only), screens, `npm start` entry point

test/
  app/                    # launch smoke test: start the app, check the screen is served
  engine/                 # Seam A: fixed seeds, plus a performance benchmark
  forecast/               # Seam B: facts + settings + ledger → milestone forecast view
  fixtures/               # canned histories and recorded Jira/GitHub responses (.json)
```

**Dependency rules:**
- `engine/` imports nothing from the rest of the app.
- `samples/` imports only `model/`.
- `forecast/` is the only module that depends on both stored data and `engine/`.
- `ledger/` depends only on `engine/types.ts`.
- `app/` reaches forecasts through `forecast/`, never `engine/` directly.
- Forecast code reads facts only through team facts (`teamFacts`), never `storage.facts`, so a forecast always sees the EM's status mapping. Storage, the sample loader and storage tests may still read raw facts.
- `connectors/`, `storage/` and `secrets/` sit at the edges behind interfaces, so v1 can run from canned data and the same code can be hosted later.

**File types:**
- Source is `.ts`.
- Tests are `.test.ts`.
- Fixtures are `.json`, in the same shape a connector produces (or the raw API response, for connector replay tests).
- Settings defaults are a typed `.ts` constant.

**Test seams.** There are two, as set in the spec:
- **Seam A** is `simulateCase`, tested with fixed seeds ([`engine.md`](engine.md)).
- **Seam B** is `forecast/`: stored facts, settings and the ledger go in, and the screens' views come out: `milestoneForecastView` for the Milestone forecast screen, and `inputsView` with `editInputs` for the Inputs screen. Team facts is part of it: tests may call `teamFacts` directly. Its logic is in [`forecast-model.md`](forecast-model.md).

Warning text and provenance are tested at Seam B, not Seam A. These cases moved from the engine tests. Each is owed, in `test/forecast/`, by the ticket that adds its warning or diagnostic:
- the horizon warning when fewer trials finish than the highest reported percentile, with the floored percentage and the horizon date, and none when enough finish;
- the long-forecast warning above `warnAboveWeeks` weeks, none at or below it, its ticket figure for 'when' and 'howMany', a median beyond the horizon counting as over, the threshold coming from `ForecastSettings`, and weeks (not periods) keeping their meaning when `periodDays` changes;
- the growth source of each epic in rank order: samples, ambiguity range, or epic size for a null or 0 `baseCount`;
- the throughput scope reported as `'milestoneEpics'`;
- the throughput source: `'measured'` for samples, `'manual'` for a range;
- the uncommitted epics listed in rank order, and none for a scope of committed epics.

Connectors are tested through Seam B by replaying recorded API responses, with no seam of their own.

`test/app/` holds the launch smoke test. It is not a forecasting seam: it builds the app, runs the built `npm start` entry point (`dist/app/main.js`) with `FORECASTER_NO_BROWSER=1` so no browser opens and a temporary `FORECASTER_DATA_FILE`, and checks that the Milestone forecast screen is served. It also checks that a bad `PORT` is refused.

The one exception is the PRNG: `engine/random.ts` is checked against output vectors from the authors' reference C code for xoshiro128**, because a port must reproduce its exact stream and Seam A can't show that.

`test/storage/` holds the schema migration tests. They are not a forecasting seam either: they write a data file as an earlier release left it, open it through `openSqliteStorage`, and check what reads back. A ticket that changes the schema appends a step to `MIGRATIONS` in `src/storage/sqliteStorage.ts` (never editing a released one) and adds a test there that opens a file from the version before.

---

## Language choice

**TypeScript for the engine. Revisit only if a benchmark shows it's needed.**

- **The workload is small.** A "when" forecast with 10,000 trials, 10 epics and a 30-week horizon is about 400,000 random draws. That takes milliseconds in JavaScript. Back-testing 200 historical forecasts takes seconds and runs in the background.
- **A compiled engine has costs:** two toolchains, serialisation across the language boundary, harder debugging, and more friction while the model is still changing.
- **It would pay off for** batch forecasting across many teams on every sync, per-item daily simulation (cycle times, WIP limits, dependencies), or very large trial counts.
- **Cheap wins in TypeScript:** `Float64Array` for samples and outcomes, a fast seeded PRNG, and no allocation inside the trial loop.
- **Benchmark guardrail:** `test/engine/` asserts that 10k trials over a realistic case finish within a budget (e.g. 100 ms).
- **Escape hatch:** port only `engine/` to Rust compiled to WebAssembly, which runs in the browser and in Node. Because the engine is pure, with one entry point, the port is a drop-in replacement. The fixture tests become the conformance suite: with the same PRNG and seed, both implementations must give identical quantiles.

---

## Security

v1 is a local, single-user tool, so items 1 and 2 are what matter. Items 3 and 4 still apply; the rest becomes relevant only with a hosted or multi-team version.

1. **Ticketing credentials.**
   - Use read-only access: Jira OAuth 2.0 (3LO) with read scopes, and a GitHub App or fine-grained token with read-only issue access. A classic API token or PAT carries all of that user's permissions, including write access.
   - Store tokens in the OS keychain. Never put them in the browser, `localStorage`, the SQLite file, logs or error messages.
   - No webhooks in v1. Connectors poll on refresh.
2. **Data minimisation.** The model needs only IDs, types, parent links, labels, status timestamps and counts. Don't ingest titles (except epics', which name them on screen), descriptions, comments or assignee identities. With fixed capacity there is no `Person` table.
3. **Engine input limits.**
   - Cap `trials`, sample-array sizes, `maxPeriods` and the number of epics in `scope` (100, `MAX_EPICS`) in `forecast/buildCase.ts`, and check them again at the engine boundary. The epic cap is a memory guard: the engine keeps a finish period per epic per trial.
   - The PRNG does **not** need to be cryptographic. A fast seeded PRNG is correct.
4. **Dependencies.**
   - Keep `engine/` free of dependencies.
   - Commit a lockfile and run `npm audit` or Dependabot.
   - TypeScript and Rust/WASM are both memory-safe, so the language choice doesn't change the security picture.
5. **Later, for hosted or multi-team use:**
   - Scope every query by team. Aggregators and stakeholders see summaries only, never item-level data.
   - Encrypt tokens at rest server-side, and verify webhook signatures.
   - The forecast ledger is append-only, with `createdBy` recorded. Calibration numbers mean nothing if old forecasts can be edited.

---

## Deferred beyond v1

| Feature | What changes |
|---|---|
| Pre-installation history (v1.1 or v2) | Read ticket history from before installation to measure pace, and growth from epics never committed. (Epics committed by label before installation already count; see [Samples](forecast-model.md#samples).) The risks to handle: a different team, a different KTLO load, different products, company-wide efforts, or a change of method (e.g. story points to Kanban). In v1, old data may only pre-fill a suggestion. |
| Other pace scopes (v2) | Pace from children of any epic, or from all of the team's work. Derive `ThroughputSample`s with that `scope` from `WorkItem.parentId`; the forecast's `throughputScope` reports the choice. |
| Capacity calendar | The last step of v1's build order: absences as a capacity fraction per period, with `capacityByPeriod` and a `capacityModel` (linear by default) on `SimulationCase`. A per-person allocation table comes later, if ever. |
| Per-epic dates in the UI | Shown only after evidence (back-testing or the ledger) that they're reliable despite parallel work. |
| Multi-team | An aggregator, the stakeholder roadmap, publishing, cross-team reference split rates, and access control. The data is already keyed by team. |
| Risks / added-scope events | Add `AddedScopeEvent { probability, impactLow, impactHigh }`, applied once per trial. |
| Reference classes | Add `ReferenceClass { workType }` if the ledger shows growth differs by work type beyond what the ambiguity levels capture. |
| Sampling experiments | Add throughput sampler kinds beside `bayesianBootstrap` and `bootstrap` (interpolated empirical, smoothed bootstrap/KDE, Poisson or negative binomial fit, block bootstrap, recency-weighted bootstrap), each with its parameters in `ThroughputSamplerConfig`. Back-test each against the ledger. Changing the default needs an ADR; [ADR-0001](../adr/0001-bayesian-bootstrap-pace-sampler.md) chose the current one on synthetic evidence, before the ledger had data. Can extend to the growth and epic-size draws. |
| Flow signals | Feed Work Item Age against cycle-time percentiles back in as "likely to split". |
| Other trackers | Linear, Azure DevOps. Webhooks. |

## Open questions

- **Minimum growth samples** before measured samples are suggested: start at 7 (Magennis), then test against the ledger.
- **Default ambiguity ranges** (low 1–1.5×, medium 1–2×, high 1.5–3×): check against the ledger once milestones finish.
- **Default epic-size range** for epics with no children before enough `EpicSizeSample`s exist.
