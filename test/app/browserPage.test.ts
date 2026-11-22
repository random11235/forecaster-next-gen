import { describe, expect, test } from 'vitest'
import { HTMLButtonElement, HTMLElement, HTMLFormElement } from 'happy-dom'
import type { CannedFixture } from '../../src/connectors/canned.js'
import { CANT_BE_REACHED, type BrowserPage } from './browserPage.js'
import { pagesOnTracker } from './pagesOnTracker.js'

// The page the other browser tests drive (#275) fails them fast and says why: on what the page's scripts throw and
// leave uncaught, on an answer held while waiting for the page to settle, and on what the page never shows. And it
// answers as a browser does where happy-dom's public interface can't say so (happyDomAnswers.ts): a fetch the app
// can't answer failing, a form's answer it can't reach shown as the browser's own page, and a page opened at the
// address its answer came from.

const NOTHING: CannedFixture = { milestoneChoices: [], reads: {} }

const pages = pagesOnTracker()

/** Submits a form on `page` posting the milestone, as one of the app's own forms does. */
function submitMilestone(page: BrowserPage): void {
  const form = page.document.createElement('form')
  form.setAttribute('method', 'post')
  form.setAttribute('action', '/inputs/milestone')
  form.innerHTML =
    '<input name="name" value="Launch"><input name="startDate" value="2026-11-02"><input name="ticketsRemaining" value="30"><button>Save</button>'
  page.document.body.append(form)
  page.find('body > form', HTMLFormElement).requestSubmit(page.find('body > form button', HTMLButtonElement))
}

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

  test('waits for nothing when the page already shows it', async () => {
    const { page } = await pages.open(NOTHING, '/inputs')

    await expect(page.until('the page as it opened', () => true)).resolves.toBeUndefined()
  })

  test('stops watching the page once it shows what it waited for', async () => {
    const { page } = await pages.open(NOTHING, '/inputs')
    const body = page.find('body', HTMLElement)
    let looked = 0
    const shown = page.until('the body marked', () => (looked++, body.hasAttribute('data-marked')))
    body.setAttribute('data-marked', '')
    await shown
    const lookedWhenShown = looked

    body.setAttribute('data-changed-after', '')
    await page.settled()

    expect(looked).toBe(lookedWhenShown)
  })

  test('fails waiting for what the page never shows, saying what it waited for', async () => {
    const { page } = await pages.open(NOTHING, '/inputs')

    await expect(page.until('a heading that never comes', () => false)).rejects.toThrow('the page didn’t show a heading that never comes')
  })

  test('fails waiting on what a timer threw, though the page didn’t change after it', async () => {
    const { page } = await pages.open(NOTHING, '/inputs')

    page.window.setTimeout(() => {
      throw new Error('a timer threw')
    })

    await expect(page.until('a heading that never comes', () => false)).rejects.toThrow('the page’s scripts threw')
  })

  test('fails a script’s fetch the app can’t answer, as a browser fails one to a stopped server, and still settles', async () => {
    const { page } = await pages.open(NOTHING, '/inputs')
    pages.stopApp()

    await expect(page.window.fetch('/inputs')).rejects.toThrow('Failed to fetch')
    await expect(page.settled()).resolves.toBeUndefined()
  })

  test('opens the browser’s own page for a form the app can’t answer, while a script’s post to it still fails', async () => {
    const { page } = await pages.open(NOTHING, '/how-it-works')
    pages.stopApp()

    await expect(page.window.fetch('/inputs/milestone', { method: 'POST', body: new page.window.URLSearchParams({ name: 'Launch' }) })).rejects.toThrow(
      'Failed to fetch',
    )
    submitMilestone(page)
    await page.settled()

    expect(page.document.title).toBe(CANT_BE_REACHED)
  })

  test('fails opening a page the app can’t answer', async () => {
    await expect(pages.open(NOTHING, '/inputs', async (app) => app.stop())).rejects.toThrow('Failed to fetch')
  })

  test('opens the page a form is answered with at the address it was redirected to', async () => {
    const { page } = await pages.open(NOTHING, '/how-it-works')

    submitMilestone(page)
    await page.settled()

    expect(page.window.location.pathname).toBe('/inputs')
    expect(page.document.title).toBe('Inputs · Forecaster')
  })
})
