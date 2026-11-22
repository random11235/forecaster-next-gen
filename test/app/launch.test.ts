import { afterEach, describe, expect, test } from 'vitest'
import { APP_VERSION } from '../../src/forecast/index.js'
import { request as httpRequest } from 'node:http'
import { networkInterfaces } from 'node:os'
import { portFromEnv, startAppAndOpenBrowser, type RunningApp } from '../../src/app/launch.js'
import { openSqliteStorage } from '../../src/storage/sqliteStorage.js'
import type { QueryTarget, Storage } from '../../src/storage/storage.js'
import { CHECKOUT, TEAM } from '../trackerScenario.js'
import { appOnTracker, defaultTeam, page, type AppOnTracker } from './appOnTracker.js'
import { post, SAVE_IN_PLACE } from './forms.js'

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
    await post(app, '/inputs/milestone', { name: 'Launch', startDate: '2026-11-02', ticketsRemaining: '30' })
    await post(app, '/inputs/pace', { low: '5', high: '10' })
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

    const teams = storage.teams()
    expect(teams).toEqual([{ ...defaultTeam(''), installedAt: expect.any(String) }])
    const [installed] = teams.map(({ installedAt }) => Date.parse(installedAt))
    expect(installed).toBeGreaterThanOrEqual(before)
    expect(installed).toBeLessThanOrEqual(Date.now())
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

  test('a request it fails on is answered 500, saying why', async () => {
    const storage = openSqliteStorage(':memory:')
    app = await startOnFreePort(storage)
    storage.close()

    const response = await fetch(app.url)

    expect(response.status).toBe(500)
    expect(await response.text()).toMatch(/^Forecaster error: /)
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

    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
    expect(html).toMatch(new RegExp(`<footer[^>]*>Forecaster ${APP_VERSION.replaceAll('.', '\\.')}</footer>`))
  })

  test('/live streams the version and keeps the stream open, and stopping the app is not held up by it', async () => {
    app = await startOnFreePort()

    const response = await fetch(new URL('/live', app.url))
    const first = await response.body?.getReader().read()
    const closing = app.close()
    app = undefined

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    expect(new TextDecoder().decode(first?.value)).toBe(`retry: 500\ndata: ${APP_VERSION}\n\n`)
    await expect(closing).resolves.toBeUndefined()
  })

  test('every page it serves carries a script that listens on /live and reloads on a version other than its own', async () => {
    app = await startOnFreePort()

    const html = await (await fetch(app.url)).text()
    const script = html.match(/<script>([^]*?EventSource[^]*?)<\/script>/)?.[1]

    expect(script).toContain(`new EventSource('/live')`)
    expect(script).toContain(`!== ${JSON.stringify(APP_VERSION)}`)
    expect(script).toContain('location.reload()')
  })
})

// Any page the EM's browser opens can reach localhost: a cross-site form can POST to it, and a rebound domain can read it.
describe('refuses requests from other sites', () => {
  /** A milestone typed on the Inputs screen, as its form posts it. */
  const MILESTONE = { name: 'Launch', startDate: '2026-11-02', ticketsRemaining: '30' }

  /** What the app answered a request sent with `send`: a stream's status and headers, with no body read. */
  interface Answer {
    status: number
    contentType: string | undefined
    body: string
  }

  /**
   * Sends a request to the running app with exactly the headers given, `Host` among them: `fetch` sets its own `Host`,
   * as a browser does, so a rebound domain's can only be sent this way. A stream (`/live`) never ends, so it answers
   * once its headers arrive.
   */
  const send = (running: RunningApp, method: string, path: string, headers: Record<string, string>, body = ''): Promise<Answer> =>
    new Promise((resolve, reject) => {
      const request = httpRequest(new URL(path, running.url), { method, headers }, (response) => {
        const answer = { status: response.statusCode ?? 0, contentType: response.headers['content-type'], body: '' }
        if (answer.contentType === 'text/event-stream') {
          response.destroy()
          return resolve(answer)
        }
        response.setEncoding('utf8')
        response.on('data', (chunk: string) => (answer.body += chunk))
        response.on('end', () => resolve(answer))
      })
      request.on('error', reject)
      request.end(body)
    })

  /** What the app answered a `fetch`, as `send` gives it. */
  const answerOf = async (response: Response): Promise<Answer> => ({
    status: response.status,
    contentType: response.headers.get('content-type') ?? undefined,
    body: await response.text(),
  })

  /** Posts the milestone form with the given headers. */
  const postMilestone = (running: RunningApp, headers: Record<string, string>): Promise<Answer> =>
    send(running, 'POST', '/inputs/milestone', { 'content-type': 'application/x-www-form-urlencoded', ...headers }, new URLSearchParams(MILESTONE).toString())

  /** Whether the posted milestone was saved, as the Inputs screen shows its name. */
  const milestoneSaved = async (running: RunningApp): Promise<boolean> => (await page(running, '/inputs')).includes('name="name" value="Launch"')

  /** A refusal: 403 with a short plain-text body, not a page. */
  const expectRefused = (answer: Answer): void => {
    expect(answer.status).toBe(403)
    expect(answer.contentType).toMatch(/^text\/plain/)
    expect(answer.body).not.toContain('<html')
  }

  test('a GET whose Host is another site is refused with 403', async () => {
    app = await startOnFreePort()
    const { port } = new URL(app.url)

    expectRefused(await send(app, 'GET', '/', { host: `attacker.example:${port}` }))
  })

  test('a POST whose Host is another site is refused with 403, and saves nothing', async () => {
    app = await startOnFreePort()
    const { port } = new URL(app.url)

    const answer = await postMilestone(app, { host: `attacker.example:${port}`, origin: `http://attacker.example:${port}` })

    expectRefused(answer)
    expect(await milestoneSaved(app)).toBe(false)
  })

  test.each([
    ['another site', { origin: 'https://attacker.example' }],
    ['another port on this machine', { origin: 'http://127.0.0.1:1' }],
    ['no Origin at all', {}],
  ])('a POST from %s is refused with 403, and saves nothing', async (_, origin) => {
    app = await startOnFreePort()
    const { host } = new URL(app.url)

    expectRefused(await postMilestone(app, { host, ...origin }))
    expect(await milestoneSaved(app)).toBe(false)
  })

  describe('on a connected app', () => {
    let tracker: AppOnTracker | undefined

    afterEach(async () => {
      await tracker?.close()
      tracker = undefined
    })

    /** The team's queries in `target`. */
    const queriesIn = ({ storage }: AppOnTracker, target: QueryTarget) => {
      const { milestoneQueries } = storage.teamQueries(target)
      return { milestone: milestoneQueries.milestoneQuery(TEAM), comparableWork: milestoneQueries.comparableWorkQuery(TEAM) }
    }

    /** The team's connection, its saved token, and its queries, saved and as setup's steps see them. */
    const connectionAndQueries = async (tracker: AppOnTracker) => ({
      connection: tracker.storage.connection(TEAM),
      token: await tracker.secrets.token(TEAM),
      saved: queriesIn(tracker, 'saved'),
      current: queriesIn(tracker, 'current'),
    })

    test.each([
      ['connecting another repo', '/inputs/connect', { tracker: 'github', repo: 'attacker/repo', token: 'theirs' }],
      ['disconnecting', '/inputs/connect/disconnect', {}],
      ['adding to the milestone query', '/inputs/milestone-query/add', { kind: 'milestone', name: 'Other', query: 'milestone:"Other"' }],
    ])('a cross-site POST %s is refused with 403, leaving the connection, its saved token and the queries as they were', async (_, path, fields) => {
      tracker = await appOnTracker({ milestoneChoices: [{ kind: 'milestone', choices: [CHECKOUT], pastLimit: false }], reads: {} })
      await post(tracker.running, '/inputs/connect', { tracker: 'github', repo: 'shop-team/shop', token: 'token' })
      await post(tracker.running, '/inputs/milestone-query/add', { ...CHECKOUT })
      const before = await connectionAndQueries(tracker)
      expect(before.connection).toEqual({ tracker: 'github', owner: 'shop-team', repo: 'shop' })
      expect(before.token).toBe('token')

      const refused = await post(tracker.running, path, fields, { origin: 'https://attacker.example' })

      expectRefused(await answerOf(refused))
      expect(await connectionAndQueries(tracker)).toEqual(before)
    })
  })

  // Started on port 0, so these also show the checks use the port the server bound.
  test.each(['127.0.0.1', 'localhost'])('a POST from the app on %s is saved as today', async (name) => {
    app = await startOnFreePort()
    const { port } = new URL(app.url)

    const answer = await postMilestone(app, { host: `${name}:${port}`, origin: `http://${name}:${port}` })

    expect(answer.status).toBe(303)
    expect(await milestoneSaved(app)).toBe(true)
  })

  test("the Inputs screen's save in place, from the app, is saved as today", async () => {
    app = await startOnFreePort()
    const { host, origin } = new URL(app.url)

    const answer = await postMilestone(app, { host, origin, [SAVE_IN_PLACE.header]: SAVE_IN_PLACE.value })

    expect(answer.status).toBeLessThan(400)
    expect(await milestoneSaved(app)).toBe(true)
  })

  test('a POST from the app with a body over 10,000 bytes is answered 500, saying why, and saves nothing', async () => {
    app = await startOnFreePort()
    const { host, origin } = new URL(app.url)
    const body = new URLSearchParams({ ...MILESTONE, padding: 'x'.repeat(10_000) }).toString()

    const answer = await send(app, 'POST', '/inputs/milestone', { host, origin, 'content-type': 'application/x-www-form-urlencoded' }, body)

    expect(answer.status).toBe(500)
    expect(answer.body).toBe('Forecaster error: Error: Request body too large.')
    expect(await milestoneSaved(app)).toBe(false)
  })

  test.each(['127.0.0.1', 'localhost'])('GET pages and /live on %s are served as today, with no Origin', async (name) => {
    app = await startOnFreePort()
    const host = `${name}:${new URL(app.url).port}`

    const inputs = await send(app, 'GET', '/inputs', { host })
    const live = await send(app, 'GET', '/live', { host })

    expect(inputs.status).toBe(200)
    expect(inputs.body).toContain('<html')
    expect(live.status).toBe(200)
    expect(live.contentType).toBe('text/event-stream')
  })
})

// The port PORT names. Run as the built entry point, a refused value stops it with exit code 1 (smoke.test.ts).
describe('PORT', () => {
  test.each([
    [undefined, 5180],
    ['', 5180],
    ['0', 0],
    ['8080', 8080],
    ['65535', 65535],
  ])('PORT=%j starts on port %i', (value, port) => {
    expect(portFromEnv(value)).toBe(port)
  })

  test.each(['abc', '5180.5', '-1', '65536', ' 80'])('refuses PORT=%j, naming the bad value', (value) => {
    expect(() => portFromEnv(value)).toThrow(`PORT must be a whole number from 0 to 65535, not "${value}".`)
  })
})
