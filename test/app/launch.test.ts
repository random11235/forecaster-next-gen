import { afterEach, describe, expect, test } from 'vitest'
import { networkInterfaces } from 'node:os'
import { startAppAndOpenBrowser, type RunningApp } from '../../src/app/launch.js'

let app: RunningApp | undefined

/** Starts the app on a free port without opening a browser. */
async function startOnFreePort(): Promise<RunningApp> {
  app = await startAppAndOpenBrowser({ port: 0, openBrowser: () => {} })
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
  test('serves the Milestone forecast screen in its empty state when no milestone is defined', async () => {
    app = await startOnFreePort()

    const response = await fetch(app.url)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toMatch(/^text\/html/)
    const html = await response.text()
    expect(html).toContain('Milestone forecast')
    expect(html).toContain('No milestone defined yet')
  })

  test('opens the browser on the Milestone forecast screen', async () => {
    const opened: string[] = []
    app = await startAppAndOpenBrowser({ port: 0, openBrowser: (url) => opened.push(url) })

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
