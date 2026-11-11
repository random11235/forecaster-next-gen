---
status: accepted
---

# Bayesian bootstrap is the default pace sampler

The forecast simulates future periods by picking from the typed counts of the team's past periods. The plain bootstrap picks every past period equally often, which treats a short history as if it were the team's exact pace, so its ranges come out too narrow even for a perfectly steady team. Short history is the usual case: the forecast runs from 4 typed counts, comparable work proposes counts from at most 8 recent periods, and counting pace again from a step in the pace pattern leaves fewer still. So on 2026-10-21 we made the Bayesian bootstrap the default. It gives the past periods fresh random weights for each trial, so some trials lean on the faster periods and some on the slower ones, and the range reflects how little a few periods tell us. As history grows, the weights even out and it behaves like the plain bootstrap. With fewer than 8 typed counts the forecast also warns that it isn't yet reliable, because the new sampler only closes part of the gap.

Evidence: [`docs/research/pace-stability/`](../research/pace-stability/README.md#short-history-makes-every-range-too-narrow).

## Considered Options

- **Keep the plain bootstrap until the calibration ledger can back-test samplers**, as the engine design asked. Rejected: the ledger needs finished milestones, and forecasts would be overconfident in the meantime. This decision rests on synthetic evidence instead.
- **Only warn about short history.** Rejected: the warning admits the range is too narrow but doesn't fix it. The new sampler fixes part of it and made no team type's forecast less accurate.

## Consequences

- Ranges are wider, most of all for short or lumpy histories, and the extra width shrinks as history grows. This is intended.
- It doesn't fix forecasts for teams whose pace is changing. The pace trend and the pace pattern are there so the EM can see that.
- The sampler does a little setup on every trial, not just once per forecast.
- Every forecast changed, so `ENGINE_VERSION` went up to `'2'`.
- Keeping it right needs no statistics: the calibration test (`test/engine/calibration.test.ts`) simulates steady teams and fails with a plain-language message if forecasts become overconfident again. Once the ledger has real forecasts, its track record takes over that check.
