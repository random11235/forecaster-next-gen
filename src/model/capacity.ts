/**
 * One capacity entry the EM typed: the team at a whole percentage of its usual from one date, to another or onward,
 * for any reason (leave, an incident, KTLO, a shift in priorities). Entries belong to the team, not the milestone, so
 * they carry over to the next one.
 */
export interface CapacityEntry {
  /** Unique within the team; a new entry takes the next number. */
  id: number
  /** ISO calendar date of its first day, `YYYY-MM-DD`. */
  from: string
  /** ISO calendar date of its last day, on or after `from`; undefined for an entry that runs onward. */
  to: string | undefined
  /** Whole percentage of the team's usual, 0 or more: 100 is a usual week. */
  percent: number
  /** Why, in the EM's words; empty when none was given. */
  note: string
  /** ISO calendar date the EM accepted it as the new usual, ending it that day; undefined until they do. */
  newUsualOn?: string
  /** The EM chose to keep it when it was proposed as the new usual, so it is no longer proposed. */
  kept?: true
}
