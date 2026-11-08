# Glossary

The [MVP](https://github.com/random11235/forecaster-next-gen/issues/84) forecasts a milestone from what the EM types in: its start date, tickets remaining and a pace (a range, or typed counts), grown by the range of its ambiguity. Entries marked *Follows the MVP* name epic-era behaviour the MVP set aside; the tables that held it are kept, unread, for [v1](https://github.com/random11235/forecaster-next-gen/issues/6) to build on.

**Team facts**: a team's facts as its workflow reads them. Each ticket's started, done and cancelled times come from its status history under the EM's status mapping, and so do the commits that still stand (see **Pull-back**). Forecasts only ever see team facts, never the facts as the connector stored them. *Follows the MVP: nothing reads it since #84.*

**Baseline**: the number of children an epic had when the EM committed it; cancelled children don't count. The epic's growth is measured from it. An uncommitted epic has only a provisional baseline, its current count. Stored as `child_count_at_commit`. *Follows the MVP: nothing reads it since #84.*

**Commit** (of an epic): the EM's statement, made in the tool after kickoff, that an epic's scope is understood. It records the epic's baseline. A team that labels consistently can commit instead by applying the workflow's commit label: the baseline is then the child count when the label was applied. A label commit counts the same as the EM's. Not the milestone's committed date, which is the date the milestone is promised for. Which commit stands, what removing the label does, and the warnings: [Committing](docs/design/forecast-model.md#committing). *Follows the MVP: nothing reads it since #84.*

**Pull-back**: an epic moving from a status mapped to started back to one mapped to not started. It resets the epic's commit: the epic is uncommitted until it is committed again. A [blocked epic](docs/design/forecast-model.md#blocked-epics) moving into or out of a status of the blocked rule, or to not started while it carries a label of the rule, is not one. The rules, including a commit label left on through one: [Pull-backs](docs/design/forecast-model.md#pull-backs).

**Ambiguity** (of a milestone): how well the EM judges a milestone's work is understood, as one level for the whole milestone: low, medium or high; medium until the EM says otherwise. Each level has a range of growth the EM can edit (defaults: low 1–1.5×, medium 1–2×, high 1.5–3×), which the forecast draws the milestone's growth from; the ticket total never drops below the tickets remaining. Before the MVP, ambiguity was an epic's, and per-epic growth may return ([#6](https://github.com/random11235/forecaster-next-gen/issues/6)).
_Avoid_: uncertainty, confidence (the forecast's "85% confident" is its confidence)

**Growth** (of an epic): how many times its baseline an epic ends up, from its children when it was done divided by its baseline. 10 children at commit and 15 when done is 1.5×. Where each epic's growth comes from: [Growth](docs/design/forecast-model.md#growth). *Follows the MVP: nothing reads it since #84.*
_Avoid_: split rate, scope creep

**Finished committed epic**: an epic with a commit that still stands and that is done, as the team's workflow reads it. Only these measure growth and epic sizes, each counted at its children when it was done, so tickets added or moved away since change nothing. An epic stops being one if it's reopened or a pull-back resets its commit, and a changed status mapping or commit label can change which epics are. *Follows the MVP: nothing reads it since #84.*

**Growth sample**: one finished committed epic's growth. The team's growth samples are pooled whatever ambiguity each epic had, so the pool describes the team's typical epic. An epic committed with no children gives no growth sample, though it still gives an epic size. *Follows the MVP: nothing reads it since #84.*

**Epic size**: a finished committed epic's children when it was done. An epic with no children yet is forecast as a whole epic of a size drawn from the team's epic sizes, or from a default range until any exist. *Follows the MVP: nothing reads it since #84.*

**Measured growth**: medium epics drawing their growth from the team's growth samples instead of the medium range, once the EM adopts it. When it is suggested, paused and resumed, and why only medium: [Growth](docs/design/forecast-model.md#growth). *Follows the MVP: nothing reads it since #84.*

**Installation** (of a team): when the Forecaster was set up for the team. Nothing the team finished before it is used automatically, so pace never quietly draws on another team, KTLO load or way of working. With a tracker connected, history from before it may be proposed, since the EM accepts or edits a proposal before it's used ([#133](https://github.com/random11235/forecaster-next-gen/issues/133)). Stored as `installed_at`.

**Measured pace**: the forecast drawing a milestone's pace from its own weeks of finished tickets (only those under its epics, and only in whole weeks since installation, from the first week one was finished) instead of the EM's manual range, once the EM switches to it. When it is offered, paused and resumed: [Pace](docs/design/forecast-model.md#pace). *Follows the MVP: nothing reads it since #84. Connected forecasting replaces it with typed counts proposed from comparable work ([#133](https://github.com/random11235/forecaster-next-gen/issues/133)).*

**Cadence** (of a milestone): how many days one of the team's periods lasts, a whole number, 1 or more; 7 until the EM sets it. Pace is entered and shown per period, which the screens call a week at 7 days and a sprint at any other length, and the forecast counts in these periods up to its 156-period horizon. Changing it keeps the pace as typed, so 4–8 a week becomes 4–8 a sprint, and warns that the cadence length has changed, asking the EM to check the pace is per the new period, until the EM edits the pace range or typed counts or changes the cadence back ([#96](https://github.com/random11235/forecaster-next-gen/issues/96)). Stored as `cadence_days`; the cadence the pace was entered in as `pace_cadence_days`.

**Start date** (of a milestone): the day the EM says work on the milestone starts, which the forecast counts from instead of today. Pre-filled with today's local date, and it may be in the past: then the forecast answers "when would we have finished had we started then", from today's tickets remaining, says so beside the start date, and marks dates before today **already past**. Stored as `start_date`.

**Tickets remaining** (of a milestone): the whole tickets the EM says are left to do, 0 or more. The forecast grows them by the range of the milestone's ambiguity, then works through them at the EM's pace. Stored as `tickets_remaining`.

**Typed counts** (of a milestone): the whole tickets the team finished in each of its past periods, 0 or more each, oldest first, as the EM types them. The EM chooses whether the forecast's pace comes from the pace range or the typed counts; both are kept whichever is chosen. The forecast draws each period's pace from the typed counts (a Bayesian bootstrap, [ADR-0001](docs/adr/0001-bayesian-bootstrap-pace-sampler.md)), needs at least 4 to forecast, and 8 for the forecast to be reliable: with fewer, it warns. Stored as `pace_counts`, the choice as `pace_mode`.

**Finished** (of a ticket): done in the team's tracker, whatever the reason: closed on GitHub, or in a Done-category status on Jira. Cancelled and duplicate tickets count as finished, and a reopened ticket counts only at its last finish. Only tickets with no children of their own are counted: never parents, epics, subtasks or pull requests. *Connected forecasting, not built yet ([#133](https://github.com/random11235/forecaster-next-gen/issues/133)).*
_Avoid_: completed, resolved

**Connection** (of a team): the one tracker the team's tickets are read from, GitHub or Jira, and the one repo or Jira project in it that every milestone query and comparable-work query is confined to. A team has at most one, and it only reads: nothing is written back to the tracker. *Connected forecasting, not built yet ([#134](https://github.com/random11235/forecaster-next-gen/issues/134)).*
_Avoid_: integration, sync, account

**Milestone query**: the query, in the connected tracker's own language (a GitHub search, or JQL on Jira), that picks out a milestone's tickets within the one repo or Jira project the team connected. The milestone is whatever it matches now: a ticket moved in counts, a ticket moved out stops counting. The EM writes it by picking epics, labels and milestones (fix versions on Jira), or by hand. A picked epic stands for every ticket beneath it, through any sub-epics; the epics themselves don't count as tickets. *Connected forecasting, not built yet ([#132](https://github.com/random11235/forecaster-next-gen/issues/132), [#148](https://github.com/random11235/forecaster-next-gen/issues/148)).*
_Avoid_: selector, filter, scope

**Comparable work** (of a milestone): the work, like the milestone's in type, capacity and ambiguity, that the EM points at for its typed counts to be proposed from: its finished tickets in each recent period. The EM points at it with a comparable-work query, written like the milestone query, whose matches join the milestone query's. So the milestone's own finished tickets are always part of it, and with no comparable-work query they are all of it; KTLO usually isn't. *Connected forecasting, not built yet ([#133](https://github.com/random11235/forecaster-next-gen/issues/133), [#132](https://github.com/random11235/forecaster-next-gen/issues/132)).*
_Avoid_: reference class, team throughput

**Capacity** (of a period): how much of the team's usual capacity it has in a period, as a percentage: 100% is a usual period, 60% one with 2 of 5 people away, for whatever reason (leave, an incident, a priority shift). Usual means a period like those the pace comes from. The EM types capacity for the team, not the milestone, as exceptions to 100% for periods to come, or from a date onward for a lasting change; the forecast scales the pace it draws for the period in proportion. *Not built yet ([#131](https://github.com/random11235/forecaster-next-gen/issues/131)).*
_Avoid_: headcount, availability, allocation

**New usual**: a lasting capacity change that the pace has caught up with, because every period the pace comes from falls after it. The tool proposes it and the EM accepts it, ending the change so it isn't counted twice. *Not built yet ([#131](https://github.com/random11235/forecaster-next-gen/issues/131)).*
_Avoid_: rebaseline, new normal

**Pace trend** (of a milestone): the typed counts drawn as small bars, oldest first, with the straight line that fits them best, shown beside typed counts once there are enough to forecast and pace is set to them. It is for the EM to read the slope and judge the risk: it says nothing about it, and the forecast doesn't use it ([#120](https://github.com/random11235/forecaster-next-gen/issues/120)). Not the trend of forecast dates over time, which needs the forecast ledger.
_Avoid_: trend line, pace slope

**Pace pattern** (of a milestone): the shape the tool reads in the counts its pace comes from, measured or typed, at a cadence of 7 days or more: Steady, Lumpy, Speeding up, Slowing down, Stepped up, Stepped down, Good and bad spells, or One odd week. It names a shape and its direction with the team's numbers, never a cause. It is read from 6 periods, and before about 10 every pattern but Steady and One odd week is called early. Quiet periods before the first finished ticket aren't read, and a window with nothing finished has no pattern. *Connected forecasting, not built yet ([#138](https://github.com/random11235/forecaster-next-gen/issues/138), [#150](https://github.com/random11235/forecaster-next-gen/issues/150)).*
_Avoid_: Team change (names a cause), pace trend (the bars and fitted line)

**Trial**: one run of a forecast: the milestone's tickets remaining, grown by a growth drawn from its ambiguity's range, worked through at a pace drawn period by period until they're done or the horizon is reached. A forecast runs 10,000 and reads its dates from when they finish. The screens call trials simulations, as an EM would; the engine and its docs say trial, and use simulation for the whole run of trials.
