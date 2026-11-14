import type { Failure } from '../connectors/connector.js'

/** Why a read failed, and when it was asked for (`at`): the tracker's failure, or this computer's keychain not giving the token. */
export type FailedRead = (Failure | { failure: 'keychainFailed' }) & { at: string }

/**
 * Why the team's last reads failed, the saved reads staying in use (#222), kept so the summary still says why after a
 * reload: a read by hand failed as a whole (`whole`), and each query whose own read failed, by the query (the
 * milestone query, comparable work's, or a pick read at Check). Each says so only until a read of it is saved after it.
 */
export interface ReadFailures {
  whole?: FailedRead
  queries?: Record<string, FailedRead>
}
