# Pace stability signals

Research date: 2026-10-21. Prompted by the review of PR #41, which added `splitHalvesError` to the engine (#12).

**Question:** does the split-halves error tell an EM when a forecast can't be trusted, and is there a better signal?

**Answer:** No. Split-halves error is the relative standard error (CV/√n) with added noise. It flags histories whose weeks vary a lot, and those get wide forecasts that hold up. The forecasts that go wrong come from pace that changes over time: a trend, a step after a team change, or spells of good and bad weeks. A trend-or-runs test catches some of those. Leave-one-out influence picks out a single odd week.

All data here is **synthetic** and seeded. It shows how the signals behave on known patterns. It doesn't say how often each pattern occurs in real teams.

Interactive dashboard: [Pace Stability Signals](https://claude.ai/artifact/DhDqM2vWah5XPmVZJVfopE). The link is private to the owner until shared.

## Method

`experiment.mjs` simulates six team types, each averaging about 6 tickets a week:

| Team type | Process |
|---|---|
| Steady | Poisson, mean 6 |
| Lumpy | Gamma-Poisson, CV ≈ 1 (batch releases, zero weeks) |
| Speeding up | Mean rises from 3 to 9 over the history, then holds at 9 |
| Team change | Mean 4, then 8 from halfway |
| Good and bad spells | Markov chain between 9 and 3 a week, 85% chance of staying |
| One odd week | Steady, plus one week of 30 |

For each type there are 400 histories of 10 weeks. Each history is forecast for 60 remaining tickets with a 2,000-trial bootstrap, the same method as the engine. The forecast is then checked against the team's true future. Each signal is computed on the history:

| Signal | Rule |
|---|---|
| Split-halves error (as in `src/engine/simulate.ts`) | > 25% |
| Relative standard error, CV/√n | > 16% |
| Older vs newer half | > 40% |
| Mann–Kendall trend test | p < 0.05 |
| Lag-1 autocorrelation | > 0.3 |
| Trend or runs | MK p < 0.05 or lag-1 > 0.3 |
| Leave-one-out influence | > 20% |
| Bootstrap P85 spread | > 50% |

`classify.mjs` reuses the same team types and signals and tests a rule-based classifier that names each history's pattern, at 10 and 20 weeks.

## Results

### Which forecasts go wrong

A P10–P90 range would miss 20% of the time if finish dates were continuous. They are whole weeks, and about 30% of actual finishes land exactly on the P10 or P90 week, so a perfect forecast (bands from the true process) misses only about 12%. That is the baseline here.

| Team type | Actual outside P10–P90 |
|---|---|
| Steady | 25% |
| Lumpy | 38% |
| Speeding up | 78% |
| Team change | 57% |
| Good and bad spells | 54% |
| One odd week | 26% |

Changing teams miss far more, and adding older history makes trending teams worse.

### Short history makes every range too narrow

Even Steady misses well above the 12% baseline. The bootstrap treats the history as the team's true pace and ignores that it is only an estimate. `steady-check.mjs` measures the steady miss rate against history length (2,000 histories each):

| Weeks of history | 5 | 10 | 20 | 40 | 80 |
|---|---|---|---|---|---|
| Actual outside P10–P90 | 43% | 28% | 19% | 15% | 12% |

So a 10-week forecast is overconfident by about 16 points even for a perfectly steady team. The fix is to widen the range for short history (for example a Bayesian or smoothed bootstrap behind the sampler seam) or to say so in the forecast.

### Split-halves error is the relative standard error

Split-halves ≈ 1.70 × RSE, with a rank correlation of 0.99. Dropping weeks at random (decimation) follows the textbook formula from CV and n for every team type, an observed/expected ratio of about 0.97. So it adds no information either.

### What each signal flags

Share of histories flagged:

| Signal | Steady | Lumpy | Speeding up | Team change | Spells | Odd week |
|---|---|---|---|---|---|---|
| Split-halves > 25% | 22% | 100% | 57% | 60% | 67% | 100% |
| RSE > 16% | 16% | 99% | 52% | 56% | 62% | 100% |
| Mann–Kendall | 2% | 5% | 49% | 33% | 14% | 3% |
| Lag-1 > 0.3 | 6% | 6% | 38% | 41% | 25% | 0% |
| Trend or runs | 7% | 9% | 55% | 51% | 30% | 3% |
| Leave-one-out > 20% | 0% | 50% | 0% | 1% | 7% | 100% |

### Does a flag mean a worse forecast?

All team types pooled; the overall miss rate is 46%.

| Signal | Fired when the forecast missed | Fired when the forecast was fine |
|---|---|---|
| Split-halves | 64% | 71% |
| RSE | 60% | 68% |
| Trend or runs | 33% | 20% |
| Mann–Kendall | 23% | 13% |
| Lag-1 | 24% | 15% |
| Leave-one-out | 16% | 35% |

Trend-or-runs is the only signal more likely to fire before a miss than before a fine forecast. Even so, it is a weak detector.

### Naming the pattern

Share of each team type named correctly:

| Team type | From 10 weeks | From 20 weeks |
|---|---|---|
| One odd week | 96% | 99% |
| Steady | 90% | 87% |
| Lumpy | 74% | 89% |
| Speeding up or Team change, as one "pace changing" label | ≈ 40% | ≈ 70% |
| Good and bad spells | 20% | 27% |

From 10 weeks, about 40% of changing teams are called Steady.

## Implications

1. Replace split-halves with the RSE, shown as information ("your weekly pace varies a lot, so the range is wide"), not as a warning. Its 25% / 75% bands correspond to about 16% / 47% RSE.
2. Warn on trend or runs, worded neutrally: "pace is changing, treat the range with care". This is tracked in #42.
3. Use leave-one-out as a data-quality prompt that names the unusual week.
4. Pattern naming is feasible for odd week and lumpy, and lumpy comes with advice for the EM. Merge trend and step into "pace changing". Say "no pattern detected yet" rather than "steady" for short histories.
5. Widen ranges from short history, or say they are likely too narrow. Even a steady team's 10-week forecast misses 25–28% of the time against a 12% baseline.

## Files

- `experiment.mjs`: the main experiment. Run `node experiment.mjs`. Seed 20261021; writes `results.json`, which is git-ignored.
- `steady-check.mjs`: steady miss rate by history length, and the perfect-forecast baseline. Run `node steady-check.mjs`.
- `classify.mjs`: the pattern classifier test. Run `node classify.mjs`; it prints a confusion matrix as JSON. It repeats the team types and signals from `experiment.mjs`.
- `data/`: the datasets behind the dashboard. They were reshaped from `results.json` and `classify.mjs` output.
- `dashboard/index.html`: the dashboard page source. It runs only inside the claude.ai Dashboard artifact runtime (`dash.onData`, design tokens), so it won't render opened directly.
