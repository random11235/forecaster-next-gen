import { afterEach } from 'vitest'
import type { RunningApp } from '../../src/app/launch.js'
import type { CannedFixture } from '../../src/connectors/canned.js'
import { appOnTracker, type AppOnTracker } from './appOnTracker.js'
import { openPage, type BrowserPage } from './browserPage.js'

// The lifecycle of a test file's browser pages (#275): each test's app on the canned connector, and its page open in
// happy-dom, both closed after it.

/** An app on the canned connector, open in happy-dom; both closed after each test. */
export interface OpenedPage {
  app: AppOnTracker
  page: BrowserPage
}

/**
 * For a test file of browser pages: opens `path` of an app on `fixture`, once `arrange` has entered what the page
 * needs, and closes both after each test. `stopApp` stops the app early, as when it stops answering.
 */
export function pagesOnTracker(): {
  open(fixture: CannedFixture, path: string, arrange?: (running: RunningApp) => Promise<void>): Promise<OpenedPage>
  stopApp(): Promise<void>
} {
  let app: AppOnTracker | undefined
  let page: BrowserPage | undefined
  afterEach(async () => {
    await page?.close()
    page = undefined
    await app?.close()
    app = undefined
  })
  return {
    async open(fixture, path, arrange = async () => {}) {
      const opened = await appOnTracker(fixture)
      app = opened
      await arrange(opened.running)
      page = await openPage(opened.running, path)
      return { app: opened, page }
    },
    async stopApp() {
      await app?.close()
      app = undefined
    },
  }
}
