import { readFileSync } from 'node:fs'
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
})
