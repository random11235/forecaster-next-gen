import { Browser, Event, type BrowserWindow, type Document, type Element, type HTMLInputElement } from 'happy-dom'
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

/** A request the page sent: its scripts' `fetch`, or a form it submitted. */
export interface PageRequest {
  readonly method: string
  readonly url: URL
}

/** A page open in happy-dom, at the app's URL, its scripts running against the app. */
export interface BrowserPage {
  /** The page's window, and its document: a form submitted opens the page it answers with in their place. */
  readonly window: BrowserWindow
  readonly document: Document
  /** Each request the page has sent since it opened, in the order sent. */
  readonly requests: readonly PageRequest[]
  /** The first element `selector` finds, as the page holds it now, which must be a `kind`. */
  find<T extends Element>(selector: string, kind: abstract new (...args: never[]) => T): T
  /** Holds the answer to the next request the scripts send to `path` (no query), until released. */
  holdAnswer(path: string): HeldAnswer
  /**
   * Waits until each request sent is answered and handled, and each timer has run. It fails at once while an answer is
   * held and not released, as the page can't settle then; and it fails on each error the page's scripts left uncaught,
   * as happy-dom reports it on the window: thrown as a script ran, in a listener or in a timer. An error a script
   * catches is its own to show: a save's shows as "Not saved…" on the page, and the candidates' and the query step's
   * answers drop theirs. A promise rejection left unhandled isn't the page's: Vitest fails the run on it.
   */
  settled(): Promise<void>
  /**
   * Waits until `shows()` is true of the page, checking it each time the page changes: for while an answer is held.
   * It fails, saying it waited for `what`, if the page hasn't shown it within `UNTIL_LIMIT_MS`.
   */
  until(what: string, shows: () => boolean): Promise<void>
  close(): Promise<void>
}

/** How long `until` waits for the page to show what it waits for: far longer than any answer from the local server takes. */
const UNTIL_LIMIT_MS = 2000

/** A stand-in for the `/live` reload script's `EventSource`, which would hold a connection open: it connects nowhere. */
class NoEventSource {
  onmessage = null
  close(): void {}
}

/** A held answer's path, and whether its answer has come back and been released. */
interface Hold {
  path: string
  state: 'waiting' | 'held' | 'released'
  answer: Promise<void>
  caught: () => void
}

/**
 * Opens `path` of `running` in happy-dom, with JavaScript on, as only the app's own pages are opened here. Each POST
 * carries the page's `Origin`, as a browser's does and the server requires; happy-dom sends it only across origins.
 * It fails if the page's scripts throw as it opens.
 */
export async function openPage(running: Pick<RunningApp, 'url'>, path: string): Promise<BrowserPage> {
  const origin = new URL(running.url).origin
  const holds: Hold[] = []
  const requests: PageRequest[] = []
  const errors: unknown[] = []
  let heldWhileSettling = (_hold: Hold): void => {}
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
            if (request.method === 'POST') request.headers.set('Origin', origin)
            requests.push({ method: request.method, url: new URL(request.url) })
          },
          afterAsyncResponse: async ({ request }) => {
            const hold = holds.find(({ path, state }) => state === 'waiting' && path === new URL(request.url).pathname)
            if (!hold) return
            hold.state = 'held'
            hold.caught()
            heldWhileSettling(hold)
            await hold.answer
          },
        },
      },
    },
  })
  const page = browser.newPage()
  /** Throws what the page's scripts threw and left uncaught since last asked. */
  const throwUncaught = (): void => {
    if (errors.length > 0) throw new AggregateError(errors.splice(0), 'the page’s scripts threw')
  }
  const stillHeld = (hold: Hold): Error => new Error(`the answer from ${hold.path} is held: release it before the page can settle`)
  await page.goto(new URL(path, running.url).href)
  await page.waitUntilComplete()
  throwUncaught()
  requests.length = 0
  return {
    get window() {
      return page.mainFrame.window
    },
    get document() {
      return page.mainFrame.window.document
    },
    requests,
    find(selector, kind) {
      const found = page.mainFrame.window.document.querySelector(selector)
      if (!(found instanceof kind)) throw new Error(`no ${kind.name} at ${selector}`)
      return found
    },
    holdAnswer(path) {
      let release = () => {}
      let caught = () => {}
      const answer = new Promise<void>((resolve) => (release = resolve))
      const held = new Promise<void>((resolve) => (caught = resolve))
      const hold: Hold = { path, state: 'waiting', answer, caught }
      holds.push(hold)
      return {
        held,
        release() {
          hold.state = 'released'
          release()
        },
      }
    },
    async settled() {
      const stuck = holds.find(({ state }) => state === 'held')
      if (stuck) throw stillHeld(stuck)
      try {
        await Promise.race([page.waitUntilComplete(), new Promise<never>((_, reject) => (heldWhileSettling = (hold) => reject(stillHeld(hold))))])
      } finally {
        heldWhileSettling = () => {}
      }
      throwUncaught()
    },
    until(what, shows) {
      const { window } = page.mainFrame
      return new Promise((resolve, reject) => {
        if (shows()) return resolve()
        const watching = new window.MutationObserver(() => {
          if (!shows()) return
          done()
          resolve()
        })
        const limit = setTimeout(() => {
          done()
          reject(new Error(`the page didn’t show ${what} within ${UNTIL_LIMIT_MS}ms`))
        }, UNTIL_LIMIT_MS)
        const done = (): void => {
          watching.disconnect()
          clearTimeout(limit)
        }
        watching.observe(window.document, { childList: true, subtree: true, characterData: true, attributes: true })
      })
    },
    close: () => browser.close(),
  }
}

/** Sets `field` to `text`, firing its input, as the browser does on each key. */
export function typed(field: HTMLInputElement, text: string): void {
  field.value = text
  field.dispatchEvent(new Event('input', { bubbles: true }))
}

/** The paths of the forms and fetches `page` has posted, in the order posted. */
export const posted = (page: BrowserPage): string[] => page.requests.filter(({ method }) => method === 'POST').map(({ url }) => url.pathname)
