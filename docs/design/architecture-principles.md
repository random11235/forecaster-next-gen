# Architecture: Principles

Part of the architecture design; the index is [`architecture.md`](architecture.md).

1. **Keep the layers apart** (described in [`forecast-model.md`](forecast-model.md#data-model)):
   - observed facts from the ticketing tool (append-only)
   - derived samples (can be recomputed, so they can live in the cache)
   - user settings
   - forecasts (never changed once written)
2. **The engine is a pure function: `simulateCase(SimulationCase) → ForecastResult`.** It does no I/O, uses no clock, and gets all its randomness from a seed in the case. That makes forecasts reproducible, and it makes the calibration ledger trustworthy.
3. **Store samples, not summaries.** Keep the raw growth ratios and weekly throughputs, not just a mean or min/max. That keeps the tail, and it lets you change the sampling method later.
4. **Key data by team, not by user.** Throughput belongs to a team. v1 has one team, but keeping every store keyed by `teamId` means a later multi-team phase needs no migration.
5. **Measured data suggests; the EM decides.** Wherever measured data could replace an EM input (pace, the medium growth range), the tool uses it only because the EM chose it as the value's source: following the tracker, the value updates on each read; typed, the EM's value stands, with a chip when the tracker reads it differently. Nothing is accepted, so no accepted copy is kept (#159, superseding #132's "values the EM accepted are kept").
