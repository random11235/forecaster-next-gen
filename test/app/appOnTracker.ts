import { startAppAndOpenBrowser, type RunningApp } from '../../src/app/launch.js'
import type { CannedFixture } from '../../src/connectors/canned.js'
import type { Team } from '../../src/model/team.js'
import { cannedTrackerApp, type CannedTrackerApp } from './cannedTrackerApp.js'

// The local server build on the canned connector, for tests of what the tracker reads through the EM's browser
// (#211–#215): its storage in memory, and the requests the browser makes.

/** The app running on the canned connector, and what it stores. */
export interface AppOnTracker extends Pick<CannedTrackerApp, 'storage' | 'secrets' | 'readAt'> {
  running: RunningApp
  close(): Promise<void>
}

/**
 * The app reading at `now` until moved, today being its date in UTC, its connector answering from `fixture` as it is
 * when read, so a test can change what the next read finds. Not yet connected, with nothing entered.
 */
export async function appOnTracker(fixture: CannedFixture, options: { now?: string } = {}): Promise<AppOnTracker> {
  const { storage, secrets, connecting, clock, readAt } = cannedTrackerApp(fixture, options)
  const running = await startAppAndOpenBrowser({ port: 0, openBrowser: () => {}, storage, connecting, clock })
  return {
    running,
    storage,
    secrets,
    readAt,
    async close() {
      await running.close()
      storage.close()
    },
  }
}

/** The page at `path`, as HTML. */
export const page = async (running: RunningApp, path: string): Promise<string> => (await fetch(new URL(path, running.url))).text()

/** The team either build adds on first open, when nothing is stored yet, installed at `installedAt`. */
export const defaultTeam = (installedAt: string): Team => ({ id: 'team', name: 'My team', source: 'manual', sourceRef: '', installedAt })
