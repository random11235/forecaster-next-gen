import { describe, expect, test } from 'vitest'
import { HTMLElement } from 'happy-dom'
import type { CannedFixture } from '../../src/connectors/canned.js'
import { pagesOnTracker } from './pagesOnTracker.js'

// The page the other browser tests drive (#275) fails them fast and says why: on what the page's scripts throw and
// leave uncaught, on an answer held while waiting for the page to settle, and on what the page never shows.

const NOTHING: CannedFixture = { milestoneChoices: [], reads: {} }

const pages = pagesOnTracker()

describe('the page a browser test drives', () => {
  test('fails settling on what a timer threw', async () => {
    const { page } = await pages.open(NOTHING, '/inputs')

    page.window.setTimeout(() => {
      throw new Error('a timer threw')
    })

    await expect(page.settled()).rejects.toThrow('the page’s scripts threw')
  })

  test('fails settling on what a listener threw', async () => {
    const { page } = await pages.open(NOTHING, '/inputs')
    const body = page.find('body', HTMLElement)
    body.addEventListener('click', () => {
      throw new Error('a listener threw')
    })

    body.click()

    await expect(page.settled()).rejects.toThrow('the page’s scripts threw')
  })

  test('fails settling at once on an answer held while it waits', async () => {
    const { page } = await pages.open(NOTHING, '/inputs')
    const held = page.holdAnswer('/inputs')

    void page.window.fetch('/inputs')

    await expect(page.settled()).rejects.toThrow('the answer from /inputs is held')
    held.release()
  })

  test('fails settling at once on an answer already held', async () => {
    const { page } = await pages.open(NOTHING, '/inputs')
    const held = page.holdAnswer('/inputs')
    void page.window.fetch('/inputs')
    await held.held

    await expect(page.settled()).rejects.toThrow('the answer from /inputs is held')
    held.release()
  })

  test('fails waiting for what the page never shows, saying what it waited for', async () => {
    const { page } = await pages.open(NOTHING, '/inputs')

    await expect(page.until('a heading that never comes', () => false)).rejects.toThrow('the page didn’t show a heading that never comes')
  })
})
