# Forecast model: design

Design date: 2026-10-14. Updated 2026-10-18 with the design grill decisions (Q1–Q31). Status: draft for v1.

This covers the data behind `samples/` and `forecast/` (Seam B's logic): the facts ingested, the samples derived from them, the EM's settings and the calibration ledger, with the rules for committing, pull-backs and growth.

**The MVP overrides most of this.** The MVP ingests no facts and derives no samples: the EM types a milestone's start date, tickets remaining and a pace (a range, or typed counts) per period of the team's cadence, and the forecast grows the tickets by the range of the milestone's one ambiguity level. Committing, pull-backs, blocked epics, the uncommitted-but-active warning, per-epic ambiguity, team facts, workflow settings, measured pace and measured growth follow it, and their code is deleted; the tables that held them stay in the data file, unread. Of Layer 3, the MVP keeps `trials`, `percentiles`, `maxPeriods` and the editable `AmbiguityRanges`, plus a fixed `seed` and `typedCounts`, how many typed counts the pace needs to forecast (4: with 2 or 3 the dates jump as counts are added) and to be reliable (8); `periodDays` gives way to the milestone's cadence. Each section below that the MVP sets aside says so.

It depends on the layers, folders and dependency rules in [`architecture.md`](architecture.md), and feeds the engine described in [`engine.md`](engine.md). Its terms are defined in [`GLOSSARY.md`](../../GLOSSARY.md).

---

## Data model

Layers 1 and 2, the facts ingested and the samples derived from them, with the rules for committing, pull-backs and blocked epics, are in [`forecast-model-facts.md`](forecast-model-facts.md).

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

_Follows the MVP: pace is what the EM types, a range or typed counts of past periods, whichever the EM chooses (see **Typed counts** in the [glossary](../../GLOSSARY.md)); nothing is measured._ `PaceSetting.mode` stays `'manual'` until the EM chooses the tracker as pace's source (#159: nothing is accepted). The tool offers the switch once the milestone has `minMeasuredPaceWeeks` of its own throughput since the last `TeamChange`: whole weeks, ending as today starts, that began at or after the team's installation (so the part-week it was installed in is dropped), counted from the week of the first finished ticket under the milestone's epics. Below that, the Milestone forecast and Inputs screens say so ("Only 4 weeks of finished tickets. Measured pace needs 8.") and the manual range is used. Measured pace is shown beside the manual range, which is kept: the EM can switch back to it, and edit it, at any time. If the milestone has fewer weeks than measured pace needs after the EM chose it (say the status mapping changed which tickets are done), measured pace is paused and the manual range is used, saying so. After a team change, the measured window restarts and the EM is prompted to review the manual range. Pace that predates the change is flagged stale until `staleWeeksAfterTeamChange` of new data exist.

#### Reads of the team's queries (#158)

How pace and tickets remaining are measured from the tracker's reads, the tracker's pace window, skipped periods and comparable work's candidates are in [`forecast-model-reads.md`](forecast-model-reads.md).

#### Capacity

The EM types the team's capacity beside the forecast, as entries: a whole percentage of the team's usual from one date, to another or onward, with a note (see **Capacity** in the [glossary](../../GLOSSARY.md)). Entries belong to the team (`CapacityEntry` in `model/capacity.ts`, stored per team), so they carry over to the next milestone. `forecast/lib/capacity.ts` turns them into the engine's per-period factors (`SimulationCase.capacity`, [`engine.md`](engine.md)), counting periods from the milestone's start date in its cadence:

- A day's capacity is the product of every entry covering it, or 100% when none does: overlapping entries multiply.
- A period's factor is the average of its working days' capacity, Monday to Friday, so weekends don't count: a holiday Monday leaves a week at 80%, and a week off in a 14-day sprint leaves it at 50%. A period with no working day is at 100%.
- Factors run to the forecast's last period and stop at the last period not at 100%; with no entries, or none from the start date on, the case has no factors, so it is the MVP's, hash and all. Entries before the start date touch nothing, and the typed counts the pace comes from are not adjusted.

An entry is refused, re-displaying the Milestone forecast screen with it as typed, when its start or end is no date, it ends before it starts (an empty end is the one day it starts), its percentage is no whole number, 0 or more, or it, or the current entries it overlaps multiplied, reach above 1000% (a past entry no longer counts, so it doesn't count toward this either): the engine's limit, which keeps a typo out of the forecast. An entry above 150% is kept but warned of: the pace comes from a team a fraction of that size, so a pace range may be better.

Capacity can be switched off for the team's forecasts (on until switched, stored per team); off, the forecast is the one without capacity and the entries are kept. When capacity is on and gives factors, `milestoneForecastView` runs the forecast twice from the same seed, with the factors and at usual capacity, so the two differ by capacity alone. The headline and the dates are those with capacity; `comparison` gives the 50%, 85% and 95% dates both ways and the shift between them in periods. The quiet line under the headline and the folded section's summary say how far capacity moves the 85% date, or that it is switched off.

The EM can edit an entry's dates, percentage and note; an edit is refused for the same reasons as an add. An entry is **past** once its end is before today: it is kept, never deleted (removing one is refused: "Past entries are kept, so it can’t be removed."), listed under a folded "Past", and touches no factor. Only a past entry's note can be edited, so the record of what happened stays as it was.

Typed counts are dated back from the current period, the one holding today in periods counted from the start date: the last count is the most recent whole period, the one before it the period before, and so on. That lets a lasting entry (one running onward) be compared with the periods the pace comes from, so it isn't counted twice once the pace already shows it: the **new usual** (see the [glossary](../../GLOSSARY.md)). For a lasting entry that has started and isn't past, with pace from typed counts:

- While only some of those periods start on or after the entry's start, the entry says how many, and that the EM will be asked once all of them do.
- Once all of them do, it is proposed as the new usual. Accepting ends it today and records the accept date (`newUsualOn`), which makes it past at once: listed under Past as "new usual from" that date, touching no factor. "Keep it" stores a dismissal (`kept`), so it isn't proposed again; editing the entry's sentence starts it afresh.

With a pace range there is no proposal, since the tool doesn't guess what a range the EM typed reflects: a lasting entry that started before today offers "End it today", which ends it yesterday. An accept, a keep or an end today is refused for an entry that is no longer there or has already ended, and an accept or an end for one that hasn't started yet.

#### Growth

_Follows the MVP: the milestone grows by the range of its one ambiguity level, with no measured growth._ Each epic's growth range comes from its ambiguity level. Once at least `minGrowthSamples` growth samples exist, the tool suggests the measured distribution for `medium`. If the EM adopts it, epics marked medium draw from the pooled samples; low and high keep their ranges. Only medium, because the pool describes the team's typical epic, which is what medium means; low and high stay the EM's judgement. The EM can go back to the range at any time. Adopted measured growth is paused while there are fewer than `minGrowthSamples` growth samples, so medium epics grow by the range, and resumes once there are enough again.

### Layer 5: calibration ledger

The calibration ledger is in [`forecast-model-ledger.md`](forecast-model-ledger.md).
