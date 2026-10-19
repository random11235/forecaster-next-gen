# Monte Carlo engine: design

Design date: 2026-10-14. Status: draft for v1.

This builds on the recommendations in [`../research/forecasting-approaches.md`](../research/forecasting-approaches.md) ("Implications for a new tool") and the stores in [`../research/EM_usecase-arch.excalidraw`](../research/EM_usecase-arch.excalidraw).

---

## v1 assumptions

- **Capacity is fixed** for the whole forecast. Historical throughput is used as it is, with no capacity calendar or scale factor. The throughput window must start after the team's last staffing change.
- **No risks or added-scope events** are modelled.
- **One reference class per team.** Growth and epic-size samples are pooled per team. Splitting them by work type or understanding level comes later, once there is enough history.
- **Counts, not story points.** Throughput and scope are measured in tickets.
- **Throughput counts every ticket the team finishes**, including KTLO (incidents, support), bugs and tickets outside any epic. The forecast spends all of it on the target epics, so dates are optimistic by roughly the share of non-epic work. The UI must say so wherever a forecast is shown, e.g. "Pace includes all completed tickets, including KTLO." Filtering throughput is a later feature (see [Deferred](#deferred-beyond-v1)).

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
4. **Key data by team, not by user.** Throughput belongs to a team. Users own only settings and authorship of forecasts. The architecture diagram follows this: the Logs and Projects stores are keyed by `teamId`, and the EM request carries `userId` only to check access and record who created a forecast.

---

## Data model

### Layer 1: observed facts (ingested)

```ts
Team          { id, name, source: 'jira'|'linear'|'ado'|'github', sourceRef,
                workflowMap: Record<sourceStatus, 'not_started'|'started'|'done'|'cancelled'> }

WorkItem      { id, teamId, sourceKey, type: 'story'|'bug'|'task'|'epic'|...,
                parentId?, createdAt, startedAt?, doneAt?, cancelledAt?, lastSyncedAt }

WorkItemEvent { itemId, at, kind: 'status'|'parent'|'type', from?, to? }
```

`WorkItemEvent` holds parent-change history (Jira changelog, Linear `IssueHistory`, ADO revisions, GitHub sub-issue events). That history tells you how many children an epic had at any point in time, which is what makes growth measurable.

Titles, descriptions, comments and assignees are deliberately **not** ingested (see [Security](#security)).

### Layer 2: derived samples (recomputable, cacheable)

```ts
ScopeBaseline    { epicId, committedAt, childCountAtCommit,
                   rule: 'entered_in_progress'|'first_breakdown'|'user_marked' }

GrowthSample     { epicId, teamId, baselineRule, committedCount, finalCount,
                   ratio /* finalCount / committedCount */, completedAt }

EpicSizeSample   { epicId, teamId, finalCount, completedAt }

ThroughputSample { teamId, periodStart, periodDays /* 1 | 7 */, workTypes: string[],
                   scope: 'all' /* v1; later 'epic_children' etc. */, count }
```

In v1 every `ThroughputSample` has `scope: 'all'`. Because `WorkItem.parentId` is ingested, filtered samples can later be derived from the same data without re-ingesting.

Epics committed with no children (`committedCount` of 0) produce no `GrowthSample`, since their ratio is undefined. They still produce an `EpicSizeSample`.

`baselineRule` is stored on every growth sample. How to define "committed" scope is still an open question, and different rules give materially different ratios. Storing the rule lets the rules be compared through back-testing.

### Layer 3: settings

```ts
ForecastSettings { teamId, windowWeeks /* 8..12 */, trials /* 10_000 */,
                   percentiles /* [50, 70, 85, 95] */, minGrowthSamples /* 7 */,
                   periodDays /* 7 */,
                   maxPeriods /* horizon cap in periods, e.g. 156 when periodDays is 7 */ }

GrowthOverride   { teamId, low, high, reason, setBy, setAt }
                 // used when there are fewer than minGrowthSamples
```

An 8–12 week window gives only 8–12 weekly throughput samples, 4–6 per half for the split-halves check. With so few samples that check is noisy, so it raises a warning rather than blocking a forecast. A team whose setup has been stable for longer can widen the window.

### Layer 5: calibration ledger

(Layer 4 is the engine contract, in the next section.)

```ts
ForecastLog   { id, createdAt, createdBy, teamId, targetEpicIds: string[],
                caseHash, caseSnapshotRef /* full SimulationCase, stored as a blob */,
                quantiles: (number | null)[101], percentileDates }

Outcome       { id, teamId, forecastLogId, targetEpicIds,
                actualDoneAt, actualFinalCount, recordedAt }

ForecastScore { forecastLogId, outcomeId,
                pit /* fraction of trials that finished before the actual;
                       trials that hit the horizon count as finishing after it */,
                hit: Record<percentile, boolean> }
```

Storing 101 quantiles, not just p50/p85/p95, gives every forecast a PIT value: the share of simulated trials that finished before the actual date. A histogram of PIT values across many forecasts is a direct calibration check ("our 85% dates were met 78% of the time"). It also gives the empirical correction factor the research recommends (Jørgensen [27]).

The ledger is append-only.

---

## Engine contract

```ts
SimulationCase {
  engineVersion, seed, trials, maxPeriods,
  question: { kind: 'when' } | { kind: 'howMany', byDate },
  startDate, periodDays,               // e.g. 7; maxPeriods is counted in these periods

  scope: Array<{
    epicId, rank,
    baseCount: number | null,          // count at commit; null or 0 = not broken down at commit
    currentCount,                      // children now, done or not
    doneCount,
  }>,

  throughputSamples: number[],                 // done counts per periodDays-long period, from the recent window
  throughputSampler: { kind: 'bootstrap' },    // how a period's throughput is drawn; see "Swappable samplers"
  growthSamples:   number[] | { low, high },   // ratios; the range is the fallback with < minGrowthSamples
  epicSizeSamples: number[] | { low, high },   // only used for epics not yet broken down
}

ForecastResult {
  caseHash,
  quantiles: (number | null)[101],     // 'when': finish period at p0..p100; null = beyond the horizon
                                       // 'howMany': items done by byDate at p0..p100
  finishedFraction,                    // 'when': share of trials that finished within maxPeriods
  percentileDates: Record<percentile, Date | null>,     // 'when' only; null = beyond the horizon
  percentileCounts: Record<percentile, number>,         // 'howMany' only; see below
  perEpic: Array<{ epicId, quantiles: (number | null)[101] }>,   // cut-line view ('when' only)
  diagnostics: {
    throughputSampleCount, splitHalvesError,  // < 25% is "good" (Magennis)
    throughputScope: 'all',                   // shown in the UI: pace includes KTLO
    growthSource: 'samples'|'override'|'default',
    trialsHittingHorizon,                     // trials that hit maxPeriods without finishing
    warnings: string[],
  },
}
```

### What the scope distributions are for

- **`growthSamples`** answers: "This epic had 10 tickets when committed. How many will it have when it's done?" Each sample is `finalCount / committedCount` from a finished epic, e.g. `[1.4, 2.0, 1.08]`. This replaces hand-entered split rates.
- **`epicSizeSamples`** answers: "This epic had no tickets when committed. How many will it have?" A growth ratio can't help there (0 × 1.4 = 0), so the engine draws a total size from the final sizes of finished epics.

Growth ratios are measured from the count at commit, so they are applied to `baseCount` (the count at commit), not to the epic's current count. Applying them to an epic that has already grown would double-count the growth. A drawn total is never allowed below `currentCount`, though: tickets that already exist are known work, so a low ratio can't make them disappear.

`throughputSamples` must be in the same period length as the case. `forecast/buildCase.ts` sums daily `ThroughputSample`s into `periodDays`-long periods and rejects samples with a different `periodDays`. Feeding daily counts into a weekly case would make the forecast about 7 times too slow.

### One trial ('when')

1. For each epic, set its total to `baseCount × one random growth ratio`, or draw one epic size if `baseCount` is null or 0. Floor the total at `currentCount`. Remaining work is `max(total − doneCount, 0)`. **Draw one ratio per epic; do not average several draws.** Averaging narrows the distribution and hides the tail (research §1.1).
2. Each period, draw one throughput value from the case's `throughputSampler` (in v1, one sample with replacement: a bootstrap) and subtract it from the remaining work, taking epics in rank order.
3. Record the period in which each epic finishes, and the period in which all of them finish.
4. Stop at `maxPeriods`. A trial that hasn't finished by then is recorded as "beyond the horizon", which also guards against all-zero throughput samples looping forever.

Collect the trial results and compute 101 quantiles overall and per epic. Trials beyond the horizon sort after every finishing trial and are kept, not dropped or clamped to `maxPeriods`. Dropping them would make every percentile too early, and clamping them would show the horizon as if it were a real finish date. Any quantile that lands on such a trial is `null`, and the UI shows it as "later than <horizon date>". `finishedFraction` says how many trials finished, and the forecast warns when it is below the highest reported percentile.

### One trial ('howMany')

"How many items will be done by `byDate`?" uses no scope draws.

1. Run `floor((byDate − startDate) / periodDays)` periods, drawing one throughput value per period from the case's `throughputSampler`.
2. Record the total items done.

Collect the totals and compute 101 quantiles. Confidence runs the other way from 'when': "85% sure" means at least this many items get done in 85% of trials, which is the **15th** percentile of the totals. So `percentileCounts[p] = quantiles[100 − p]`. `percentileDates` and `perEpic` are empty for this question.

### Swappable samplers

v1 draws throughput by bootstrap: each draw returns one observed period's count, every period equally likely. It keeps the empirical shape and tail, unlike the triangular draw it replaces (research §1.1). Other ways of drawing (interpolated empirical, smoothed bootstrap, parametric fits, block or recency-weighted bootstrap) are worth testing later, so the draw sits behind one seam:

```ts
type ThroughputSamplerConfig = { kind: 'bootstrap' }   // later kinds add their own parameters
interface Sampler { draw(rng: Rng): number }
makeThroughputSampler(config, samples: Float64Array): Sampler
```

- **The trial loop knows only `Sampler`.** Adding a sampler means adding one file in `engine/samplers/` and one entry in the registry. `simulate.ts` doesn't change.
- **The sampler is part of the case.** `throughputSampler` is in `SimulationCase`, so it is covered by `caseHash` and recorded in the ledger with every forecast. Back-testing can then compare samplers on the same history by PIT and hit rate, the same way `baselineRule` lets "committed" rules be compared.
- **`makeThroughputSampler` runs once per case.** It may precompute (sort, fit, build a CDF) but `draw` must not allocate, to keep the trial loop fast.
- **Every sampler is deterministic for a given seed,** and has a fixture test with known output. Adding a sampler doesn't change existing results: the default stays `bootstrap` until back-testing shows something better, and changing the default bumps `engineVersion`.

---

## Folder structure

```
src/
  model/                  # Layer 1: ingested entity types, no logic
    team.ts
    workItem.ts           # WorkItem, WorkItemEvent

  samples/                # Layer 2: pure derivations from model/
    throughput.ts         # WorkItems → ThroughputSample[]
    growth.ts             # baselines + final counts → GrowthSample[]
    epicSize.ts           # finished epics → EpicSizeSample[]

  engine/                 # pure: no I/O, no DB, no clock
    types.ts              # SimulationCase, ForecastResult
    simulate.ts           # simulateCase(case) → result
    random.ts             # seeded PRNG; drawFrom(samples | {low, high})
    samplers/
      index.ts            # registry: makeThroughputSampler(config, samples) → Sampler
      bootstrap.ts        # v1 default
    quantiles.ts
    index.ts              # exports simulateCase and the types only

  forecast/               # the only module that knows both stored data and the engine
    buildCase.ts          # picks the window, gathers samples, applies fallbacks and limits
    settings.ts           # ForecastSettings defaults
    diagnostics.ts        # sample counts, split-halves stability, warnings

  ledger/                 # Layer 5
    forecastLog.ts
    outcomes.ts           # record actuals; compute PIT and hit rates

  access/                 # team-scoped authorization checks
  secrets/                # credential storage interface (env / KMS / OS keychain)
  connectors/             # later: jira/, linear/, ado/, github/ → model/ types
  storage/                # later: DB and cache adapters behind interfaces

test/
  engine/                 # deterministic tests with fixed seeds, plus a performance benchmark
  samples/
  fixtures/               # small hand-made histories (.json) with known answers
```

**Dependency rules:**
- `engine/` imports nothing from the rest of the app.
- `samples/` imports only `model/`.
- `forecast/` is the only module that depends on both stored data and `engine/`.
- `ledger/` depends only on `engine/types.ts`.
- `connectors/` and `storage/` sit at the edges, so v1 can run from fixture files or a CSV export.

**File types:**
- Source is `.ts`.
- Tests are `.test.ts`.
- Fixtures are `.json`, in the same shape a connector produces.
- Settings defaults are a typed `.ts` constant.

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

Most of the risk is at the edges, not in the engine. Roughly in priority order:

1. **Ticketing credentials.**
   - Prefer OAuth or app installs with read-only scopes: Jira OAuth 2.0 (3LO), a Linear OAuth app, a GitHub App, and Entra ID for Azure DevOps. A Jira API token or a PAT carries all of that user's permissions, including write access.
   - Keep tokens server-side only and encrypt them at rest. Never put them in the browser, `localStorage`, logs or error messages.
   - Store credentials per connection (team or workspace), not per app.
   - Verify webhook signatures (GitHub Projects v2 capture).
2. **Data minimisation.** The model needs only IDs, types, parent links, status timestamps and counts. Don't ingest titles, descriptions, comments or assignees. With fixed capacity there is no `Person` table, so v1 stores no personal data beyond the user who created each forecast.
3. **Access control.**
   - Scope every query by team. A user should see a team's data only if their own connection to the ticketing tool can see that project.
   - The aggregator and stakeholders see summaries only (`projectForecastSummary`), never item-level data.
   - The forecast ledger is append-only, with `createdBy` recorded. Calibration numbers mean nothing if old forecasts can be edited.
4. **Engine input limits.**
   - Cap `trials`, sample-array sizes and `maxPeriods` in `forecast/buildCase.ts`, and check them again at the engine boundary.
   - The horizon cap also prevents non-termination when throughput is all zeros.
   - The PRNG does **not** need to be cryptographic. A fast seeded PRNG is correct.
5. **Dependencies.**
   - Keep `engine/` free of dependencies.
   - Commit a lockfile and run `npm audit` or Dependabot.
   - TypeScript and Rust/WASM are both memory-safe, so the language choice doesn't change the security picture.

How much of this applies depends on deployment. A local, single-user tool needs mostly items 1 and 2. A hosted service shared across teams needs all of them.

---

## Deferred beyond v1

| Feature | What changes |
|---|---|
| Throughput filter | Let the EM choose which tickets count as pace, e.g. only children of epics, excluding KTLO and unparented work. Derive `ThroughputSample`s with that `scope` from `WorkItem.parentId` and `type`; `diagnostics.throughputScope` reports the choice so the UI label stays accurate. |
| Capacity calendar | Add `Person`, `Allocation` and `Absence` tables, plus `capacityFractionThen` on `ThroughputSample`. Add `capacityByPeriod` and an explicit `capacityModel` (linear by default) to `SimulationCase`. |
| Risks / added-scope events | Add `AddedScopeEvent { probability, impactLow, impactHigh }`, applied once per trial. |
| Reference classes | Add `ReferenceClass { workType, understanding }`. Growth and epic-size samples become maps keyed by class. |
| Unplanned work (bugs) | Choose between a separate arrival stream and counting it in throughput. |
| Sampling experiments | Add throughput sampler kinds beside `bootstrap` (interpolated empirical, smoothed bootstrap/KDE, Poisson or negative binomial fit, block bootstrap, recency-weighted bootstrap), each with its parameters in `ThroughputSamplerConfig`. Back-test each against the ledger and switch the default only on better calibration. Can extend to the growth and epic-size draws. |
| Flow signals | Feed Work Item Age against cycle-time percentiles back in as "likely to split". |

## Open questions

- **Definition of "committed" scope** (`baselineRule`): decide by back-testing the candidate rules.
- **Minimum growth samples** before measured samples beat the fallback range: start at 7 (Magennis), then test.
- **Per-epic dates assume epics are worked one at a time.** Step 2 of a trial spends throughput on epics in rank order, so the cut-line view puts early epics too early and later ones too late when the team works epics in parallel. The milestone date is unaffected. Decide whether per-epic likelihood is shown in the UI, or labelled as rougher than the milestone figure, after back-testing.
- **Deployment model** (local or hosted): this decides how much of the security section applies to v1.
