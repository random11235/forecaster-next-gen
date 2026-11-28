# Forecast model: facts and samples

Part of the forecast model design; the index is [`forecast-model.md`](forecast-model.md), which has the settings; the calibration ledger is in [`forecast-model-ledger.md`](forecast-model-ledger.md).

## Layer 1: observed facts (ingested)

_Follows the MVP: it ingests nothing._

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

## Layer 2: derived samples (recomputable, cacheable)

_Follows the MVP, including the rules for committing, pull-backs, blocked epics and the warning below: it derives no samples._

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

### Committing

The EM commits an epic in the tool after kickoff, or a configured label in the ticketing tool commits it. The commit records the epic's child count at that moment, its **baseline**. A label commit is not stored: on each read, `samples/commits.ts` finds each time the epic's label history applies `commitLabel`, and counts the children it had then from the tickets' creation, parent and status history (cancelled children don't count). So setting the commit label commits each epic that already carries it, as of when it was applied.

The two count the same: the first commit since the last [pull-back](#pull-backs) stands, however it was made, so while one stands, neither the EM nor applying the label again replaces it. Only the EM's latest commit is stored. Either kind of commit counts towards the growth ratio.

Removing the label doesn't uncommit the epic: the Milestone forecast warns "<epic> is committed but no longer has the “<label>” label" until it is put back or the epic is done or cancelled, for the EM to put the label back or remove the epic from the milestone. A commit made in the tool is never warned about.

Team facts carries the commits that stand, with their source (`'inTool'` or `'label'`), and the epics whose label commit a pull-back reset (`labelCommitsReset`).

### Pull-backs

A **pull-back** (the epic moving from a status mapped to started back to one mapped to not started) resets the commit, and the EM commits again on restart, in the tool or by applying the label again. Like a label commit, the reset is not stored: `samples/commits.ts` checks the epic's status history under the team's `WorkflowSettings` for a pull-back after `committedAt`, so changing the status mapping can change which commits stand. A move into or out of the blocked rule is not a pull-back (see [Blocked epics](#blocked-epics)).

The label commits only when applied, so a pull-back with the label still on leaves the epic uncommitted while it carries the label; the tool doesn't recommit it on restart, which would surprise the EM. The Milestone forecast warns instead: "<epic> has the “<label>” label but isn't committed: it moved back to not started after the label went on. Commit it on Inputs, or take the label off and put it back." It needs a label commit the pull-back reset, so an epic carrying the label with no record of it going on isn't warned, and it stops once the epic is done or cancelled. For that epic this replaces the [uncommitted-but-active warning](#the-uncommitted-but-active-warning).

### Blocked epics

An epic in a status, or with a label, of `blockedRule` is flagged "Blocked" in the Milestone forecast's epic list. It keeps its commit: a move into or out of a blocked status is not a pull-back, even to or from a status mapped to not started, nor is a move to not started while the epic carries a blocked label. An epic out of scope is removed from the milestone explicitly. A blocked epic stays in the milestone and is forecast like any other epic.

### The uncommitted-but-active warning

An epic whose own status is mapped to started, with no commit standing, is flagged "<epic> is in progress but isn't committed". Its children's statuses play no part, so the tool needs no rule for which tickets are spikes ([ADR-0002](../adr/0002-no-spike-rule.md)).

### Samples

Only committed epics (in the tool or by label) that have since finished produce samples. Epics committed with no children (`committedCount` of 0) produce no `GrowthSample`, since their ratio is undefined. They still produce an `EpicSizeSample`. A label commit counts however long ago the label was applied, even before installation: label commits are commits, so a team that committed by label before installing the tool has its growth measured from day one.

### Throughput

`ThroughputSample`s count done tickets whose parent is one of the milestone's epics. Because `WorkItem.parentId` is ingested, other scopes (e.g. children of any epic, or all tickets) can be derived later from the same data without re-ingesting.
