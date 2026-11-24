import { afterEach, describe, expect, test, vi } from 'vitest'
import { cannedConnector, type CannedFixture } from '../../src/connectors/canned.js'
import { startAppAndOpenBrowser, type RunningApp } from '../../src/app/launch.js'
import { post, redirectedTo } from './forms.js'
import { openWebApp } from '../../src/app/webApp.js'
import type { Connecting } from '../../src/forecast/index.js'
import { openMemorySecrets } from '../../src/secrets/memorySecrets.js'
import { openSqliteStorage } from '../../src/storage/sqliteStorage.js'
import type { TeamStorage } from '../trackerScenario.js'
import { openWebStorage } from '../../src/storage/webStorage.js'

// The Connect step (#181) through the local server, on the canned connector and in-memory secrets: its form read as the
// browser posts it into what is stored, where the browser lands, and the token kept out of every page and log. What
// the step shows and refuses is test/forecast/connection*.test.ts's and test/app/components/connectSection.test.ts's.

const TOKEN = 'github_pat_11ABCDEFG0123456789_secret'

const CHOICES: CannedFixture['milestoneChoices'] = [
  { kind: 'milestone', choices: [{ kind: 'milestone', name: 'Checkout v2', query: 'milestone:"Checkout v2"' }], pastLimit: false },
]

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
async function startConnecting(
  answer: Answer = CHOICES,
): Promise<{ app: RunningApp; storage: TeamStorage; connecting: Connecting; answerWith: (next: Answer) => void }> {
  const opened = (storage = openSqliteStorage(':memory:'))
  const canned = { answer }
  const connecting: Connecting = {
    connections: opened,
    queries: opened,
    setup: opened,
    secrets: openMemorySecrets(),
    connector: () => cannedConnector({ milestoneChoices: canned.answer, reads: {} }),
  }
  app = await startAppAndOpenBrowser({
    port: 0,
    openBrowser: () => {},
    storage: opened,
    connecting,
    clock: { now: () => '2026-11-11T09:00:00Z', timeZone: 'UTC' },
  })
  return { app, storage: opened, connecting, answerWith: (next) => void (canned.answer = next) }
}

const inputsPage = async (running: RunningApp): Promise<string> => (await fetch(new URL('/inputs?step=connect', running.url))).text()

/** The Connect form for a GitHub repo, as the EM fills it in. */
const github = (repo: string, token = TOKEN): Record<string, string> => ({ tracker: 'github', repo, token })

describe('the Connect step', () => {
  test('a good connect is saved, the token in the secrets, and lands on the Milestone step', async () => {
    const { app, storage, connecting } = await startConnecting()

    const posted = await post(app, '/inputs/connect', github('shop-team/shop'))

    expect(redirectedTo(posted)).toBe('/inputs#milestone-tickets')
    expect(storage.connection('team')).toEqual({ tracker: 'github', owner: 'shop-team', repo: 'shop' })
    expect(await connecting.secrets.token('team')).toBe(TOKEN)
  })

  test('a Jira connect is saved from its site, project key and email', async () => {
    const { app, storage } = await startConnecting()

    await post(app, '/inputs/connect', { tracker: 'jira', site: 'https://shop.atlassian.net/', projectKey: 'shop', email: 'em@shop.example', token: TOKEN })

    expect(storage.connection('team')).toEqual({ tracker: 'jira', site: 'shop.atlassian.net', projectKey: 'SHOP', email: 'em@shop.example' })
  })

  test('disconnecting forgets the token and lands back on the Connect step', async () => {
    const { app, connecting } = await startConnecting()
    await post(app, '/inputs/connect', github('shop-team/shop'))

    const posted = await post(app, '/inputs/connect/disconnect', {})

    expect(redirectedTo(posted)).toBe('/inputs?step=connect#connect')
    expect(await connecting.secrets.token('team')).toBeUndefined()
  })

  test('no page and no log carries the token: refused, the keychain failing with it in its error, or connected', async () => {
    const logged: unknown[] = []
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logged.push(...args)),
    )
    try {
      const { app, connecting, answerWith } = await startConnecting({ failure: 'unauthorised' })
      const refused = await post(app, '/inputs/connect', github('shop-team/shop'))
      const pages = [await refused.text()]

      answerWith(CHOICES)
      const saveToken = connecting.secrets.saveToken
      connecting.secrets.saveToken = async () => {
        throw new Error(`keychain refused ${TOKEN}`)
      }
      const keychainFailed = await post(app, '/inputs/connect', github('shop-team/shop'))
      pages.push(await keychainFailed.text())

      connecting.secrets.saveToken = saveToken
      await post(app, '/inputs/connect', github('shop-team/shop'))
      pages.push(await inputsPage(app))

      expect([refused.status, keychainFailed.status]).toEqual([400, 400])
      for (const page of pages) expect(page).not.toContain(TOKEN)
      expect(JSON.stringify(logged)).not.toContain(TOKEN)
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })

  test('the browser build has no Connect step to post to', async () => {
    const web = openWebApp({ storage: openWebStorage(undefined), clock: { now: () => '2026-11-11T09:00:00Z', timeZone: 'UTC' } })

    expect(
      (await web.show({ method: 'POST', path: '/inputs/connect', form: new URLSearchParams({ tracker: 'github', repo: 'a/b', token: TOKEN }) })).status,
    ).toBe(404)
  })
})
