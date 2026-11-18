import { afterEach, describe, expect, test, vi } from 'vitest'
import { Event, HTMLAnchorElement, HTMLInputElement } from 'happy-dom'
import type { CannedFixture } from '../../src/connectors/canned.js'
import type { Choice } from '../../src/connectors/connector.js'
import { appOnTracker, type AppOnTracker } from './appOnTracker.js'
import { openPage, type BrowserPage } from './browserPage.js'
import { post } from './forms.js'

// The Comparable work step's candidates script (#205), run in happy-dom against the local server on the canned
// connector (#275): which candidates the EM's browser asks for, and what the step shows of the answers. What each
// answer holds is tested over HTTP (candidates.test.ts); these test what the script asks, and when.

const CANDIDATES_PATH = '/inputs/comparable-work-candidates'

const checkout: Choice = { kind: 'milestone', name: 'Checkout v2', query: 'milestone:"Checkout v2"' }
const payments: Choice = { kind: 'label', name: 'payments', query: 'label:"payments"' }
const bug: Choice = { kind: 'label', name: 'bug', query: 'label:"bug"' }
const broken: Choice = { kind: 'label', name: 'broken', query: 'label:"broken"' }

/** A ticket finished on each day in `days`. */
const finishedOn = (prefix: string, days: string[]) => days.map((day, n) => ({ id: `${prefix}${n}`, finishedAt: `${day}T10:00:00Z` }))

// the milestone finishes 2 a week from 1 Oct, payments 2 in all, so slower; bug matches nothing, and broken fails
const FIXTURE: CannedFixture = {
  milestoneChoices: [
    { kind: 'milestone', choices: [checkout], pastLimit: false },
    { kind: 'label', choices: [payments, bug, broken], pastLimit: false },
  ],
  reads: {
    [checkout.query]: {
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
}

let app: AppOnTracker | undefined
let page: BrowserPage | undefined

afterEach(async () => {
  await page?.close()
  page = undefined
  await app?.close()
  app = undefined
})

/** The Comparable work step open in happy-dom, connected to GitHub with the milestone query picked. */
async function openStep(): Promise<BrowserPage> {
  app = await appOnTracker(FIXTURE)
  const { running } = app
  await post(running, '/inputs/connect', { tracker: 'github', repo: 'shop-team/shop', token: 'token' })
  await post(running, '/inputs/milestone', { name: 'Checkout v2', startDate: '2026-10-01', ticketsRemaining: '30' })
  await post(running, '/inputs/milestone-query/add', { ...checkout })
  page = await openPage(running, '/inputs?step=comparableWork')
  return page
}

/** The candidates each request the page has sent asked for, by query; any other request, by its path. */
const asked = (shown: BrowserPage): (string[] | string)[] =>
  shown.requests.map((request) => {
    const url = new URL(request.replace(/^GET /, ''), 'http://page')
    return url.pathname === CANDIDATES_PATH ? url.searchParams.getAll('query') : request
  })

/** Clicks the link opening `choice` as a candidate, beside it in the step's lists. */
function openLink(shown: BrowserPage, choice: Choice): void {
  shown.find(`#comparable-work .found form[data-name="${choice.name}"] a.open`, HTMLAnchorElement).click()
}

/** Types `text` into the step's find box, one key at a time, as the browser fires each. */
function type(shown: BrowserPage, text: string): void {
  const find = shown.find('#comparable-work input[name=comparableFind]', HTMLInputElement)
  for (const at of text.split('').keys()) {
    find.value = text.slice(0, at + 1)
    find.dispatchEvent(new Event('input', { bubbles: true }))
  }
}

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

  test('typing that narrows the lists to a few opens those, once the typing has paused', async () => {
    const page = await openStep()

    // "b" narrows to bug and broken; "bu" to bug alone
    type(page, 'bu')
    // a moment after the typing, before the pause it waits for
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(asked(page)).toEqual([])
    await page.settled()

    expect(asked(page)).toEqual([[bug.query]])
    expect(candidates(page)).toContain('Nothing finished')
    expect(candidates(page)).not.toContain('Couldn’t be read')
  })

  test('an answer arriving after a newer one is ignored', async () => {
    const page = await openStep()
    const first = page.holdAnswer(CANDIDATES_PATH)

    openLink(page, payments)
    await first.held
    openLink(page, bug)
    await vi.waitFor(() => expect(candidates(page)).toContain('Nothing finished'))
    first.release()
    await page.settled()

    expect(asked(page)).toEqual([[payments.query], [payments.query, bug.query]])
    expect(candidates(page)).toContain('Nothing finished')
    expect(candidates(page)).toContain('Slower than the milestone')
  })
})
