import type { EpicCommit } from '../model/epicCommit.js'
import { categoryLookup, type WorkflowSettings } from '../model/workflow.js'
import type { WorkItemEvent } from '../model/workItem.js'

/**
 * The commits that still stand, by epic ID. A pull-back (the epic moving from started to not started, as the workflow
 * reads its statuses) after its commit resets that commit, until the EM commits the epic again.
 */
export function standingCommits(
  commits: readonly EpicCommit[],
  events: readonly WorkItemEvent[],
  workflow: WorkflowSettings,
): Map<string, EpicCommit> {
  const category = categoryLookup(workflow)
  const pulledBackSince = (commit: EpicCommit): boolean =>
    events.some(
      (event) =>
        event.itemId === commit.epicId &&
        event.kind === 'status' &&
        Date.parse(event.at) > Date.parse(commit.committedAt) &&
        category(event.from) === 'started' &&
        category(event.to) === 'notStarted',
    )
  return new Map(commits.filter((commit) => !pulledBackSince(commit)).map((commit) => [commit.epicId, commit]))
}
