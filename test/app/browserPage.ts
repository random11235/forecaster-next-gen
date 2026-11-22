import { Browser, Event, PropertySymbol, type BrowserWindow, type Document, type Element, type HTMLInputElement, type Request, type Response } from 'happy-dom'
import type { AppInProcess, RouteReply, RouteRequest } from './appInProcess.js'

// A page of the app in happy-dom, its scripts running (#275): what the EM's browser does with the HTML the other app
// tests check. Each request it sends, its scripts' `fetch` and the forms it submits, is answered by the app's routes
// in-process (#237), with no server started, so a script's saves go through the real routes to the storage behind
// them. happy-dom does no layout, so how a page looks and where it scrolls stay with the demos
// (docs/agents/demos.md); focus and selection it keeps.

/** An answer held back from the page's scripts until released, so a test can make answers arrive out of order. */
export interface HeldAnswer {
  /** Resolves once the answer has come back from the app, and is held. */
  readonly held: Promise<void>
  /** Hands the answer to the script that asked for it. */
  release(): void
}

/** A request the page sent: its scripts' `fetch`, or a form it submitted. */
export interface PageRequest {
  readonly method: string
  readonly url: URL
  /** Whether it asked to be answered in place, as the Inputs screen's script asks of each save. */
  readonly saveInPlace: boolean
  /** The form it posted, as the routes read it; none for a GET. */
  readonly form?: URLSearchParams
}

/** A page open in happy-dom, its scripts running against the app. */
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

/** How long `until` waits for the page to show what it waits for: far longer than any answer from the app takes. */
const UNTIL_LIMIT_MS = 2000

/** Where the page is opened: an address nothing serves, as each request is answered in-process. */
const ORIGIN = 'http://forecaster.test'

/**
 * The header the Inputs screen's script sends when it saves in place. It pins the wire value of `SAVE_IN_PLACE` in
 * `src/app/inputsScript.ts` on purpose: TEST_SEAMS doesn't let app tests import that file.
 */
const SAVE_IN_PLACE = { header: 'forecaster-save', value: 'in-place' } as const

/** A held answer's path, and whether its answer has come back and been released. */
interface Hold {
  path: string
  state: 'waiting' | 'held' | 'released'
  answer: Promise<void>
  caught: () => void
}

/** `request`, as the page sent it, read as the server reads it for the routes: its form urlencoded, or multipart as happy-dom submits one. */
async function routeRequest(request: Request): Promise<RouteRequest> {
  const { pathname, search } = new URL(request.url)
  const path = pathname + search
  if (request.method !== 'POST') return { method: request.method, path }
  const fields = [...(await request.formData())].map(([name, value]): [string, string] => [name, String(value)])
  const saveInPlace = request.headers.get(SAVE_IN_PLACE.header) === SAVE_IN_PLACE.value
  return { method: 'POST', path, form: new URLSearchParams(fields), ...(saveInPlace && { saveInPlace }) }
}

/**
 * Opens `path` of `app` in happy-dom, with JavaScript on, as only the app's own pages are opened here. Each request is
 * answered by `app`, a redirect followed to the page it names as a browser follows the server's; a request `app` fails
 * to answer fails, as one to a server that has stopped does. It fails if the page's scripts throw as it opens.
 */
export async function openPage(app: Pick<AppInProcess, 'answer'>, path: string): Promise<BrowserPage> {
  const holds: Hold[] = []
  const requests: PageRequest[] = []
  const errors: unknown[] = []
  let heldWhileSettling = (_hold: Hold): void => {}
  /** `app`'s answer to `request`, as `window` reads one, at the address it was answered from. */
  const answer = async (window: BrowserWindow, request: RouteRequest): Promise<Response> => {
    let reply: RouteReply = await app.answer(request)
    let at = request.path
    while (reply.kind === 'redirect') {
      at = reply.location
      reply = await app.answer({ method: 'GET', path: at })
    }
    const response =
      reply.kind === 'html'
        ? new window.Response(reply.html, { status: reply.status, headers: { 'content-type': 'text/html; charset=utf-8' } })
        : new window.Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } })
    // read-only by its type, a plain field in happy-dom: the page's location is set from it
    return Object.assign(response, { url: new URL(at, ORIGIN).href })
  }
  /** Holds the answer to `request`, if a test asked to hold the next one to its path, until released. */
  const holding = async (request: RouteRequest): Promise<void> => {
    const hold = holds.find(({ path, state }) => state === 'waiting' && path === new URL(request.path, ORIGIN).pathname)
    if (!hold) return
    hold.state = 'held'
    hold.caught()
    heldWhileSettling(hold)
    await hold.answer
  }
  const browser = new Browser({
    settings: {
      enableJavaScriptEvaluation: true,
      suppressInsecureJavaScriptEnvironmentWarning: true,
      navigation: {
        beforeContentCallback: (window) => {
          window.addEventListener('error', (event) => errors.push('error' in event ? event.error : event))
        },
      },
      fetch: {
        interceptor: {
          beforeAsyncRequest: async ({ request, window }) => {
            const asked = await routeRequest(request)
            requests.push({ method: asked.method, url: new URL(request.url), saveInPlace: asked.saveInPlace === true, ...(asked.form && { form: asked.form }) })
            let response: Response
            try {
              response = await answer(window, asked)
            } catch (error) {
              // a request aborted here fails as happy-dom fails one it can't send, its task ended; one thrown here would
              // leave its task open, so the page would never settle
              request.signal[PropertySymbol.abort](new window.TypeError(`Failed to fetch: ${String(error)}`))
              return
            }
            await holding(asked)
            return response
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
  await page.goto(new URL(path, ORIGIN).href)
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
