import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { beforeAll, describe, expect, test } from 'vitest'

// Reads the one file the web build writes (#114); test/buildOnce.ts runs `npm run build:web` before any test file.

/** The app's one version, as `package.json` sets it. */
const VERSION: unknown = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version

let html: string

beforeAll(() => {
  html = readFileSync(new URL('../../dist/web/forecaster.html', import.meta.url), 'utf8')
})

describe('web build smoke test', () => {
  test('writes one page that opens on the Milestone forecast screen in its empty state, with no sample data', () => {
    expect(html).toMatch(/^<!doctype html>/)
    expect(html).toContain('<title>Milestone forecast · Forecaster</title>')
    expect(html).toContain('No milestone defined yet')
    expect(html).not.toContain('Checkout v2')
  })

  test('has its script and fonts inline, the script in one piece, and loads nothing from outside', () => {
    expect(html).not.toMatch(/<script[^>]*\ssrc=/)
    // inside a script, only `</script` ends it: the screens' own `<script>` templates in the bundle are left alone
    expect(html.match(/<\/script/gi)).toHaveLength(1)
    expect(html.indexOf('<script>')).toBeLessThan(html.indexOf('</script>'))
    expect(html).toContain("@font-face { font-family: 'Geist'; src: url(data:font/woff2;base64,")
    expect(html).toContain("@font-face { font-family: 'Geist Mono'; src: url(data:font/woff2;base64,")
    // the script names the SVG namespace, `http://www.w3.org/2000/svg`, which loads nothing
    expect(html).not.toMatch(/(?:href=|src=|url\()["']?(?:https?:)?\/\//)
    expect(html).not.toMatch(/@import/)
  })

  test('shows the version in its footer, and its script carries it for the screens it shows, with no live reload', () => {
    expect(html).toContain(`<footer class="version">Forecaster ${String(VERSION)}</footer>`)
    expect(html.match(/<script>([^]*)<\/script>/)?.[1]).toContain(JSON.stringify(VERSION))
    expect(html).not.toContain('EventSource')
    expect(html).not.toContain('/live')
  })

  test('its script, as bundled, forecasts the milestone and pace the EM enters (#280)', async () => {
    const page = openBuiltScript()

    await page.post('/inputs/milestone', 'name=Launch&startDate=2026-11-02&ticketsRemaining=30')
    const forecast = await page.post('/inputs/pace', 'low=5&high=10')

    expect(forecast).toContain('Launch · 30 tickets remaining')
    expect(forecast).toMatch(/Starting 2 Nov 2026: 85% confident of finishing by/)
  })
})

/**
 * Runs the built page's script in Node, on a stub of the few browser parts it reaches for as it opens, and posts to
 * it as the Inputs screen's saves do: through the `fetch` it answers itself. What the bundling breaks in the app
 * shows here; the page's links and forms in a real browser are still the demo's to check.
 */
function openBuiltScript(): { post: (path: string, body: string) => Promise<string> } {
  const script = html.match(/<script>([^]*)<\/script>/)?.[1]
  if (script === undefined) throw new Error('The built page has no script.')
  const kept = new Map<string, string>()
  const element = { replaceWith: () => {}, querySelectorAll: () => [] }
  const window: Record<string, unknown> = {
    localStorage: { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => kept.set(key, value) },
    location: { hash: '#/inputs' },
    history: { pushState: () => {} },
    document: { head: element, body: element, importNode: () => element, getElementById: () => null, addEventListener: () => {} },
    DOMParser: class {
      parseFromString = (): object => ({ head: element, body: element })
    },
    addEventListener: () => {},
    scrollTo: () => {},
    fetch: () => Promise.reject(new Error('The page fetched from outside itself.')),
    // the web platform's own globals, which Node shares with the browser but a vm context doesn't have
    ...{ Headers, Response, URL, URLSearchParams, structuredClone, TextEncoder, TextDecoder, crypto, atob, btoa },
    ...{ console, setTimeout, clearTimeout, queueMicrotask },
  }
  window.window = window
  runInNewContext(script, window)
  const pageFetch = window.fetch as typeof fetch
  return { post: async (path, body) => (await pageFetch(path, { method: 'POST', body })).text() }
}
