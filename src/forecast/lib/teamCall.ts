import type { Connector } from '../../connectors/connector.js'
import type { Team } from '../../model/team.js'
import type { Storage } from '../../storage/storage.js'
import type { Connecting } from './connection.js'
import { calendarDayIn, type ReadClock } from './pace.js'
import { DEFAULT_SETTINGS, type ForecastSettings } from './settings.js'
import type { SetupContext } from './setup.js'
import type { Skipping } from './skippedPeriods.js'
import type { TeamContext } from './teamContext.js'
import type { TrackerReads } from './trackerReads.js'

/** The time, as the EM's computer tells it: the UTC instant now, and the EM's time zone (an IANA name). */
export interface Clock {
  now(): string
  timeZone: string
}

/**
 * What the team's handle is opened on: where everything is stored, the clock, the settings (`DEFAULT_SETTINGS` unless
 * given), and, in the local server build, what it connects a tracker with; the browser build connects nothing, so its
 * views have no Connect or query step.
 */
export interface ForecastingOptions {
  storage: Storage
  connecting?: Connecting
  clock: Clock
  settings?: ForecastSettings
}

/**
 * What one call of the team's handle reads and saves with: what the views read with (`TeamContext`), and, in the local
 * server build, what setup and its steps read and save with (`reading`), whose connectors list the milestone choices
 * once in the call. The browser build has none.
 */
export interface TeamCall extends TeamContext {
  /**
   * What both builds reach reads it as it may be, none in the browser build (`reading &&`): the Inputs screen, a
   * search, a renamed milestone followed. What only the local server build's screens send takes it through
   * `connected`, which throws without it: setup's forms, a skip, the candidates.
   */
  reading: (SetupContext & Skipping) | undefined
}

/** What setup and its steps read and save with: a submit of one in the browser build, which never sends one, throws. */
export function connected({ reading }: TeamCall): SetupContext & Skipping {
  if (!reading) throw new Error('The browser build connects no tracker.')
  return reading
}

/** The team's calls, adding the default team on first launch, when nothing is stored yet: a fresh one for each handle call. */
export function openTeamCalls({ storage, connecting, clock, settings = DEFAULT_SETTINGS }: ForecastingOptions): () => TeamCall {
  const teamId = (storage.teams()[0] ?? addDefaultTeam(storage, clock.now())).id
  const { timeZone } = clock
  const tracker: TrackerReads | undefined = connecting && { ...connecting, timeZone }
  return () => {
    const readAt = clock.now()
    const at: ReadClock = { readAt, today: calendarDayIn(timeZone)(readAt), timeZone }
    const reading = connecting && { ...listingOnce(connecting), milestoneInputs: storage, today: at.today, timeZone }
    return { storage, teamId, settings, at, tracker, reading }
  }
}

/**
 * Adds the one team everything is stored under, installed at `installedAt`. The MVP has no team screen, so the EM never
 * sees it: its facts are the ones the EM types in, read from no board or repository.
 */
function addDefaultTeam(storage: Storage, installedAt: string): Team {
  const team: Team = { id: 'team', name: 'My team', source: 'manual', sourceRef: '', installedAt }
  storage.saveTeam(team)
  return team
}

/** `connecting`, but its connectors ask the tracker for the milestone choices once between them, however often asked. */
function listingOnce(connecting: Connecting): Connecting {
  let listed: ReturnType<Connector['milestoneChoices']> | undefined
  return {
    ...connecting,
    connector: (connection, token) => {
      const connector = connecting.connector(connection, token)
      return {
        milestoneChoices: () => (listed ??= connector.milestoneChoices()),
        searchChoices: (kind, text) => connector.searchChoices(kind, text),
        read: (query, finishedSince) => connector.read(query, finishedSince),
      }
    },
  }
}
