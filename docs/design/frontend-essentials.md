# Front-end design: essentials

Design date: 2026-10-14. Status: agreed in planning; not built.

This is the minimal front-end for the Forecaster, reduced from a first prototype after review. It follows the architecture in [`../research/EM_usecase-arch.excalidraw`](../research/EM_usecase-arch.excalidraw) and the method recommended in [`../research/forecasting-approaches.md`](../research/forecasting-approaches.md).

---

## Principles

1. **Only the essential.** Every element answers a question the EM or a stakeholder must answer.
2. **Measured, not guessed.** Every number is counted from the ticketing tool or entered by the EM. No hidden scaling assumptions.
3. **Nothing outside the architecture.** No feature that needs a component the diagram does not have (e.g. LLM suggestions, HR calendar sync).

---

## Decisions

| # | Topic | Decision |
|---|---|---|
| 1 | Milestone | A Forecaster concept: a name, a committed date and a set of epics. Not tied to any ticketing tool's implementation (Jira fix versions, labels, etc.). The connector only supplies epics and their tickets. Stored in the Forecaster's database. |
| 2 | Forecast gap | The headline. The chance of finishing by the committed date, and how many days the 85% date falls after it, plus how both have moved across previous forecasts. |
| 3 | Forecast history | The Forecaster reads its own log directly (`forecastLogGet`), so the EM view does not depend on the aggregator. The aggregator (the "analyser") reads it separately for cross-team analysis. |
| 4 | Split rate | One per team, measured from completed epics (final item count ÷ count when committed). Below about 7 completed epics, fall back to other teams' reference rates from the aggregator (`referenceSplitRatesGet`). Understanding levels are dropped for now; add them only if the forecast log shows split rates differ by level. |
| 5 | KTLO (incidents, second-party support) | In v1, pace counts every ticket the team finishes, including KTLO, bugs and tickets outside any epic. All of it is spent on the milestone's epics, so forecasts are optimistic by roughly the share of non-milestone work. Every screen that shows pace or a forecast says so ("Pace includes all completed tickets, including KTLO"). A later feature lets the EM filter which tickets count as pace (engine doc: Deferred, "Throughput filter"). |
| 6 | Capacity | Pace is measured for the current team setup. After a team change, the previous setup's pace is used until 4 weeks of new data exist; no assumption about how output scales with headcount. Absences and holidays are entered manually by the EM. |
| 7 | Track record | One line on the forecast screen: how often past "85% sure" dates were met, read from the forecast log. |

---

## Screens

### 1. Milestone forecast (EM home)

Architecture: `displayDashboard`, `latestForecast`, `update` (forces cache refresh), `projectForecastSummary` (publish).

```
Checkout v2 · committed 18 Dec                 Jira data as of 13 Oct 07:10 [Refresh]
─────────────────────────────────────────────────────────────────────────────
 Gap to committed date
   67% chance by 18 Dec · 85% sure by 1 Jan (14 days after committed)

 How the gap has moved (one point per weekly forecast)
   Chance by 18 Dec   82% ─ 80% ─ 74% ─ 67%
   85% sure by        12 Dec · 15 Dec · 25 Dec · 1 Jan
                      15 Sep   22 Sep   6 Oct    13 Oct

 Track record: our "85% sure" dates were met 78% of the time
 Pace includes all completed tickets, including KTLO
                                            [Publish to roadmap] last published 6 Oct
─────────────────────────────────────────────────────────────────────────────
 Epics in this milestone      Items now   Status
 Card vaulting                 6          In progress
 Refunds                      14          In progress
 Receipts redesign             3          Not broken down (wide default range used)
```

### 2. Inputs

Architecture: split rate estimator, capacity calendar, `splitRatesSet/Get`, `settingsSet/Get`, `milestonesSet/Get`.

| Section | Shows | Source |
|---|---|---|
| Milestones | Name, committed date, epics in it | EM |
| Pace | Items finished per week for the current team setup, weeks of data, and the note "includes all completed tickets, including KTLO" | Measured |
| Split rate | Team's typical split rate and the number of epics behind it | Measured; falls back to reference rates from the aggregator |
| Capacity | Absences and holidays (from, to, who) | EM |
| Settings | Ticketing board, which statuses mean started / done, when an epic counts as committed | EM |

### 3. Roadmap (aggregator; stakeholders; read-only)

Architecture: aggregator, `projectForecastSummary`, `projectTrendsGet`. A separate tool with no links into the Forecaster; stakeholders see only what EMs have published.

```
 Team       Milestone        Committed   Chance   85% sure by   vs previous    Published
 Payments   Checkout v2      18 Dec      74%      25 Dec        ▼ 6 pts        6 Oct (not updated for 8 days)
 Platform   Observability    30 Nov      92%      20 Nov        —              12 Oct

 Forecasts use pace from all completed tickets, including KTLO
```

The roadmap shows the last *published* forecast, so it can lag the EM's latest run (Checkout v2 is 67% in the Forecaster but 74% here until the EM publishes again). Forecasts not published for more than a week are flagged.

Prototype screens for this design: the "v2 — essentials" row of the prototype canvas (E1–E3).

All figures above are sample data.

---

## Removed from the first prototype

| Removed | Reason |
|---|---|
| Suggested option ("drop X to raise the chance to 84%") | Implies LLM integration, which is not in the architecture. |
| Scenario comparison | Not essential for a first version; can return later as a `simulateCase` run. |
| Histogram of finish weeks, full percentile table | The chance by the committed date and the 85% date answer the question. |
| Changes-since-last-forecast breakdown | Replaced by the gap trend. |
| Ageing work in progress | Flow management, not forecasting. |
| Understanding levels | Extra input for the EM with no evidence yet that it improves forecasts. |
| Throughput scaling assumption (linear / diminishing / manual) | Not data-driven and reduces transparency. Replaced by decision 6. |
| Per-person allocation grid | Too fine-grained; absences are entered as a short list. |
| HR calendar sync | New feature outside the architecture. |
| Calibration screen | Reduced to the track-record line; the full log stays in the database. |
| Team switcher | Raises an unresolved access-control question. |

---

## Architecture changes

Made in `EM_usecase-arch.excalidraw`, on the Forecaster ↔ database link:

- `forecastLogSet` → `forecastLogSet/Get` (decision 3).
- Added `milestonesSet/Get` (decision 1).

---

## Open questions

- How should the Forecaster handle a sustained change in KTLO load (decision 5) once it is visible in the data? While pace counts KTLO tickets, a KTLO spike raises measured pace even though less milestone work gets done.
- Which tickets the later pace filter (decision 5) should offer: children of milestone epics, children of any epic, or by work type.
- Permissions and access control (noted on the architecture diagram) are not yet designed: who may define milestones, publish, and see other teams.
