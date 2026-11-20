import type { Failure } from './failure.js'

/** Why a read failed, and when it was asked for (`at`): the tracker's failure, or this computer's keychain not giving the token. */
export type FailedRead = (Failure | { failure: 'keychainFailed' }) & { at: string }

/** Each failed read of a query, by the query read, as saved reads are kept. */
export type FailedReads = Readonly<Record<string, FailedRead>>

/**
 * Why the team's last reads failed, the saved reads staying in use (#222), kept so the summary still says why after a
 * reload: a read by hand failed as a whole (`whole`); a step's query's own read by hand failed, by that query
 * (`queries`: the milestone query or comparable work's); and a pick's own read at Check failed, by the pick's query
 * (`picks`), kept apart from the queries', as a lone pick's query is its step's too. Each says so only until a read of
 * it is saved after it.
 */
export interface ReadFailures {
  whole?: FailedRead
  queries?: FailedReads
  picks?: FailedReads
}
