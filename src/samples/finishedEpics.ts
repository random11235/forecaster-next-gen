import type { EpicCommit } from '../model/epicCommit.js'
import { childrenOf, type WorkItem } from '../model/workItem.js'

/** A committed epic that has since finished: its baseline, and its children when done. */
export interface FinishedEpic {
  epicId: string
  teamId: string
  /** Children at commit: the baseline. */
  committedCount: number
  /** Children now it is done; cancelled children don't count. */
  finalCount: number
  /** ISO timestamp. */
  completedAt: string
}

/**
 * The committed epics that are done, from the commits that stand and the work items as the workflow reads them.
 * An epic never committed is left out: its growth was never measured from a baseline.
 */
export function finishedEpics(commits: Iterable<EpicCommit>, workItems: readonly WorkItem[]): FinishedEpic[] {
  const byId = new Map(workItems.map((item) => [item.id, item]))
  const finished: FinishedEpic[] = []
  for (const commit of commits) {
    const completedAt = byId.get(commit.epicId)?.doneAt
    if (completedAt === undefined) continue
    finished.push({
      epicId: commit.epicId,
      teamId: commit.teamId,
      committedCount: commit.baseline,
      finalCount: childrenOf(workItems, commit.epicId).length,
      completedAt,
    })
  }
  return finished
}
