/** What the screens call one of the team's periods: a week at 7 days, a sprint at any other cadence. */
export type PeriodName = 'week' | 'sprint'

/** The name of a period `cadenceDays` long, as the screens say it: "tickets per week", "tickets per sprint". */
export function periodName(cadenceDays: number): PeriodName {
  return cadenceDays === 7 ? 'week' : 'sprint'
}
