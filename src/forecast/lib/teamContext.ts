import type { Storage } from '../../storage/storage.js'
import type { ReadClock } from './pace.js'
import type { ForecastSettings } from './settings.js'
import type { TrackerReads } from './trackerReads.js'

/**
 * What the views of the team's inputs and forecast read with, and the forms on them save with, in one call of the
 * team's handle: the storage, the team, the settings, the clock as the call reads it (`at`: now, today, the clock's
 * date in the EM's time zone, and the time zone), and, in the local server build, the tracker's reads the views measure
 * with (`tracker`); the browser build has none. Its own file, as teamCall.ts reaches the views through setup.
 */
export interface TeamContext {
  storage: Storage
  teamId: string
  settings: ForecastSettings
  at: ReadClock
  tracker: TrackerReads | undefined
}
