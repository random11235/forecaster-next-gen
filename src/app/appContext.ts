import type { Connecting } from '../forecast/connection.js'
import type { Team } from '../model/team.js'
import type { Storage } from '../storage/storage.js'

// The context the routes (routes.ts) run in, and the request and reply they see.

/** A request as the routes see it: the server has already read the form body. */
export interface Request {
  method: string
  /** With any query: `/?capacity=open` is the Milestone forecast with its Capacity section open. */
  path: string
  /** The submitted form, for a POST. */
  form?: URLSearchParams
  /** Asked by the Inputs screen's script, which saves each input as it changes: answer a save with the Inputs screen. */
  saveInPlace?: boolean
}

/** What to send back. */
export type Reply =
  /** A screen; for a post, `path` is where the screen it answers with is served. */
  { kind: 'html'; status: number; html: string; path?: string } | { kind: 'redirect'; location: string } | { kind: 'notFound' }

export interface AppContext {
  storage: Storage
  /** Today's ISO calendar date: the start date's default, and what marks dates as past. */
  today: () => string
  /** What the local server build connects a tracker with; the browser build has none, so no Connect or Milestone step. */
  connecting?: Connecting
  /** The UTC instant now, which a read is made at. */
  now: () => string
}

/**
 * The context the routes run in, on `storage`; today is the system clock's local date unless given. Given
 * `connecting`, the Inputs screen has its Connect step.
 */
export function appContext(storage: Storage, today?: () => string, connecting?: Connecting, now?: () => string): AppContext {
  addDefaultTeamIfEmpty(storage)
  return {
    storage,
    today: today ?? (() => localCalendarDate(new Date())),
    now: now ?? (() => new Date().toISOString()),
    ...(connecting && { connecting }),
  }
}

/**
 * The one team everything is stored under, added on first launch and installed at `installedAt`. The MVP has no team
 * screen, so the EM never sees it: its facts are the ones the EM types in, read from no board or repository.
 */
function defaultTeam(installedAt: string): Team {
  return { id: 'team', name: 'My team', source: 'manual', sourceRef: '', installedAt }
}

/** On first launch (nothing stored yet), adds the default team, installed now. Otherwise does nothing. */
function addDefaultTeamIfEmpty(storage: Storage): void {
  if (!storage.isEmpty()) return
  storage.saveTeam(defaultTeam(new Date().toISOString()))
}

/** `at` as the EM's calendar date, `YYYY-MM-DD`, in the machine's time zone: not UTC's, which can be a day off. */
function localCalendarDate(at: Date): string {
  const two = (value: number): string => String(value).padStart(2, '0')
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`
}
