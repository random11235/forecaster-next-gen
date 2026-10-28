import type { EpicCommit } from '../model/epicCommit.js'
import type { WorkflowSettings } from '../model/workflow.js'
import type { Facts } from '../model/workItem.js'
import { childCounter } from './itemHistory.js'

/** A committed epic that has since finished: its baseline, and its children when done. */
export interface FinishedEpic {
  epicId: string
  teamId: string
  /** Children at commit: the baseline. */
  committedCount: number
  /** Children when it was done; cancelled children don't count. Tickets added or moved away since change nothing. */
  finalCount: number
  /** ISO timestamp. */
  completedAt: string
}

/**
 * The committed epics that are done, from the commits that stand and the facts as the workflow reads them.
 * An epic never committed is left out: its growth was never measured from a baseline.
 */
export function finishedEpics(commits: Iterable<EpicCommit>, facts: Facts, workflow: WorkflowSettings): FinishedEpic[] {
  const byId = new Map(facts.workItems.map((item) => [item.id, item]))
  const childrenAt = childCounter(facts, workflow)
  const finished: FinishedEpic[] = []
  for (const commit of commits) {
    const completedAt = byId.get(commit.epicId)?.doneAt
    if (completedAt === undefined) continue
    finished.push({
      epicId: commit.epicId,
      teamId: commit.teamId,
      committedCount: commit.baseline,
      finalCount: childrenAt(commit.epicId, completedAt),
      completedAt,
    })
  }
  return finished
}
