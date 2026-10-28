# Glossary

**Team facts**: a team's facts as its workflow reads them. Each ticket's started, done and cancelled times come from its status history under the EM's status mapping, and so do the commits that still stand (see **Pull-back**). Forecasts only ever see team facts, never the facts as the connector stored them.

**Baseline**: the number of children an epic had when the EM committed it; cancelled children don't count. The epic's growth is measured from it. An uncommitted epic has only a provisional baseline, its current count. Stored as `child_count_at_commit`.

**Commit** (of an epic): the EM's statement, made in the tool after kickoff, that an epic's scope is understood. It records the epic's baseline. A team that labels consistently can commit instead by applying the workflow's commit label: the baseline is then the child count when the label was applied. Label commits are derived from label history on each read, never stored, so setting the commit label commits each epic that already carries it, as of when it was applied. Removing the label doesn't uncommit the epic: until the epic is done or cancelled, the Milestone forecast warns that the epic no longer has it, for the EM to put it back or remove the epic from the milestone. A label commit counts the same as the EM's: the commit that stands is the first made since the last pull-back, so while one stands, neither the EM nor applying the label again replaces it. Not the milestone's committed date, which is the date the milestone is promised for.

**Pull-back**: an epic moving from a status mapped to started back to one mapped to not started. A blocked epic keeps its commit: a move into or out of a status of the blocked rule is not a pull-back, nor is a move to not started while the epic carries a label of the rule. An epic out of scope is removed from the milestone instead. A pull-back after a commit resets it: the epic is uncommitted until it is committed again, in the tool or by applying the commit label. A label still on through a pull-back doesn't recommit the epic on restart: until the epic is done or cancelled, the Milestone forecast warns that it carries the label but isn't committed, for the EM to commit it in the tool or take the label off and put it back. It is derived from status history under the team's workflow on each read, never stored.

**Ambiguity** (of an epic): how well the EM judges an epic is understood, as low, medium or high; medium until the EM says otherwise. Each level has a range of growth the EM can edit, which the forecast draws the epic's growth from.
_Avoid_: uncertainty, confidence (the forecast's "85% sure" is its confidence)

**Growth** (of an epic): how many times its baseline an epic ends up, from its children when it was done divided by its baseline. 10 children at commit and 15 when done is 1.5×.
_Avoid_: split rate, scope creep

**Finished committed epic**: an epic with a commit that still stands and that is done, as the team's workflow reads it. Only these measure growth and epic sizes, each counted at its children when it was done, so tickets added or moved away since change nothing. An epic stops being one if it's reopened or a pull-back resets its commit, and a changed status mapping or commit label can change which epics are.

**Growth sample**: one finished committed epic's growth. The team's growth samples are pooled whatever ambiguity each epic had, so the pool describes the team's typical epic. An epic committed with no children gives no growth sample, though it still gives an epic size.

**Epic size**: a finished committed epic's children when it was done. An epic with no children yet is forecast as a whole epic of a size drawn from the team's epic sizes, or from a default range until any exist.

**Measured growth**: medium epics drawing their growth from the team's growth samples instead of the medium range. Only medium, because the pool describes the team's typical epic, which is what medium means; low and high stay the EM's judgement. Once there are enough growth samples, the measured range is suggested; it applies only when the EM adopts it, and the EM can go back to the range at any time. Adopted measured growth is paused, and medium epics grow by the range, while there are too few growth samples, and resumes once there are enough again.
