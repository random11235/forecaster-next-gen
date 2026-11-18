import { describe, expect, test } from 'vitest'
import { HTMLAnchorElement, HTMLInputElement } from 'happy-dom'
import type { CannedFixture } from '../../src/connectors/canned.js'
import type { Choice } from '../../src/connectors/connector.js'
import { FEW_CANDIDATES, NARROWED_DEBOUNCE_MS } from '../../src/forecast/candidates.js'
import { CHECKOUT, finishedOn, label } from '../trackerScenario.js'
import { connectAndPick } from './appOnTracker.js'
import { typed, type BrowserPage } from './browserPage.js'
import { pagesOnTracker } from './pagesOnTracker.js'
import { post } from './forms.js'

// The Comparable work step's candidates script (#205), run in happy-dom against the local server on the canned
// connector (#275): which candidates the EM's browser asks for, and what the step shows of the answers. What each
// answer holds is tested over HTTP (candidates.test.ts); these test what the script asks, and when.

const CANDIDATES_PATH = '/inputs/comparable-work-candidates'

const payments = label('payments')
const bug = label('bug')
const broken = label('broken')
// with bug and broken, more than a few labels with a "b"; with bug, a few with "bu"
const MORE_BU = Array.from({ length: FEW_CANDIDATES - 1 }, (_, n) => label(`bulk ${n}`))

/** A ticket finished on each day in `days`. */
const finishedEachOf = (prefix: string, days: readonly string[]) => days.flatMap((day) => finishedOn(prefix, day, 1))

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
        ...finishedEachOf(
          'm',
          ['10-02', '10-03', '10-09', '10-10', '10-16', '10-17', '10-23', '10-24', '10-30', '10-31', '11-06', '11-07'].map((day) => `2026-${day}`),
        ),
      ],
      incomplete: false,
    },
    [payments.query]: { tickets: [{ id: 'p-open' }, ...finishedEachOf('p', ['2026-10-02', '2026-10-30'])], incomplete: false },
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
const setFind = (shown: BrowserPage, text: string): void => typed(findBox(shown), text)

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

  test(`typing that narrows the lists to a few, ${FEW_CANDIDATES} or fewer, opens those once the typing has paused; to more, none`, async () => {
    const page = await openStep(MORE_BU)

    // "b" narrows the labels to more than a few
    typeInFind(page, 'b')
    await page.settled()
    expect(asked(page)).toEqual([])

    // "bu" to a few
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

    // each key comes sooner than the pause it waits for, though the second comes later than that after the first
    const sooner = (NARROWED_DEBOUNCE_MS * 2) / 3
    typeInFind(page, 'b')
    await wait(sooner)
    typeInFind(page, 'u')
    await wait(sooner)
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
    await page.until('the newer answer', () => candidates(page).includes('Nothing finished'))
    first.release()
    await page.settled()

    expect(asked(page)).toEqual([[payments.query], [payments.query, bug.query]])
    expect(candidates(page)).toContain('Nothing finished')
    expect(candidates(page)).toContain('Slower than the milestone')
  })
})
