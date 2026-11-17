import { startAppAndOpenBrowser, type RunningApp } from '../../src/app/launch.js'
import { cannedConnector, type CannedFixture } from '../../src/connectors/canned.js'
import type { Connecting } from '../../src/forecast/connection.js'
import type { Team } from '../../src/model/team.js'
import { openMemorySecrets } from '../../src/secrets/memorySecrets.js'
import type { Secrets } from '../../src/secrets/secrets.js'
import { openSqliteStorage } from '../../src/storage/sqliteStorage.js'
import { TODAY, type TeamStorage } from '../trackerScenario.js'

// The local server build on the canned connector, for tests of what the tracker reads through the EM's browser
// (#211–#215): its storage in memory, and the requests the browser makes.

/** The app running on the canned connector, and what it stores. */
export interface AppOnTracker {
  running: RunningApp
  storage: TeamStorage
  /** Where the app keeps the team's token, in memory in place of the keychain. */
  secrets: Secrets
  /** Moves the clock: the instant the app reads the tracker at from now on. */
  readAt(instant: string): void
  close(): Promise<void>
}

/**
 * The app on `today`, reading at `now` until moved, its connector answering from `fixture` as it is when read, so a
 * test can change what the next read finds. Not yet connected, with nothing entered.
 */
export async function appOnTracker(fixture: CannedFixture, { today = TODAY, now = `${TODAY}T09:00:00Z` } = {}): Promise<AppOnTracker> {
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
  const running = await startAppAndOpenBrowser({ port: 0, openBrowser: () => {}, storage, connecting, today: () => today, now: () => instant })
  return {
    running,
    storage,
    secrets,
    readAt: (later) => void (instant = later),
    async close() {
      await running.close()
      storage.close()
    },
  }
}

/** The page at `path`, as HTML. */
export const page = async (running: RunningApp, path: string): Promise<string> => (await fetch(new URL(path, running.url))).text()

/** The section of the Inputs screen with `id`. */
export async function inputsSection(running: RunningApp, id: string): Promise<string> {
  const html = await page(running, '/inputs')
  const start = html.indexOf(`id="${id}"`)
  if (start === -1) throw new Error(`no section ${id} on the Inputs screen`)
  return html.slice(start, html.indexOf('</section>', start))
}

/** The team either build adds on first open, when nothing is stored yet, installed at `installedAt`. */
export const defaultTeam = (installedAt: string): Team => ({ id: 'team', name: 'My team', source: 'manual', sourceRef: '', installedAt })
