# Monte Carlo engine: design

Design date: 2026-10-14. Updated 2026-10-18 with the design grill decisions (Q1–Q31). Status: draft for v1. The v1 spec is [issue #6](https://github.com/random11235/forecaster-next-gen/issues/6).

This covers `engine/` (Seam A): the contract `simulateCase(SimulationCase) → ForecastResult`, how one trial runs, the swappable samplers, and the facts it reports when data is thin. The engine's place in the system and its dependency rules are in [`architecture.md`](architecture.md); the data and settings `forecast/buildCase.ts` builds the case from are in [`forecast-model.md`](forecast-model.md).

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
- The lasting fix is a sampler that keeps runs of weeks together (see "Sampling experiments" under [Deferred](architecture.md#deferred-beyond-v1)).

The forecast states plainly when an input is thin rather than hiding it, e.g. "Only 4 weeks of finished tickets. Forecast needs 8." `forecast/diagnostics.ts` writes these, alongside:

- an epic in progress but not committed;
- a blocked epic;
- pace marked stale after a team change;
- pace measured over a short history, whose range is likely still too narrow ([ADR-0001](../adr/0001-bayesian-bootstrap-pace-sampler.md));
- wide cycle-time spread, or tickets ageing beyond the team's usual cycle time.
