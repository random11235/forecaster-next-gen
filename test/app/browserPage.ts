import { Browser, type BrowserWindow, type Document, type Element } from 'happy-dom'
import type { RunningApp } from '../../src/app/launch.js'

// A page of the running app in happy-dom, its scripts running (#275): what the EM's browser does with the HTML the
// other app tests check. Its `fetch` reaches the app's own server, so a script's saves go through the real routes to
// the storage behind them. happy-dom does no layout, so how a page looks and where it scrolls stay with the demos
// (docs/agents/demos.md); focus and selection it keeps.

/** An answer held back from the page's scripts until released, so a test can make answers arrive out of order. */
export interface HeldAnswer {
  /** Resolves once the answer has come back from the server, and is held. */
  readonly held: Promise<void>
  /** Hands the answer to the script that asked for it. */
  release(): void
}

/** A page open in happy-dom, at the app's URL, its scripts running against the app. */
export interface BrowserPage {
  readonly window: BrowserWindow
  readonly document: Document
  /** Each request the page's scripts have sent, as `METHOD /path?query`, in the order sent. */
  readonly requests: readonly string[]
  /** The first element `selector` finds, as the page holds it now, which must be a `kind`. */
  find<T extends Element>(selector: string, kind: abstract new (...args: never[]) => T): T
  /** Holds the answer to the next request the scripts send to `path` (no query), until released. */
  holdAnswer(path: string): HeldAnswer
  /** Waits until each request sent is answered and handled, and each timer has run; throws any error a script threw. */
  settled(): Promise<void>
  close(): Promise<void>
}

/** A stand-in for the `/live` reload script's `EventSource`, which would hold a connection open: it connects nowhere. */
class NoEventSource {
  onmessage = null
  close(): void {}
}

/**
 * Opens `path` of `running` in happy-dom, with JavaScript on, as only the app's own pages are opened here. Each POST
 * carries the page's `Origin`, as a browser's does and the server requires; happy-dom sends it only across origins.
 */
export async function openPage(running: Pick<RunningApp, 'url'>, path: string): Promise<BrowserPage> {
  const origin = new URL(running.url).origin
  const holds: { path: string; answer: Promise<void>; caught: () => void }[] = []
  const requests: string[] = []
  const errors: unknown[] = []
  const browser = new Browser({
    settings: {
      enableJavaScriptEvaluation: true,
      suppressInsecureJavaScriptEnvironmentWarning: true,
      navigation: {
        beforeContentCallback: (window) => {
          Object.assign(window, { EventSource: NoEventSource })
          window.addEventListener('error', (event) => errors.push('error' in event ? event.error : event))
        },
      },
      fetch: {
        interceptor: {
          beforeAsyncRequest: async ({ request }) => {
            const url = new URL(request.url)
            if (request.method === 'POST') request.headers.set('Origin', origin)
            requests.push(`${request.method} ${url.pathname}${url.search}`)
          },
          afterAsyncResponse: async ({ request }) => {
            const hold = holds.find(({ path }) => path === new URL(request.url).pathname)
            if (!hold) return
            holds.splice(holds.indexOf(hold), 1)
            hold.caught()
            await hold.answer
          },
        },
      },
    },
  })
  const page = browser.newPage()
  await page.goto(new URL(path, running.url).href)
  await page.waitUntilComplete()
  requests.length = 0
  const { window } = page.mainFrame
  return {
    window,
    document: window.document,
    requests,
    find(selector, kind) {
      const found = window.document.querySelector(selector)
      if (!(found instanceof kind)) throw new Error(`no ${kind.name} at ${selector}`)
      return found
    },
    holdAnswer(path) {
      let release = () => {}
      let caught = () => {}
      const answer = new Promise<void>((resolve) => (release = resolve))
      const held = new Promise<void>((resolve) => (caught = resolve))
      holds.push({ path, answer, caught })
      return { held, release }
    },
    async settled() {
      await page.waitUntilComplete()
      if (errors.length > 0) throw new AggregateError(errors.splice(0), 'the page’s scripts threw')
    },
    close: () => browser.close(),
  }
}
