---
status: accepted
---

# The tool doesn't identify spikes

The EM's workflow settings had a spike rule: the issue types and labels that mark a ticket as a spike. Nothing read it. Its one planned use was the uncommitted-but-active warning (#20), so that a spike in progress before kickoff wouldn't count as the epic starting. On 2026-10-27 we dropped it as over-design for v1: it asks every EM to describe their spikes before anyone has seen whether the warning helps. Schema migration 4 drops its columns.

The warning stays, triggered by the epic alone: an epic whose own status is mapped to started, with no commit standing, is flagged "<epic> is in progress but isn't committed". That uses the status mapping the EM already sets.

## Considered Options

- **Warn when any child has started.** Rejected: without a spike rule, it warns on every epic in discovery.
- **Drop the warning too.** Rejected: an epic that is never committed has a sliding baseline and never produces a growth sample, so forgetting to commit is worth flagging. The Milestone forecast's "Not committed: wide range" alone is easy to miss.

## Consequences

- An epic can be in progress with its children started and raise no warning, if the team leaves the epic's own status at not started.
- Spike tickets count like any other child: in the epic's count, its baseline and the team's throughput.
- If spikes turn out to distort forecasts, a spike rule can come back as a new workflow setting and a new migration.
