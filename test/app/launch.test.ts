import { afterEach, describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { networkInterfaces } from 'node:os'
import { startAppAndOpenBrowser, type RunningApp } from '../../src/app/launch.js'
import { defaultTeam } from '../../src/app/routes.js'
import { openSqliteStorage } from '../../src/storage/sqliteStorage.js'
import type { Storage } from '../../src/storage/storage.js'

/** The app's one version, as `package.json` sets it. */
const VERSION: unknown = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version

/** When the Forecaster was installed for the team the tests store. */
const INSTALLED = '2026-01-01T00:00:00Z'

let app: RunningApp | undefined

/** Starts the app on a free port without opening a browser, on empty storage unless given some. */
async function startOnFreePort(storage: Storage = openSqliteStorage(':memory:')): Promise<RunningApp> {
  app = await startAppAndOpenBrowser({ port: 0, openBrowser: () => {}, storage })
  return app
}

/** An address on this machine that other machines could reach, if it has one. */
const networkAddress = Object.values(networkInterfaces())
  .flat()
  .find((address) => address && address.family === 'IPv4' && !address.internal)

afterEach(async () => {
  await app?.close()
  app = undefined
})

describe('one-command launch', () => {
  test('on first launch, opens on the empty state with no sample data, and the Inputs screen is there to enter the milestone', async () => {
    app = await startOnFreePort()

    const home = await (await fetch(app.url)).text()
    const inputs = await fetch(new URL('/inputs', app.url))

    expect(home).toContain('No milestone defined yet')
    expect(home).not.toContain('Checkout v2')
    expect(inputs.status).toBe(200)
  })

  test('on first launch, the EM can enter a milestone and its pace on the Inputs screen and see it forecast', async () => {
    app = await startOnFreePort()
    const post = (path: string, fields: Record<string, string>): Promise<Response> =>
      fetch(new URL(path, app!.url), { method: 'POST', body: new URLSearchParams(fields), redirect: 'manual' })

    await post('/inputs/milestone', { name: 'Launch', startDate: '2026-11-02', ticketsRemaining: '30' })
    await post('/inputs/pace', { low: '5', high: '10' })
    const home = await (await fetch(app.url)).text()

    expect(home).toContain('Launch · 30 tickets remaining')
    expect(home).toMatch(/Starting 2 Nov 2026: 85% confident of finishing by/)
  })

  test('first launch creates the default team, installed at launch, and launching again adds no other', async () => {
    const storage = openSqliteStorage(':memory:')
    const before = Date.now()
    app = await startOnFreePort(storage)
    await app.close()

    app = await startOnFreePort(storage)

    const [team] = storage.teams()
    expect(storage.teams()).toEqual([defaultTeam(team!.installedAt)])
    expect(Date.parse(team!.installedAt)).toBeGreaterThanOrEqual(before)
    expect(Date.parse(team!.installedAt)).toBeLessThanOrEqual(Date.now())
  })

  test('serves the Milestone forecast screen in its empty state when no milestone is defined', async () => {
    const storage = openSqliteStorage(':memory:')
    storage.saveTeam({ id: 'ACME', name: 'ACME', source: 'jira', sourceRef: 'ACME', installedAt: INSTALLED })
    app = await startOnFreePort(storage)

    const response = await fetch(app.url)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toMatch(/^text\/html/)
    const html = await response.text()
    expect(html).toContain('Milestone forecast')
    expect(html).toContain('No milestone defined yet')
  })

  // 14 hours ahead of UTC, its date is a day after UTC's from 10:00 UTC; 11 hours behind, a day before until 11:00 UTC.
  // Between them, one of the two dates differs from UTC's whenever the test runs.
  test.each(['Pacific/Kiritimati', 'Pacific/Pago_Pago'])("pre-fills the start date with today's local calendar date in %s, not UTC's", async (zone) => {
    const before = process.env.TZ
    process.env.TZ = zone
    try {
      const storage = openSqliteStorage(':memory:')
      storage.saveTeam({ id: 'ACME', name: 'ACME', source: 'jira', sourceRef: 'ACME', installedAt: INSTALLED })
      app = await startAppAndOpenBrowser({ port: 0, openBrowser: () => {}, storage })

      const html = await (await fetch(new URL('/inputs', app.url))).text()

      const today = new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date())
      expect(html).toMatch(new RegExp(`name="startDate"[^>]*value="${today}"`))
    } finally {
      if (before === undefined) delete process.env.TZ
      else process.env.TZ = before
    }
  })

  test('opens the browser on the Milestone forecast screen', async () => {
    const opened: string[] = []
    app = await startAppAndOpenBrowser({
      port: 0,
      openBrowser: (url) => opened.push(url),
      storage: openSqliteStorage(':memory:'),
    })

    expect(opened).toEqual([app.url])
  })

  test('listens on localhost only', async () => {
    app = await startOnFreePort()

    expect(new URL(app.url).hostname).toBe('127.0.0.1')
  })

  test.skipIf(!networkAddress)('is not reachable from the network address', async () => {
    app = await startOnFreePort()
    const { port } = new URL(app.url)

    await expect(fetch(`http://${networkAddress?.address}:${port}/`)).rejects.toThrow()
  })

  test('answers 404 for anything but the screen', async () => {
    app = await startOnFreePort()

    const response = await fetch(new URL('/nope', app.url))

    expect(response.status).toBe(404)
  })
})

describe('version and live reload', () => {
  test.each(['/', '/inputs', '/how-it-works'])('%s shows the version in its footer', async (path) => {
    app = await startOnFreePort()

    const html = await (await fetch(new URL(path, app.url))).text()

    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/)
    expect(html).toMatch(new RegExp(`<footer[^>]*>Forecaster ${String(VERSION).replaceAll('.', '\\.')}</footer>`))
  })

  test('/live streams the version and keeps the stream open, and stopping the app is not held up by it', async () => {
    app = await startOnFreePort()

    const response = await fetch(new URL('/live', app.url))
    const first = await response.body?.getReader().read()
    const closing = app.close()
    app = undefined

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    expect(new TextDecoder().decode(first?.value)).toBe(`retry: 500\ndata: ${String(VERSION)}\n\n`)
    await expect(closing).resolves.toBeUndefined()
  })

  test('every page it serves carries a script that listens on /live and reloads on a version other than its own', async () => {
    app = await startOnFreePort()

    const html = await (await fetch(app.url)).text()
    const script = html.match(/<script>([^]*?EventSource[^]*?)<\/script>/)?.[1]

    expect(script).toContain(`new EventSource('/live')`)
    expect(script).toContain(`!== ${JSON.stringify(VERSION)}`)
    expect(script).toContain('location.reload()')
  })
})

// Any page the EM's browser opens can reach localhost: a cross-site form can POST to it, and a rebound domain can read it.
describe('refuses requests from other sites', () => {
  /** A milestone typed on the Inputs screen, as its form posts it. */
  const MILESTONE = { name: 'Launch', startDate: '2026-11-02', ticketsRemaining: '30' }

  /** What the app answered a request sent with `send`. */
  interface Answer {
    status: number
    contentType: string | undefined
    body: string
  }

  /**
   * Sends a request to the running app with exactly the headers given, `Host` among them: `fetch` sets its own `Host`,
   * as a browser does, so a rebound domain's can only be sent this way.
   */
  const send = (method: string, path: string, headers: Record<string, string>, body = ''): Promise<Answer> =>
    new Promise((resolve, reject) => {
      const request = httpRequest(new URL(path, app!.url), { method, headers }, (response) => {
        let text = ''
        response.setEncoding('utf8')
        response.on('data', (chunk: string) => (text += chunk))
        response.on('end', () => resolve({ status: response.statusCode ?? 0, contentType: response.headers['content-type'], body: text }))
      })
      request.on('error', reject)
      request.end(body)
    })

  /** Posts the milestone form with the given headers. */
  const postMilestone = (headers: Record<string, string>): Promise<Answer> =>
    send('POST', '/inputs/milestone', { 'content-type': 'application/x-www-form-urlencoded', ...headers }, new URLSearchParams(MILESTONE).toString())

  /** Whether the posted milestone was saved, as the Milestone forecast screen shows it. */
  const milestoneSaved = async (): Promise<boolean> => (await (await fetch(app!.url)).text()).includes('Launch · 30 tickets remaining')

  /** A refusal: 403 with a short plain-text body, not a page. */
  const expectRefused = (answer: Answer): void => {
    expect(answer.status).toBe(403)
    expect(answer.contentType).toMatch(/^text\/plain/)
    expect(answer.body).not.toContain('<html')
  }

  test('a GET whose Host is another site is refused with 403', async () => {
    app = await startOnFreePort()
    const { port } = new URL(app.url)

    expectRefused(await send('GET', '/', { host: `attacker.example:${port}` }))
  })

  test('a POST whose Host is another site is refused with 403, and saves nothing', async () => {
    app = await startOnFreePort()
    const { port } = new URL(app.url)

    const answer = await postMilestone({ host: `attacker.example:${port}`, origin: `http://attacker.example:${port}` })

    expectRefused(answer)
    expect(await milestoneSaved()).toBe(false)
  })
})
