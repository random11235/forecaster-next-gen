import { describe, expect, test } from 'vitest'
import { Event, HTMLAnchorElement, HTMLInputElement } from 'happy-dom'
import type { CannedFixture } from '../../src/connectors/canned.js'
import type { Choice } from '../../src/connectors/connector.js'
import { CHECKOUT } from '../trackerScenario.js'
import { connectAndPick } from './appOnTracker.js'
import { pagesOnTracker, type BrowserPage } from './browserPage.js'
import { post } from './forms.js'

// The Comparable work step's candidates script (#205), run in happy-dom against the local server on the canned
// connector (#275): which candidates the EM's browser asks for, and what the step shows of the answers. What each
// answer holds is tested over HTTP (candidates.test.ts); these test what the script asks, and when.

const CANDIDATES_PATH = '/inputs/comparable-work-candidates'

const label = (name: string): Choice => ({ kind: 'label', name, query: `label:"${name}"` })
const payments = label('payments')
const bug = label('bug')
const broken = label('broken')
// with bug and broken, six labels with a "b", five of them with "bu": more than a few (FEW_CANDIDATES, 5), then a few
const MORE_BU = ['build', 'bulk', 'buffer', 'bundle'].map(label)

/** A ticket finished on each day in `days`. */
const finishedOn = (prefix: string, days: string[]) => days.map((day, n) => ({ id: `${prefix}${n}`, finishedAt: `${day}T10:00:00Z` }))

/**
 * The milestone finishes 2 a week from 1 Oct, payments 2 in all, so slower; the labels listed with them, `labels`,
 * match nothing, but broken, whose read fails.
 */
const fixture = (labels: readonly Choice[]): CannedFixture => ({
  milestoneChoices: [
    { kind: 'milestone', choices: [CHECKOUT], pastLimit: false },
    { kind: 'label', choices: [payments, bug, broken, ...labels], pastLimit: false },
  ],
  reads: {
    [CHECKOUT.query]: {
      tickets: [
        { id: 'm-open' },
        ...finishedOn(
          'm',
          ['10-02', '10-03', '10-09', '10-10', '10-16', '10-17', '10-23', '10-24', '10-30', '10-31', '11-06', '11-07'].map((day) => `2026-${day}`),
        ),
      ],
      incomplete: false,
    },
    [payments.query]: { tickets: [{ id: 'p-open' }, ...finishedOn('p', ['2026-10-02', '2026-10-30'])], incomplete: false },
    [broken.query]: { failure: 'unavailable' },
  },
})

const pages = pagesOnTracker()

/** The Comparable work step open in happy-dom, connected to GitHub with the milestone query picked, its lists holding `labels` too. */
const openStep = async (labels: readonly Choice[] = []): Promise<BrowserPage> =>
  (
    await pages.open(fixture(labels), '/inputs?step=comparableWork', async (running) => {
      await post(running, '/inputs/milestone', { name: 'Checkout v2', startDate: '2026-10-01', ticketsRemaining: '30' })
      await connectAndPick(running)
    })
  ).page

/** The candidates each request the page has sent asked for, by query; any other request, by its path. */
const asked = (shown: BrowserPage): (string[] | string)[] =>
  shown.requests.map(({ url }) => (url.pathname === CANDIDATES_PATH ? url.searchParams.getAll('query') : url.pathname))

/** Clicks the link opening `choice` as a candidate, beside it in the step's lists. */
function openLink(shown: BrowserPage, choice: Choice): void {
  shown.find(`#comparable-work .found form[data-name="${choice.name}"] a.open`, HTMLAnchorElement).click()
}

/** The step's find box. */
const findBox = (shown: BrowserPage): HTMLInputElement => shown.find('#comparable-work input[name=comparableFind]', HTMLInputElement)

/** Sets the find box to `text`, firing its input, as the browser does on each key. */
function setFind(shown: BrowserPage, text: string): void {
  const find = findBox(shown)
  find.value = text
  find.dispatchEvent(new Event('input', { bubbles: true }))
}

/** Types `text` on into the step's find box, one key at a time, as the browser fires each. */
function typeInFind(shown: BrowserPage, text: string): void {
  const before = findBox(shown).value
  for (const at of text.split('').keys()) setFind(shown, before + text.slice(0, at + 1))
}

/** Waits `ms` on the clock the page's timers run on. */
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** What the step's candidates block says now. */
const candidates = (shown: BrowserPage): string => shown.document.querySelector('#comparable-work .candidates')?.textContent ?? ''

describe('the candidates script', () => {
  test('a candidate’s link opens it in place, asking for it once', async () => {
    const page = await openStep()
    expect(candidates(page)).not.toContain('Slower than the milestone')

    openLink(page, payments)
    await page.settled()
    openLink(page, payments)
    await page.settled()

    expect(asked(page)).toEqual([[payments.query]])
    expect(candidates(page)).toContain('Slower than the milestone')
    expect(candidates(page)).toContain('payments')
  })

  test('typing that narrows the lists to a few, five or fewer, opens those once the typing has paused; to more, none', async () => {
    const page = await openStep(MORE_BU)

    // "b" narrows the labels to six
    typeInFind(page, 'b')
    await page.settled()
    expect(asked(page)).toEqual([])

    // "bu" to five
    typeInFind(page, 'u')
    // a moment after the typing, before the pause it waits for
    await wait(0)
    expect(asked(page)).toEqual([])
    await page.settled()

    expect(asked(page)).toEqual([[bug, ...MORE_BU].map(({ query }) => query)])
    expect(candidates(page)).toContain('Nothing finished')
    expect(candidates(page)).not.toContain('Couldn’t be read')
  })

  test('typing that goes on opens nothing until it pauses, however long it goes on', async () => {
    const page = await openStep()

    // the pause it waits for is 450ms: each key comes sooner, though the second comes later than that after the first
    typeInFind(page, 'b')
    await wait(300)
    typeInFind(page, 'u')
    await wait(300)
    expect(asked(page)).toEqual([])
    await page.settled()

    expect(asked(page)).toEqual([[bug.query]])
  })

  test('a find box emptied opens nothing, though every choice is listed again and they are few', async () => {
    const page = await openStep()

    typeInFind(page, 'bu')
    setFind(page, '')
    await page.settled()

    expect(asked(page)).toEqual([])
  })

  test('an answer arriving after a newer one is ignored', async () => {
    const page = await openStep()
    const first = page.holdAnswer(CANDIDATES_PATH)

    openLink(page, payments)
    await first.held
    openLink(page, bug)
    await page.until(() => candidates(page).includes('Nothing finished'))
    first.release()
    await page.settled()

    expect(asked(page)).toEqual([[payments.query], [payments.query, bug.query]])
    expect(candidates(page)).toContain('Nothing finished')
    expect(candidates(page)).toContain('Slower than the milestone')
  })
})
