# Glossary

## Forecasting a milestone

**Milestone**: the body of work the EM forecasts a finish date for.
_Avoid_: project, release, epic

**Start date** (of a milestone): the day the EM says work on the milestone starts, which the forecast counts from instead of today.

**Tickets remaining** (of a milestone): the whole tickets left to do: the open leaves its tracker query matches now, when the team has a connection, else the count the EM types.

**Ambiguity** (of a milestone): how well the EM judges the milestone's work is understood: low, medium or high, each with a range its growth is drawn from.
_Avoid_: uncertainty, confidence (the forecast's "85% confident" is its confidence)

**Growth** (of a milestone): how many times its tickets remaining the milestone's work ends up, drawn in each trial from the range of its ambiguity.
_Avoid_: split rate, scope creep

**Cadence** (of a milestone): how many days one of the team's periods lasts.

**Period**: one stretch of a milestone's cadence, which the screens call a week at 7 days and a sprint at any other length.

**Pace**: the tickets the team finishes per period, which the EM gives as a range or as typed counts.
_Avoid_: velocity, throughput

**Typed counts** (of a milestone): the tickets the team finished in each of its past periods, oldest first, as the EM types them.

**Capacity** (of a period): how much of the team's usual capacity it has, as a percentage: 100% is a usual period. It belongs to the team, not the milestone.
_Avoid_: headcount, availability, allocation

**New usual**: a lasting capacity change that the pace has caught up with, because every period the pace comes from falls after it. Accepting it ends the change, so it isn't counted twice.
_Avoid_: rebaseline, new normal

**Pace trend** (of a milestone): the typed counts drawn as bars with the straight line that fits them best, for the EM to read; the forecast doesn't use it. Not the trend of forecast dates over time.
_Avoid_: trend line, pace slope

**Pace window** (of a milestone): the periods its pace is drawn from: every typed count, less any the EM's applied pace action leaves out. Counts outside it are kept, so undoing the action brings them back.

**Pace pattern** (of a milestone): the shape the tool names in the typed counts in its pace window, at a cadence of 7 days or more: Steady, Lumpy, Speeding up, Slowing down, Stepped up, Stepped down, Good and bad spells, or One odd week (or sprint). It names the shape and its direction with the team's numbers, never a cause. A step offers to count pace from it, and one odd period to leave it out.
_Avoid_: team change (names a cause), pace trend (the bars and their line)

**Trial**: one simulated future of a milestone: its tickets remaining, grown by a drawn growth, worked through at a pace drawn period by period. The screens call trials simulations; the engine says trial, and keeps simulation for the whole run of trials.

## Connecting a tracker

**Connection** (of a team): the one tracker, GitHub or Jira, and the one repo or Jira project in it, that the team's tickets are read from; nothing is written back.
_Avoid_: integration, sync, account

**Milestone query**: the query, in the connected tracker's own language (a GitHub search, or JQL on Jira), that picks out a milestone's tickets within the team's connection. The milestone is whatever it matches now. The EM writes it by picking epics, labels and milestones (fix versions on Jira), joined with OR, or by editing it by hand; a picked epic stands for every leaf beneath it, through any sub-epics.
_Avoid_: selector, filter, scope

**Leaf**: a ticket in the tracker with no children of its own: never a pull request, a parent, an epic, or a story with subtasks. Only leaves count, as remaining or finished.
_Avoid_: child ticket, work item

**Finished** (of a ticket): done in the team's tracker, whatever the reason, and counted once, at its last finish. Only leaves count.
_Avoid_: completed, resolved
