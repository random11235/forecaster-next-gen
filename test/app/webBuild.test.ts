import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, test } from 'vitest'

// Builds the web build the way `npm run build:web` does (#114) and reads the one file it writes.
const root = fileURLToPath(new URL('../..', import.meta.url))

let html: string

beforeAll(() => {
  execFileSync('npm', ['run', 'build:web'], { cwd: root, stdio: 'ignore' })
  html = readFileSync(new URL('../../dist/web/forecaster.html', import.meta.url), 'utf8')
}, 60_000)

describe('web build smoke test', () => {
  test('writes one page that opens on the Milestone forecast screen in its empty state, with no sample data', () => {
    expect(html).toMatch(/^<!doctype html>/)
    expect(html).toContain('<title>Milestone forecast · Forecaster</title>')
    expect(html).toContain('No milestone defined yet')
    expect(html).not.toContain('Checkout v2')
  })

  test('has its script inline, in one piece, and loads nothing from outside but its fonts', () => {
    expect(html).not.toMatch(/<script[^>]*\ssrc=/)
    // inside a script, only `</script` ends it: the screens' own `<script>` templates in the bundle are left alone
    expect(html.match(/<\/script/gi)).toHaveLength(1)
    expect(html.indexOf('<script>')).toBeLessThan(html.indexOf('</script>'))
    const outside = [...html.matchAll(/(?:href|src)="(https?:[^"]+)"/g)].map(([, url]) => new URL(url!).host)
    expect(new Set(outside)).toEqual(new Set(['fonts.googleapis.com', 'fonts.gstatic.com']))
  })
})
