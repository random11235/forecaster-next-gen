/** `YYYY-MM-DD` naming a day that exists: 2026-02-30 is refused. */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const day = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === value
}
