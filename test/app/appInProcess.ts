import { route } from '../../src/app/routes.js'
import { openForecasting } from '../../src/forecast/index.js'
import type { CannedFixture } from '../../src/connectors/canned.js'
import type { Secrets } from '../../src/secrets/secrets.js'
import { CHECKOUT, type TeamStorage } from '../trackerScenario.js'
import { GITHUB_SHOP, onTracker } from './appOnTracker.js'

// The local server build's routes on the canned connector, answered in-process with no server started (#237): for the
// tests of the page scripts, whose page asks them in place of the server. What the server adds around the routes (its
// Host and Origin checks, and the `/live` reload) is launch.test.ts's.

/** A request as the routes see it, its form already read. */
export type RouteRequest = Parameters<typeof route>[0]
/** What the routes answer with. */
export type RouteReply = Awaited<ReturnType<typeof route>>

/** The server build's routes on the canned connector, and what they store. */
export interface AppInProcess {
  storage: TeamStorage
  /** Where the app keeps the team's token, in memory in place of the keychain. */
  secrets: Secrets
  /** Moves the clock: the instant the app reads the tracker at from now on. */
  readAt(instant: string): void
  /** Answers `request` as the server's routes do; once stopped, fails, as a server no longer answering. */
  answer(request: RouteRequest): Promise<RouteReply>
  /** Posts `fields` to `path` as a form on the app's own page does. */
  post(path: string, fields: Record<string, string>): Promise<RouteReply>
  /** The screen at `path`, as HTML, failing if `path` answers with none. */
  page(path: string): Promise<string>
  /** Stops answering, as the Forecaster does once it stops running. */
  stop(): void
  close(): void
}

/** The routes reading at `now` until moved, on `fixture` as it is when read. Not yet connected, with nothing entered. */
export function appInProcess(fixture: CannedFixture, options: { now?: string } = {}): AppInProcess {
  const { storage, secrets, connecting, clock, readAt } = onTracker(fixture, options)
  const forecasting = openForecasting({ storage, connecting, clock })
  let stopped = false
  const answer = async (request: RouteRequest): Promise<RouteReply> => {
    if (stopped) throw new TypeError('Failed to fetch: the Forecaster has stopped')
    return route(request, forecasting)
  }
  return {
    storage,
    secrets,
    readAt,
    answer,
    post: (path, fields) => answer({ method: 'POST', path, form: new URLSearchParams(fields) }),
    async page(path) {
      const reply = await answer({ method: 'GET', path })
      if (reply.kind !== 'html') throw new Error(`${path} answers with no screen: ${reply.kind}`)
      return reply.html
    },
    stop: () => void (stopped = true),
    close: () => storage.close(),
  }
}

/** Connects `app` to `GITHUB_SHOP`, and picks Checkout v2's milestone as the milestone's query. */
export async function connectAndPick(app: AppInProcess): Promise<void> {
  await app.post('/inputs/connect', GITHUB_SHOP)
  await app.post('/inputs/milestone-query/add', { ...CHECKOUT })
}
