const MS_PER_DAY = 86_400_000
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function isIsoDate(value: string): boolean {
  return ISO_DATE.test(value) && !Number.isNaN(dayStart(value))
}

/** The date `period` periods after `startDate`, as ISO `YYYY-MM-DD`. */
export function periodEndDate(startDate: string, periodDays: number, period: number): string {
  return new Date(dayStart(startDate) + period * periodDays * MS_PER_DAY).toISOString().slice(0, 10)
}

/** `floor((byDate − startDate) / periodDays)`: the periods that end on or before `byDate`. */
export function wholePeriodsUntil(startDate: string, periodDays: number, byDate: string): number {
  return Math.floor((dayStart(byDate) - dayStart(startDate)) / MS_PER_DAY / periodDays)
}

function dayStart(isoDate: string): number {
  return Date.parse(`${isoDate}T00:00:00Z`)
}
