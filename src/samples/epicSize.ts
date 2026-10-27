import type { FinishedEpic } from './finishedEpics.js'

/** A finished committed epic's final size, for sizing an epic with no children. */
export interface EpicSizeSample {
  epicId: string
  teamId: string
  finalCount: number
  completedAt: string
}

/** Epic-size samples from finished committed epics, including those committed with no children. */
export function epicSizeSamples(finished: readonly FinishedEpic[]): EpicSizeSample[] {
  return finished.map(({ epicId, teamId, finalCount, completedAt }) => ({ epicId, teamId, finalCount, completedAt }))
}
