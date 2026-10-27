import type { FinishedEpic } from './finishedEpics.js'

/** How much a finished committed epic grew: its children when done over its children at commit. */
export interface GrowthSample {
  epicId: string
  teamId: string
  committedCount: number
  finalCount: number
  /** `finalCount / committedCount`. */
  ratio: number
  completedAt: string
}

/** Growth samples from finished committed epics. One committed with no children gives none: its ratio is undefined. */
export function growthSamples(finished: readonly FinishedEpic[]): GrowthSample[] {
  return finished
    .filter((epic) => epic.committedCount > 0)
    .map((epic) => ({ ...epic, ratio: epic.finalCount / epic.committedCount }))
}
