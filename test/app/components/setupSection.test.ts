import { describe, expect, test } from 'vitest'
import { checkStepHtml, setupSkippedHtml, setupStepHtml, setupSummaryHtml } from '../../../src/app/setupSection.js'
import type { PaceCheck, SetupCheck, SetupSteps, SetupSummary } from '../../../src/forecast/index.js'
import { allByRole, byRole, hasRole, postsTo, radios, render, text } from '../dom.js'

// Setup on the Inputs screen (#236), rendered from views built by hand: its steps' list and navigation, Check's rows
// with each source, its summary once done with its flags, and connecting skipped. Which step is shown, what Check
// reads and what the summary says are Seam B's (test/forecast/setup.*.test.ts).

const steps = (view: Partial<SetupSteps>): SetupSteps => ({
  kind: 'steps',
  step: 'milestone',
  steps: [
    { step: 'connect', mark: 'done' },
    { step: 'milestone', mark: 'current' },
    { step: 'comparableWork', mark: 'ahead' },
    { step: 'check', mark: 'ahead' },
  ],
  ...view,
})
const stepPage = (view: Partial<SetupSteps>) => render(setupStepHtml(steps(view), '<p>The step itself</p>'))

describe('the setup steps', () => {
  test('the steps listed, each done one a link back to it and the current one marked, around the step', () => {
    const page = stepPage({ back: 'connect' })

    const list = byRole(page, 'list', { name: 'Setup steps' })
    expect(allByRole(list, 'listitem').map((step) => [text(step), step.getAttribute('aria-current')])).toEqual([
      ['Connect', null],
      ['Milestone', 'step'],
      ['Comparable work', null],
      ['Check', null],
    ])
    expect(byRole(list, 'link', { name: 'Connect' }).getAttribute('href')).toBe('/inputs?step=connect#connect')
    expect(text(page)).toBe('Connect Milestone Comparable work Check The step itself Cancel Back')
  })

  test('Cancel, Back, and Next where the step can be left forward', () => {
    const page = stepPage({ back: 'connect', next: { step: 'comparableWork', label: 'next' } })

    expect(postsTo(byRole(page, 'button', { name: 'Cancel' }))).toBe('/inputs/setup/cancel')
    expect(byRole(page, 'link', { name: 'Back' }).getAttribute('href')).toBe('/inputs?step=connect#connect')
    expect(byRole(page, 'link', { name: 'Next' }).getAttribute('href')).toBe('/inputs?step=comparableWork#comparable-work')
  })

  test('Comparable work with no query yet: Skip in place of Next, and Back to the Milestone step, at the screen’s own URL', () => {
    const page = stepPage({ step: 'comparableWork', back: 'milestone', next: { step: 'check', label: 'skip' } })

    expect(byRole(page, 'link', { name: 'Skip' }).getAttribute('href')).toBe('/inputs?step=check#check')
    expect(byRole(page, 'link', { name: 'Back' }).getAttribute('href')).toBe('/inputs#milestone-tickets')
  })

  test('on Connect: no Back; once the connection changed in the steps, why they can’t be cancelled in place of Cancel', () => {
    const page = stepPage({ step: 'connect', noCancel: 'The connection changed in these steps, so they can’t be cancelled.' })

    expect(hasRole(page, 'link', { name: 'Back' })).toBe(false)
    expect(hasRole(page, 'button', { name: 'Cancel' })).toBe(false)
    expect(text(page)).toContain('The connection changed in these steps, so they can’t be cancelled.')
  })
})

describe('the Check step', () => {
  const pace: PaceCheck = {
    yours: { source: 'range', range: { low: 2, high: 4 } },
    period: 'week',
    reading: {
      periods: [],
      counts: [4, 6, 5],
      line: 'last 3 weeks · read 12 Nov 09:00',
      firstFinished: undefined,
      current: 'This week, from 9 Nov, counts once it ends: 2 finished so far.',
      skipped: undefined,
    },
    incomplete: false,
    noStartDate: false,
    source: 'tracker',
    choices: ['tracker', 'range'],
  }
  const { reading: _, ...unread } = pace
  const check: SetupCheck = { tracker: 'GitHub', ticketsRemaining: { yours: 30, reading: 42, incomplete: false, source: 'tracker' }, pace }
  const rows = (view: SetupCheck) => allByRole(render(checkStepHtml(view)), 'row').map((row) => text(row))
  const chosen = (view: SetupCheck, group: string) => radios(byRole(render(checkStepHtml(view)), 'group', { name: group }))

  test('before its rows are read: only Use these, and that nothing changes until then', () => {
    const page = render(checkStepHtml(undefined))

    expect(hasRole(page, 'table')).toBe(false)
    expect(text(page)).toBe('Nothing picked here changes the inputs below or the forecast until you use these. Use these')
    expect(postsTo(byRole(page, 'button', { name: 'Use these' }))).toBe('/inputs/setup/use-these')
  })

  test('a row for each value: yours now, the tracker’s, and which to use, the tracker chosen', () => {
    expect(rows(check)).toEqual([
      'Yours now From GitHub Use',
      'Tickets remaining 30 42 GitHub Typed Choose',
      'Pace 2–4 a week 4, 6, 5 last 3 weeks · read 12 Nov 09:00 GitHub Range Choose',
    ])
    expect(chosen(check, 'Where tickets remaining comes from')).toEqual([
      ['GitHub', true],
      ['Typed', false],
    ])
    expect(chosen(check, 'Pace the forecast uses')).toEqual([
      ['GitHub', true],
      ['Range', false],
    ])
  })

  test('your own chosen: typed tickets, typed counts', () => {
    const own: SetupCheck = {
      ...check,
      ticketsRemaining: { ...check.ticketsRemaining, source: 'typed' },
      pace: { ...pace, yours: { source: 'counts', counts: [3, 5] }, source: 'counts', choices: ['tracker', 'range', 'counts'] },
    }

    expect(rows(own)[2]).toBe('Pace 3, 5 4, 6, 5 last 3 weeks · read 12 Nov 09:00 GitHub Range Typed counts Choose')
    expect(chosen(own, 'Where tickets remaining comes from')).toEqual([
      ['GitHub', false],
      ['Typed', true],
    ])
    expect(chosen(own, 'Pace the forecast uses').find(([, checked]) => checked)?.[0]).toBe('Typed counts')
  })

  test('nothing yours yet, nothing read yet, and no typed counts', () => {
    const nothing: SetupCheck = {
      ...check,
      ticketsRemaining: { yours: undefined, reading: undefined, incomplete: false, source: 'typed' },
      pace: { ...unread, yours: { source: 'range', range: undefined }, source: 'range' },
    }

    expect(rows(nothing).slice(1)).toEqual(['Tickets remaining — — GitHub Typed Choose', 'Pace — — GitHub Range Choose'])
    expect(rows({ ...nothing, pace: { ...nothing.pace, yours: { source: 'counts', counts: [] } } })[2]).toMatch(/^Pace — —/)
  })

  test('a read the tracker gave only part of: marked on each row', () => {
    const partial: SetupCheck = {
      ...check,
      ticketsRemaining: { ...check.ticketsRemaining, incomplete: true },
      pace: { ...unread, incomplete: true },
    }

    expect(rows(partial).slice(1)).toEqual([
      'Tickets remaining 30 42 GitHub gave only part of what the query matches GitHub Typed Choose',
      'Pace 2–4 a week None: GitHub gave only part of what the query matches GitHub Range Choose',
    ])
  })

  test('no start date yet: says pace counts from it', () => {
    expect(rows({ ...check, pace: { ...unread, noStartDate: true } })[2]).toBe(
      'Pace 2–4 a week None yet: pace counts GitHub’s weeks from the milestone’s start date, entered below. GitHub Range Choose',
    )
  })
})

describe('setup’s summary', () => {
  const summary: SetupSummary = {
    kind: 'summary',
    tracker: 'GitHub',
    where: 'shop-team/shop',
    readOn: '12 Nov 09:00',
    milestone: {
      picks: [
        { name: 'Checkout v2', kind: 'epic', count: 32 },
        { name: 'payments', kind: 'label' },
      ],
    },
    note: 'Leaf tickets only. Epics include their sub-epics.',
    flags: [],
  }
  const { readOn: _, ...neverRead } = summary
  const box = (view: SetupSummary) => render(setupSummaryHtml(view))

  test('done: the tracker, where it reads, when, Read again and Change, a row for the milestone’s picks with their counts', () => {
    const page = box(summary)

    expect(text(page)).toBe(
      'GitHub · shop-team/shop read 12 Nov 09:00 Read again Change Milestone Checkout v2 (epic) · 32, payments (label) Leaf tickets only. Epics include their sub-epics.',
    )
    expect(postsTo(byRole(page, 'button', { name: 'Read again' }))).toBe('/inputs/setup/read-again')
    expect(postsTo(byRole(page, 'button', { name: 'Change' }))).toBe('/inputs/setup/change')
  })

  test('a query written by hand, comparable work, counts waiting for Check, never read', () => {
    const page = box({
      ...neverRead,
      milestone: { query: 'label:payments -label:wontfix' },
      comparable: { picks: [{ name: 'Search', kind: 'milestone' }] },
      countsWait: 'Each pick’s count waits for Check.',
    })

    expect(text(page)).toBe(
      'GitHub · shop-team/shop Read again Change Milestone label:payments -label:wontfix Comparable Search (milestone) Each pick’s count waits for Check. Leaf tickets only. Epics include their sub-epics.',
    )
  })

  test('problem flags beneath: of a query, of the reads as a whole, and a refused token’s with Change opening Connect', () => {
    const page = box({
      ...summary,
      flags: [
        { of: 'Milestone query', flag: 'This query matches nothing.' },
        { flag: 'GitHub didn’t answer.' },
        { flag: 'GitHub refused the token.', change: 'connect' },
      ],
    })

    expect(text(page)).toContain(
      'Leaf tickets only. Epics include their sub-epics. ⚠ Milestone query: This query matches nothing. ⚠ GitHub didn’t answer. ⚠ GitHub refused the token. Change',
    )
    expect(allByRole(page, 'button', { name: 'Change' }).map((button) => postsTo(button))).toEqual(['/inputs/setup/change', '/inputs/setup/change-connection'])
  })

  test('connecting skipped: says no tracker is connected, with a way to connect one', () => {
    const page = render(setupSkippedHtml())

    expect(text(page)).toBe('No tracker connected. Connect a tracker')
    expect(postsTo(byRole(page, 'button', { name: 'Connect a tracker' }))).toBe('/inputs/setup/change')
  })
})
