/** `YYYY-MM-DD` naming a day that exists: 2026-02-30 is refused. */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const day = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === value
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `2026-10-12` → `12 Oct`, as a line about recent periods says it. */
export function dayMonth(isoDate: string): string {
  return `${Number(isoDate.slice(8, 10))} ${MONTHS[Number(isoDate.slice(5, 7)) - 1]}`
}

/** Whole days from calendar date `from` to `to`, both `YYYY-MM-DD`: negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const MS_PER_DAY = 86_400_000
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY)
}

/** The calendar date `days` after `date`, both `YYYY-MM-DD`: before it when `days` is negative. */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

/** A UTC instant as the screens date a read, in `timeZone`: "4 Nov 09:12". */
export function readOn(instant: string, timeZone: string): string {
  const format = new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const part = (type: Intl.DateTimeFormatPartTypes): string => format.formatToParts(new Date(instant)).find((each) => each.type === type)?.value ?? ''
  return `${part('day')} ${part('month')} ${part('hour')}:${part('minute')}`
}
