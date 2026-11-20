import { cannedConnector, type CannedFixture } from '../../src/connectors/canned.js'
import type { Choice, ChoiceKind, Ticket } from '../../src/connectors/connector.js'
import {
  DEFAULT_SETTINGS,
  openForecasting,
  type Connecting,
  type Forecasting,
  type ForecastSettings,
  type Outcome,
  type QuerySetupStep,
} from '../../src/forecast/index.js'
import type { Connection } from '../../src/model/connection.js'
import { openMemorySecrets } from '../../src/secrets/memorySecrets.js'
import { openSqliteStorage } from '../../src/storage/sqliteStorage.js'
import type { Storage } from '../../src/storage/storage.js'
import { CHECKOUT, TEAM, type TeamStorage } from '../trackerScenario.js'

// Seam B's one arrangement (#233): the team's handle itself, opened as either build opens it, on an in-memory SQLite
// storage, the canned connector answering from a fixture the test can change between reads, `openMemorySecrets` in
// place of the keychain, and a fixed clock the test can move; or, for the forecast ledger's tests, the browser build's
// handle on a storage of the test's own, opened again on each restart. Seam B's tests build their handle here.

export { CHECKOUT, TEAM, type TeamStorage }
/** The instant the clock reads unless given: a Thursday, 09:00 UTC, on trackerScenario.ts's `TODAY`. */
export const NOW = '2026-11-12T09:00:00Z'

/** The fixture unless given: the tracker lists Checkout v2's milestone, whose query reads `tickets`. */
export const checkoutFixture = (tickets: Ticket[] = []): CannedFixture => ({
  milestoneChoices: [{ kind: 'milestone', choices: [CHECKOUT], pastLimit: false }],
  reads: { [CHECKOUT.query]: { tickets, incomplete: false } },
})

/** Where each tracker connects: GitHub's shop-team/shop, or Jira's project SHOP. */
export const CONNECTIONS = {
  github: { kind: 'connect', tracker: 'github', repo: 'shop-team/shop', site: '', projectKey: '', email: '', token: 'token' },
  jira: { kind: 'connect', tracker: 'jira', repo: '', site: 'shop.atlassian.net', projectKey: 'SHOP', email: 'em@shop.test', token: 'token' },
} as const

/** What the keychain and the stored connection can be made to fail at, as each would: by throwing. */
export type Fails = Partial<Record<'saveToken' | 'token' | 'deleteToken' | 'saveConnection' | 'removeConnection', boolean>>

export interface ForecastingForTestOptions {
  /** What the canned connector answers from, as it is when read; `checkoutFixture()` unless given. */
  fixture?: CannedFixture
  /** The clock: `NOW` in UTC unless given. Move it with `at`. */
  clock?: { now?: string; timeZone?: string }
  /** Connected to GitHub (`true`) or Jira before the test, with nothing counted yet. */
  connected?: boolean | 'github' | 'jira'
  /** Setup open, as on first launch, so what the steps pick is held in its draft until "Use these"; closed done unless given. */
  setupOpen?: boolean
  settings?: ForecastSettings
  /** The browser build, which connects nothing. */
  browser?: boolean
}

/**
 * The browser build's handle on a storage of the test's own that stays when the handle is opened again (a SQLite file,
 * or the web build's browser storage), which `storedIn` opens, and opens again on each restart, so a restart reads
 * back what was written.
 */
export interface StoredInOptions extends Omit<ForecastingForTestOptions, 'browser' | 'connected' | 'setupOpen' | 'fixture'> {
  storedIn: () => Storage
}

/** The team's handle itself, and what the test arranges, reads and moves it with. */
export interface ForecastingForTest<S extends Storage = TeamStorage> extends Forecasting {
  /** The storage the handle was opened on last. */
  readonly storage: S
  fixture: CannedFixture
  /** What the canned connector was asked: the choices listed, each query read and how far back, each search. */
  calls: { choices: number; reads: string[]; since: string[]; searches: [ChoiceKind, string][]; built: { connection: Connection; token: string }[] }
  /** Where the team's token is kept, in memory in place of the keychain, read as it is, failing at nothing. */
  secrets: Connecting['secrets']
  /** Set one to make the keychain or the stored connection fail at it from now on. */
  fails: Fails
  /** Moves the clock to `now`. */
  at(now: string): void
  /** Opens the handle again, as a restart does, with `settings` if given: on the same storage, or on `storedIn` opened again. */
  restart(settings?: ForecastSettings): void
  /** A handle on the same storage and clock as the browser build opens it, connecting nothing. */
  browserBuild(): Forecasting
}

/** The team's handle on the canned connector, as the local server build opens it unless `browser`; or on a storage of the test's own. */
export async function forecastingForTest(options: StoredInOptions): Promise<ForecastingForTest<Storage>>
export async function forecastingForTest(options?: ForecastingForTestOptions): Promise<ForecastingForTest>
export async function forecastingForTest(options: ForecastingForTestOptions & Partial<StoredInOptions> = {}): Promise<ForecastingForTest<Storage>> {
  const { fixture = checkoutFixture(), clock = {}, connected = false, setupOpen = false, settings = DEFAULT_SETTINGS, storedIn } = options
  const memory: TeamStorage = openSqliteStorage(':memory:')
  let storage: Storage = storedIn ? storedIn() : memory
  let now = clock.now ?? NOW
  const calls: ForecastingForTest['calls'] = { choices: 0, reads: [], since: [], searches: [], built: [] }
  const secrets = openMemorySecrets()
  const fails: Fails = {}
  const browser = options.browser === true || storedIn !== undefined
  const connecting = browser ? undefined : failing(cannedConnecting(memory, secrets, fixture, calls), fails)
  const clockNow = { now: () => now, timeZone: clock.timeZone ?? 'UTC' }
  const open = (with_: ForecastSettings, using: Connecting | undefined) =>
    openForecasting({ storage, ...(using && { connecting: using }), clock: clockNow, settings: with_ })
  const team: ForecastingForTest<Storage> = Object.assign(open(settings, connecting), {
    storage,
    fixture,
    calls,
    fails,
    secrets,
    at: (later: string) => void (now = later),
    restart: (with_ = settings) => {
      if (storedIn) storage = storedIn()
      Object.assign(team, open(with_, connecting), { storage })
    },
    browserBuild: () => open(settings, undefined),
  })
  if (!setupOpen && !storedIn) memory.saveSetupState(TEAM, { open: false, closed: 'done' })
  if (connected) {
    await team.submit({ form: 'connection', edit: CONNECTIONS[connected === true ? 'github' : connected] })
    Object.assign(calls, { choices: 0, reads: [], since: [], searches: [], built: [] })
  }
  return team
}

/** The local server build's means to connect, on the canned connector answering from `fixture` as it is when read. */
function cannedConnecting(storage: TeamStorage, secrets: Connecting['secrets'], fixture: CannedFixture, calls: ForecastingForTest['calls']): Connecting {
  return {
    connections: storage,
    queries: storage,
    setup: storage,
    secrets,
    connector: (connection, token) => {
      calls.built.push({ connection, token })
      const canned = cannedConnector(fixture)
      return {
        milestoneChoices: () => ((calls.choices += 1), canned.milestoneChoices()),
        searchChoices: (kind, text) => (calls.searches.push([kind, text]), canned.searchChoices(kind, text)),
        read: (query, since) => (calls.reads.push(query), calls.since.push(since), canned.read(query, since)),
      }
    },
  }
}

/** `using`, its keychain and connection storage failing as `fails` says when called. */
function failing(using: Connecting, fails: Fails): Connecting {
  const fail = (what: string): never => {
    throw new Error(`${what} failed`)
  }
  const { secrets, connections } = using
  return {
    ...using,
    secrets: {
      saveToken: async (teamId, token) => (fails.saveToken ? fail('saveToken') : secrets.saveToken(teamId, token)),
      token: async (teamId) => (fails.token ? fail('token') : secrets.token(teamId)),
      deleteToken: async (teamId) => (fails.deleteToken ? fail('deleteToken') : secrets.deleteToken(teamId)),
    },
    connections: {
      saveConnection: (teamId, connection) => (fails.saveConnection ? fail('saveConnection') : connections.saveConnection(teamId, connection)),
      connection: (teamId) => connections.connection(teamId),
      removeConnection: (teamId) => (fails.removeConnection ? fail('removeConnection') : connections.removeConnection(teamId)),
    },
  }
}

/** Picks `choice` (Checkout v2 unless given) in the query step `step` (the Milestone step unless given), as at `readAt`. */
export function pick(team: ForecastingForTest, readAt: string, choice: Choice = CHECKOUT, step: QuerySetupStep = 'milestone'): Promise<Outcome> {
  team.at(readAt)
  return team.submit({ form: 'stepQuery', step, edit: { kind: 'addPick', choice } })
}

/**
 * Reads the milestone query again at `readAt`, as the Milestone step does: its pick removed, then picked again, which
 * reads it as far back as the milestone's inputs need.
 */
export async function readAgain(team: ForecastingForTest, readAt: string, choice: Choice = CHECKOUT): Promise<void> {
  team.at(readAt)
  await team.submit({ form: 'stepQuery', step: 'milestone', edit: { kind: 'removePick', query: choice.query } })
  await pick(team, readAt, choice)
}

/** Skips the tracker's periods starting on `periods`, as at `readAt`. */
export function skip(team: ForecastingForTest, periods: string[], readAt: string): Promise<Outcome> {
  team.at(readAt)
  return team.submit({ form: 'skip', edit: { kind: 'skip', periods } })
}

/** Counts the skipped periods starting on `periods` again, as at `readAt`. */
export function countAgain(team: ForecastingForTest, periods: string[], readAt: string): Promise<Outcome> {
  team.at(readAt)
  return team.submit({ form: 'skip', edit: { kind: 'countAgain', periods } })
}
