import { afterEach, describe, expect, test } from 'vitest'
import { Event, HTMLButtonElement, HTMLDetailsElement, HTMLElement, HTMLFormElement, HTMLInputElement } from 'happy-dom'
import type { CannedFixture } from '../../src/connectors/canned.js'
import { appOnTracker, inputsSection, type AppOnTracker } from './appOnTracker.js'
import { openPage, type BrowserPage } from './browserPage.js'
import { post } from './forms.js'

// The Inputs screen's script (#100), run in happy-dom against the local server on the canned connector (#275): what
// the EM's browser saves as each input changes, and what the screen shows after. What each save or refusal answers is
// tested over HTTP (screens.inputs.test.ts and the rest); these test what the script does with it.

const TEAM = 'team'
const MILESTONE = '/inputs/milestone#milestone'

const CHECKOUT = { kind: 'milestone', name: 'Checkout v2', query: 'milestone:"Checkout v2"' } as const
// 3 open, so tickets remaining typed as 30 reads differently
const FIXTURE: CannedFixture = {
  milestoneChoices: [{ kind: 'milestone', choices: [CHECKOUT], pastLimit: false }],
  reads: { [CHECKOUT.query]: { tickets: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }], incomplete: false } },
}

let app: AppOnTracker | undefined
let page: BrowserPage | undefined

afterEach(async () => {
  await page?.close()
  page = undefined
  await app?.close()
  app = undefined
})

/** The Inputs screen open in happy-dom, its milestone entered with 30 tickets remaining; connected, if asked, to GitHub. */
async function openInputs({ connected = false } = {}): Promise<{ app: AppOnTracker; page: BrowserPage }> {
  app = await appOnTracker(FIXTURE)
  const { running } = app
  await post(running, '/inputs/milestone', { name: 'Checkout v2', startDate: '2026-10-05', ticketsRemaining: '30' })
  if (connected) {
    await post(running, '/inputs/connect', { tracker: 'github', repo: 'shop-team/shop', token: 'token' })
    await post(running, '/inputs/milestone-query/add', CHECKOUT)
    await post(running, '/inputs/setup/use-these', {})
  }
  page = await openPage(running, '/inputs')
  return { app, page }
}

/** The field named `name` in the form posting to `action`, as the page holds it now. */
const field = (shown: BrowserPage, action: string, name: string): HTMLInputElement => shown.find(`form[action="${action}"] [name="${name}"]`, HTMLInputElement)

/** Types `value` into `input`, and fires its change, as the browser does on Enter or on leaving it. */
function change(input: HTMLInputElement, value: string): void {
  input.value = value
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

/** The section with `id`, as the page holds it now. */
const section = (shown: BrowserPage, id: string): HTMLElement => shown.find(`section#${id}`, HTMLElement)

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
    expect(section(page, 'pace').textContent).toContain('tickets per week')

    change(field(page, '/inputs/cadence#cadence', 'cadenceDays'), '14')
    await page.settled()

    expect(app.storage.milestoneInputs(TEAM)?.cadenceDays).toBe(14)
    expect(section(page, 'cadence').textContent).toContain('Saved')
    expect(section(page, 'pace').textContent).toContain('tickets per sprint')
  })

  test('a refused value swaps in only its section, saying why and keeping what was typed', async () => {
    const { app, page } = await openInputs()
    const cadence = section(page, 'cadence')

    change(field(page, MILESTONE, 'ticketsRemaining'), '-1')
    await page.settled()

    expect(app.storage.milestoneInputs(TEAM)?.ticketsRemaining).toBe(30)
    expect(section(page, 'milestone').textContent).toContain('Enter tickets remaining as a whole number, 0 or more.')
    expect(section(page, 'milestone').textContent).not.toContain('Saved')
    expect(field(page, MILESTONE, 'ticketsRemaining').value).toBe('-1')
    expect(section(page, 'cadence')).toBe(cadence)
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
    expect(section(page, 'milestone').textContent).toContain('Saved')
  })

  test('two quick changes are saved in the order they were made, the second once the first is answered', async () => {
    const { app, page } = await openInputs()
    const first = page.holdAnswer('/inputs/milestone')

    change(field(page, MILESTONE, 'ticketsRemaining'), '25')
    change(field(page, '/inputs/cadence#cadence', 'cadenceDays'), '14')
    await first.held
    expect(page.requests).toEqual(['POST /inputs/milestone'])
    first.release()
    await page.settled()

    expect(page.requests).toEqual(['POST /inputs/milestone', 'POST /inputs/cadence'])
    expect(app.storage.milestoneInputs(TEAM)).toMatchObject({ ticketsRemaining: 25, cadenceDays: 14 })
    expect(field(page, MILESTONE, 'ticketsRemaining').value).toBe('25')
    expect(field(page, '/inputs/cadence#cadence', 'cadenceDays').value).toBe('14')
    expect(section(page, 'pace').textContent).toContain('tickets per sprint')
  })

  test('the focus stays on the field that had it, with its selection, once the sections are swapped in', async () => {
    const { page } = await openInputs()
    const name = field(page, MILESTONE, 'name')

    name.focus()
    change(name, 'Checkout v3')
    name.setSelectionRange(2, 5)
    name.dispatchEvent(new Event('change', { bubbles: true }))
    await page.settled()

    const swapped = field(page, MILESTONE, 'name')
    expect(swapped).not.toBe(name)
    expect(page.document.activeElement).toBe(swapped)
    expect([swapped.selectionStart, swapped.selectionEnd]).toEqual([2, 5])
  })

  test('the Connect step isn’t saved as it changes, and a save elsewhere leaves what is typed in it', async () => {
    const { page } = await openInputs()

    change(field(page, '/inputs/connect#connect', 'repo'), 'shop-team/shop')
    await page.settled()
    expect(page.requests).toEqual([])

    change(field(page, MILESTONE, 'ticketsRemaining'), '25')
    await page.settled()
    expect(section(page, 'milestone').textContent).toContain('Saved')
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
    expect(page.requests).toEqual(['POST /inputs/milestone'])
  })

  test('with the Forecaster not answering, the section says it isn’t saved', async () => {
    const { app: stopped, page } = await openInputs()
    await stopped.close()
    app = undefined

    change(field(page, MILESTONE, 'ticketsRemaining'), '25')
    await page.settled()

    expect(section(page, 'milestone').textContent).toContain(NOT_SAVED)
    expect(section(page, 'milestone').textContent).not.toContain('Saved')
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

    expect(page.requests).toEqual(['POST /inputs/reading-opened'])
    expect(chip.querySelector('.dot')).toBeNull()
    expect(await inputsSection(app.running, 'milestone')).not.toContain('class="dot"')
  })

  test('a chip’s Follow switches the value back to the tracker, though nothing was typed', async () => {
    const { app, page } = await openInputs({ connected: true })

    clickSubmitting(page, '#milestone button[form="follow-tickets"]')
    await page.settled()

    expect(app.storage.milestoneInputs(TEAM)?.ticketsSource).toBe('tracker')
    expect(section(page, 'milestone').querySelector('.reading-value')?.textContent).toBe('3')
    expect(section(page, 'milestone').querySelector('details.reads-differently')).toBeNull()
  })
})
