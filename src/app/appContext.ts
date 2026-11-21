import type { Clock } from '../forecast/index.js'

// The request and reply the routes (routes.ts) see, and the clock both builds open the team's handle on.

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

/** The system clock, in this computer's time zone: the EM's, which today is the date in, and each finish is counted on its calendar day in. */
export function systemClock(): Clock {
  return { now: () => new Date().toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }
}
