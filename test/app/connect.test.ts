import { afterEach, describe, expect, test, vi } from 'vitest'
import { cannedConnector, type CannedFixture } from '../../src/connectors/canned/cannedConnector.js'
import { startAppAndOpenBrowser, type RunningApp } from '../../src/app/launch.js'
import { openWebApp } from '../../src/app/webApp.js'
import type { Connecting } from '../../src/forecast/connection.js'
import { openMemorySecrets } from '../../src/secrets/memorySecrets.js'
import { openSqliteStorage } from '../../src/storage/sqliteStorage.js'
import type { TeamStorage } from '../trackerScenario.js'
import { openWebStorage } from '../../src/storage/webStorage.js'

// The Connect step on the Inputs screen (#181), through the local server as the EM's browser sees it, on the canned
// connector and in-memory secrets.

const TOKEN = 'github_pat_11ABCDEFG0123456789_secret'

const CHOICES: CannedFixture['milestoneChoices'] = [{ kind: 'milestone', choices: [{ kind: 'milestone', name: 'Checkout v2', query: 'milestone:"Checkout v2"' }], pastLimit: false }]

let app: RunningApp | undefined
let storage: TeamStorage | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
  storage?.close()
  storage = undefined
})

type Answer = CannedFixture['milestoneChoices']

/**
 * Starts the local build on empty storage, connecting through a canned connector that answers its check with
 * `answer`, until `answerWith` changes it.
 */
async function startConnecting(answer: Answer = CHOICES): Promise<{ app: RunningApp; connecting: Connecting; answerWith: (next: Answer) => void }> {
  storage = openSqliteStorage(':memory:')
  const canned = { answer }
  const connecting: Connecting = {
    connections: storage,
    queries: storage,
    setup: storage,
    secrets: openMemorySecrets(),
    connector: () => cannedConnector({ milestoneChoices: canned.answer, reads: {} }),
  }
  app = await startAppAndOpenBrowser({ port: 0, openBrowser: () => {}, storage, connecting, today: () => '2026-11-11' })
  return { app, connecting, answerWith: (next) => void (canned.answer = next) }
}

const inputsPage = async (running: RunningApp): Promise<string> => (await fetch(new URL('/inputs?step=connect', running.url))).text()

const post = (running: RunningApp, path: string, fields: Record<string, string>): Promise<Response> =>
  fetch(new URL(path, running.url), { method: 'POST', body: new URLSearchParams(fields), redirect: 'manual' })

/** The Connect form for a GitHub repo, as the EM fills it in. */
const github = (repo: string, token = TOKEN): Record<string, string> => ({ tracker: 'github', repo, token })

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

  test('a good connect goes on to the Milestone step, connected, with the token kept in the secrets', async () => {
    const { app, connecting } = await startConnecting()

    const posted = await post(app, '/inputs/connect', github('shop-team/shop'))
    const html = await inputsPage(app)

    expect(posted.status).toBe(303)
    expect(posted.headers.get('location')).toBe('/inputs#milestone-tickets')
    expect(html).toContain('Connected to GitHub · <b>shop-team/shop</b>')
    expect(html).toContain('Disconnect')
    expect(html).not.toContain('Skip: type the inputs instead')
    expect(await connecting.secrets.token('team')).toBe(TOKEN)
  })

  test('a Jira connect shows its site and project', async () => {
    const { app } = await startConnecting()

    await post(app, '/inputs/connect', { tracker: 'jira', site: 'https://shop.atlassian.net/', projectKey: 'shop', email: 'em@shop.example', token: TOKEN })

    expect(await inputsPage(app)).toContain('Connected to Jira · <b>shop.atlassian.net · SHOP</b>')
  })

  test('a refused token shows the Inputs screen again, saying why, with the repo as typed and no token', async () => {
    const { app } = await startConnecting({ failure: 'unauthorised' })

    const posted = await post(app, '/inputs/connect', github('shop-team/shop'))
    const html = await posted.text()

    expect(posted.status).toBe(400)
    expect(html).toContain('GitHub refused the token.')
    expect(html).toContain('value="shop-team/shop"')
    expect(html).not.toContain(TOKEN)
    expect(await inputsPage(app)).not.toContain('Connected to')
  })

  test('a missing token is refused before the tracker is asked', async () => {
    const { app } = await startConnecting()

    const html = await (await post(app, '/inputs/connect', github('shop-team/shop', ''))).text()

    expect(html).toContain('Paste a token to connect.')
  })

  test('once connected, the connection can be changed, and a refused change keeps the connection', async () => {
    const { app, connecting, answerWith } = await startConnecting()
    await post(app, '/inputs/connect', github('shop-team/shop'))

    answerWith({ failure: 'notFound' })
    const refused = await (await post(app, '/inputs/connect', github('shop-team/shopp', 'new-token'))).text()
    answerWith(CHOICES)
    await post(app, '/inputs/connect', github('shop-team/checkout', 'new-token'))
    const html = await inputsPage(app)

    expect(refused).toContain('GitHub can’t see shop-team/shopp with this token.')
    expect(refused).toContain('Connected to GitHub · <b>shop-team/shop</b>')
    expect(html).toContain('Connected to GitHub · <b>shop-team/checkout</b>')
    expect(await connecting.secrets.token('team')).toBe('new-token')
  })

  test('once connected, a change can leave the token blank to keep the saved one', async () => {
    const { app, connecting } = await startConnecting()
    await post(app, '/inputs/connect', github('shop-team/shop'))

    const page = await inputsPage(app)
    const posted = await post(app, '/inputs/connect', github('shop-team/checkout', ''))

    expect(page).toContain('placeholder="blank keeps the saved token"')
    expect(posted.status).toBe(303)
    expect(await inputsPage(app)).toContain('Connected to GitHub · <b>shop-team/checkout</b>')
    expect(await connecting.secrets.token('team')).toBe(TOKEN)
  })

  test('a keychain failing as the token is saved shows the Inputs screen again, saying so, and never the token', async () => {
    const { app, connecting } = await startConnecting()
    connecting.secrets.saveToken = async () => {
      throw new Error(`keychain refused ${TOKEN}`)
    }

    const posted = await post(app, '/inputs/connect', github('shop-team/shop'))
    const html = await posted.text()

    expect(posted.status).toBe(400)
    expect(html).toContain('This computer’s keychain couldn’t be used, so nothing changed.')
    expect(html).not.toContain(TOKEN)
    expect(await inputsPage(app)).not.toContain('Connected to')
  })

  test('disconnecting forgets the token and goes back to the Connect step', async () => {
    const { app, connecting } = await startConnecting()
    await post(app, '/inputs/connect', github('shop-team/shop'))

    const posted = await post(app, '/inputs/connect/disconnect', {})
    const html = await inputsPage(app)

    expect(posted.headers.get('location')).toBe('/inputs?step=connect#connect')
    expect(html).not.toContain('Connected to')
    expect(html).toContain('Skip: type the inputs instead')
    expect(await connecting.secrets.token('team')).toBeUndefined()
  })

  test('no page and no log carries the token', async () => {
    const logged: unknown[] = []
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logged.push(...args)),
    )
    try {
      const { app, answerWith } = await startConnecting({ failure: 'unauthorised' })
      const pages = [await (await post(app, '/inputs/connect', github('shop-team/shop'))).text()]
      answerWith(CHOICES)
      await post(app, '/inputs/connect', github('shop-team/shop'))
      pages.push(await inputsPage(app))

      for (const page of pages) expect(page).not.toContain(TOKEN)
      expect(JSON.stringify(logged)).not.toContain(TOKEN)
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })

  test('the browser build has no Connect step', () => {
    const web = openWebApp({ storage: openWebStorage(undefined), today: () => '2026-11-11' })

    const page = web.show({ method: 'GET', path: '/inputs' })

    expect(page.html).not.toContain('id="connect"')
    expect(page.html).not.toContain('Skip: type the inputs instead')
    expect(web.show({ method: 'POST', path: '/inputs/connect', form: new URLSearchParams({ tracker: 'github', repo: 'a/b', token: TOKEN }) }).status).toBe(404)
  })
})
