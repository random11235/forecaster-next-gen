import type { WorkItem } from '../model/workItem.js'

const MS_PER_DAY = 86_400_000

/**
 * Done tickets under the given epics per period, oldest first: whole periods of `periodDays` ending at the start
 * of `today`, back to the one holding the first such ticket done. Empty when none is done yet.
 * Only children of `epicIds` count, so KTLO and unparented tickets are left out.
 */
export function milestoneThroughput(
  workItems: readonly WorkItem[],
  epicIds: readonly string[],
  today: string,
  periodDays: number,
): number[] {
  const epics = new Set(epicIds)
  const end = Date.parse(`${today}T00:00:00Z`)
  const periodMs = periodDays * MS_PER_DAY
  const periodsBack = workItems
    .filter((item) => item.parentId !== undefined && epics.has(item.parentId) && item.doneAt !== undefined)
    .map((item) => Math.floor((end - Date.parse(item.doneAt!)) / periodMs))
    .filter((back) => back >= 0)
  if (periodsBack.length === 0) return []

  const counts = new Array<number>(Math.max(...periodsBack) + 1).fill(0)
  for (const back of periodsBack) counts[counts.length - 1 - back]!++
  return counts
}
