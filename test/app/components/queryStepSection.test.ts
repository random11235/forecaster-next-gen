import { describe, expect, test } from 'vitest'
import { choiceListHtml, COMPARABLE_WORK_STEP, MILESTONE_STEP, queryStepSection } from '../../../src/app/queryStepSection.js'
import type { ChoiceList, ComparableWorkPace, QueryStep } from '../../../src/forecast/index.js'
import { accessibleName, all, allByRole, around, byRole, hasRole, hiddenFields, one, postsTo, render, text } from '../dom.js'

// A query step (#236), the Milestone step's and the Comparable work step's, rendered from a view built by hand: finding
// choices to pick, refused, flagged, and its query open for editing. What each view holds, and when, is Seam B's
// (test/forecast/queryStep.*.test.ts).

const checkout = { kind: 'milestone', name: 'Checkout v2', query: 'milestone:"Checkout v2"' } as const
const payments = { kind: 'label', name: 'payments', query: 'label:payments' } as const
const lists: ChoiceList[] = [
  { kind: 'milestone', choices: [checkout], searchedInTracker: false },
  { kind: 'label', choices: [payments], searchedInTracker: true },
]
type Step<Kind extends QueryStep['kind']> = Extract<QueryStep, { kind: Kind }>
const milestoneStep: Step<'milestoneStep'> = {
  kind: 'milestoneStep',
  queryName: 'Milestone query',
  find: '',
  lists,
  picks: [],
  query: '',
  note: 'Reads open and closed tickets.',
}
const comparableStep: Step<'comparableWorkStep'> = { ...milestoneStep, kind: 'comparableWorkStep', queryName: 'Comparable-work query' }
const milestone = (view: Partial<Step<'milestoneStep'>> = {}) => render(queryStepSection({ ...milestoneStep, ...view }, MILESTONE_STEP))
const comparable = (view: Partial<Step<'comparableWorkStep'>> = {}) => render(queryStepSection({ ...comparableStep, ...view }, COMPARABLE_WORK_STEP))
const editing = { typed: 'label:payments OR', readIn: 'shop-team/shop' }

describe('a query step, finding choices to pick', () => {
  test('nothing picked yet: the find box over each kind’s list, each choice a button that adds it', () => {
    const page = milestone()

    expect(text(page)).toContain('Milestone query Edit as a query Nothing picked yet. Reads open and closed tickets.')
    expect(byRole(page, 'searchbox', { name: 'Find a choice to pick' }).getAttribute('placeholder')).toBe('Find a milestone or label…')
    expect(allByRole(page, 'heading').map((heading) => text(heading))).toEqual(['Milestones', 'Labels'])
    expect(postsTo(byRole(page, 'button', { name: 'Checkout v2 milestone' }))).toBe('/inputs/milestone-query/add#milestone-tickets')
    expect(hasRole(page, 'list')).toBe(false)
    expect(hasRole(page, 'alert')).toBe(false)
    expect(byRole(page, 'link', { name: 'Edit as a query' }).getAttribute('href')).toBe('/inputs?edit=query#milestone-tickets')
    expect(one(page, '.found').hasAttribute('hidden')).toBe(false)
  })

  test('a kind searched in the tracker is marked for the script, and the one choice that is the milestone query is marked', () => {
    const page = comparable({ lists: [{ ...lists[0]!, thisMilestone: checkout.query }, lists[1]!] })

    expect(one(page, '[data-kind="label"]').hasAttribute('data-searched')).toBe(true)
    expect(one(page, '[data-kind="milestone"]').hasAttribute('data-searched')).toBe(false)
    byRole(page, 'button', { name: 'Checkout v2 milestone this milestone' })
    byRole(page, 'button', { name: 'payments label' })
  })

  test('picks as chips, each removable, the query they join into and its read', () => {
    const page = milestone({ picks: [checkout, payments], query: `${checkout.query} OR ${payments.query}`, read: '50 open · 43 finished in the last 8 weeks' })

    expect(allByRole(byRole(page, 'list'), 'listitem').map((chip) => text(chip))).toEqual(['Checkout v2 milestone ×', 'payments label ×'])
    expect(one(around(byRole(page, 'button', { name: 'Remove payments' }), 'form'), 'input[name="query"]').getAttribute('value')).toBe('label:payments')
    expect(text(page)).toContain('Milestone query Edit as a query milestone:"Checkout v2" OR label:payments')
    expect(text(page)).toContain('50 open · 43 finished in the last 8 weeks')
  })

  test('a read flagged: the flag beneath it, finding and editing alike', () => {
    const flagged = { picks: [checkout], query: checkout.query, read: '0 open · 0 finished in the last 8 weeks', flag: 'The query matched no tickets.' }

    expect(text(milestone(flagged))).toContain('0 open · 0 finished in the last 8 weeks ⚠ The query matched no tickets.')
    expect(text(milestone({ ...flagged, editing }))).toContain('0 open · 0 finished in the last 8 weeks ⚠ The query matched no tickets.')
  })

  test('the choices not listed, or a kind not searched: why, as alerts', () => {
    const page = milestone({ lists: [{ ...lists[1]!, choices: [], failure: 'GitHub couldn’t search labels.' }], choicesFailure: 'GitHub didn’t answer.' })

    expect(allByRole(page, 'alert').map((alert) => text(alert))).toEqual(['GitHub didn’t answer.', 'GitHub couldn’t search labels.'])
  })

  test('a change of the picks refused: why, beside the chips still in use', () => {
    const page = milestone({ picks: [checkout], query: checkout.query, refusal: 'GitHub refused the query: <bad>' })

    expect(text(byRole(page, 'alert'))).toBe('GitHub refused the query: <bad>')
    byRole(page, 'button', { name: 'Remove Checkout v2' })
  })

  test('with no choices listed, the find box asks for a choice', () => {
    expect(byRole(milestone({ lists: [] }), 'searchbox').getAttribute('placeholder')).toBe('Find a choice…')
  })
})

describe('one kind’s list, alone, as the find box’s script asks for it', () => {
  test('headed by its kind, marked searched for the script, each choice a button adding it to the step’s query', () => {
    const page = render(
      choiceListHtml({ kind: 'label', choices: [payments, { kind: 'label', name: 'search', query: 'label:search' }], searchedInTracker: true }, MILESTONE_STEP),
    )

    expect(text(byRole(page, 'heading'))).toBe('Labels')
    expect(one(page, '[data-kind="label"]').hasAttribute('data-searched')).toBe(true)
    expect(allByRole(page, 'button').map((button) => [accessibleName(button), postsTo(button)])).toEqual([
      ['payments label', '/inputs/milestone-query/add#milestone-tickets'],
      ['search label', '/inputs/milestone-query/add#milestone-tickets'],
    ])
    expect(hasRole(page, 'link')).toBe(false)
  })

  test('the Comparable work step’s: each choice also a link opening it as a candidate', () => {
    const page = render(choiceListHtml(lists[1]!, COMPARABLE_WORK_STEP))

    expect(postsTo(byRole(page, 'button', { name: 'payments label' }))).toBe('/inputs/comparable-work/add#comparable-work')
    byRole(page, 'link', { name: 'How payments runs' })
  })

  test('the kind not searched: why, as an alert, with no choices', () => {
    const page = render(
      choiceListHtml({ kind: 'milestone', choices: [], searchedInTracker: true, failure: 'GitHub couldn’t search milestones.' }, MILESTONE_STEP),
    )

    expect(text(byRole(page, 'alert'))).toBe('GitHub couldn’t search milestones.')
    expect(hasRole(page, 'button')).toBe(false)
  })
})

describe('a query step, its query open for editing', () => {
  test('the query as typed, within the connected repo, read on Enter, with Back to finding', () => {
    const page = milestone({ editing })

    const query = byRole(page, 'textbox', { name: 'Milestone query, within shop-team/shop' })
    expect(query.getAttribute('value')).toBe('label:payments OR')
    expect([query.getAttribute('name'), around(query, 'form').getAttribute('action')]).toEqual(['query', '/inputs/milestone-query/edit#milestone-tickets'])
    expect(text(page)).toContain('Press Enter to read it. Reads open and closed tickets.')
    expect(postsTo(byRole(page, 'button', { name: 'Back to finding' }))).toBe('/inputs/milestone-query/back#milestone-tickets')
    expect(hasRole(page, 'searchbox')).toBe(false)
    expect(hasRole(page, 'alert')).toBe(false)
  })

  test('refused: why, and the query still read', () => {
    const page = milestone({ query: checkout.query, editing: { ...editing, refusal: 'GitHub refused the query: unbalanced OR' } })

    expect(text(byRole(page, 'alert'))).toBe('GitHub refused the query: unbalanced OR')
    expect(text(page)).toContain('Still reading milestone:"Checkout v2"')
  })

  test('refused with no query yet: says nothing is still read', () => {
    expect(text(milestone({ editing: { ...editing, refusal: 'Empty.' } }))).not.toContain('Still reading')
  })

  test('a query the picker can’t show: says going back clears it, then asks to confirm', () => {
    const backClears = 'The picker can’t show this query, so going back to finding clears it.'

    expect(text(milestone({ editing: { ...editing, backClears } }))).toContain(`${backClears} Back to finding`)
    const confirming = milestone({ editing: { ...editing, backClears, confirmingBack: true } })
    const clear = around(byRole(confirming, 'button', { name: 'Clear the query and go back' }), 'form')
    expect(clear.getAttribute('action')).toBe('/inputs/milestone-query/back#milestone-tickets')
    expect(hiddenFields(clear)).toEqual([['confirmed', 'yes']])
    expect(byRole(confirming, 'link', { name: 'Keep editing' }).getAttribute('href')).toBe('/inputs?edit=query#milestone-tickets')
    expect(hasRole(confirming, 'button', { name: 'Back to finding' })).toBe(false)
  })
})

describe('the Comparable work step', () => {
  const pace: ComparableWorkPace = {
    periods: [
      { start: '2026-10-26', milestone: 0, comparableWork: 4, beforeStart: true },
      { start: '2026-11-02', milestone: 3, comparableWork: 6, beforeStart: false },
    ],
    picks: [{ query: payments.query, strip: [4, 6], finished: 10, onlyHere: 2 }],
    comparison: { versus: { kind: 'faster', by: 2 }, ownPeriods: 3 },
    said: { inUse: '5 a week', from: 'pace, from comparable work', comparison: '↑ 2 a week faster than the milestone’s own so far' },
  }

  test('each choice listed with a link opening it as a candidate, and the find box keeping to the step', () => {
    const page = comparable()

    expect(byRole(page, 'link', { name: 'How payments runs' }).getAttribute('href')).toBe(
      '/inputs?step=comparableWork&comparableOpen=label%3Apayments#comparable-work',
    )
    expect(one(around(byRole(page, 'searchbox'), 'form'), 'input[name="step"]').getAttribute('value')).toBe('comparableWork')
    expect(hasRole(page, 'button', { name: 'Start afresh' })).toBe(false)
  })

  test('Edit as a query opens its own query, posted to its own path', () => {
    expect(byRole(comparable(), 'link', { name: 'Edit as a query' }).getAttribute('href')).toBe('/inputs?step=comparableWork&edit=comparable#comparable-work')
    const query = byRole(comparable({ editing }), 'textbox', { name: 'Comparable-work query, within shop-team/shop' })
    expect([query.id, around(query, 'form').getAttribute('action')]).toEqual(['comparable-work-query', '/inputs/comparable-work/edit#comparable-work'])
  })

  test('with a query: Start afresh at its end', () => {
    expect(postsTo(byRole(comparable({ picks: [payments], query: payments.query }), 'button', { name: 'Start afresh' }))).toBe(
      '/inputs/comparable-work/afresh#comparable-work',
    )
  })

  test('leads with its pace, how far it is from the milestone’s own, each period paired, and each pick’s pace on its chip', () => {
    const page = comparable({ picks: [payments], query: payments.query, pace })

    expect(text(page)).toMatch(
      /^5 a week pace, from comparable work ↑ 2 a week faster than the milestone’s own so far 26 Oct 2 Nov comparable work the milestone’s own before it started/,
    )
    expect(
      allByRole(byRole(page, 'list', { name: 'Tickets finished each period, oldest first' }), 'listitem').map((period) => period.getAttribute('title')),
    ).toEqual(['26 Oct: comparable work 4, the milestone’s own 0, before it started', '2 Nov: comparable work 6, the milestone’s own 3'])
    const chip = byRole(page, 'listitem', { name: /^payments label/ })
    expect(accessibleName(byRole(chip, 'img'))).toBe('Finished each period: 4, 6')
    expect(text(chip)).toBe('payments label 10 finished, +2 only here ×')
  })

  test('its pace with no comparable work yet: asks for some; its flag beside the read when it is unused', () => {
    const own: ComparableWorkPace = {
      periods: [{ start: '2026-11-02', milestone: 3, beforeStart: false }],
      picks: [],
      flag: 'Comparable work finished nothing, so it isn’t used.',
      said: { inUse: '3 a week' },
    }
    const page = comparable({ pace: own, read: '0 finished in the last 8 weeks' })

    expect(text(page)).toContain('3 a week Add comparable work to measure pace from work like this milestone’s.')
    expect(text(page)).toContain('0 finished in the last 8 weeks ⚠ Comparable work finished nothing, so it isn’t used.')
  })

  test('no pace to lead with: nothing in its place', () => {
    expect(all(comparable({ pace: { periods: [], picks: [], said: {} } }), '.step-pace')).toEqual([])
  })
})
