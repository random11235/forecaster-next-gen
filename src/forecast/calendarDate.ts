/** `YYYY-MM-DD` naming a day that exists: 2026-02-30 is refused. */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const day = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === value
}

/** Whole days from calendar date `from` to `to`, both `YYYY-MM-DD`: negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const MS_PER_DAY = 86_400_000
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY)
}
