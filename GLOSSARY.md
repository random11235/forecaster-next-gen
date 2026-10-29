# Glossary

**Team facts**: a team's facts as its workflow reads them. Each ticket's started, done and cancelled times come from its status history under the EM's status mapping, and so do the commits that still stand (see **Pull-back**). Forecasts only ever see team facts, never the facts as the connector stored them.

**Baseline**: the number of children an epic had when the EM committed it; cancelled children don't count. The epic's growth is measured from it. An uncommitted epic has only a provisional baseline, its current count. Stored as `child_count_at_commit`.

**Commit** (of an epic): the EM's statement, made in the tool after kickoff, that an epic's scope is understood. It records the epic's baseline. A team that labels consistently can commit instead by applying the workflow's commit label: the baseline is then the child count when the label was applied. A label commit counts the same as the EM's. Not the milestone's committed date, which is the date the milestone is promised for. Which commit stands, what removing the label does, and the warnings: [Committing](docs/design/forecast-model.md#committing).

**Pull-back**: an epic moving from a status mapped to started back to one mapped to not started. It resets the epic's commit: the epic is uncommitted until it is committed again. A [blocked epic](docs/design/forecast-model.md#blocked-epics) moving into or out of a status of the blocked rule, or to not started while it carries a label of the rule, is not one. The rules, including a commit label left on through one: [Pull-backs](docs/design/forecast-model.md#pull-backs).

**Ambiguity** (of an epic): how well the EM judges an epic is understood, as low, medium or high; medium until the EM says otherwise. Each level has a range of growth the EM can edit, which the forecast draws the epic's growth from.
_Avoid_: uncertainty, confidence (the forecast's "85% sure" is its confidence)

**Growth** (of an epic): how many times its baseline an epic ends up, from its children when it was done divided by its baseline. 10 children at commit and 15 when done is 1.5×. Where each epic's growth comes from: [Growth](docs/design/forecast-model.md#growth).
_Avoid_: split rate, scope creep

**Finished committed epic**: an epic with a commit that still stands and that is done, as the team's workflow reads it. Only these measure growth and epic sizes, each counted at its children when it was done, so tickets added or moved away since change nothing. An epic stops being one if it's reopened or a pull-back resets its commit, and a changed status mapping or commit label can change which epics are.

**Growth sample**: one finished committed epic's growth. The team's growth samples are pooled whatever ambiguity each epic had, so the pool describes the team's typical epic. An epic committed with no children gives no growth sample, though it still gives an epic size.

**Epic size**: a finished committed epic's children when it was done. An epic with no children yet is forecast as a whole epic of a size drawn from the team's epic sizes, or from a default range until any exist.

**Measured growth**: medium epics drawing their growth from the team's growth samples instead of the medium range, once the EM adopts it. When it is suggested, paused and resumed, and why only medium: [Growth](docs/design/forecast-model.md#growth).

**Installation** (of a team): when the Forecaster was set up for the team. Nothing the team finished before it is used automatically, so pace never quietly draws on another team, KTLO load or way of working. Stored as `installed_at`.

**Measured pace**: the forecast drawing a milestone's pace from its own weeks of finished tickets (only those under its epics, and only in whole weeks since installation, from the first week one was finished) instead of the EM's manual range, once the EM switches to it. When it is offered, paused and resumed: [Pace](docs/design/forecast-model.md#pace).

**Start date** (of a milestone): the day the EM says work on the milestone starts, which the forecast counts from instead of today. Pre-filled with today's local date, and it may be in the past. Stored as `start_date`.

**Tickets remaining** (of a milestone): the whole tickets the EM says are left to do, 0 or more. The forecast grows them by the milestone's ambiguity, then works through them at the EM's pace. Stored as `tickets_remaining`.
