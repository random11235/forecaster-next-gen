import { afterEach } from 'vitest'
import type { CannedFixture } from '../../src/connectors/canned.js'
import { appInProcess, type AppInProcess } from './appInProcess.js'
import { openPage, type BrowserPage } from './browserPage.js'

// The lifecycle of a test file's browser pages (#275): each test's app on the canned connector, answered in-process
// (#237), and its page open in happy-dom, both closed after it.

/** An app on the canned connector, open in happy-dom; both closed after each test. */
export interface OpenedPage {
  app: AppInProcess
  page: BrowserPage
}

/**
 * For a test file of browser pages: opens `path` of an app on `fixture`, once `arrange` has entered what the page
 * needs, and closes both after each test. `stopApp` stops the app answering, as when it stops running.
 */
export function pagesOnTracker(): {
  open(fixture: CannedFixture, path: string, arrange?: (app: AppInProcess) => Promise<void>): Promise<OpenedPage>
  stopApp(): void
} {
  let app: AppInProcess | undefined
  let page: BrowserPage | undefined
  afterEach(async () => {
    await page?.close()
    page = undefined
    app?.close()
    app = undefined
  })
  return {
    async open(fixture, path, arrange = async () => {}) {
      const opened = appInProcess(fixture)
      app = opened
      await arrange(opened)
      page = await openPage(opened, path)
      return { app: opened, page }
    },
    stopApp: () => app?.stop(),
  }
}
