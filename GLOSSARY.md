# Glossary

**Team facts**: a team's facts as its workflow reads them. Each ticket's started, done and cancelled times come from its status history under the EM's status mapping, and so do the commits that still stand (see **Pull-back**). Forecasts only ever see team facts, never the facts as the connector stored them.

**Baseline**: the number of children an epic had when the EM committed it; cancelled children don't count. The epic's growth is measured from it. An uncommitted epic has only a provisional baseline, its current count. Stored as `child_count_at_commit`.

**Commit** (of an epic): the EM's statement, made in the tool after kickoff, that an epic's scope is understood. It records the epic's baseline. Only the latest commit of an epic is kept. Not the milestone's committed date, which is the date the milestone is promised for.

**Pull-back**: an epic moving from a status mapped to started back to one mapped to not started. A pull-back after a commit resets it: the epic is uncommitted until the EM commits it again. It is derived from status history under the team's workflow on each read, never stored.
