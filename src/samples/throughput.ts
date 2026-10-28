import type { WorkItem } from '../model/workItem.js'

const MS_PER_DAY = 86_400_000

/** Done tickets under a milestone's epics in one period. */
export interface ThroughputSample {
  /** ISO calendar date the period starts on. */
  periodStart: string
  periodDays: number
  count: number
}

/**
 * Done tickets under the given epics per day, oldest first: each whole day from the first one starting at or after
 * `from` (an ISO timestamp) to the day before `today`. Only children of `epicIds` count, so KTLO and unparented tickets
 * are left out, and nothing done before `from` counts.
 */
export function dailyThroughput(
  workItems: readonly WorkItem[],
  epicIds: readonly string[],
  from: string,
  today: string,
): ThroughputSample[] {
  const first = Math.ceil(Date.parse(from) / MS_PER_DAY)
  const end = Date.parse(`${today}T00:00:00Z`) / MS_PER_DAY
  if (first >= end) return []

  const counts = new Array<number>(end - first).fill(0)
  const epics = new Set(epicIds)
  for (const item of workItems) {
    if (item.parentId === undefined || !epics.has(item.parentId) || item.doneAt === undefined) continue
    const day = Math.floor(Date.parse(item.doneAt) / MS_PER_DAY) - first
    if (day >= 0 && day < counts.length) counts[day]!++
  }
  return counts.map((count, day) => ({
    periodStart: new Date((first + day) * MS_PER_DAY).toISOString().slice(0, 10),
    periodDays: 1,
    count,
  }))
}
