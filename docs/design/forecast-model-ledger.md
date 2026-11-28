# Forecast model: calibration ledger

Part of the forecast model design; the index is [`forecast-model.md`](forecast-model.md), which has the settings.

## Layer 5: calibration ledger

(Layer 4 is the engine contract, in [`engine.md`](engine.md#engine-contract).)

```ts
ForecastLog   { id /* from 1, in the order the team's are logged */, createdAt /* UTC instant, stamped by storage */,
                teamId, milestoneName /* the MVP has one milestone per team, with no ID */,
                simulationCase /* the full SimulationCase, as JSON */,
                result /* the whole ForecastResult: caseHash, quantiles, percentileDates and the rest */,
                appVersion /* the release that made it, package.json's version (APP_VERSION);
                              the engine's is the case's engineVersion */ }
                /* v1 adds createdBy and targetEpicIds, and milestoneId once milestones have one */

Outcome       { id, teamId, milestoneId, forecastLogId, targetEpicIds,
                actualDoneAt, actualFinalCount, recordedAt }

ForecastScore { forecastLogId, outcomeId,
                pit /* fraction of trials that finished before the actual;
                       trials that hit the horizon count as finishing after it */,
                hit: Record<percentile, boolean> }
```

Storing 101 quantiles, not just p50/p85/p95, gives every forecast a PIT value: the share of simulated trials that finished before the actual date. A histogram of PIT values across many forecasts is a direct calibration check ("our 85% dates were met 78% of the time"). It also gives the empirical correction factor the [research](../research/forecasting-approaches.md#implications-for-a-new-tool-synthesis) recommends (Jørgensen [27]).

Every forecast is logged from the first run (#27): the one the Milestone forecast screen shows, in `src/ledger/ledger.ts`'s shape, not the runs it is compared with (capacity's, each entry's effect, a pace action's). Shown again on the same case by the same release, it isn't logged again: the case alone gives the same result. A logged forecast is re-run from its case alone (`rerunForecast`), unless another engine version logged it. Its case and result are a stored shape: changing `SimulationCase` or `ForecastResult` needs a migration step or a reader for the older shape ([`engine.md`](engine.md#engine-contract)). Whether a forecast is the one last logged is read from the last log's header alone (its release, milestone's name, and case's hash, read out of its result), so a log whose case or result this version can't read never stops the screen. In the SQLite file, a last log whose result gives no case hash (not JSON, or none in it) has no header, so the forecast is logged again after it. The web build keeps the ledger in browser storage under a key of its own, `forecaster.ledger`, apart from the EM's other data, and keeps at most a million characters of it there, about a fifth of what a browser gives a site, a few hundred logs: past that, it drops the oldest logs to keep the newest, so the ledger never takes the room the EM's other data needs. It keeps each team's last ID given, so a dropped log's ID is never given again. A `forecaster.ledger` value this version can't read is kept as it is: the forecast is still shown, just not logged. That value is read whole, so a single log in it this build can't read stops all further logging in the web build until the value can be read again. Each save and read reads the value again, so the page's tabs log one after another. Storage only ever adds one: nothing in the app changes a logged forecast, and only the web build's bound removes one. The schema doesn't refuse it, so a later migration step can backfill; refusing it is deferred to hosted or multi-team use ([`architecture-security.md`](architecture-security.md)). The track record is shown only once `minResolvedMilestones` milestones have an `Outcome`.
