# Glossary

The [MVP](https://github.com/random11235/forecaster-next-gen/issues/84) forecasts a milestone from what the EM types in: its start date, tickets remaining and a pace (a range, or typed counts), grown by the range of its ambiguity. Entries marked *Follows the MVP* name epic-era behaviour the MVP set aside; the tables that held it are kept, unread, for [v1](https://github.com/random11235/forecaster-next-gen/issues/6) to build on.

**Team facts**: a team's facts as its workflow reads them. Each ticket's started, done and cancelled times come from its status history under the EM's status mapping, and so do the commits that still stand (see **Pull-back**). Forecasts only ever see team facts, never the facts as the connector stored them. *Follows the MVP: nothing reads it since #84.*

**Baseline**: the number of children an epic had when the EM committed it; cancelled children don't count. The epic's growth is measured from it. An uncommitted epic has only a provisional baseline, its current count. Stored as `child_count_at_commit`. *Follows the MVP: nothing reads it since #84.*

**Commit** (of an epic): the EM's statement, made in the tool after kickoff, that an epic's scope is understood. It records the epic's baseline. A team that labels consistently can commit instead by applying the workflow's commit label: the baseline is then the child count when the label was applied. A label commit counts the same as the EM's. Not the milestone's committed date, which is the date the milestone is promised for. Which commit stands, what removing the label does, and the warnings: [Committing](docs/design/forecast-model.md#committing). *Follows the MVP: nothing reads it since #84.*

**Pull-back**: an epic moving from a status mapped to started back to one mapped to not started. It resets the epic's commit: the epic is uncommitted until it is committed again. A [blocked epic](docs/design/forecast-model.md#blocked-epics) moving into or out of a status of the blocked rule, or to not started while it carries a label of the rule, is not one. The rules, including a commit label left on through one: [Pull-backs](docs/design/forecast-model.md#pull-backs).

**Ambiguity** (of a milestone): how well the EM judges a milestone's work is understood, as one level for the whole milestone: low, medium or high; medium until the EM says otherwise. Each level has a range of growth the EM can edit (defaults: low 1–1.5×, medium 1–2×, high 1.5–3×), which the forecast draws the milestone's growth from; the ticket total never drops below the tickets remaining. Before the MVP, ambiguity was an epic's, and per-epic growth may return ([#6](https://github.com/random11235/forecaster-next-gen/issues/6)).
_Avoid_: uncertainty, confidence (the forecast's "85% sure" is its confidence)

**Growth** (of an epic): how many times its baseline an epic ends up, from its children when it was done divided by its baseline. 10 children at commit and 15 when done is 1.5×. Where each epic's growth comes from: [Growth](docs/design/forecast-model.md#growth). *Follows the MVP: nothing reads it since #84.*
_Avoid_: split rate, scope creep

**Finished committed epic**: an epic with a commit that still stands and that is done, as the team's workflow reads it. Only these measure growth and epic sizes, each counted at its children when it was done, so tickets added or moved away since change nothing. An epic stops being one if it's reopened or a pull-back resets its commit, and a changed status mapping or commit label can change which epics are. *Follows the MVP: nothing reads it since #84.*

**Growth sample**: one finished committed epic's growth. The team's growth samples are pooled whatever ambiguity each epic had, so the pool describes the team's typical epic. An epic committed with no children gives no growth sample, though it still gives an epic size. *Follows the MVP: nothing reads it since #84.*

**Epic size**: a finished committed epic's children when it was done. An epic with no children yet is forecast as a whole epic of a size drawn from the team's epic sizes, or from a default range until any exist. *Follows the MVP: nothing reads it since #84.*

**Measured growth**: medium epics drawing their growth from the team's growth samples instead of the medium range, once the EM adopts it. When it is suggested, paused and resumed, and why only medium: [Growth](docs/design/forecast-model.md#growth). *Follows the MVP: nothing reads it since #84.*

**Installation** (of a team): when the Forecaster was set up for the team. Nothing the team finished before it is used automatically, so pace never quietly draws on another team, KTLO load or way of working. Stored as `installed_at`.

**Measured pace**: the forecast drawing a milestone's pace from its own weeks of finished tickets (only those under its epics, and only in whole weeks since installation, from the first week one was finished) instead of the EM's manual range, once the EM switches to it. When it is offered, paused and resumed: [Pace](docs/design/forecast-model.md#pace). *Follows the MVP: nothing reads it since #84.*

**Cadence** (of a milestone): how many days one of the team's periods lasts, a whole number, 1 or more; 7 until the EM sets it. Pace is entered and shown per period, which the screens call a week at 7 days and a sprint at any other length, and the forecast counts in these periods up to its 156-period horizon. For now, changing it keeps the pace as typed, so 4–8 a week becomes 4–8 a sprint; whether it should is open in #96. Stored as `cadence_days`.

**Start date** (of a milestone): the day the EM says work on the milestone starts, which the forecast counts from instead of today. Pre-filled with today's local date, and it may be in the past: then the forecast answers "when would we have finished had we started then", from today's tickets remaining, says so beside the start date, and marks dates before today **already past**. Stored as `start_date`.

**Tickets remaining** (of a milestone): the whole tickets the EM says are left to do, 0 or more. The forecast grows them by the range of the milestone's ambiguity, then works through them at the EM's pace. Stored as `tickets_remaining`.

**Typed counts** (of a milestone): the whole tickets the team finished in each of its past periods, 0 or more each, oldest first, as the EM types them. The EM chooses whether the forecast's pace comes from the pace range or the typed counts; both are kept whichever is chosen. The forecast draws each period's pace from the typed counts (a Bayesian bootstrap, [ADR-0001](docs/adr/0001-bayesian-bootstrap-pace-sampler.md)), needs at least 2 to forecast, and 8 for the forecast to be reliable: with fewer, it warns. Stored as `pace_counts`, the choice as `pace_mode`.
