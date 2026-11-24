import { describe, expect, test } from 'vitest'
import { HTMLElement, HTMLInputElement, type Element } from 'happy-dom'
import type { CannedFixture } from '../../src/connectors/canned.js'
import type { Choice } from '../../src/connectors/connector.js'
import { CHECKOUT, finishedOn, label, open } from '../trackerScenario.js'
import { connectAndPick, GITHUB_SHOP } from './appInProcess.js'
import { CANT_BE_REACHED, posted, type BrowserPage } from './browserPage.js'
import { changed, typed } from './fieldEvents.js'
import { pagesOnTracker, type OpenedPage } from './pagesOnTracker.js'

// The setup steps' own scripts, run in happy-dom against the app's routes in-process on the canned connector (#275,
// #237): the Milestone step's find box (`queryStepScript`, #191, #198), and Check's sources (`CHECK_SCRIPT`, #220).
// What each answers is tested over HTTP (milestoneStep.test.ts, check.test.ts); these test what the scripts do in the
// browser.

const STEP = '#milestone-tickets'

const payments: Choice = { kind: 'milestone', name: 'Payments v2', query: 'milestone:"Payments v2"' }
const epic = (n: number, name = `Epic ${n}`): Choice => ({ kind: 'epic', name, query: `parent-issue:shop-team/shop#${n}` })
const listedEpics = Array.from({ length: 100 }, (_, at) => epic(at + 1))

// the milestones and labels listed whole, so filtered as typed; the epics past the 100 listed, so searched in the tracker
const FIXTURE: CannedFixture = {
  milestoneChoices: [
    { kind: 'epic', choices: listedEpics, pastLimit: true },
    { kind: 'milestone', choices: [payments, CHECKOUT], pastLimit: false },
    { kind: 'label', choices: [label('payments'), label('bug')], pastLimit: false },
  ],
  searchable: { epic: [...listedEpics, epic(140, 'Card payments'), epic(141, 'Payouts')] },
  reads: { [CHECKOUT.query]: { tickets: [...open(7), ...finishedOn('f', '2026-11-03', 6)], incomplete: false } },
}

const pages = pagesOnTracker()

/** Sets the step's find box to `text`, firing its input, as the browser does on each key. */
const setFind = (shown: BrowserPage, text: string): void => typed(shown.find(`${STEP} input[name=find]`, HTMLInputElement), text)

/** Whether `element` is displayed, by the page's styles: an element the script hides, they must not show. */
const displayed = (shown: BrowserPage, element: Element): boolean => shown.window.getComputedStyle(element).display !== 'none'

/** The names of the choices the step's `kind` list shows now; none while the list isn't shown. */
function shownIn(shown: BrowserPage, kind: Choice['kind']): string[] {
  const list = shown.find(`${STEP} .kind-list[data-kind="${kind}"]`, HTMLElement)
  if (!displayed(shown, list)) return []
  return [...list.querySelectorAll('form[data-name]')]
    .filter((choice) => displayed(shown, choice))
    .map((choice) => choice.querySelector(`input[name=name]`)?.getAttribute('value') ?? '')
}

/** Whether the step says nothing matches. */
const noneFound = (shown: BrowserPage): boolean => displayed(shown, shown.find(`${STEP} .none-found`, HTMLElement))

describe('the Milestone step’s find box', () => {
  const openStep = async (): Promise<BrowserPage> =>
    (await pages.open(FIXTURE, '/inputs', (app) => app.post('/inputs/connect', GITHUB_SHOP).then(() => {}))).page

  test('narrows the lists as the EM types, to the choices whose names hold what is typed, ignoring case', async () => {
    const page = await openStep()
    expect(shownIn(page, 'milestone')).toEqual(['Payments v2', 'Checkout v2'])

    setFind(page, 'MENT')
    expect(shownIn(page, 'milestone')).toEqual(['Payments v2'])
    expect(shownIn(page, 'label')).toEqual(['payments'])

    setFind(page, 'bu')
    expect(shownIn(page, 'milestone')).toEqual([])
    expect(shownIn(page, 'label')).toEqual(['bug'])
    expect(noneFound(page)).toBe(false)

    setFind(page, 'zz')
    expect(shownIn(page, 'label')).toEqual([])
    expect(noneFound(page)).toBe(false)
    await page.settled()
    expect(shownIn(page, 'epic')).toEqual([])
    expect(noneFound(page)).toBe(true)

    setFind(page, '')
    expect(shownIn(page, 'milestone')).toEqual(['Payments v2', 'Checkout v2'])
    expect(noneFound(page)).toBe(false)
  })

  test('asks the tracker for a kind it searches, once the typing pauses, and lists what it finds as found', async () => {
    const page = await openStep()

    // "pay card" starts words of Card payments, as the tracker searches, though the name doesn't hold it
    setFind(page, 'pay')
    setFind(page, 'pay card')
    expect(page.requests).toEqual([])
    await page.settled()

    expect(page.requests.map(({ url }) => `${url.pathname}${url.search}`)).toEqual(['/inputs/milestone-choices?kind=epic&find=pay%20card'])
    expect(shownIn(page, 'epic')).toEqual(['Card payments'])
    expect(shownIn(page, 'milestone')).toEqual([])
  })

  test('an answer to a search older than the latest is dropped', async () => {
    const page = await openStep()
    const first = page.holdAnswer('/inputs/milestone-choices')

    setFind(page, 'card')
    await first.held
    setFind(page, 'payouts')
    await page.until('the newer search’s answer', () => shownIn(page, 'epic').includes('Payouts'))
    first.release()
    await page.settled()

    expect(shownIn(page, 'epic')).toEqual(['Payouts'])
  })

  test('with the Forecaster not answering, a search leaves the kind’s list as it was', async () => {
    const page = await openStep()
    expect(shownIn(page, 'epic')).toHaveLength(100)
    pages.stopApp()

    setFind(page, 'card')
    await page.settled()

    expect(page.requests).toHaveLength(1)
    expect(shownIn(page, 'epic')).toHaveLength(100)
  })
})

describe('the Check step’s sources', () => {
  /** Check open on the Inputs screen, its milestone and pace entered, connected to GitHub, Checkout v2 picked. */
  const openCheck = (): Promise<OpenedPage> =>
    pages.open(FIXTURE, '/inputs?step=check', async (app) => {
      await app.post('/inputs/milestone', { name: 'Checkout v2', startDate: '2026-09-01', ticketsRemaining: '30' })
      await app.post('/inputs/pace', { low: '4', high: '8' })
      await connectAndPick(app)
    })

  /** The radio on `page` choosing `source` for tickets remaining. */
  const sourceRadio = (page: BrowserPage, source: string): HTMLInputElement =>
    page.find(`#check form.source input[name=source][value=${source}]`, HTMLInputElement)

  /** Chooses `radio`, a source for tickets remaining, as the EM picks it. */
  function choose(radio: HTMLInputElement): HTMLInputElement {
    radio.checked = true
    changed(radio)
    return radio
  }

  // happy-dom posts a submitted form as multipart, where a browser sends it urlencoded; the page reads either for the
  // routes, as the form's fields are the same
  test('a source chosen posts its form at once, with no Choose to press, and Check opens again showing it chosen', async () => {
    const { app, page } = await openCheck()
    expect(page.find('#check', HTMLElement).classList.contains('chooses-as-changed')).toBe(true)

    const tracker = choose(sourceRadio(page, 'tracker'))
    await page.settled()

    expect(posted(page)).toEqual(['/inputs/setup/source'])
    expect(page.requests[0]?.form?.toString()).toBe('value=ticketsRemaining&source=tracker')
    expect(app.storage.setupDraft('team')?.sources).toEqual({ ticketsRemaining: 'tracker' })
    expect(`${page.window.location.pathname}${page.window.location.search}`).toBe('/inputs?step=check')
    const shown = page.find('#check form.source input[name=source][value=tracker]', HTMLInputElement)
    expect(shown).not.toBe(tracker)
    expect(shown.checked).toBe(true)
  })

  // the script submits the form, as a browser does, so what the page shows of a refused or failed answer is the
  // browser's own: the page the routes answer with, or the browser's saying it couldn't reach the Forecaster
  test('a source the routes refuse, as from a form changed by hand, opens the routes’ not found in place of Check, saving nothing', async () => {
    const { app, page } = await openCheck()
    const changedByHand = sourceRadio(page, 'tracker')
    changedByHand.value = 'range'

    choose(changedByHand)
    await page.settled()

    expect(posted(page)).toEqual(['/inputs/setup/source'])
    expect(page.requests[0]?.form?.get('source')).toBe('range')
    expect(page.requests[0]?.reply).toEqual({ kind: 'notFound' })
    expect(page.window.location.pathname).toBe('/inputs/setup/source')
    expect(page.document.querySelector('#check')).toBeNull()
    expect(app.storage.setupDraft('team')?.sources).toBeUndefined()
  })

  test('with the Forecaster not answering, a source chosen opens the browser’s own page saying so, saving nothing', async () => {
    const { app, page } = await openCheck()
    pages.stopApp()

    choose(sourceRadio(page, 'tracker'))
    await page.settled()

    expect(posted(page)).toEqual(['/inputs/setup/source'])
    expect(page.requests[0]?.reply).toBeUndefined()
    // the browser's own page, which browserPage.ts stands in for: the app answered nothing
    expect(page.document.title).toBe(CANT_BE_REACHED)
    expect(app.storage.setupDraft('team')?.sources).toBeUndefined()
  })
})
