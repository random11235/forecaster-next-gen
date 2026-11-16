import { SAVE_IN_PLACE } from '../../src/app/inputsScript.js'
import { startAppAndOpenBrowser, type RunningApp } from '../../src/app/launch.js'
import { cannedConnector, type CannedFixture } from '../../src/connectors/canned/cannedConnector.js'
import type { Connecting } from '../../src/forecast/connection.js'
import { openMemorySecrets } from '../../src/secrets/memorySecrets.js'
import { openSqliteStorage } from '../../src/storage/sqliteStorage.js'
import { TODAY, type TeamStorage } from '../trackerScenario.js'

// The local server build on the canned connector, for tests of what the tracker reads through the EM's browser
// (#211–#215): its storage in memory, and the requests the browser makes.

/** The app running on the canned connector, and what it stores. */
export interface AppOnTracker {
  running: RunningApp
  storage: TeamStorage
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
  const connecting: Connecting = {
    connections: storage,
    queries: storage,
    setup: storage,
    secrets: openMemorySecrets(),
    connector: () => cannedConnector(fixture),
  }
  let instant = now
  const running = await startAppAndOpenBrowser({ port: 0, openBrowser: () => {}, storage, connecting, today: () => today, now: () => instant })
  return {
    running,
    storage,
    readAt: (later) => void (instant = later),
    async close() {
      await running.close()
      storage.close()
    },
  }
}

/** A form's fields, in any shape `URLSearchParams` takes. */
type FormFields = Record<string, string> | [string, string][] | URLSearchParams

/**
 * Posts `fields` to `path` as a form on the app's own page does: from its origin, which the server checks, not following
 * a redirect. Takes anything with the app's `url`, so a test of the built app can post to the address it printed.
 */
export const post = (running: Pick<RunningApp, 'url'>, path: string, fields: FormFields, headers: Record<string, string> = {}): Promise<Response> =>
  fetch(new URL(path, running.url), {
    method: 'POST',
    body: new URLSearchParams(fields),
    headers: { origin: new URL(running.url).origin, ...headers },
    redirect: 'manual',
  })

/** Posts `fields` as the Inputs screen's script does when a field changes: it asks to stay on the Inputs screen. */
export const saveInPlace = (running: Pick<RunningApp, 'url'>, path: string, fields: FormFields): Promise<Response> =>
  post(running, path, fields, { [SAVE_IN_PLACE.header]: SAVE_IN_PLACE.value })

/** The page at `path`, as HTML. */
export const page = async (running: RunningApp, path: string): Promise<string> => (await fetch(new URL(path, running.url))).text()

/** The section of the Inputs screen with `id`. */
export async function inputsSection(running: RunningApp, id: string): Promise<string> {
  const html = await page(running, '/inputs')
  const start = html.indexOf(`id="${id}"`)
  if (start === -1) throw new Error(`no section ${id} on the Inputs screen`)
  return html.slice(start, html.indexOf('</section>', start))
}
