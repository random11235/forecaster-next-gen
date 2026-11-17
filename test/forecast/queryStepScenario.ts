import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach } from 'vitest'
import { cannedConnector, type CannedFixture } from '../../src/connectors/canned.js'
import type { Choice, Connector } from '../../src/connectors/connector.js'
import { submitConnection } from '../../src/forecast/connection.js'
import type { QueryStepping } from '../../src/forecast/queryStep.js'
import { openMemorySecrets } from '../../src/secrets/memorySecrets.js'
import { openSqliteStorage } from '../../src/storage/sqliteStorage.js'
import type { TeamStorage } from '../trackerScenario.js'

// The arrangement shared by the Milestone step's tests (#191): a team in a fresh database for each test, the canned
// connector's choices and reads, and the means to connect and to change the step. Importing it sets the database up.

export const TEAM = 'team'
export const READ_AT = '2026-11-12T09:00:00Z'
const AT = { readAt: READ_AT, today: '2026-11-12', timeZone: 'UTC' }

export const payments: Choice = { kind: 'milestone', name: 'Payments v2', query: 'milestone:"Payments v2"' }
export const checkout: Choice = { kind: 'milestone', name: 'Checkout', query: 'milestone:"Checkout"' }
export const repay: Choice = { kind: 'label', name: 'repayments', query: 'label:"repayments"' }
export const bug: Choice = { kind: 'label', name: 'bug', query: 'label:"bug"' }

export const FIXTURE: CannedFixture = {
  milestoneChoices: [
    { kind: 'milestone', choices: [payments, checkout], pastLimit: false },
    { kind: 'label', choices: [repay, bug], pastLimit: false },
  ],
  reads: {
    'milestone:"Payments v2"': {
      tickets: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3', finishedAt: '2026-10-20T10:00:00Z' }, { id: 'p4', finishedAt: '2026-08-01T10:00:00Z' }],
      incomplete: false,
    },
    'milestone:"Payments v2" OR label:"bug"': {
      tickets: [{ id: 'p1' }, { id: 'p2' }, { id: 'b1' }, { id: 'p3', finishedAt: '2026-10-20T10:00:00Z' }, { id: 'b2', finishedAt: '2026-11-01T10:00:00Z' }],
      incomplete: false,
    },
    'label:checkout -label:bug': { tickets: [{ id: 'c1' }], incomplete: false },
  },
}

let dir: string
let file: string
export let storage: TeamStorage

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'forecaster-milestone-step-'))
  file = join(dir, 'forecaster.db')
  storage = openSqliteStorage(file)
  storage.saveTeam({ id: TEAM, name: 'My team', source: 'manual', sourceRef: '', installedAt: '2026-01-01T00:00:00Z' })
  storage.saveSetupState(TEAM, { open: false, closed: 'done' })
})

afterEach(() => {
  storage.close()
  rmSync(dir, { recursive: true, force: true })
})

/** Opens the database file again, as a restart would, in place of `storage`. */
export function reopenStorage(): void {
  storage = openSqliteStorage(file)
}

/** The local build's means to connect, on the canned connector answering from `fixture`, counting its calls. */
export function connecting(fixture: CannedFixture = FIXTURE): QueryStepping & { calls: { choices: number; reads: string[]; searches: [string, string][] } } {
  const calls = { choices: 0, reads: [] as string[], searches: [] as [string, string][] }
  const canned = cannedConnector(fixture)
  const connector = (): Connector => ({
    milestoneChoices: () => {
      calls.choices += 1
      return canned.milestoneChoices()
    },
    searchChoices: (kind, text) => {
      calls.searches.push([kind, text])
      return canned.searchChoices(kind, text)
    },
    read: (query, since) => {
      calls.reads.push(query)
      return canned.read(query, since)
    },
  })
  return { connections: storage, queries: storage, setup: storage, secrets: openMemorySecrets(), connector, milestoneInputs: storage, at: AT, calls }
}

/** Connected to a GitHub repo, with no calls counted yet. */
export async function connected(fixture: CannedFixture = FIXTURE): Promise<ReturnType<typeof connecting>> {
  const using = connecting(fixture)
  await submitConnection(using, TEAM, { kind: 'connect', tracker: 'github', repo: 'shop-team/shop', site: '', projectKey: '', email: '', token: 'token' })
  using.calls.choices = 0
  return using
}

export const add = (choice: Choice) => ({ kind: 'addPick', choice }) as const
export const remove = (choice: Choice) => ({ kind: 'removePick', query: choice.query }) as const
export const edit = (query: string) => ({ kind: 'editQuery', query }) as const
export const back = { kind: 'backToFinding', confirmed: false } as const
export const backConfirmed = { kind: 'backToFinding', confirmed: true } as const

/** `FIXTURE`, its read of `query` answering `read`. */
export function reading(query: string, read: CannedFixture['reads'][string]): CannedFixture {
  return { ...FIXTURE, reads: { ...FIXTURE.reads, [query]: read } }
}

/** The means to connect on `fixture`, connected to the Jira project SHOP. */
export async function connectedToJira(fixture: CannedFixture): Promise<ReturnType<typeof connecting>> {
  const using = connecting(fixture)
  await submitConnection(using, TEAM, {
    kind: 'connect',
    tracker: 'jira',
    repo: '',
    site: 'shop.atlassian.net',
    projectKey: 'SHOP',
    email: 'em@shop.test',
    token: 'token',
  })
  return using
}
