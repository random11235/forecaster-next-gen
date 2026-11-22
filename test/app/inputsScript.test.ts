import { describe, expect, test } from 'vitest'
import { Event, HTMLButtonElement, HTMLDetailsElement, HTMLElement, HTMLFormElement, HTMLInputElement } from 'happy-dom'
import type { CannedFixture } from '../../src/connectors/canned.js'
import { CHECKOUT, TEAM } from '../trackerScenario.js'
import { connectAndPick, type AppInProcess } from './appInProcess.js'
import { posted, type BrowserPage } from './browserPage.js'
import { all, one, render } from './dom.js'
import { pagesOnTracker } from './pagesOnTracker.js'

// The Inputs screen's script (#100), run in happy-dom against the app's routes in-process on the canned connector
// (#275, #237): what the EM's browser saves as each input changes, and what the screen shows after. What each save or refusal answers is
// tested over HTTP (screens.inputs.test.ts and the rest); these test what the script does with it.

const MILESTONE = '/inputs/milestone#milestone'
const CADENCE = '/inputs/cadence#cadence'

// 3 open, so tickets remaining typed as 30 reads differently
const FIXTURE: CannedFixture = {
  milestoneChoices: [{ kind: 'milestone', choices: [CHECKOUT], pastLimit: false }],
  reads: { [CHECKOUT.query]: { tickets: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }], incomplete: false } },
}

const pages = pagesOnTracker()

/** The Inputs screen open in happy-dom, its milestone entered with 30 tickets remaining; connected, if asked, to GitHub. */
const openInputs = ({ connected = false } = {}): Promise<{ app: AppInProcess; page: BrowserPage }> =>
  pages.open(FIXTURE, '/inputs', async (app) => {
    await app.post('/inputs/milestone', { name: 'Checkout v2', startDate: '2026-10-05', ticketsRemaining: '30' })
    if (!connected) return
    await connectAndPick(app)
    await app.post('/inputs/setup/use-these', {})
  })

/** The field named `name` in the form posting to `action`, as the page holds it now. */
const field = (shown: BrowserPage, action: string, name: string): HTMLInputElement => shown.find(`form[action="${action}"] [name="${name}"]`, HTMLInputElement)

/** Fires `input`'s change, as the browser does on Enter or on leaving it. */
const changed = (input: HTMLInputElement): boolean => input.dispatchEvent(new Event('change', { bubbles: true }))

/** Types `value` into `input`, and fires its change. */
function change(input: HTMLInputElement, value: string): void {
  input.value = value
  changed(input)
}

/** The section with `id`, as the page holds it now. */
const sectionOnPage = (shown: BrowserPage, id: string): HTMLElement => shown.find(`section#${id}`, HTMLElement)

/**
 * Clicks `button`, which submits the form its `form` attribute names. happy-dom submits the form around it instead, so
 * this fires the click the script hears, then submits the named form as a browser would.
 */
function clickSubmitting(shown: BrowserPage, selector: string): void {
  const button = shown.find(selector, HTMLButtonElement)
  button.dispatchEvent(new Event('click', { bubbles: true }))
  shown.find(`form#${button.getAttribute('form')}`, HTMLFormElement).requestSubmit()
}

const NOT_SAVED = 'Not saved: the Forecaster is not answering. Is it still running?'

describe('the Inputs screen’s script', () => {
  test('a changed field is saved, its section says so, and the other sections show what the save changed', async () => {
    const { app, page } = await openInputs()
    expect(sectionOnPage(page, 'pace').textContent).toContain('tickets per week')

    change(field(page, CADENCE, 'cadenceDays'), '14')
    await page.settled()

    expect(app.storage.milestoneInputs(TEAM)?.cadenceDays).toBe(14)
    expect(sectionOnPage(page, 'cadence').textContent).toContain('Saved')
    expect(sectionOnPage(page, 'pace').textContent).toContain('tickets per sprint')
  })

  test('a save posts its form’s fields, asking to be answered in place, and the page stays where it was', async () => {
    const { page } = await openInputs()

    change(field(page, CADENCE, 'cadenceDays'), '14')
    await page.settled()

    expect(page.requests).toHaveLength(1)
    expect(page.requests[0]).toMatchObject({ method: 'POST', saveInPlace: true })
    expect(page.requests[0]?.form?.get('cadenceDays')).toBe('14')
    expect(page.window.location.pathname).toBe('/inputs')
  })

  test('a save swaps in the screen’s header too, which names the milestone', async () => {
    const { page } = await openInputs()
    expect(page.document.querySelector('main > header')?.textContent).toContain('Checkout v2')

    change(field(page, MILESTONE, 'name'), 'Checkout v3')
    await page.settled()

    expect(page.document.querySelector('main > header')?.textContent).toContain('Checkout v3')
  })

  test('a refused value swaps in only its section, saying why and keeping what was typed', async () => {
    const { app, page } = await openInputs()
    const cadence = sectionOnPage(page, 'cadence')
    expect(sectionOnPage(page, 'milestone').querySelector('.error')).toBeNull()

    change(field(page, MILESTONE, 'ticketsRemaining'), '-1')
    await page.settled()

    expect(app.storage.milestoneInputs(TEAM)?.ticketsRemaining).toBe(30)
    expect(sectionOnPage(page, 'milestone').querySelector('.error[role=alert]')).not.toBeNull()
    expect(sectionOnPage(page, 'milestone').textContent).not.toContain('Saved')
    expect(field(page, MILESTONE, 'ticketsRemaining').value).toBe('-1')
    expect(sectionOnPage(page, 'cadence')).toBe(cadence)
  })

  test('a date field isn’t saved while it has the focus, and is saved on leaving it', async () => {
    const { app, page } = await openInputs()
    const startDate = field(page, MILESTONE, 'startDate')

    startDate.focus()
    change(startDate, '2026-10-12')
    await page.settled()
    expect(page.requests).toEqual([])
    expect(app.storage.milestoneInputs(TEAM)?.startDate).toBe('2026-10-05')

    startDate.blur()
    await page.settled()
    expect(app.storage.milestoneInputs(TEAM)?.startDate).toBe('2026-10-12')
    expect(sectionOnPage(page, 'milestone').textContent).toContain('Saved')
  })

  test('two quick changes are saved in the order they were made, the second once the first is answered', async () => {
    const { app, page } = await openInputs()
    const first = page.holdAnswer('/inputs/milestone')

    change(field(page, MILESTONE, 'ticketsRemaining'), '25')
    change(field(page, CADENCE, 'cadenceDays'), '14')
    await first.held
    expect(posted(page)).toEqual(['/inputs/milestone'])
    first.release()
    await page.settled()

    expect(posted(page)).toEqual(['/inputs/milestone', '/inputs/cadence'])
    expect(app.storage.milestoneInputs(TEAM)).toMatchObject({ ticketsRemaining: 25, cadenceDays: 14 })
    expect(field(page, MILESTONE, 'ticketsRemaining').value).toBe('25')
    expect(field(page, CADENCE, 'cadenceDays').value).toBe('14')
    expect(sectionOnPage(page, 'pace').textContent).toContain('tickets per sprint')
  })

  test('the focus stays on the field that had it, with its selection, once the sections are swapped in', async () => {
    const { page } = await openInputs()
    const name = field(page, MILESTONE, 'name')

    name.focus()
    name.value = 'Checkout v3'
    name.setSelectionRange(2, 5)
    changed(name)
    await page.settled()

    const swapped = field(page, MILESTONE, 'name')
    expect(swapped).not.toBe(name)
    expect(page.document.activeElement).toBe(swapped)
    expect([swapped.selectionStart, swapped.selectionEnd]).toEqual([2, 5])
  })

  test('what is typed into the focused field while its save is answered stays, over what was saved', async () => {
    const { page } = await openInputs()
    const name = field(page, MILESTONE, 'name')
    const saving = page.holdAnswer('/inputs/milestone')

    name.focus()
    change(name, 'Checkout v3')
    await saving.held
    name.value = 'Checkout v3.1'
    saving.release()
    await page.settled()

    const swapped = field(page, MILESTONE, 'name')
    expect(swapped).not.toBe(name)
    expect(swapped.value).toBe('Checkout v3.1')
  })

  test('the Connect step isn’t saved as it changes, and a save elsewhere leaves what is typed in it', async () => {
    const { page } = await openInputs()

    change(field(page, '/inputs/connect#connect', 'repo'), 'shop-team/shop')
    await page.settled()
    expect(page.requests).toEqual([])

    change(field(page, MILESTONE, 'ticketsRemaining'), '25')
    await page.settled()
    expect(sectionOnPage(page, 'milestone').textContent).toContain('Saved')
    expect(field(page, '/inputs/connect#connect', 'repo').value).toBe('shop-team/shop')
  })

  test('a form changed back to what was last saved isn’t posted again', async () => {
    const { page } = await openInputs()

    change(field(page, MILESTONE, 'ticketsRemaining'), '30')
    await page.settled()
    expect(page.requests).toEqual([])

    change(field(page, MILESTONE, 'ticketsRemaining'), '25')
    await page.settled()
    change(field(page, MILESTONE, 'ticketsRemaining'), '25')
    await page.settled()
    expect(posted(page)).toEqual(['/inputs/milestone'])
  })

  test('with the Forecaster not answering, the section says it isn’t saved', async () => {
    const { page } = await openInputs()
    pages.stopApp()

    change(field(page, MILESTONE, 'ticketsRemaining'), '25')
    await page.settled()

    expect(sectionOnPage(page, 'milestone').textContent).toContain(NOT_SAVED)
    expect(sectionOnPage(page, 'milestone').textContent).not.toContain('Saved')
  })

  test('opening a chip with a dot posts that it was opened, once, and clears the dot', async () => {
    const { app, page } = await openInputs({ connected: true })
    const chip = page.find('#milestone details.reads-differently', HTMLDetailsElement)
    expect(chip.querySelector('.dot')).not.toBeNull()

    chip.open = true
    await page.settled()
    chip.open = false
    chip.open = true
    await page.settled()

    expect(posted(page)).toEqual(['/inputs/reading-opened'])
    expect(chip.querySelector('.dot')).toBeNull()
    expect(all(one(render(await app.page('/inputs')), 'section#milestone'), '.dot')).toEqual([])
  })

  test('a chip’s Follow switches the value back to the tracker, though nothing was typed', async () => {
    const { app, page } = await openInputs({ connected: true })

    clickSubmitting(page, '#milestone button[form="follow-tickets"]')
    await page.settled()

    expect(app.storage.milestoneInputs(TEAM)?.ticketsSource).toBe('tracker')
    expect(sectionOnPage(page, 'milestone').querySelector('.reading-value')?.textContent).toBe('3')
    expect(sectionOnPage(page, 'milestone').querySelector('details.reads-differently')).toBeNull()
  })
})
