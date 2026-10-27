# Front-end design: essentials

Design date: 2026-10-14. Updated 2026-10-18 with the design grill decisions (Q1–Q31). Status: agreed in planning; not built. The v1 spec is [issue #6](https://github.com/random11235/forecaster-next-gen/issues/6).

This is the minimal front-end for the Forecaster, reduced from a first prototype after review. It follows the architecture in [`../research/EM_usecase-arch.excalidraw`](../research/EM_usecase-arch.excalidraw) and the method recommended in [`../research/forecasting-approaches.md`](../research/forecasting-approaches.md). The engine is described in [`monte-carlo-engine.md`](monte-carlo-engine.md).

v1's scope (single team, local, SQLite) is in the engine design's [v1 assumptions](monte-carlo-engine.md#v1-assumptions). The app is started with one command and opened in the browser. The first usable version runs on canned data, before any connector exists.

Thresholds and default ranges below (growth samples, pace weeks, stale weeks, finished milestones, ambiguity ranges) are set in the engine design's [settings](monte-carlo-engine.md#layer-3-settings); this doc names them rather than repeating the numbers.

---

## Principles

1. **Only the essential.** Every element answers a question the EM must answer.
2. **Measured, not guessed, and earned before it's used.** Every number is counted from the ticketing tool or entered by the EM. Measured data replaces an EM input only when the EM accepts it.
3. **Say when the data is thin.** Too little data is reported as exactly that, never hidden behind a confident-looking date.
4. **Nothing outside the architecture.** No feature that needs a component the diagram does not have (e.g. LLM suggestions, HR calendar sync).

---

## Decisions

| # | Topic | Decision |
|---|---|---|
| 1 | Milestone | A Forecaster concept: a name, a committed date and a set of epics in rank order. Not tied to any ticketing tool's implementation (Jira fix versions, labels, etc.). The connector only supplies epics and their tickets. Stored in the Forecaster's local database. |
| 2 | Forecast gap | The headline. The chance of finishing by the committed date, and how many days the 85% date falls after it, plus how both have moved across previous forecasts. Only the milestone date is shown; per-epic dates are not. |
| 3 | Forecast history | Every forecast is logged from the first run. The Forecaster reads its own log (`forecastLogGet`). |
| 4 | Committing an epic | Manual. The EM commits an epic after kickoff (after spikes, the backlog and team alignment), which records its child count as the baseline. Optionally, a configured label in the ticketing tool commits it. A pull-back to not started resets the commit; the EM commits again on restart. A blocked epic keeps its commit, stays in scope and is flagged. The tool warns when an epic is in progress but isn't committed. The tool doesn't identify spikes ([ADR-0002](../adr/0002-no-spike-rule.md)). |
| 5 | Growth (split rate) | The EM sets each epic's ambiguity: low, medium (default) or high, each mapped to an editable growth range (`AmbiguityRanges`). Growth samples from finished epics committed in the tool are pooled per team. Once `minGrowthSamples` exist, the measured range is suggested for medium and the EM decides whether to adopt it. Uncommitted epics are still forecast, labelled "not committed: wide range". |
| 6 | Pace | Counts only tickets under this milestone's epics, so KTLO and unrelated work show up as slower pace rather than inflating it. Starts as a manual low–high range per week. Older data may pre-fill it, labelled as a suggestion. Nothing from before installation is used automatically. Once the milestone has `minMeasuredPaceWeeks` of its own throughput, measured pace is shown beside the manual range with an offer to switch. |
| 7 | Team change | The EM records the date. The measured window restarts, the EM is prompted to review the manual range, and pace is flagged stale until `staleWeeksAfterTeamChange` of new data exist. |
| 8 | Capacity | Fixed in v1 until the last step of the build order, when absences are entered as a share of capacity per week. Until then the absence input is hidden. |
| 9 | Track record | One line on the forecast screen, under the pace lines: how often past "85% sure" dates were met. Shown only once `minResolvedMilestones` milestones have finished; before that, nothing is shown in its place. |
| 10 | Cycle time | From the status mapped as "started" to done. A wide spread or ageing tickets raise a warning that ticket-size discipline has slipped. |

---

## Screens

### 1. Milestone forecast (EM home)

Architecture: `displayDashboard`, `latestForecast`, `update` (forces cache refresh).

```
Checkout v2 · committed 18 Dec                 Jira data as of 13 Oct 07:10 [Refresh]
─────────────────────────────────────────────────────────────────────────────
 Gap to committed date
   67% chance by 18 Dec · 85% sure by 1 Jan (14 days after committed)

 How the gap has moved (one point per weekly forecast)
   Chance by 18 Dec   82% ─ 80% ─ 74% ─ 67%
   85% sure by        12 Dec · 15 Dec · 25 Dec · 1 Jan
                      15 Sep   22 Sep   6 Oct    13 Oct

 Pace: manual range 6–10 per week (measured pace available in 3 weeks)
 Pace counts tickets under this milestone's epics only
 ⚠ Refunds has 4 tickets in progress but isn't committed
─────────────────────────────────────────────────────────────────────────────
 Epics in this milestone   Items now   Ambiguity   Pace (4 wk)   Status
 Card vaulting              6          Low         2.0 / wk      Committed
 Refunds                   14          Medium      1.5 / wk      Not committed: wide range
 Receipts redesign          3          High        —             Blocked
```

Per-epic pace is information only and never feeds the forecast.

### 2. Inputs

Architecture: split rate estimator, `splitRatesSet/Get`, `settingsSet/Get`, `milestonesSet/Get`.

| Section | Shows | Source |
|---|---|---|
| Milestones | Name, committed date, epics in rank order; commit / uncommit each epic; ambiguity per epic | EM |
| Pace | Manual low–high range per week; suggested range and its basis; measured pace and weeks of data once available, with the offer to switch | EM; measured as a suggestion |
| Growth | Ambiguity ranges (editable); the number of finished committed epics; the suggested medium range once enough exist (decision 5) | EM; measured as a suggestion |
| Team | Date of the last team change | EM |
| Settings | Ticketing board; which statuses mean not started / started / done / cancelled; optional commit label | EM |
| Capacity | Absences as a share of capacity per week (hidden until decision 8's step ships) | EM |

All figures above are sample data.

---

## Removed from the first prototype

| Removed | Reason |
|---|---|
| Suggested option ("drop X to raise the chance to 84%") | Implies LLM integration, which is not in the architecture. |
| Scenario comparison | Not essential for a first version; can return later as a `simulateCase` run. |
| Histogram of finish weeks, full percentile table | The chance by the committed date and the 85% date answer the question. |
| Changes-since-last-forecast breakdown | Replaced by the gap trend. |
| Throughput scaling assumption (linear / diminishing / manual) | Not data-driven and reduces transparency. Replaced by decisions 6 and 7. |
| Per-person allocation grid | Too fine-grained; absences are entered as a short list. |
| HR calendar sync | New feature outside the architecture. |
| Calibration screen | Reduced to the track-record line; the full log stays in the database. |
| Team switcher | v1 is single-team. |
| Roadmap screen and "Publish to roadmap" | v1 is single-team with no aggregator. Moved to the multi-team phase, together with cross-team reference split rates and permissions. |
| Per-epic forecast dates | The engine spends pace on epics one at a time, so per-epic dates are unreliable when epics run in parallel. |

Ageing work in progress and understanding levels, both removed earlier, came back in a narrower form: ageing as a warning (decision 10) and understanding as per-epic ambiguity (decision 5).

---

## Architecture changes

Made in `EM_usecase-arch.excalidraw`, on the Forecaster ↔ database link:

- `forecastLogSet` → `forecastLogSet/Get` (decision 3).
- Added `milestonesSet/Get` (decision 1).

Not yet reflected in the diagram, and pending an update:

- The aggregator, stakeholders and `projectForecastSummary` are outside v1.
- The database is a local SQLite file, and the cache is part of the local app.

---

## Open questions

- How the suggested pace range is worked out when there is no previous milestone (e.g. recent tickets under any epic, or left blank).
- What an EM sees on first run with canned data, and how they move from it to their own board.
