import { afterEach, describe, expect, test } from 'vitest'
import { cannedConnector, type CannedFixture } from '../../src/connectors/canned/cannedConnector.js'
import { startAppAndOpenBrowser, type RunningApp } from '../../src/app/launch.js'
import { openWebApp } from '../../src/app/webApp.js'
import type { Connecting } from '../../src/forecast/connection.js'
import { openMemorySecrets } from '../../src/secrets/memorySecrets.js'
import { openSqliteStorage, type SqliteStorage } from '../../src/storage/sqliteStorage.js'
import { openWebStorage } from '../../src/storage/webStorage.js'

// The Connect step on the Inputs screen (#181), through the local server as the EM's browser sees it, on the canned
// connector and in-memory secrets.

const TOKEN = 'github_pat_11ABCDEFG0123456789_secret'

const CHOICES: CannedFixture['milestoneChoices'] = [{ kind: 'milestone', name: 'Checkout v2', query: 'milestone:"Checkout v2"' }]

let app: RunningApp | undefined
let storage: SqliteStorage | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
  storage?.close()
  storage = undefined
})

/** Starts the local build on empty storage, connecting through a canned connector answering its check with `answer`. */
async function startConnecting(answer: CannedFixture['milestoneChoices'] = CHOICES): Promise<{ app: RunningApp; connecting: Connecting }> {
  storage = openSqliteStorage(':memory:')
  const connecting: Connecting = {
    connections: storage,
    secrets: openMemorySecrets(),
    connector: () => cannedConnector({ milestoneChoices: answer, reads: {} }),
  }
  app = await startAppAndOpenBrowser({ port: 0, openBrowser: () => {}, storage, connecting, today: () => '2026-11-11' })
  return { app, connecting }
}

const inputsPage = async (running: RunningApp): Promise<string> => (await fetch(new URL('/inputs', running.url))).text()

describe('the Connect step', () => {
  test('in the local build, is the first section of the Inputs screen, with Skip beside it', async () => {
    const { app } = await startConnecting()

    const html = await inputsPage(app)

    const connect = html.indexOf('id="connect"')
    expect(connect).toBeGreaterThan(-1)
    expect(connect).toBeLessThan(html.indexOf('id="milestone"'))
    expect(html).toContain('Skip: type the inputs instead')
    expect(html).toContain('Issues: read')
    expect(html).toContain('read:jira-work')
  })

  test('the browser build has no Connect step', () => {
    const web = openWebApp({ storage: openWebStorage(undefined), today: () => '2026-11-11' })

    const page = web.show({ method: 'GET', path: '/inputs' })

    expect(page.html).not.toContain('id="connect"')
    expect(page.html).not.toContain('Skip: type the inputs instead')
    expect(web.show({ method: 'POST', path: '/inputs/connect', form: new URLSearchParams({ tracker: 'github', repo: 'a/b', token: TOKEN }) }).status).toBe(404)
  })
})
