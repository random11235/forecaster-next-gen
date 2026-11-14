# Front-end design: essentials

Design date: 2026-10-14. Updated 2026-10-18 with the design grill decisions (Q1–Q31). Status: agreed in planning; not built.

**The MVP overrides the screens below.** The MVP has the same two screens, cut down: the Milestone forecast shows the milestone's finish dates at 50/70/85/95% from its start date, the pace in use (its range, or its typed counts), a graph of when the simulations (trials) finish by period of the team's cadence with those dates marked (reversing the histogram's removal below) and the warnings on what was typed; Inputs takes the milestone's name, start date and tickets remaining, the cadence, the pace (a range or typed counts, and which the forecast uses), the milestone's ambiguity level, and the editable ambiguity ranges. The epic table, commits, measured pace, the growth sample count, workflow settings and team changes follow it.

**Capacity** sits on the Milestone forecast, beside the forecast it changes:
- **The capacity section** is folded under Pace in the sidebar, its summary line saying "none, every week usual" or how many entries there are. Open, it says "100% = the team's usual week, as in the pace", lists the team's entries earliest first (each with Remove, and a warning above 150%), takes another as one sentence ("The team is at 50% from 21 Dec to 1 Jan, or onward, for leave") and states the assumptions: pace scales in proportion, weekends don't count, overlapping entries multiply, past counts aren't adjusted. A refused sentence reopens it with the reason, keeping what was typed.
- **The comparison table.** With capacity in use, "When it could finish" gives the 50%, 85% and 95% dates with capacity and at usual capacity, and the shift between them; a quiet line under the headline says how far capacity moves the 85% date.
- **The chart's shading.** The finish graph, headed "Week by week" ("Sprint by sprint" at another cadence), shades each period whose capacity isn't 100% and labels it with its percentage, rounded; its hover text adds "At 80% capacity." and its caption explains the shading. Each bar's capacity is its period's average over the working days, as the forecast uses it.

**The pace pattern** sits under the Pace bars in the sidebar, as one folded line naming the pattern with the team's numbers ("Stepped up · about 4 a week, then 8 since 12 Oct"). Open, it says what the pattern means and what to do; when it offers an action (Start from 12 Oct, or Leave out 12 Oct), it gives the 85% date now and with the action, from the same seed, and the action's button. Too few periods to read, the line alone says so, faintly ("No pattern yet · 5 weeks is too few to tell"). An applied action is said under the line with Undo ("Counting pace from 12 Oct, after it stepped up. Undo"), and no other action is offered while it is. An action is offered even when it would leave fewer counts than the forecast needs: applied, the screen shows the too-few-counts problem to fix, with the applied action and Undo under it.

This is the minimal front-end for the Forecaster, reduced from a first prototype after review. It follows the architecture in [`../research/EM_usecase-arch.excalidraw`](../research/EM_usecase-arch.excalidraw) and the method recommended in [`../research/forecasting-approaches.md`](../research/forecasting-approaches.md). The engine is described in [`engine.md`](engine.md), and the rest of the system in [`architecture.md`](architecture.md).

v1's scope (single team, local, SQLite) is in the architecture's [v1 assumptions](architecture.md#v1-assumptions). The app is started with one command and opened in the browser. The first usable version runs on canned data, before any connector exists.

Thresholds and default ranges below (growth samples, pace weeks, stale weeks, finished milestones, ambiguity ranges) are set in the forecast model's [settings](forecast-model.md#layer-3-settings); this doc names them rather than repeating the numbers.

---

## Principles

1. **Only the essential.** Every element answers a question the EM must answer.
2. **Measured, not guessed, and earned before it's used.** Every number is counted from the ticketing tool or entered by the EM. Measured data replaces an EM input only when the EM chooses the tracker as its source; a typed value the tracker reads differently carries a chip that offers to follow it, and is never overwritten.
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
| 5 | Growth | The EM sets each epic's ambiguity: low, medium (default) or high, each mapped to an editable growth range (`AmbiguityRanges`). Growth samples from finished committed epics, in the tool or by label, are pooled per team. Once `minGrowthSamples` exist, the measured range is suggested for medium and the EM decides whether to adopt it. Uncommitted epics are still forecast, labelled "not committed: wide range". |
| 6 | Pace | Once the EM adds comparable work, counts its finished tickets alone (the milestone's own only if it is picked in it); with none, or one matching nothing finished, the milestone's own since its start date. KTLO and unrelated work count only if a query picks them out, so time spent on them shows up as slower pace rather than inflating it. Starts as a manual low–high range per week. Older data may pre-fill it, labelled as a suggestion. Nothing from before installation is used automatically. Once the milestone has `minMeasuredPaceWeeks` of its own throughput, measured pace is shown beside the manual range with an offer to switch. |
| 7 | Team change | The EM records the date. The measured window restarts, the EM is prompted to review the manual range, and pace is flagged stale until `staleWeeksAfterTeamChange` of new data exist. |
| 8 | Capacity | Typed by the EM beside the forecast, as date ranges at a share of the team's usual; see Capacity above. |
| 9 | Track record | One line on the forecast screen, under the pace lines: how often past "85% confident" dates were met. Shown only once `minResolvedMilestones` milestones have finished; before that, nothing is shown in its place. |
| 10 | Cycle time | From the status mapped as "started" to done. A wide spread or ageing tickets raise a warning that ticket-size discipline has slipped. |

---

## Screens

### 1. Milestone forecast (EM home)

Architecture: `displayDashboard`, `latestForecast`, `update` (forces cache refresh).

```
Checkout v2 · committed 18 Dec                 Jira data as of 13 Oct 07:10 [Refresh]
─────────────────────────────────────────────────────────────────────────────
 Gap to committed date
   67% chance by 18 Dec · 85% confident by 1 Jan (14 days after committed)

 How the gap has moved (one point per weekly forecast)
   Chance by 18 Dec   82% ─ 80% ─ 74% ─ 67%
   85% confident by   12 Dec · 15 Dec · 25 Dec · 1 Jan
                      15 Sep   22 Sep   6 Oct    13 Oct

 Pace: manual range 6–10 per week (measured pace available in 3 weeks)
 Pace counts comparable work's finished tickets
 ⚠ Refunds is in progress but isn't committed
─────────────────────────────────────────────────────────────────────────────
 Epics in this milestone   Items now   Ambiguity   Pace (4 wk)   Status
 Card vaulting              6          Low         2.0 / wk      Committed
 Refunds                   14          Medium      1.5 / wk      Not committed: wide range
 Receipts redesign          3          High        —             Blocked
```

Per-epic pace is information only and never feeds the forecast.

### 2. Inputs

Architecture: split rate estimator, `splitRatesSet/Get`, `settingsSet/Get`, `milestonesSet/Get`.

Each input saves as the EM changes it, with no save buttons: a small inline script posts the changed form, swaps in the screen's sections from the reply and notes "Saved" beside the section; a refusal shows its reason in its own section, keeping what was typed. Without the script the buttons show and each form posts as before. Typed counts are edited as one list.

The Connect step, first in the local server build, is the exception: it posts only when its Connect (or Change connection) button is pressed. Its check asks the tracker, so a save as each field changes would send a half-typed repo or token to it, and refuse each keystroke as not found; and the token, never put back into the page, can't be kept between saves.

#### The setup steps

In the local server build, the Inputs screen opens on setup (#217): four steps, Connect, Milestone, Comparable work and Check, shown one at a time above the inputs, under a list of the four with the current one marked and each done one a link back to it. Back goes to the step before; Next goes on, shown once the step can be left forward: Connect once connected, Milestone once the milestone has a query, Comparable work always (reading Skip until it has a query). Check closes setup with **Use these**, refused until connected with a milestone query. The step shown is in the URL (`?step=`), Milestone at the screen's own URL; a later step asked for before the milestone has a query opens Milestone. Connect's **Skip: type the inputs instead** closes setup to the inputs typed, as the MVP has them, with **Connect a tracker** to open the steps again.

Once set up, the steps give way to a summary above the Milestone and Pace sections: the tracker, the repo or Jira project, and when the milestone query was last read, with **Change** to open the steps again at Milestone, the connection and queries as they were. Beneath that line, a **Milestone** row and a **Comparable** row say what the forecast reads (#219): each names its picks in the order picked, each with its kind as the tracker has it ("#41 Checkout v2 (epic), #57 Search revamp (epic)"; on Jira fix version, epic or label), or shows the query as written when the EM wrote it by hand and the picker can't show it as chips. There is no Comparable row without comparable work. "Leaf tickets only. Epics include their sub-epics." follows, once. Under it only problem flags show, each naming its query as its step does ("Milestone query: …"), in the step's own words: a read incomplete, the milestone query matching nothing, or comparable work's matching nothing finished, so pace is the milestone's own. A working setup shows none. A query out of scope or rejected is refused when submitted, so no saved query is; those flags come from a failed read again. Set up, the screen asks the tracker nothing, its choices included: it shows the saved reads. How setup was closed, done or skipped, is saved per team; a team connected with a milestone query before setup existed opens set up.

#### The query steps

Once connected, two query steps follow the Connect step, each picking or writing one of the team's queries the same way: the Milestone step the milestone query, then the Comparable work step comparable work's, kept apart from the milestone's and left as it was when the milestone is renamed or its start date changes. Every Inputs screen the local server build serves during setup, a refused form's and a save in place included, has the step shown; a save in place lists no choices, as the script doesn't replace the steps.

- **Finding.** The step asks the tracker for the choices once as it opens, kept nowhere, and lists them by kind, filtered by what the EM types, less those already picked; a kind with more than the tracker lists is searched in the tracker as the EM types. Each pick and each removal posts at once, and the picks are saved with the query they join into with OR, read once.
- **Edit as a query.** A query edited by hand is saved as written and read the same way, on submit only. Free text and an empty qualifier are refused first; nothing else is checked. It comes back as chips when it is an OR of choices' queries, each named once; a part not among the choices listed is searched for by what it names. The step opens the query for editing when the EM asks or when the picker can't show it as chips; then Back to finding warns that it will clear the query, and clears it only once the EM confirms.
- **Refused.** A query is saved only once read, unless the read says it is wrong: the tracker rejecting it (with its message) or it reaching outside the connection refuses it, and the last query that worked stays in use with its saved read. A hand edit stays open for editing, as typed, with why; a change of the picks stays finding, with why beside the chips that worked.
- **The read.** The query's last read is one line, "50 open · 43 finished in the last 8 weeks". One that matched nothing is accepted and flagged beside its line; one that is incomplete is accepted and flagged in place of its line, as part of a count would pass for the count.
- **Comparable work** is optional. Its read line counts finished tickets only, and nothing extra is read without a query. It leads with its pace: the pace in use, how far it is from the milestone's own, and the two paired per period, with each pick's own strip on its chip; its pace flags it as not used when it finished nothing in the periods pace counts. Its Next reads Skip until it has a query, and goes on to Check; Start afresh, once it has one, clears its picks and query at once.
- **Candidates.** The Comparable work step's choices are candidates, read on demand (#205): opening the step reads none; each the EM opens (its **pace** link), or the few its typing narrows the lists to, is read once per opening and never saved, then shown below the picker grouped slower, about the same or faster than the milestone's own, by median when the milestone has too few periods of its own, then nothing finished and reads that failed, each with why. The page keeps its opening by an id, so its script reads more in the same one. The choice that is the milestone query is marked "this milestone".
- **A renamed milestone.** When the EM renames the milestone on this screen, a milestone query that is just the tracker's milestone or Jira fix version of the old name, one chip, moves to the one of the new name, when the tracker has one, and is read again; any other milestone query is left as it was.
- **Reads differently** (#215). A typed value, tickets remaining or the typed counts or range in use, that differs from the tracker's latest reading carries a small chip, "GitHub reads differently" (Jira on Jira); typed counts differ unless they are the reading's counts, and a range unless it spans them, slowest to best. The chip takes no space until opened: it opens on the reading and "Follow GitHub", which switches the value's source back to the tracker, keeping the typed value. A dot on it marks a read the EM hasn't opened; opening it clears the dot (the page's script posts it, keeping the read's `readAt` in `seenReads`) until the next read. No chip while the value follows the tracker, equals the reading, or the reading counts no periods.

| Section | Shows | Source |
|---|---|---|
| Milestones | Name, committed date, epics in rank order; commit / uncommit each epic; ambiguity per epic | EM |
| Pace | Manual low–high range per week; suggested range and its basis; measured pace and weeks of data once available, with the offer to switch | EM; measured as a suggestion |
| Growth | Ambiguity ranges (editable); the number of growth samples; the suggested medium range once enough exist (decision 5) | EM; measured as a suggestion |
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
| Full percentile table | The 50%, 70%, 85% and 95% dates answer the question. |
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
