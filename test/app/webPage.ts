import { afterEach, vi } from 'vitest'
import { Window } from 'happy-dom'

// The web build's page (#114) in happy-dom, its page script (`webMain.ts`) running (#237): imported here, in Vitest's
// own process, on the happy-dom window put in place of the browser's globals, so the coverage counts it, and the
// screens' scripts it runs ask its `fetch`, answered by the web build's app in-process. Each test's page opens on a
// window of its own, with the script imported afresh, and is closed after it.

/** The web build's page open in happy-dom. */
export interface WebPage {
  readonly window: Window
  /** The URLs the page fetched past the app, from the browser's own `fetch`, in the order asked. */
  readonly fetchedElsewhere: readonly string[]
  /** What the page keeps in the browser's storage now, by key. */
  stored(): Map<string, string>
  /**
   * Waits until `shows()` is true of the page, checking it each time the page changes. It fails, saying it waited for
   * `what`, if the page hasn't shown it within `UNTIL_LIMIT_MS`, and on each error the page's scripts left uncaught.
   */
  until(what: string, shows: () => boolean): Promise<void>
}

/** How the browser treats the page: what its storage holds at the start, or that it is blocked; whether it refuses a history entry. */
export interface Opening {
  /** The URL's fragment, `#/inputs` naming the Inputs screen. */
  hash?: string
  stored?: ReadonlyMap<string, string>
  storageBlocked?: boolean
  historyRefused?: boolean
}

/** How long `until` waits: far longer than any answer from the app in-process takes. */
const UNTIL_LIMIT_MS = 2000

/** For a test file of the web build's page: opens it as `opening` says, and closes it after each test. */
export function webPages(): { open(opening?: Opening): Promise<WebPage> } {
  let window: Window | undefined
  afterEach(async () => {
    vi.unstubAllGlobals()
    await window?.happyDOM.close()
    window = undefined
  })
  return {
    async open({ hash = '', stored = new Map(), storageBlocked = false, historyRefused = false } = {}) {
      const opened = new Window({
        url: `https://forecaster.test/forecaster.html${hash}`,
        settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true },
      })
      window = opened
      const errors: unknown[] = []
      opened.addEventListener('error', (event) => errors.push('error' in event ? event.error : event))
      for (const [key, value] of stored) opened.localStorage.setItem(key, value)
      if (storageBlocked) {
        Object.defineProperty(opened, 'localStorage', {
          get: () => {
            throw new opened.DOMException('The page’s site data is blocked', 'SecurityError')
          },
        })
      }
      if (historyRefused) {
        opened.history.pushState = () => {
          throw new opened.DOMException('A sandboxed frame refuses a history entry', 'SecurityError')
        }
      }
      const fetchedElsewhere: string[] = []
      opened.fetch = async (input) => {
        fetchedElsewhere.push(String(input))
        return new opened.Response('elsewhere')
      }
      const globals = { window: opened, document: opened.document, location: opened.location, history: opened.history }
      const constructors = { DOMParser: opened.DOMParser, FormData: opened.FormData, Headers: opened.Headers, Response: opened.Response }
      for (const [name, value] of Object.entries({ ...globals, ...constructors })) vi.stubGlobal(name, value)
      vi.resetModules()
      await import('../../src/app/webMain.js')
      const page: WebPage = {
        window: opened,
        fetchedElsewhere,
        stored: () => {
          const { localStorage } = opened
          const keys = Array.from({ length: localStorage.length }, (_, at) => localStorage.key(at) ?? '')
          return new Map(keys.map((key) => [key, localStorage.getItem(key) ?? '']))
        },
        until: (what, shows) =>
          new Promise((resolve, reject) => {
            const check = (): void => {
              if (errors.length > 0) {
                done()
                reject(new AggregateError(errors.splice(0), 'the page’s scripts threw'))
              } else if (shows()) {
                done()
                resolve()
              }
            }
            const watching = new opened.MutationObserver(check)
            const limit = setTimeout(() => {
              done()
              reject(new Error(`the page didn’t show ${what} within ${UNTIL_LIMIT_MS}ms`))
            }, UNTIL_LIMIT_MS)
            const done = (): void => {
              watching.disconnect()
              clearTimeout(limit)
            }
            watching.observe(opened.document, { childList: true, subtree: true, characterData: true, attributes: true })
            check()
          }),
      }
      await page.until('a screen of the app', () => opened.document.title.endsWith('· Forecaster'))
      return page
    },
  }
}
