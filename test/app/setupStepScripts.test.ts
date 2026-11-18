import { describe, expect, test } from 'vitest'
import { Event, HTMLElement, HTMLInputElement, type Element } from 'happy-dom'
import type { CannedFixture } from '../../src/connectors/canned.js'
import type { Choice } from '../../src/connectors/connector.js'
import { CHECKOUT, finishedOn, label, open } from '../trackerScenario.js'
import { connectAndPick, GITHUB_SHOP } from './appOnTracker.js'
import { posted, typed, type BrowserPage } from './browserPage.js'
import { pagesOnTracker } from './pagesOnTracker.js'
import { post } from './forms.js'

// The setup steps' own scripts, run in happy-dom against the local server on the canned connector (#275): the
// Milestone step's find box (`queryStepScript`, #191, #198), and Check's sources (`CHECK_SCRIPT`, #220). What each
// answers is tested over HTTP (milestoneStep.test.ts, check.test.ts); these test what the scripts do in the browser.

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
    (await pages.open(FIXTURE, '/inputs', (running) => post(running, '/inputs/connect', GITHUB_SHOP).then(() => {}))).page

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
})

describe('the Check step’s sources', () => {
  // happy-dom posts a submitted form as multipart, where a browser sends it urlencoded, so the server finds no source in
  // it: what a choice posted saves is check.test.ts's, over HTTP. This tests that choosing one posts its form.
  test('a source chosen posts its form at once, with no Choose to press', async () => {
    const { page } = await pages.open(FIXTURE, '/inputs?step=check', async (running) => {
      await post(running, '/inputs/milestone', { name: 'Checkout v2', startDate: '2026-09-01', ticketsRemaining: '30' })
      await post(running, '/inputs/pace', { low: '4', high: '8' })
      await connectAndPick(running)
    })
    expect(page.find('#check', HTMLElement).classList.contains('chooses-as-changed')).toBe(true)
    const tracker = page.find('#check form.source input[name=source][value=tracker]', HTMLInputElement)

    tracker.checked = true
    tracker.dispatchEvent(new Event('change', { bubbles: true }))
    await page.settled()

    expect(posted(page)).toEqual(['/inputs/setup/source'])
  })
})
