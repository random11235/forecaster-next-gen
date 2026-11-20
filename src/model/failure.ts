/**
 * Why a connector couldn't answer. Connectors don't word failures; the screens do.
 * - `invalidQuery`: the tracker refused the query, with its own message.
 * - `outOfScope`: the query reaches outside the connection's repo or project.
 * - `notFound`: the repo or project doesn't exist, or the token can't see it.
 * - `unauthorised`: the token was refused.
 * - `unavailable`: the network, or rate limiting after backoff.
 */
export type Failure = { failure: 'invalidQuery'; message: string } | { failure: 'outOfScope' | 'notFound' | 'unauthorised' | 'unavailable' }
