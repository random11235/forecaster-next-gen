import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cannedConnector, type CannedFixture } from '../../src/connectors/canned/cannedConnector.js'
import type { Connection, Connector, Failure } from '../../src/connectors/connector.js'
import { connectionView, submitConnection, type Connecting, type ConnectionEdit } from '../../src/forecast/connection.js'
import { openMemorySecrets } from '../../src/secrets/memorySecrets.js'
import { openSqliteStorage, type SqliteStorage } from '../../src/storage/sqliteStorage.js'

// Connecting a tracker (#180): the Connect step's view, and a submit that checks the connection before saving it.

const TEAM = 'team'
const TOKEN = 'github_pat_11ABCDEFG0123456789_secret'

const CHOICES: CannedFixture = { milestoneChoices: [{ kind: 'milestone', name: 'Checkout v2', query: 'milestone:"Checkout v2"' }], reads: {} }

let dir: string
let storage: SqliteStorage

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
function connecting(answer: CannedFixture['milestoneChoices'] = CHOICES.milestoneChoices): Connecting & { built: Built } {
  const built: Built = []
  const connector = (connection: Connection, token: string): Connector => {
    built.push({ connection, token })
    return cannedConnector({ milestoneChoices: answer, reads: {} })
  }
  return { connections: storage, secrets: openMemorySecrets(), connector, built }
}

function github(repo = 'shop-team/shop', token = TOKEN): ConnectionEdit {
  return { kind: 'connect', tracker: 'github', repo, site: '', projectKey: '', email: '', token }
}

function jira(fields: Partial<{ site: string; projectKey: string; email: string; token: string }> = {}): ConnectionEdit {
  return { kind: 'connect', tracker: 'jira', repo: '', site: 'shop.atlassian.net', projectKey: 'SHOP', email: 'em@shop.example', token: TOKEN, ...fields }
}

describe('connecting', () => {
  test('a good GitHub connect is checked, saves the connection and the token, and moves on to the milestone', async () => {
    const using = connecting()

    const submitted = await submitConnection(using, TEAM, github())

    expect(submitted).toEqual({ saved: true, next: 'milestone' })
    expect(using.built).toEqual([{ connection: { tracker: 'github', owner: 'shop-team', repo: 'shop' }, token: TOKEN }])
    expect(storage.connection(TEAM)).toEqual({ tracker: 'github', owner: 'shop-team', repo: 'shop' })
    expect(await using.secrets.token(TEAM)).toBe(TOKEN)
  })

  test('a good Jira connect saves the site, the project and the account email, as typed but tidied', async () => {
    const using = connecting()

    const submitted = await submitConnection(using, TEAM, jira({ site: ' https://shop.atlassian.net/ ', projectKey: 'shop ', email: ' em@shop.example' }))

    const connection: Connection = { tracker: 'jira', site: 'shop.atlassian.net', projectKey: 'SHOP', email: 'em@shop.example' }
    expect(submitted).toEqual({ saved: true, next: 'milestone' })
    expect(using.built).toEqual([{ connection, token: TOKEN }])
    expect(storage.connection(TEAM)).toEqual(connection)
    expect(await using.secrets.token(TEAM)).toBe(TOKEN)
  })
})

describe('a connect the tracker refuses', () => {
  const refusedBy = (failure: Failure['failure']): CannedFixture['milestoneChoices'] =>
    failure === 'invalidQuery' ? { failure, message: 'no' } : { failure }

  test('a refused GitHub token says so, saves nothing, and keeps the form as typed without the token', async () => {
    const using = connecting(refusedBy('unauthorised'))

    const submitted = await submitConnection(using, TEAM, github('shop-team/shop'))

    expect(submitted).toEqual({
      saved: false,
      view: {
        kind: 'connect',
        form: { tracker: 'github', repo: 'shop-team/shop', site: '', projectKey: '', email: '' },
        permissions: { github: 'Issues: read', jira: 'read:jira-work' },
        refusal: 'GitHub refused the token. Check it hasn’t expired, and that it has Issues: read on this repo.',
      },
    })
    expect(storage.connection(TEAM)).toBeUndefined()
    expect(await using.secrets.token(TEAM)).toBeUndefined()
  })

  test.each([
    ['github', 'unauthorised', 'GitHub refused the token. Check it hasn’t expired, and that it has Issues: read on this repo.'],
    ['github', 'notFound', 'GitHub can’t see shop-team/shop with this token. Check the repo’s name, and that the token covers it.'],
    ['github', 'unavailable', 'GitHub can’t be reached just now, or is limiting requests. Try again in a few minutes.'],
    ['jira', 'unauthorised', 'Jira refused the token. Check it hasn’t expired, that it has read:jira-work, and that em@shop.example is the account that made it.'],
    ['jira', 'notFound', 'Jira can’t find project SHOP on shop.atlassian.net with this token. Check the site and the project key, and that the account can see it.'],
    ['jira', 'unavailable', 'Jira can’t be reached just now, or is limiting requests. Try again in a few minutes.'],
  ] as const)('%s failing the check as %s says so, and saves nothing', async (tracker, failure, refusal) => {
    const using = connecting(refusedBy(failure))

    const submitted = await submitConnection(using, TEAM, tracker === 'github' ? github() : jira())

    expect(submitted.saved === false && submitted.view.refusal).toBe(refusal)
    expect(storage.connection(TEAM)).toBeUndefined()
    expect(await using.secrets.token(TEAM)).toBeUndefined()
  })
})
