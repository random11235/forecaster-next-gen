import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { beforeAll, describe, expect, test, vi } from 'vitest'
import { webPage } from '../../scripts/buildWeb.ts'

// Reads the one file the web build writes (#114); test/buildOnce.ts runs `npm run build:web` before any test file.

/** `package.json`, read here rather than through the app, so the version the page shows is checked against it. */
const PACKAGE: { version: string; scripts: Record<string, string> } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))

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
    // the script names the SVG namespace, `http://www.w3.org/2000/svg`, which loads nothing; Send feedback's link loads
    // nothing until it's followed
    expect(html.replace(/<a href="https:\/\/github\.com\/[^"]*" target="_blank" rel="noopener">Send feedback<\/a>/, '')).not.toMatch(
      /(?:href=|src=|url\()["']?(?:https?:)?\/\//,
    )
    expect(html).not.toMatch(/@import/)
  })

  test('shows the version in its footer, then Send feedback for the repo the build recorded, and its script carries both for the screens it shows, with no live reload', async () => {
    // a clone records its origin's repo (scripts/feedbackRepo.ts, whose tests say how), a build with none records none
    const { FEEDBACK_REPO }: { FEEDBACK_REPO: string | undefined } = await import(new URL('../../dist/app/feedbackRepo.js', import.meta.url).href)
    const script = html.match(/<script>([^]*)<\/script>/)?.[1]
    if (FEEDBACK_REPO) {
      expect(footerText(html)).toBe(`Forecaster ${PACKAGE.version} · Send feedback`)
      expect(sendFeedback(html)).toEqual(feedbackTo(FEEDBACK_REPO, 'Milestone forecast'))
      expect(script).toContain(JSON.stringify(FEEDBACK_REPO))
    } else expect(footerText(html)).toBe(`Forecaster ${PACKAGE.version}`)
    expect(script).toContain(JSON.stringify(PACKAGE.version))
    expect(html).not.toContain('EventSource')
    expect(html).not.toContain('/live')
  })

  test("carries package.json's version alone, none of its scripts or dependencies: the page is shared", () => {
    expect(html).not.toContain('devDependencies')
    // a script's name can be an everyday word (`check`); its command is package.json's alone
    for (const command of Object.values(PACKAGE.scripts)) expect(html).not.toContain(command)
  })

  test('its script, as bundled, forecasts the milestone and pace the EM enters (#280)', async () => {
    const page = openBuiltScript()

    await page.post('/inputs/milestone', 'name=Launch&startDate=2026-11-02&ticketsRemaining=30')
    const forecast = await page.post('/inputs/pace', 'low=5&high=10')

    expect(forecast).toContain('Launch · 30 tickets remaining')
    expect(forecast).toMatch(/Starting 2 Nov 2026: 85% confident of finishing by/)
  })
})

describe('the web build’s Send feedback (#371)', () => {
  test('a page built for a repo links its footer to that repo’s new-issue form, in a new tab, naming the version and the screen', async () => {
    const built = await webPage('a-fork/forecaster')

    expect(footerText(built)).toBe(`Forecaster ${PACKAGE.version} · Send feedback`)
    expect(sendFeedback(built)).toEqual(feedbackTo('a-fork/forecaster', 'Milestone forecast'))
  })

  test('after moving to another screen, the footer’s link names that screen, and a click on it is left to the browser, to open GitHub in a new tab', async () => {
    const page = openBuiltScript(await webPage('a-fork/forecaster'))

    const inputs = await page.get('/inputs')
    const howItWorks = await page.get('/how-it-works')

    expect(sendFeedback(inputs)).toEqual(feedbackTo('a-fork/forecaster', 'Inputs'))
    expect(sendFeedback(howItWorks)).toEqual(feedbackTo('a-fork/forecaster', 'How it works'))
    expect(page.click(sendFeedback(inputs).href)).toBe(false)
    // where an in-app link is the page's own to show
    expect(page.click('/inputs')).toBe(true)
  })

  test('a page built with no repo has no Send feedback link, on its first screen or any its script shows', async () => {
    const built = await webPage(undefined)
    const page = openBuiltScript(built)

    expect(footerText(built)).toBe(`Forecaster ${PACKAGE.version}`)
    expect(footerText(await page.get('/inputs'))).toBe(`Forecaster ${PACKAGE.version}`)
    expect(built.replace(/<script>[^]*<\/script>/, '')).not.toContain('Send feedback')
  })
})

describe('the web build’s Inputs screen (#396)', () => {
  /** The note in place of setup, as `[its text, the link in it as tag]`. */
  const noTrackerNote = (page: string): [string | undefined, string | undefined] => {
    const note = page.match(/<div class="setup-summary"[^>]*>([^]*?)<\/div>/)?.[1]
    return [note?.replace(/<[^>]*>/g, '').trim(), note?.match(/<a [^>]*>/)?.[0]]
  }
  const NOTE = 'This page reads no tracker: type the inputs below. To read the milestone’s tickets from GitHub or Jira, run the Forecaster on your own machine.'

  test('built for a repo, says how to run the Forecaster on your own machine: that repo’s README, in a new tab', async () => {
    const page = openBuiltScript(await webPage('a-fork/forecaster'))

    const inputs = await page.get('/inputs')

    expect(noTrackerNote(inputs)).toEqual([NOTE, '<a href="https://github.com/a-fork/forecaster#readme" target="_blank" rel="noopener">'])
  })

  test('built with no repo, says it with no link', async () => {
    const page = openBuiltScript(await webPage(undefined))

    expect(noTrackerNote(await page.get('/inputs'))).toEqual([NOTE, undefined])
  })
})

/** The text of `page`'s footer, its tags left out. */
const footerText = (page: string): string | undefined => page.match(/<footer class="version">(.*)<\/footer>/)?.[1]?.replace(/<[^>]*>/g, '')

interface Feedback {
  href: string
  /** The page it opens, its query left out. */
  form: string
  labels: string | null
  title: string | null
  body: string | null
  target: string
}

/** The footer's Send feedback link in `page`, which must have it: what it opens, with what, and where. */
function sendFeedback(page: string): Feedback {
  const link = page.match(/<footer class="version">.*<a href="([^"]*)" target="([^"]*)" rel="noopener">Send feedback<\/a><\/footer>/)
  if (!link) throw new Error('The footer has no Send feedback link.')
  const href = link[1]!.replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
  const url = new URL(href)
  return {
    href,
    form: `${url.origin}${url.pathname}`,
    labels: url.searchParams.get('labels'),
    title: url.searchParams.get('title'),
    body: url.searchParams.get('body'),
    target: link[2]!,
  }
}

/** Send feedback as it opens `repo`'s new-issue form from `screen`: untitled, asking for needs-triage, in a new tab. */
const feedbackTo = (repo: string, screen: string): Feedback => ({
  href: expect.any(String) as string,
  form: `https://github.com/${repo}/issues/new`,
  labels: 'needs-triage',
  title: null,
  body: expect.stringMatching(
    new RegExp(
      `^> This issue is public, screenshots included\\.[^]*### What happened[^]*### What you expected[^]*### Screenshots[^]*\nVersion: ${PACKAGE.version.replaceAll('.', '\\.')}\nScreen: ${screen}$`,
    ),
  ) as string,
  target: '_blank',
})

/**
 * Runs the built page's script in Node, on a stub of the few browser parts it reaches for as it opens, and posts to
 * it as the Inputs screen's saves do: through the `fetch` it answers itself. What the bundling breaks in the app
 * shows here; the page's links and forms in a real browser are still the demo's to check.
 */
function openBuiltScript(page = html): {
  post: (path: string, body: string) => Promise<string>
  get: (path: string) => Promise<string>
  /** Clicks a link to `href` with the left button; whether the page took the click from the browser. */
  click: (href: string) => boolean
} {
  const script = page.match(/<script>([^]*)<\/script>/)?.[1]
  if (script === undefined) throw new Error('The built page has no script.')
  const kept = new Map<string, string>()
  type Listener = (event: object) => void
  const listeners = new Map<string, Listener>()
  const element = { replaceWith: () => {}, querySelectorAll: () => [] }
  const window: Record<string, unknown> = {
    localStorage: { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => kept.set(key, value) },
    location: { hash: '#/inputs' },
    history: { pushState: () => {} },
    document: {
      head: element,
      body: element,
      importNode: () => element,
      getElementById: () => null,
      addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    },
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
  return {
    post: async (path, body) => (await pageFetch(path, { method: 'POST', body })).text(),
    get: async (path) => (await pageFetch(path)).text(),
    click: (href) => {
      const preventDefault = vi.fn()
      const link = { getAttribute: () => href }
      listeners.get('click')?.({ defaultPrevented: false, button: 0, target: { closest: () => link }, preventDefault })
      return preventDefault.mock.calls.length > 0
    },
  }
}
