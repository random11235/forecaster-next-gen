# Forecast model: design

Design date: 2026-10-14. Updated 2026-10-18 with the design grill decisions (Q1–Q31). Status: draft for v1. The v1 spec is [issue #6](https://github.com/random11235/forecaster-next-gen/issues/6).

This covers the data behind `samples/` and `forecast/` (Seam B's logic): the facts ingested, the samples derived from them, the EM's settings and the calibration ledger, with the rules for committing, pull-backs and growth.

**The MVP overrides most of this.** The MVP ([#84](https://github.com/random11235/forecaster-next-gen/issues/84)) ingests no facts and derives no samples: the EM types a milestone's start date, tickets remaining and a pace (a range, or typed counts) per period of the team's cadence, and the forecast grows the tickets by the range of the milestone's one ambiguity level. Committing, pull-backs, blocked epics, the uncommitted-but-active warning, per-epic ambiguity, team facts, workflow settings, measured pace and measured growth follow it, and their code was deleted in #87; the tables that held them stay in the data file, unread. Of Layer 3, the MVP keeps `trials`, `percentiles`, `maxPeriods` and the editable `AmbiguityRanges`, plus a fixed `seed` and `typedCounts`, how many typed counts the pace needs to forecast (4: with 2 or 3 the dates jump as counts are added, [#116](https://github.com/random11235/forecaster-next-gen/issues/116)) and to be reliable (8); `periodDays` gives way to the milestone's cadence ([#90](https://github.com/random11235/forecaster-next-gen/issues/90)). Each section below that the MVP sets aside says so.

It depends on the layers, folders and dependency rules in [`architecture.md`](architecture.md), and feeds the engine described in [`engine.md`](engine.md). Its terms are defined in [`GLOSSARY.md`](../../GLOSSARY.md).

---

## Data model

### Layer 1: observed facts (ingested)

*Follows the MVP: it ingests nothing.*

```ts
Team          { id, name, source: 'manual'|'sample'|'jira'|'github', sourceRef, installedAt }

WorkflowSettings { teamId,            // set by the EM; one per team
                statuses: { status, category: 'notStarted'|'started'|'done'|'cancelled' }[],
                startedStatus,       // the status where cycle time starts; one mapped to started
                startedSignal?,      // later, with the GitHub connector: the label, project column or assignee
                                     // that means "started"; not in the model yet
                commitLabel?,        // optional label that commits an epic when applied
                blockedRule: { statuses, labels } }  // statuses and/or labels (flags) that mark an epic blocked

WorkItem      { id, teamId, sourceKey, type: 'story'|'bug'|'task'|'epic'|...,
                parentId?, labels, createdAt, startedAt?, doneAt?, cancelledAt?, lastSyncedAt }

WorkItemEvent { itemId, at, kind: 'status'|'parent'|'type'|'label', from?, to? }
```

`WorkItemEvent` holds parent-change history (Jira changelog, GitHub sub-issue events). That history tells you how many children an epic had at any point in time, which is what makes growth measurable.

The forecast reads `startedAt`, `doneAt` and `cancelledAt` from each ticket's status history under the team's `WorkflowSettings` (**team facts**, `forecast/teamFacts.ts`), so changing the mapping changes which tickets count as done. `startedAt` is when the ticket first entered `startedStatus`. A ticket that skipped it starts when it first entered any status mapped to started, or, if it skipped those too, when it first entered one mapped to done, so work that jumps columns still has a cycle time. On GitHub, `startedSignal` will set it instead, once that connector adds it. A status the EM hasn't mapped counts as not started. Cycle time is `startedAt → doneAt`. Created-to-done (lead time) is not used in v1.

Ingestion follows data minimisation (see [Security](architecture.md#security)). On GitHub, an assignee used as `startedSignal` is read only as "has an assignee".

### Layer 2: derived samples (recomputable, cacheable)

*Follows the MVP, including the rules for committing, pull-backs, blocked epics and the warning below: it derives no samples.*

```ts
EpicCommit       { teamId, epicId, committedAt,
                   baseline }            // children at commit; stored as child_count_at_commit.
                                         // Team facts adds source: 'inTool'|'label' to the commits that stand

GrowthSample     { epicId, teamId, committedCount, finalCount,
                   ratio /* finalCount / committedCount */, completedAt }

EpicSizeSample   { epicId, teamId, finalCount, completedAt }

ThroughputSample { teamId, milestoneId, periodStart, periodDays /* 1 | 7 */,
                   scope: 'milestoneEpics', count }
```

#### Committing

The EM commits an epic in the tool after kickoff, or a configured label in the ticketing tool commits it. The commit records the epic's child count at that moment, its **baseline**. A label commit is not stored: on each read, `samples/commits.ts` finds each time the epic's label history applies `commitLabel`, and counts the children it had then from the tickets' creation, parent and status history (cancelled children don't count). So setting the commit label commits each epic that already carries it, as of when it was applied.

The two count the same: the first commit since the last [pull-back](#pull-backs) stands, however it was made, so while one stands, neither the EM nor applying the label again replaces it. Only the EM's latest commit is stored. Either kind of commit counts towards the growth ratio.

Removing the label doesn't uncommit the epic: the Milestone forecast warns "<epic> is committed but no longer has the “<label>” label" until it is put back or the epic is done or cancelled, for the EM to put the label back or remove the epic from the milestone. A commit made in the tool is never warned about.

Team facts carries the commits that stand, with their source (`'inTool'` or `'label'`), and the epics whose label commit a pull-back reset (`labelCommitsReset`).

#### Pull-backs

A **pull-back** (the epic moving from a status mapped to started back to one mapped to not started) resets the commit, and the EM commits again on restart, in the tool or by applying the label again. Like a label commit, the reset is not stored: `samples/commits.ts` checks the epic's status history under the team's `WorkflowSettings` for a pull-back after `committedAt`, so changing the status mapping can change which commits stand. A move into or out of the blocked rule is not a pull-back (see [Blocked epics](#blocked-epics)).

The label commits only when applied, so a pull-back with the label still on leaves the epic uncommitted while it carries the label; the tool doesn't recommit it on restart, which would surprise the EM. The Milestone forecast warns instead: "<epic> has the “<label>” label but isn't committed: it moved back to not started after the label went on. Commit it on Inputs, or take the label off and put it back." It needs a label commit the pull-back reset, so an epic carrying the label with no record of it going on isn't warned, and it stops once the epic is done or cancelled. For that epic this replaces the [uncommitted-but-active warning](#the-uncommitted-but-active-warning).

#### Blocked epics

An epic in a status, or with a label, of `blockedRule` is flagged "Blocked" in the Milestone forecast's epic list. It keeps its commit: a move into or out of a blocked status is not a pull-back, even to or from a status mapped to not started, nor is a move to not started while the epic carries a blocked label. An epic out of scope is removed from the milestone explicitly. A blocked epic stays in the milestone and is forecast like any other epic.

#### The uncommitted-but-active warning

An epic whose own status is mapped to started, with no commit standing, is flagged "<epic> is in progress but isn't committed". Its children's statuses play no part, so the tool needs no rule for which tickets are spikes ([ADR-0002](../adr/0002-no-spike-rule.md)).

#### Samples

Only committed epics (in the tool or by label) that have since finished produce samples. Epics committed with no children (`committedCount` of 0) produce no `GrowthSample`, since their ratio is undefined. They still produce an `EpicSizeSample`. A label commit counts however long ago the label was applied, even before installation: label commits are commits, so a team that committed by label before installing the tool has its growth measured from day one.

#### Throughput

`ThroughputSample`s count done tickets whose parent is one of the milestone's epics. Because `WorkItem.parentId` is ingested, other scopes (e.g. children of any epic, or all tickets) can be derived later from the same data without re-ingesting.

### Layer 3: settings

```ts
ForecastSettings { teamId, trials /* 10_000 */,
                   percentiles /* [50, 70, 85, 95] */, minGrowthSamples /* 7 */,
                   minMeasuredPaceWeeks /* 8 */, staleWeeksAfterTeamChange /* 4 */,
                   minResolvedMilestones /* 5, for the track record */,
                   periodDays /* 7 */,
                   maxPeriods /* horizon cap in periods, e.g. 156 when periodDays is 7 */,
                   warnAboveWeeks /* 26, provisional: tune from the calibration ledger */,
                   typedCounts: { forForecast /* 4 */, reliable /* 8 */ } /* MVP: typed counts the pace needs */ }

PaceSetting      { teamId, milestoneId, mode: 'manual'|'measured',
                   manualLow, manualHigh,           // tickets per period; kept when mode is 'measured'
                   suggestion?: { low, high, basis }, // pre-fill only, e.g. "previous milestone"
                   setBy, setAt }

TeamChange       { teamId, at, note }   // restarts the measured window; flags pace stale

AmbiguityRanges  { teamId, low: { low: 1, high: 1.5 }, medium: { low: 1, high: 2 },
                   high: { low: 1.5, high: 3 }, setBy, setAt }    // editable

EpicSetting      { epicId, milestoneId, rank, ambiguity: 'low'|'medium'|'high' /* default medium */ }
```

These defaults are the single source for the thresholds the app design refers to. In the MVP, `PaceSetting` is the milestone's pace range and typed counts, with which the forecast uses, and there is no `EpicSetting` or `TeamChange`.

#### Pace

*Follows the MVP: pace is what the EM types, a range or typed counts of past periods, whichever the EM chooses (see **Typed counts** in the [glossary](../../GLOSSARY.md)); nothing is measured.* `PaceSetting.mode` stays `'manual'` until the EM accepts measured pace. The tool offers the switch once the milestone has `minMeasuredPaceWeeks` of its own throughput since the last `TeamChange`: whole weeks, ending as today starts, that began at or after the team's installation (so the part-week it was installed in is dropped), counted from the week of the first finished ticket under the milestone's epics. Below that, the Milestone forecast and Inputs screens say so ("Only 4 weeks of finished tickets. Measured pace needs 8.") and the manual range is used. Measured pace is shown beside the manual range, which is kept: the EM can switch back to it, and edit it, at any time. If the milestone has fewer weeks than measured pace needs after the EM chose it (say the status mapping changed which tickets are done), measured pace is paused and the manual range is used, saying so. After a team change, the measured window restarts and the EM is prompted to review the manual range. Pace that predates the change is flagged stale until `staleWeeksAfterTeamChange` of new data exist.

#### Capacity

The EM types the team's capacity beside the forecast, as entries: a whole percentage of the team's usual from one date, to another or onward, with a note (see **Capacity** in the [glossary](../../GLOSSARY.md)). Entries belong to the team (`CapacityEntry` in `model/capacity.ts`, stored per team), so they carry over to the next milestone. `forecast/capacity.ts` turns them into the engine's per-period factors (`SimulationCase.capacity`, [`engine.md`](engine.md)), counting periods from the milestone's start date in its cadence:

- A day's capacity is the product of every entry covering it, or 100% when none does: overlapping entries multiply.
- A period's factor is the average of its working days' capacity, Monday to Friday, so weekends don't count: a holiday Monday leaves a week at 80%, and a week off in a 14-day sprint leaves it at 50%. A period with no working day is at 100%.
- Factors run to the forecast's last period and stop at the last period not at 100%; with no entries, or none from the start date on, the case has no factors, so it is the MVP's, hash and all. Entries before the start date touch nothing, and the typed counts the pace comes from are not adjusted.

An entry is refused, re-displaying the Milestone forecast screen with it as typed, when its start or end is no date, it ends before it starts (an empty end is the one day it starts), its percentage is no whole number, 0 or more, or it, or the entries it overlaps multiplied, reach above 1000%: the engine's limit, which keeps a typo out of the forecast. An entry above 150% is kept but warned of: the pace comes from a team a fraction of that size, so a pace range may be better.

Capacity can be switched off for the team's forecasts (on until switched, stored per team); off, the forecast is the one without capacity and the entries are kept. When capacity is on and gives factors, `milestoneForecastView` runs the forecast twice from the same seed, with the factors and at usual capacity, so the two differ by capacity alone. The headline and the dates are those with capacity; `comparison` gives the 50%, 85% and 95% dates both ways and the shift between them in periods. The quiet line under the headline and the folded section's summary say how far capacity moves the 85% date, or that it is switched off.

The EM can edit an entry's dates, percentage and note; an edit is refused for the same reasons as an add. An entry is **past** once its end is before today: it is kept, never deleted, listed under a folded "Past", and touches no factor. Only a past entry's note can be edited, so the record of what happened stays as it was.

Typed counts are dated back from the current period, the one holding today in periods counted from the start date: the last count is the most recent whole period, the one before it the period before, and so on. That lets a lasting entry (one running onward) be compared with the periods the pace comes from, so it isn't counted twice once the pace already shows it: the **new usual** (see the [glossary](../../GLOSSARY.md)). For a lasting entry that has started and isn't past, with pace from typed counts:

- While only some of those periods start on or after the entry's start, the entry says how many, and that the EM will be asked once all of them do.
- Once all of them do, it is proposed as the new usual. Accepting ends it today and records the accept date (`newUsualOn`), which makes it past at once: listed under Past as "new usual from" that date, touching no factor. "Keep it" stores a dismissal (`kept`), so it isn't proposed again; editing the entry's sentence starts it afresh.

With a pace range there is no proposal, since the tool doesn't guess what a range the EM typed reflects: a lasting entry that started before today offers "End it today", which ends it yesterday. An accept, a keep or an end today is refused for an entry that is no longer there or has already ended, and an accept or an end for one that hasn't started yet.

#### Growth

*Follows the MVP: the milestone grows by the range of its one ambiguity level, with no measured growth.* Each epic's growth range comes from its ambiguity level. Once at least `minGrowthSamples` growth samples exist, the tool suggests the measured distribution for `medium`. If the EM adopts it, epics marked medium draw from the pooled samples; low and high keep their ranges. Only medium, because the pool describes the team's typical epic, which is what medium means; low and high stay the EM's judgement. The EM can go back to the range at any time. Adopted measured growth is paused while there are fewer than `minGrowthSamples` growth samples, so medium epics grow by the range, and resumes once there are enough again.

### Layer 5: calibration ledger

(Layer 4 is the engine contract, in [`engine.md`](engine.md#engine-contract).)

```ts
ForecastLog   { id, createdAt, createdBy, teamId, milestoneId, targetEpicIds: string[],
                caseHash, caseSnapshotRef /* full SimulationCase, stored as a blob */,
                quantiles: (number | null)[101], percentileDates }

Outcome       { id, teamId, milestoneId, forecastLogId, targetEpicIds,
                actualDoneAt, actualFinalCount, recordedAt }

ForecastScore { forecastLogId, outcomeId,
                pit /* fraction of trials that finished before the actual;
                       trials that hit the horizon count as finishing after it */,
                hit: Record<percentile, boolean> }
```

Storing 101 quantiles, not just p50/p85/p95, gives every forecast a PIT value: the share of simulated trials that finished before the actual date. A histogram of PIT values across many forecasts is a direct calibration check ("our 85% dates were met 78% of the time"). It also gives the empirical correction factor the [research](../research/forecasting-approaches.md#implications-for-a-new-tool-synthesis) recommends (Jørgensen [27]).

Every forecast is logged from the first run. The track record is shown only once `minResolvedMilestones` milestones have an `Outcome`.
