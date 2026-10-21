---
status: accepted
---

# Bayesian bootstrap is the default pace sampler

Decided 2026-10-21, on synthetic evidence rather than the Ledger back-test the engine design asks for before changing the default sampler.

## In plain words

The forecast simulates future weeks by picking from the team's past weeks. The plain bootstrap picks every past week equally often, which treats a short history as if it were the team's exact pace. With 10 weeks, the "80% likely" range holds only about 72% of the time, even for a perfectly steady team.

The Bayesian bootstrap gives the past weeks a fresh random weighting for each simulated run. Some runs lean on the faster weeks and some on the slower ones. That spreads the forecast to reflect how little a few weeks really tell us. As history grows, the weightings even out and it behaves like the plain bootstrap.

We also show a note on short-history forecasts, because the new sampler only closes about half the gap.

## Why

- v1 often forecasts from short history: measured pace is offered from 8 weeks, and a team change restarts the count. That is where the plain bootstrap is most overconfident.
- The Bayesian bootstrap made no team type's forecast less accurate in testing. Its miss rate fell for all six team types.
- It is a small change behind the existing sampler seam.
- We chose not to wait for the Ledger: it needs finished milestones, and v1 would ship overconfident ranges in the meantime.

Evidence: [`docs/research/pace-stability/`](../research/pace-stability/README.md#short-history-makes-every-range-too-narrow).

## Consequences

- Ranges are wider, about 40% at 10 weeks, and the extra width shrinks as history grows. This is intended.
- Lumpy teams get the widest ranges, and their middle date moves about a week later.
- It does not fix forecasts for teams whose pace is changing (#42).
- The sampler needs a little setup on every simulated run, not just once per forecast.
- Every forecast changes, so `engineVersion` goes up.

## Keeping it right without statistics

A calibration test pins the behaviour: it simulates steady teams and checks the miss rate stays within agreed bounds. If a change breaks it, the test fails. You don't need to follow the maths to see that. Once the Ledger has real forecasts, its track record replaces the synthetic numbers as the check.
