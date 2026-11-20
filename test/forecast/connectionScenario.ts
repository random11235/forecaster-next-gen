import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach } from 'vitest'
import { cannedConnector, type CannedFixture } from '../../src/connectors/canned.js'
import type { Connector, Failure } from '../../src/connectors/connector.js'
import type { Connection } from '../../src/model/connection.js'
import { connectionView, submitConnection, type Connecting, type ConnectionEdit } from '../../src/forecast/connection.js'
import { openMemorySecrets } from '../../src/secrets/memorySecrets.js'
import { openSqliteStorage } from '../../src/storage/sqliteStorage.js'
import type { TeamStorage } from '../trackerScenario.js'

// The arrangement connection.test.ts and connection.refused.test.ts share: a team in a fresh SQLite file for each
// test, removed after, and the canned connector to connect to.

export const TEAM = 'team'
export const TOKEN = 'github_pat_11ABCDEFG0123456789_secret'

const CHOICES: CannedFixture = {
  milestoneChoices: [{ kind: 'milestone', choices: [{ kind: 'milestone', name: 'Checkout v2', query: 'milestone:"Checkout v2"' }], pastLimit: false }],
  reads: {},
}

let dir: string
export let storage: TeamStorage

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'forecaster-connection-'))
  storage = openSqliteStorage(join(dir, 'forecaster.db'))
  storage.saveTeam({ id: TEAM, name: 'My team', source: 'manual', sourceRef: '', installedAt: '2026-01-01T00:00:00Z' })
})

afterEach(() => {
  storage.close()
  rmSync(dir, { recursive: true, force: true })
})

/** What a connector was built from, each time the factory was called. */
type Built = { connection: Connection; token: string }[]

/** The local server build's means to connect, on the canned connector answering `milestoneChoices` with `answer`. */
export function connecting(answer: CannedFixture['milestoneChoices'] = CHOICES.milestoneChoices): Connecting & { built: Built } {
  const built: Built = []
  const connector = (connection: Connection, token: string): Connector => {
    built.push({ connection, token })
    return cannedConnector({ milestoneChoices: answer, reads: {} })
  }
  return { connections: storage, queries: storage, setup: storage, secrets: openMemorySecrets(), connector, built }
}

export function github(repo = 'shop-team/shop', token = TOKEN): ConnectionEdit {
  return { kind: 'connect', tracker: 'github', repo, site: '', projectKey: '', email: '', token }
}

export function jira(fields: Partial<{ site: string; projectKey: string; email: string; token: string }> = {}): ConnectionEdit {
  return { kind: 'connect', tracker: 'jira', repo: '', site: 'shop.atlassian.net', projectKey: 'SHOP', email: 'em@shop.example', token: TOKEN, ...fields }
}
