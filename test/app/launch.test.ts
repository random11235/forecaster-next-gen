import { afterEach, describe, expect, test } from 'vitest'
import { networkInterfaces } from 'node:os'
import { startApp, type RunningApp } from '../../src/app/launch.js'

let app: RunningApp | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
})

describe('one-command launch', () => {
  test('serves the Milestone forecast screen in its empty state when no milestone is defined', async () => {
    app = await startApp({ port: 0, openBrowser: () => {} })

    const response = await fetch(app.url)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toMatch(/^text\/html/)
    const html = await response.text()
    expect(html).toContain('Milestone forecast')
    expect(html).toContain('No milestone defined yet')
  })

  test('opens the browser on the Milestone forecast screen', async () => {
    const opened: string[] = []
    app = await startApp({ port: 0, openBrowser: (url) => opened.push(url) })

    expect(opened).toEqual([app.url])
  })

  test('listens on localhost only', async () => {
    app = await startApp({ port: 0, openBrowser: () => {} })
    const { hostname, port } = new URL(app.url)
    expect(hostname).toBe('127.0.0.1')

    const networkAddress = Object.values(networkInterfaces())
      .flat()
      .find((address) => address && address.family === 'IPv4' && !address.internal)
    if (!networkAddress) return // no network interface to try from

    await expect(fetch(`http://${networkAddress.address}:${port}/`)).rejects.toThrow()
  })

  test('answers 404 for anything but the screen', async () => {
    app = await startApp({ port: 0, openBrowser: () => {} })

    const response = await fetch(new URL('/nope', app.url))

    expect(response.status).toBe(404)
  })
})
