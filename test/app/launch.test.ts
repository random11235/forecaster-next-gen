import { afterEach, describe, expect, test } from 'vitest'
import { networkInterfaces } from 'node:os'
import { startAppAndOpenBrowser, type RunningApp } from '../../src/app/launch.js'
import { openSqliteStorage } from '../../src/storage/sqliteStorage.js'
import type { Storage } from '../../src/storage/storage.js'

/** Before any ticket the tests finish, so installation leaves out none of them. */
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
  test('on first launch, serves the Milestone forecast screen on the sample data', async () => {
    app = await startOnFreePort()

    const html = await (await fetch(app.url)).text()

    expect(html).toContain('Checkout v2')
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
