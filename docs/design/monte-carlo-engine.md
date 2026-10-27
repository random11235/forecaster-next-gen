# Monte Carlo engine: design

Design date: 2026-10-14. Updated 2026-10-18 with the design grill decisions (Q1–Q31). Status: draft for v1. The v1 spec is [issue #6](https://github.com/random11235/forecaster-next-gen/issues/6).

This builds on the recommendations in [`../research/forecasting-approaches.md`](../research/forecasting-approaches.md) ("Implications for a new tool") and the stores in [`../research/EM_usecase-arch.excalidraw`](../research/EM_usecase-arch.excalidraw).

The engine is built and tested in isolation first (build order: engine → app on canned data → Jira → GitHub → capacity). The app design ([`frontend-essentials.md`](frontend-essentials.md)) need not match it until the app is built.

---

## v1 assumptions

- **Single team, run locally.** The tool is a local web app started with one command, holding its data in a local SQLite file. There is no aggregator and no access control in v1.
- **Capacity is fixed** for the whole forecast, until the capacity calendar (see [Deferred](#deferred-beyond-v1)).
- **No risks or added-scope events** are modelled.
- **One reference class per team.** Growth and epic-size samples are pooled per team. The EM expresses how well each epic is understood through its ambiguity level (see [Settings](#layer-3-settings)), not through separate reference classes.
- **Counts, not story points.** Throughput and scope are measured in tickets.
- **Pace counts only children of the milestone's epics.** KTLO, bugs and tickets outside the milestone's epics are excluded. Time spent on them shows up as slower milestone pace, which is what the forecast needs.
- **Pace is earned, not assumed.** Nothing from before installation is used automatically. Pace starts as a manual range; see [Pace](#layer-3-settings) for when measured pace is offered.
- **Committing an epic is manual.** See [Committing](#layer-2-derived-samples-recomputable-cacheable).

The data model is designed so that each of these can be relaxed later without re-ingesting data (see [Deferred](#deferred-beyond-v1)).

---

## Principles

1. **Keep the layers apart:**
   - observed facts from the ticketing tool (append-only)
   - derived samples (can be recomputed, so they can live in the cache)
   - user settings
   - forecasts (never changed once written)
2. **The engine is a pure function: `simulateCase(SimulationCase) → ForecastResult`.** It does no I/O, uses no clock, and gets all its randomness from a seed in the case. That makes forecasts reproducible, and it makes the calibration ledger trustworthy.
3. **Store samples, not summaries.** Keep the raw growth ratios and weekly throughputs, not just a mean or min/max. That keeps the tail, and it lets you change the sampling method later.
4. **Key data by team, not by user.** Throughput belongs to a team. v1 has one team, but keeping every store keyed by `teamId` means a later multi-team phase needs no migration.
5. **Measured data suggests; the EM decides.** Wherever measured data could replace an EM input (pace, the medium growth range), the tool shows it as a suggestion and switches only when the EM accepts.

---

## Data model

### Layer 1: observed facts (ingested)

```ts
Team          { id, name, source: 'sample'|'jira'|'github', sourceRef }

WorkflowSettings { teamId,            // set by the EM; one per team
                statuses: { status, category: 'notStarted'|'started'|'done'|'cancelled' }[],
                startedStatus,       // the status where cycle time starts; one mapped to started
                startedSignal?,      // later, with the GitHub connector: the label, project column or assignee
                                     // that means "started"; not in the model yet
                commitLabel?,        // optional label that commits an epic when applied
                blockedRule: { statuses, labels } }  // statuses and/or labels (flags) that mark an epic blocked

WorkItem      { id, teamId, sourceKey, type: 'story'|'bug'|'task'|'epic'|...,
                parentId?, labels, createdAt, startedAt?, doneAt?, cancelledAt?, lastSyncedAt }

WorkItemEvent { itemId, at, kind: 'status'|'parent'|'type'|'label', from?, to? }
```

`WorkItemEvent` holds parent-change history (Jira changelog, GitHub sub-issue events). That history tells you how many children an epic had at any point in time, which is what makes growth measurable.

The forecast reads `startedAt`, `doneAt` and `cancelledAt` from each ticket's status history under the team's `WorkflowSettings` (**team facts**, `forecast/teamFacts.ts`), so changing the mapping changes which tickets count as done. `startedAt` is when the ticket first entered `startedStatus`. A ticket that skipped it starts when it first entered any status mapped to started, or, if it skipped those too, when it first entered one mapped to done, so work that jumps columns still has a cycle time. On GitHub, `startedSignal` will set it instead, once that connector adds it. A status the EM hasn't mapped counts as not started. Cycle time is `startedAt → doneAt`. Created-to-done (lead time) is not used in v1.

Ingestion follows data minimisation (see [Security](#security)). On GitHub, an assignee used as `startedSignal` is read only as "has an assignee".

### Layer 2: derived samples (recomputable, cacheable)

```ts
EpicCommit       { teamId, epicId, committedAt,
                   baseline }            // children at commit; stored as child_count_at_commit.
                                         // Team facts adds source: 'inTool'|'label' to the commits that stand

GrowthSample     { epicId, teamId, committedCount, finalCount,
                   ratio /* finalCount / committedCount */, completedAt }

EpicSizeSample   { epicId, teamId, finalCount, completedAt }

ThroughputSample { teamId, milestoneId, periodStart, periodDays /* 1 | 7 */,
                   scope: 'milestoneEpics', count }
```

**Committing.** The EM commits an epic in the tool after kickoff, or a configured label in the ticketing tool commits it. The commit records the epic's child count at that moment, its **baseline**. A label commit is not stored: on each read, `samples/commits.ts` finds each time the epic's label history applies `commitLabel`, and counts the children it had then from the tickets' creation, parent and status history (cancelled children don't count). A **pull-back** (the epic moving from started to not started) resets the commit, and the EM commits again on restart, in the tool or by applying the label again. The reset is not stored either: `samples/commits.ts` checks the epic's status history under the team's `WorkflowSettings` for a pull-back after `committedAt`, so changing the status mapping can change which commits stand. While a commit stands, a later one (applying the label again) doesn't replace it, so the commit that stands is the first since the last pull-back. Removing the label doesn't uncommit the epic. Team facts carries the commits that stand, with their source (`'inTool'` or `'label'`). Only the EM's latest commit is stored, and only an in-tool commit counts towards the growth ratio.

**Blocked epics.** An epic in a status, or with a label, of `blockedRule` is flagged "Blocked" in the Milestone forecast's epic list. It keeps its commit (a move into a blocked status is not a pull-back, even when that status is mapped to not started; leaving it for not started is), stays in the milestone and is forecast like any other epic.

**The uncommitted-but-active warning.** An epic whose own status is mapped to started, with no commit standing, is flagged "<epic> is in progress but isn't committed". Its children's statuses play no part, so the tool needs no rule for which tickets are spikes ([ADR-0002](../adr/0002-no-spike-rule.md)).

**Samples.** Only epics committed in the tool that have since finished produce samples. Epics committed with no children (`committedCount` of 0) produce no `GrowthSample`, since their ratio is undefined. They still produce an `EpicSizeSample`. Old epics are excluded either way.

**Throughput.** `ThroughputSample`s count done tickets whose parent is one of the milestone's epics. Because `WorkItem.parentId` is ingested, other scopes (e.g. children of any epic, or all tickets) can be derived later from the same data without re-ingesting.

### Layer 3: settings

```ts
ForecastSettings { teamId, trials /* 10_000 */,
                   percentiles /* [50, 70, 85, 95] */, minGrowthSamples /* 7 */,
                   minMeasuredPaceWeeks /* 8 */, staleWeeksAfterTeamChange /* 4 */,
                   minResolvedMilestones /* 5, for the track record */,
                   periodDays /* 7 */,
                   maxPeriods /* horizon cap in periods, e.g. 156 when periodDays is 7 */,
                   warnAboveWeeks /* 26, provisional: tune from the calibration ledger */ }

PaceSetting      { teamId, milestoneId, mode: 'manual'|'measured',
                   manualLow, manualHigh,           // tickets per period
                   suggestion?: { low, high, basis }, // pre-fill only, e.g. "previous milestone"
                   setBy, setAt }

TeamChange       { teamId, at, note }   // restarts the measured window; flags pace stale

AmbiguityRanges  { teamId, low: { low: 1, high: 1.5 }, medium: { low: 1, high: 2 },
                   high: { low: 1.5, high: 3 }, setBy, setAt }    // editable

EpicSetting      { epicId, milestoneId, rank, ambiguity: 'low'|'medium'|'high' /* default medium */ }
```

These defaults are the single source for the thresholds the app design refers to.

**Pace.** `PaceSetting.mode` stays `'manual'` until the EM accepts measured pace. The tool offers the switch once the milestone has `minMeasuredPaceWeeks` of its own throughput since the last `TeamChange`. After a team change, the measured window restarts and the EM is prompted to review the manual range. Pace that predates the change is flagged stale until `staleWeeksAfterTeamChange` of new data exist.

**Growth.** Each epic's growth range comes from its ambiguity level. Once at least `minGrowthSamples` growth samples exist, the tool suggests the measured distribution for `medium`. If the EM adopts it, epics marked medium draw from the pooled samples; low and high keep their ranges.

### Layer 5: calibration ledger

(Layer 4 is the engine contract, in the next section.)

```ts
ForecastLog   { id, createdAt, createdBy, teamId, milestoneId, targetEpicIds: string[],
                caseHash, caseSnapshotRef /* full SimulationCase, stored as a blob */,
                quantiles: (number | null)[101], percentileDates }

Outcome       { id, teamId, milestoneId, forecastLogId, targetEpicIds,
                actualDoneAt, actualFinalCount, recordedAt }

ForecastScore { forecastLogId, outcomeId,
                pit /* fraction of trials that finished before the actual;
                       trials that hit the horizon count as finishing after it */,
                hit: Record<percentile, boolean> }
```

Storing 101 quantiles, not just p50/p85/p95, gives every forecast a PIT value: the share of simulated trials that finished before the actual date. A histogram of PIT values across many forecasts is a direct calibration check ("our 85% dates were met 78% of the time"). It also gives the empirical correction factor the [research](../research/forecasting-approaches.md#implications-for-a-new-tool-synthesis) recommends (Jørgensen [27]).

Every forecast is logged from the first run. The track record is shown only once `minResolvedMilestones` milestones have an `Outcome`.

---

## Engine contract

This is the v1 target. What is built so far is typed in `src/engine/types.ts`, which is the source of truth for the current contract; change the code first, and this section only when the design changes.

```ts
SimulationCase {
  engineVersion, seed, trials, maxPeriods,
  question: { kind: 'when' } | { kind: 'howMany', byDate },
  startDate, periodDays,               // e.g. 7; maxPeriods is counted in these periods

  scope: Array<{
    epicId, rank,
    baseCount: number | null,          // count at commit; for an uncommitted epic, its current count
                                       // (provisional); null or 0 = no children
    currentCount,                      // children now, done or not
    doneCount,
    growth: number[] | { low, high },  // pooled samples, or the epic's ambiguity range
  }>,

  throughputSamples: number[] | { low, high },  // measured done counts per period (whole numbers), or the EM's manual range
  throughputSampler: { kind: 'bayesianBootstrap' },  // how measured samples are drawn; see "Swappable samplers"
  epicSizeSamples:   number[] | { low, high },  // only used for epics with no children
  percentiles: number[],               // from ForecastSettings.percentiles, default [50, 70, 85, 95];
                                       // whole numbers 0 to 100, at least one, no repeats, any order
}

ForecastResult {
  caseHash,
  quantiles: (number | null)[101],     // 'when': finish period at p0..p100; null = beyond the horizon
                                       // 'howMany': items done by byDate at p0..p100
  finishedFraction,                    // 'when': share of trials that finished within maxPeriods
  percentileDates: Record<number, string | null>,   // keyed by the case's percentiles; 'when' only, ISO YYYY-MM-DD; null = beyond the horizon
  percentileCounts: Record<number, number>,         // keyed by the case's percentiles; 'howMany' only; see below
  perEpic: Array<{ epicId, quantiles: (number | null)[101] }>,   // computed, not shown in the v1 UI
  diagnostics: {
    paceVariation?,                           // relative standard error; measured pace only, 2+ samples
    trialsHittingHorizon,                     // trials that hit maxPeriods without finishing
    span: { periods: number | null, tickets },  // how far the forecast reaches; see "Long forecasts"
  },
}
```

The engine returns facts, not sentences. Every warning is written by `forecast/diagnostics.ts` from these facts and `ForecastSettings`.

The engine also leaves out provenance: facts that `forecast/buildCase.ts` already knows because it made the choice. `forecast/diagnostics.ts` derives them where `buildCase.ts` makes that choice, and owns their types (`ThroughputScope`, `GrowthSource`):
- `throughputScope`: which tickets the pace counts; in v1 only `'milestoneEpics'`, shown in the UI;
- `throughputSource`: `'manual'` or `'measured'`;
- `growthSource`: each epic's source in rank order, `'samples'`, `'ambiguity'` or `'epicSize'` (no children);
- the uncommitted epics in rank order, labelled "not committed: wide range".

### What the scope distributions are for

- **`growth`** answers: "This epic had 10 tickets when committed. How many will it have when it's done?" Each sample is `finalCount / committedCount` from a finished epic, e.g. `[1.4, 2.0, 1.08]`, or the epic's ambiguity range when measured samples aren't in use. This replaces hand-entered split rates.
- **`epicSizeSamples`** answers: "This epic has no tickets. How many will it have?" A growth ratio can't help there (0 × 1.4 = 0), so the engine draws a total size from the final sizes of finished epics, or from the default range.

Growth ratios are measured from the count at commit, so they are applied to `baseCount` (the count at commit), not to the epic's current count. Applying them to an epic that has already grown would double-count the growth. A drawn total is never allowed below `currentCount`, though: tickets that already exist are known work, so a low ratio can't make them disappear.

An **uncommitted epic** has no baseline yet. `forecast/buildCase.ts` passes its current count as a provisional `baseCount`. The engine treats it like any other epic, and the forecast labels it "not committed: wide range".

`throughputSamples` must be in the same period length as the case. `forecast/buildCase.ts` sums daily `ThroughputSample`s into `periodDays`-long periods and rejects samples with a different `periodDays`. Feeding daily counts into a weekly case would make the forecast about 7 times too slow. A manual range is already per period.

### One trial ('when')

1. **Correlated growth.** Draw one uniform `u` in [0, 1) for the trial. For each epic, its growth ratio is the `u`-quantile of its own `growth` distribution: the empirical quantile of the samples, or `low + u × (high − low)` for a range. Set its total to `baseCount × ratio`, rounded to 9 decimal places to clear float error (100 × 1.1 is 110.00000000000001) while keeping real fractions, or draw one epic size (independently) if `baseCount` is null or 0. Floor the total at `currentCount`. Remaining work is `max(total − doneCount, 0)`.
   - A milestone's epics tend to over-run together (same team, same planning habits), so one shared `u` per trial keeps the range from coming out falsely narrow. Each epic still keeps its own range.
   - **Do not average several draws.** Averaging narrows the distribution and hides the tail ([research §1.1](../research/forecasting-approaches.md#11-the-users-prior-tool-random11235forecaster)).
2. **Pace.** Each period, draw one throughput value: from measured samples, a draw by the case's `throughputSampler` (in v1, the Bayesian bootstrap; see "Swappable samplers"); from a manual range, a whole number drawn uniformly from `[low, high]`. Subtract it from the remaining work, taking epics in rank order.
3. Record the period in which each epic finishes, and the period in which all of them finish.
4. Stop at `maxPeriods`. A trial that hasn't finished by then is recorded as "beyond the horizon", which also guards against all-zero throughput looping forever.

Collect the trial results and compute 101 quantiles overall and per epic.

**Trials beyond the horizon** sort after every finishing trial and are kept, not dropped or clamped to `maxPeriods`. Dropping them would make every percentile too early, and clamping them would show the horizon as if it were a real finish date. Any quantile that lands on such a trial is `null`, and the UI shows it as "later than <horizon date>". `finishedFraction` says how many trials finished, and `forecast/diagnostics.ts` warns when it is below the highest reported percentile, naming the horizon date (`periodEndDate`, exported by the engine so both format it the same way).

**Per-epic results** assume epics are worked one at a time (step 2), so they are computed and logged but not shown in v1.

### One trial ('howMany')

"How many items will be done by `byDate`?" uses no scope draws.

1. Run `floor((byDate − startDate) / periodDays)` periods, drawing one throughput value per period as in 'when' step 2.
2. Record the total items done.

Collect the totals and compute 101 quantiles. Confidence runs the other way from 'when': "85% sure" means at least this many items get done in 85% of trials, which is the **15th** percentile of the totals. So `percentileCounts[p] = quantiles[100 − p]`. `percentileDates` and `perEpic` are empty for this question.

### Swappable samplers

v1 draws measured throughput by Bayesian bootstrap ([ADR-0001](../adr/0001-bayesian-bootstrap-pace-sampler.md)): each trial weights the observed periods at random, and each draw returns one observed period's count by those weights. The plain `bootstrap` (every period equally likely) stays available as a sampler kind. Both return only observed counts, so they keep the empirical shape and tail, unlike the triangular draw they replace ([research §1.1](../research/forecasting-approaches.md#11-the-users-prior-tool-random11235forecaster)). Other ways of drawing (interpolated empirical, smoothed bootstrap, parametric fits, block or recency-weighted bootstrap) are worth testing later, so the draw sits behind one seam:

```ts
type ThroughputSamplerConfig = { kind: 'bayesianBootstrap' } | { kind: 'bootstrap' }   // later kinds add their own parameters
interface Sampler { draw(rng: Rng): number }
makeThroughputSampler(config, samples: Float64Array): Sampler
```

- **The trial loop knows only `Sampler`.** Adding a sampler means adding one file in `engine/samplers/` and one entry in the registry. `simulate.ts` doesn't change.
- **The sampler is part of the case.** `throughputSampler` is in `SimulationCase`, so it is covered by `caseHash` and recorded in the ledger with every forecast. Back-testing can then compare samplers on the same history by PIT and hit rate.
- **`makeThroughputSampler` runs once per case.** It may precompute (sort, fit, build a CDF) but `draw` must not allocate, to keep the trial loop fast. Per-trial state, such as the Bayesian bootstrap's weights, is reset in place at the start of each trial.
- **Every sampler is deterministic for a given seed,** and has a fixture test with known output. Adding a sampler doesn't change existing results: the default changes only by ADR, and changing it bumps `engineVersion`.
- **A manual range isn't sampled this way.** The EM's `{ low, high }` is a stated range, not observations, so it is always drawn uniformly.

### Not enough data

**Pace variation.** For measured pace with 2 or more samples, `diagnostics.paceVariation` is the relative standard error: sample sd / mean / √n, or 0 when every sample is 0. It uses no random draws. It is information for the EM ("your weekly pace varies a lot, so the range is wide"), not a warning: lumpy weeks give a wide range that still holds up. It replaces Magennis's split-halves error, which is the same measure plus random noise ([research](../research/pace-stability/README.md#split-halves-error-is-the-relative-standard-error)). The bands that choose the text belong to the forecast layer.

**Long forecasts.** Each period's pace is drawn independently, so over many periods good and bad weeks average out, and the spread grows only with the square root of the number of periods: a long forecast comes out too confident about the date. The engine reports how far the forecast reaches as `diagnostics.span`. When that is more than `ForecastSettings.warnAboveWeeks` weeks, `forecast/diagnostics.ts` says so in tickets and weeks, never periods, e.g. "This forecast covers about 180 tickets, roughly 30 weeks at your current pace. Forecasts this far out tend to be too confident about the date." The forecast still runs.
- `warnAboveWeeks` is not in the case: the threshold changes no draw, so it has no reason to be covered by `caseHash`.
- `span.periods` is periods to the median finish ('when', null beyond the horizon) or to `byDate` ('howMany'). The warning counts it in time (periods × `periodDays`), so the threshold keeps its meaning if `periodDays` changes. For 'when' it is the median finish, and a median beyond the horizon counts as over; for 'howMany' it is the time to `byDate`.
- The ticket figure for 'when' is the median remaining work across trials, after growth; for 'howMany', the median count done.
- The lasting fix is a sampler that keeps runs of weeks together (see "Sampling experiments" under [Deferred](#deferred-beyond-v1)).

The forecast states plainly when an input is thin rather than hiding it, e.g. "Only 4 weeks of finished tickets. Forecast needs 8." `forecast/diagnostics.ts` writes these, alongside:

- an epic in progress but not committed;
- a blocked epic;
- pace marked stale after a team change;
- pace measured over a short history, whose range is likely still too narrow ([ADR-0001](../adr/0001-bayesian-bootstrap-pace-sampler.md));
- wide cycle-time spread, or tickets ageing beyond the team's usual cycle time.

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

  samples/                # Layer 2: pure derivations from model/
    commits.ts            # commits that stand: in the tool or by the commit label, after pull-back resets
    throughput.ts         # WorkItems → ThroughputSample[] (milestone epics only)
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
    buildCase.ts          # pace mode, ambiguity ranges, provisional baselines, limits
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
- **Seam A** is `simulateCase`, tested with fixed seeds.
- **Seam B** is `forecast/`: stored facts, settings and the ledger go in, and the screens' views come out: `milestoneForecastView` for the Milestone forecast screen, and `inputsView` with `editInputs` for the Inputs screen. Team facts is part of it: tests may call `teamFacts` directly.

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
| Pre-installation history (v1.1 or v2) | Read ticket history from before installation to measure pace and growth. The risks to handle: a different team, a different KTLO load, different products, company-wide efforts, or a change of method (e.g. story points to Kanban). In v1, old data may only pre-fill a suggestion. |
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
