import type { BrowserWindow } from 'happy-dom'

// What a test sees of a page in happy-dom as its scripts run, for either build's page (browserPage.ts, webPage.ts): the
// errors they leave uncaught, and the page coming to show what a test waits for.

/** How long `until` waits for the page to show what it waits for: far longer than any answer from the app takes. */
export const UNTIL_LIMIT_MS = 2000

/** The errors a page's scripts leave uncaught, and waiting on what it shows. */
export interface PageWatch {
  /** Hears each error `window`'s scripts leave uncaught from now on, as happy-dom reports it on the window. */
  hear(window: BrowserWindow): void
  /** Throws what the page's scripts threw and left uncaught since last asked, if anything. */
  throwUncaught(): void
  /**
   * Waits until `shows()` is true of `window`'s page, checking it each time the page changes. It fails, saying it
   * waited for `what`, if the page hasn't shown it within `UNTIL_LIMIT_MS`, and on each error the page's scripts left
   * uncaught meanwhile.
   */
  until(window: BrowserWindow, what: string, shows: () => boolean): Promise<void>
}

/** A watch on a page, hearing no window until told to. */
export function watchPage(): PageWatch {
  const errors: unknown[] = []
  const throwUncaught = (): void => {
    if (errors.length > 0) throw new AggregateError(errors.splice(0), 'the page’s scripts threw')
  }
  return {
    hear(window) {
      window.addEventListener('error', (event) => errors.push('error' in event ? event.error : event))
    },
    throwUncaught,
    until: (window, what, shows) =>
      new Promise((resolve, reject) => {
        const check = (): void => {
          try {
            throwUncaught()
            if (!shows()) return
          } catch (error) {
            done()
            reject(error)
            return
          }
          done()
          resolve()
        }
        const watching = new window.MutationObserver(check)
        const limit = setTimeout(() => {
          done()
          reject(new Error(`the page didn’t show ${what} within ${UNTIL_LIMIT_MS}ms`))
        }, UNTIL_LIMIT_MS)
        const done = (): void => {
          watching.disconnect()
          clearTimeout(limit)
        }
        watching.observe(window.document, { childList: true, subtree: true, characterData: true, attributes: true })
        check()
      }),
  }
}
