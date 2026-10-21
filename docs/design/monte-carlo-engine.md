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
Team          { id, name, source: 'jira'|'github', sourceRef,
                workflowMap: Record<sourceStatus, 'not_started'|'started'|'done'|'cancelled'>,
                startedSignal?,      // GitHub: the label, project column or assignee that means "started"
                spikeRule,           // issue types and/or labels that mark a spike
                commitLabel? }       // optional label that commits an epic when applied

WorkItem      { id, teamId, sourceKey, type: 'story'|'bug'|'task'|'epic'|...,
                parentId?, labels, createdAt, startedAt?, doneAt?, cancelledAt?, lastSyncedAt }

WorkItemEvent { itemId, at, kind: 'status'|'parent'|'type'|'label', from?, to? }
```

`WorkItemEvent` holds parent-change history (Jira changelog, GitHub sub-issue events). That history tells you how many children an epic had at any point in time, which is what makes growth measurable.

`startedAt` comes from the status mapped as "started" in `workflowMap` (or `startedSignal` on GitHub). Cycle time is `startedAt → doneAt`. Created-to-done (lead time) is not used in v1.

Ingestion follows data minimisation (see [Security](#security)). On GitHub, an assignee used as `startedSignal` is read only as "has an assignee".

### Layer 2: derived samples (recomputable, cacheable)

```ts
EpicCommit       { epicId, committedAt, childCountAtCommit,
                   source: 'user_marked'|'label',
                   resetAt? }            // set when the epic is pulled back to not started

GrowthSample     { epicId, teamId, committedCount, finalCount,
                   ratio /* finalCount / committedCount */, completedAt }

EpicSizeSample   { epicId, teamId, finalCount, completedAt }

ThroughputSample { teamId, milestoneId, periodStart, periodDays /* 1 | 7 */,
                   scope: 'milestone_epics', count }
```

**Committing.** The EM commits an epic in the tool after kickoff, or a configured label in the ticketing tool commits it. The commit records the epic's child count at that moment. Spikes never commit an epic. A pull-back (from started to not started) resets the commit: `resetAt` is set and the EM commits again on restart. Only the latest commit counts towards the growth ratio. A blocked epic keeps its commit.

**The uncommitted-but-active warning.** "The epic moved to in progress, or a non-spike child started" is no longer a commit rule. It only triggers a warning when the epic isn't committed.

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
    committed: boolean,
    baseCount: number | null,          // count at commit; for an uncommitted epic, its current count
                                       // (provisional); null or 0 = no children
    currentCount,                      // children now, done or not
    doneCount,
    growth: number[] | { low, high },  // pooled samples, or the epic's ambiguity range
  }>,

  throughputSamples: number[] | { low, high },  // measured done counts per period (whole numbers), or the EM's manual range
  throughputSampler: { kind: 'bayesianBootstrap' },  // how measured samples are drawn; see "Swappable samplers"
  epicSizeSamples:   number[] | { low, high },  // only used for epics with no children
  warnAboveWeeks,                               // from ForecastSettings, so caseHash covers it; see "Long forecasts"
}

ForecastResult {
  caseHash,
  quantiles: (number | null)[101],     // 'when': finish period at p0..p100; null = beyond the horizon
                                       // 'howMany': items done by byDate at p0..p100
  finishedFraction,                    // 'when': share of trials that finished within maxPeriods
  percentileDates: Record<percentile, string | null>,   // 'when' only, ISO YYYY-MM-DD; null = beyond the horizon
  percentileCounts: Record<percentile, number>,         // 'howMany' only; see below
  perEpic: Array<{ epicId, quantiles: (number | null)[101] }>,   // computed, not shown in the v1 UI
  diagnostics: {
    throughputSampleCount, splitHalvesError,  // < 25% is "good" (Magennis); measured pace only, 2+ samples; to be replaced by relative standard error (#47)
    throughputScope: 'milestone_epics',       // shown in the UI
    throughputSource: 'manual'|'measured',
    growthSource: Array<{ epicId, source: 'samples'|'ambiguity'|'epic_size' }>,
    uncommittedEpicIds: string[],             // labelled "not committed: wide range"
    trialsHittingHorizon,                     // trials that hit maxPeriods without finishing
    warnings: string[],
  },
}
```

### What the scope distributions are for

- **`growth`** answers: "This epic had 10 tickets when committed. How many will it have when it's done?" Each sample is `finalCount / committedCount` from a finished epic, e.g. `[1.4, 2.0, 1.08]`, or the epic's ambiguity range when measured samples aren't in use. This replaces hand-entered split rates.
- **`epicSizeSamples`** answers: "This epic has no tickets. How many will it have?" A growth ratio can't help there (0 × 1.4 = 0), so the engine draws a total size from the final sizes of finished epics, or from the default range.

Growth ratios are measured from the count at commit, so they are applied to `baseCount` (the count at commit), not to the epic's current count. Applying them to an epic that has already grown would double-count the growth. A drawn total is never allowed below `currentCount`, though: tickets that already exist are known work, so a low ratio can't make them disappear.

An **uncommitted epic** has no baseline yet. `forecast/buildCase.ts` passes its current count as a provisional `baseCount` and sets `committed: false`. The engine treats it the same way, and the forecast labels it "not committed: wide range".

`throughputSamples` must be in the same period length as the case. `forecast/buildCase.ts` sums daily `ThroughputSample`s into `periodDays`-long periods and rejects samples with a different `periodDays`. Feeding daily counts into a weekly case would make the forecast about 7 times too slow. A manual range is already per period.

### One trial ('when')

1. **Correlated growth.** Draw one uniform `u` in [0, 1) for the trial. For each epic, its growth ratio is the `u`-quantile of its own `growth` distribution: the empirical quantile of the samples, or `low + u × (high − low)` for a range. Set its total to `baseCount × ratio`, rounded to 9 decimal places to clear float error (100 × 1.1 is 110.00000000000001) while keeping real fractions, or draw one epic size (independently) if `baseCount` is null or 0. Floor the total at `currentCount`. Remaining work is `max(total − doneCount, 0)`.
   - A milestone's epics tend to over-run together (same team, same planning habits), so one shared `u` per trial keeps the range from coming out falsely narrow. Each epic still keeps its own range.
   - **Do not average several draws.** Averaging narrows the distribution and hides the tail ([research §1.1](../research/forecasting-approaches.md#11-the-users-prior-tool-random11235forecaster)).
2. **Pace.** Each period, draw one throughput value: from measured samples, a draw by the case's `throughputSampler` (in v1, the Bayesian bootstrap; see "Swappable samplers"); from a manual range, a whole number drawn uniformly from `[low, high]`. Subtract it from the remaining work, taking epics in rank order.
3. Record the period in which each epic finishes, and the period in which all of them finish.
4. Stop at `maxPeriods`. A trial that hasn't finished by then is recorded as "beyond the horizon", which also guards against all-zero throughput looping forever.

Collect the trial results and compute 101 quantiles overall and per epic.

**Trials beyond the horizon** sort after every finishing trial and are kept, not dropped or clamped to `maxPeriods`. Dropping them would make every percentile too early, and clamping them would show the horizon as if it were a real finish date. Any quantile that lands on such a trial is `null`, and the UI shows it as "later than <horizon date>". `finishedFraction` says how many trials finished, and the forecast warns when it is below the highest reported percentile.

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

**Split-halves error.** For measured pace, the engine splits the samples into two random halves and takes the gap between their means as a share of the overall mean, averaged over 100 splits drawn after the trials (so the trials' random stream is unchanged). Below 25% is "good" (Magennis). It is absent for a manual range, and for a single sample, which can't be split.

**Long forecasts.** Each period's pace is drawn independently, so over many periods good and bad weeks average out, and the spread grows only with the square root of the number of periods: a long forecast comes out too confident about the date. When the forecast spans more than `warnAboveWeeks` weeks, `diagnostics.warnings` says so in tickets and weeks, never periods, e.g. "This forecast covers about 180 tickets, roughly 30 weeks at your current pace. Forecasts this far out tend to be too confident about the date." The forecast still runs.
- The span is counted in time (periods × `periodDays`), so the threshold keeps its meaning if `periodDays` changes. For 'when' it is the median finish, and a median beyond the horizon counts as over; for 'howMany' it is the time to `byDate`.
- The ticket figure for 'when' is the median remaining work across trials, after growth; for 'howMany', the median count done.
- The lasting fix is a sampler that keeps runs of weeks together (see "Sampling experiments" under [Deferred](#deferred-beyond-v1)).

The forecast states plainly when an input is thin rather than hiding it, e.g. "Only 4 weeks of finished tickets. Forecast needs 8." These go in `diagnostics.warnings`, alongside:

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
    workItem.ts           # WorkItem, WorkItemEvent

  samples/                # Layer 2: pure derivations from model/
    commits.ts            # commits, pull-back resets, uncommitted-but-active detection
    throughput.ts         # WorkItems → ThroughputSample[] (milestone epics only)
    growth.ts             # commits + final counts → GrowthSample[]
    epicSize.ts           # finished epics → EpicSizeSample[]
    cycleTime.ts          # started → done; spread and ageing

  engine/                 # pure: no I/O, no DB, no clock; see src/engine/ for its files
    index.ts              # exports simulateCase and the types only

  forecast/               # the only module that knows both stored data and the engine
    buildCase.ts          # pace mode, ambiguity ranges, provisional baselines, limits
    settings.ts           # ForecastSettings and AmbiguityRanges defaults
    suggestions.ts        # suggested pace range, measured medium range, switch offers
    diagnostics.ts        # sample counts, split-halves stability, warnings

  ledger/                 # Layer 5
    forecastLog.ts
    outcomes.ts           # record actuals; compute PIT and hit rates

  secrets/                # credential storage interface; v1: OS keychain
  connectors/             # jira/ (first), github/ (second) → model/ types; read-only
  storage/                # interfaces; v1: SQLite file

test/
  engine/                 # Seam A: fixed seeds, plus a performance benchmark
  forecast/               # Seam B: facts + settings + ledger → milestone forecast view
  fixtures/               # canned histories and recorded Jira/GitHub responses (.json)
```

**Dependency rules:**
- `engine/` imports nothing from the rest of the app.
- `samples/` imports only `model/`.
- `forecast/` is the only module that depends on both stored data and `engine/`.
- `ledger/` depends only on `engine/types.ts`.
- `connectors/`, `storage/` and `secrets/` sit at the edges behind interfaces, so v1 can run from canned data and the same code can be hosted later.

**File types:**
- Source is `.ts`.
- Tests are `.test.ts`.
- Fixtures are `.json`, in the same shape a connector produces (or the raw API response, for connector replay tests).
- Settings defaults are a typed `.ts` constant.

**Test seams.** There are two, as set in the spec:
- **Seam A** is `simulateCase`, tested with fixed seeds.
- **Seam B** is `forecast/`: stored facts, settings and the ledger go in, and the milestone forecast view comes out.

Connectors are tested through Seam B by replaying recorded API responses, with no seam of their own.

The one exception is the PRNG: `engine/random.ts` is checked against output vectors from the authors' reference C code for xoshiro128**, because a port must reproduce its exact stream and Seam A can't show that.

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
2. **Data minimisation.** The model needs only IDs, types, parent links, labels, status timestamps and counts. Don't ingest titles, descriptions, comments or assignee identities. With fixed capacity there is no `Person` table.
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
| Other pace scopes (v2) | Pace from children of any epic, or from all of the team's work. Derive `ThroughputSample`s with that `scope` from `WorkItem.parentId`; `diagnostics.throughputScope` reports the choice. |
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
