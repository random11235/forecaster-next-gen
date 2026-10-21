---
status: accepted
---

# Bayesian bootstrap is the default pace sampler

The forecast simulates future weeks by picking from the team's past weeks. The plain bootstrap picks every past week equally often, which treats a short history as if it were the team's exact pace, so its ranges come out too narrow even for a perfectly steady team. v1 often forecasts from short history: measured pace is offered from 8 weeks, and a team change restarts the count. So on 2026-10-21 we made the Bayesian bootstrap the default. It gives the past weeks fresh random weights for each simulated run, so some runs lean on the faster weeks and some on the slower ones, and the range reflects how little a few weeks tell us. As history grows, the weights even out and it behaves like the plain bootstrap. Short-history forecasts also carry a note that the range is likely still too narrow, because the new sampler only closes part of the gap.

Evidence: [`docs/research/pace-stability/`](../research/pace-stability/README.md#short-history-makes-every-range-too-narrow).

## Considered Options

- **Keep the plain bootstrap until the Ledger can back-test samplers**, as the engine design asked. Rejected: the Ledger needs finished milestones, and v1 would ship overconfident ranges in the meantime. This decision rests on synthetic evidence instead.
- **Show only the short-history note.** Rejected: the note admits the range is too narrow but doesn't fix it. The new sampler fixes part of it and made no team type's forecast less accurate.

## Consequences

- Ranges are wider, most of all for short or lumpy histories, and the extra width shrinks as history grows. This is intended.
- It doesn't fix forecasts for teams whose pace is changing (#42).
- The sampler does a little setup on every simulated run, not just once per forecast.
- Every forecast changes, so `engineVersion` goes up.
- Keeping it right needs no statistics: a calibration test (#45) simulates steady teams and fails with a plain-language message if forecasts become overconfident again. Once the Ledger has real forecasts, its track record takes over that check.
