import { cannedConnector, type CannedFixture } from '../../src/connectors/canned.js'
import type { Clock, Connecting } from '../../src/forecast/index.js'
import { openMemorySecrets } from '../../src/secrets/memorySecrets.js'
import type { Secrets } from '../../src/secrets/secrets.js'
import { openSqliteStorage } from '../../src/storage/sqliteStorage.js'
import { TODAY, type TeamStorage } from '../trackerScenario.js'

// What the app's tests on the canned connector run the app on, whether it is served (appOnTracker.ts) or answered
// in-process (appInProcess.ts).

/** The parts the app runs on, with the canned connector: storage and secrets in memory, and a clock a test moves. */
export interface CannedTrackerApp {
  storage: TeamStorage
  /** Where the app keeps the team's token, in memory in place of the keychain. */
  secrets: Secrets
  connecting: Connecting
  clock: Clock
  /** Moves the clock: the instant the app reads the tracker at from now on. */
  readAt(instant: string): void
}

/** The parts the app runs on, reading at `now` until moved, its connector answering from `fixture` as it is when read. */
export function cannedTrackerApp(fixture: CannedFixture, { now = `${TODAY}T09:00:00Z` } = {}): CannedTrackerApp {
  const storage: TeamStorage = openSqliteStorage(':memory:')
  const secrets = openMemorySecrets()
  const connecting: Connecting = {
    connections: storage,
    queries: storage,
    setup: storage,
    secrets,
    connector: () => cannedConnector(fixture),
  }
  let instant = now
  const clock: Clock = { now: () => instant, timeZone: 'UTC' }
  return { storage, secrets, connecting, clock, readAt: (later) => void (instant = later) }
}
