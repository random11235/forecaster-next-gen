import { afterEach, describe, expect, test } from 'vitest'
import { editInputs, inputsView } from '../../src/forecast/inputs.js'
import { milestoneForecastView } from '../../src/forecast/milestoneForecastView.js'
import { DEFAULT_SETTINGS, type ForecastSettings } from '../../src/forecast/settings.js'
import type { Facts, WorkItem } from '../../src/model/workItem.js'
import { openSqliteStorage } from '../../src/storage/sqliteStorage.js'
import type { Storage } from '../../src/storage/storage.js'

const TEAM = 'ACME'
const MILESTONE = 'ACME-M'
/** A Saturday: weeks run Saturday to Friday, ending as today starts. */
const TODAY = '2026-10-24'
const CREATED = '2026-03-01T09:00:00Z'
/** Long before any week the tests count, unless a test says otherwise. */
const INSTALLED = '2026-04-01T09:00:00Z'

let storage: Storage | undefined

afterEach(() => {
  storage?.close()
  storage = undefined
})

/** A Jira team installed at `installedAt`, whose milestone holds epic E1 with `doneAt` done children and 50 open. */
function teamWithMilestone(doneAt: string[], { installedAt = INSTALLED, extra = [] as WorkItem[] } = {}): Storage {
  storage = openSqliteStorage(':memory:')
  storage.saveTeam({ id: TEAM, name: TEAM, source: 'jira', sourceRef: TEAM, installedAt })
  const workItems: WorkItem[] = [ticket('E1', 'epic', { title: 'Epic E1' })]
  for (let i = 0; i < 50; i++) workItems.push(ticket(`E1-open-${i}`, 'story', { parentId: 'E1' }))
  doneAt.forEach((at, i) => workItems.push(ticket(`E1-done-${i}`, 'story', { parentId: 'E1', startedAt: CREATED, doneAt: at })))
  const facts: Facts = { workItems: [...workItems, ...extra], events: [] }
  storage.addFacts(TEAM, facts)
  storage.saveMilestone({ id: MILESTONE, teamId: TEAM, name: 'Launch', committedDate: '2026-12-18', epicIds: ['E1'] })
  return storage
}

function ticket(id: string, type: string, fields: Partial<WorkItem> = {}): WorkItem {
  return { id, teamId: TEAM, sourceKey: id, type, labels: [], createdAt: CREATED, lastSyncedAt: CREATED, ...fields }
}

/** Done times for `counts[i]` tickets in each week up to today, oldest week first, mid-week. */
function doneInWeeks(counts: number[]): string[] {
  const todayStart = Date.parse(`${TODAY}T00:00:00Z`)
  return counts.flatMap((count, i) => {
    const weeksBack = counts.length - 1 - i
    const midWeek = new Date(todayStart - (weeksBack * 7 + 3) * 86_400_000).toISOString()
    return Array<string>(count).fill(midWeek)
  })
}

function enterManualPace(storage: Storage, low: string, high: string): void {
  expect(editInputs(storage, TEAM, { kind: 'setPace', low, high }, DEFAULT_SETTINGS, TODAY)).toEqual({ ok: true })
}

function forecastOf(storage: Storage, settings: ForecastSettings = DEFAULT_SETTINGS) {
  const view = milestoneForecastView(storage, TEAM, { today: TODAY, settings })
  if (view.kind !== 'milestone') throw new Error('expected a milestone')
  return view.forecast
}

function paceOf(storage: Storage, settings: ForecastSettings = DEFAULT_SETTINGS) {
  return inputsView(storage, TEAM, settings, TODAY).pace
}

describe('pace below 8 weeks of finished tickets', () => {
  test('the manual range is used, and the forecast says how many weeks there are and how many measured pace needs', () => {
    const storage = teamWithMilestone(doneInWeeks([1, 2, 1, 3]))
    enterManualPace(storage, '2', '4')

    expect(forecastOf(storage)).toMatchObject({
      kind: 'forecast',
      pace: { source: 'manual', low: 2, high: 4, scope: 'milestoneEpics' },
      notes: ['Only 4 weeks of finished tickets. Measured pace needs 8.'],
    })
  })

  test('with no finished tickets yet, says so', () => {
    const storage = teamWithMilestone([])
    enterManualPace(storage, '2', '4')

    expect(forecastOf(storage)).toMatchObject({ notes: ['No finished tickets yet. Measured pace needs 8 weeks of them.'] })
  })

  test('weeks count from the first finished ticket; quiet weeks after it still count', () => {
    const storage = teamWithMilestone(doneInWeeks([0, 0, 3, 0, 0, 1, 0]))
    enterManualPace(storage, '2', '4')

    expect(forecastOf(storage)).toMatchObject({ notes: ['Only 5 weeks of finished tickets. Measured pace needs 8.'] })
  })

  test('KTLO and tickets under no epic or another epic are left out', () => {
    const elsewhere = doneInWeeks([1, 1, 1, 1, 1, 1, 1, 1, 1, 1])
    const storage = teamWithMilestone(doneInWeeks([2, 2]), {
      extra: [
        ticket('OTHER', 'epic'),
        ...elsewhere.map((doneAt, i) => ticket(`KTLO-${i}`, 'bug', { labels: ['ktlo'], startedAt: CREATED, doneAt })),
        ...elsewhere.map((doneAt, i) => ticket(`OTHER-${i}`, 'story', { parentId: 'OTHER', startedAt: CREATED, doneAt })),
      ],
    })
    enterManualPace(storage, '2', '4')

    expect(forecastOf(storage)).toMatchObject({ notes: ['Only 2 weeks of finished tickets. Measured pace needs 8.'] })
  })

  test('nothing finished before installation counts, nor in the part-week it was installed in', () => {
    // installed on the Monday of the 4th week back (weeks start on Saturdays): that week and older don't count
    const storage = teamWithMilestone(doneInWeeks([3, 3, 3, 3, 3, 3, 3, 3, 3, 3]), { installedAt: '2026-09-28T09:00:00Z' })
    enterManualPace(storage, '2', '4')

    expect(forecastOf(storage)).toMatchObject({ notes: ['Only 3 weeks of finished tickets. Measured pace needs 8.'] })
  })

  test('the weeks measured pace needs come from the settings', () => {
    const storage = teamWithMilestone(doneInWeeks([1, 2, 1, 3]))
    enterManualPace(storage, '2', '4')

    expect(forecastOf(storage, { ...DEFAULT_SETTINGS, minMeasuredPaceWeeks: 6 })).toMatchObject({
      notes: ['Only 4 weeks of finished tickets. Measured pace needs 6.'],
    })
  })

  test('the Inputs screen says the same, and offers no switch', () => {
    const storage = teamWithMilestone(doneInWeeks([1, 2, 1, 3]))
    enterManualPace(storage, '2', '4')

    expect(paceOf(storage)).toEqual({
      manual: { low: 2, high: 4 },
      mode: 'manual',
      paused: false,
      weeks: 4,
      weeksNeeded: 8,
      measured: undefined,
      message: 'Only 4 weeks of finished tickets. Measured pace needs 8.',
    })
  })

  test('switching to measured pace is refused', () => {
    const storage = teamWithMilestone(doneInWeeks([1, 2, 1, 3]))
    enterManualPace(storage, '2', '4')

    expect(editInputs(storage, TEAM, { kind: 'useMeasuredPace' }, DEFAULT_SETTINGS, TODAY)).toEqual({
      ok: false,
      error: 'Only 4 weeks of finished tickets. Measured pace needs 8.',
    })
    expect(forecastOf(storage)).toMatchObject({ pace: { source: 'manual' } })
  })
})

describe('pace at 8 weeks of finished tickets or more', () => {
  const EIGHT_WEEKS = doneInWeeks([1, 3, 2, 0, 4, 2, 3, 1])

  test('measured pace is offered beside the manual range, which the forecast keeps using until the EM switches', () => {
    const storage = teamWithMilestone(EIGHT_WEEKS)
    enterManualPace(storage, '2', '4')

    expect(paceOf(storage)).toEqual({
      manual: { low: 2, high: 4 },
      mode: 'manual',
      paused: false,
      weeks: 8,
      weeksNeeded: 8,
      measured: { weeks: 8, low: 0, high: 4 },
      message: undefined,
    })
    expect(forecastOf(storage)).toMatchObject({
      kind: 'forecast',
      pace: { source: 'manual', low: 2, high: 4 },
      notes: ['Measured pace is ready, from 8 weeks of finished tickets. Switch to it on Inputs.'],
    })
  })

  test('once the EM switches, the forecast uses measured pace and says over how many weeks', () => {
    const storage = teamWithMilestone(EIGHT_WEEKS)
    enterManualPace(storage, '2', '4')

    expect(editInputs(storage, TEAM, { kind: 'useMeasuredPace' }, DEFAULT_SETTINGS, TODAY)).toEqual({ ok: true })

    expect(forecastOf(storage)).toMatchObject({
      kind: 'forecast',
      pace: { source: 'measured', weeks: 8, scope: 'milestoneEpics' },
      notes: ['Your weekly pace varies, so the range is wider.'],
    })
    expect(paceOf(storage)).toMatchObject({ mode: 'measured', paused: false, manual: { low: 2, high: 4 } })
  })

  test('measured pace can be chosen before any manual range is entered', () => {
    const storage = teamWithMilestone(EIGHT_WEEKS)

    expect(forecastOf(storage)).toEqual({
      kind: 'needsPace',
      message: 'Measured pace is ready, from 8 weeks of finished tickets. Switch to it on Inputs.',
    })
    expect(editInputs(storage, TEAM, { kind: 'useMeasuredPace' }, DEFAULT_SETTINGS, TODAY)).toEqual({ ok: true })

    expect(forecastOf(storage)).toMatchObject({ kind: 'forecast', pace: { source: 'measured', weeks: 8 } })
  })

  test('the EM can go back to the manual range, as it was', () => {
    const storage = teamWithMilestone(EIGHT_WEEKS)
    enterManualPace(storage, '2', '4')
    editInputs(storage, TEAM, { kind: 'useMeasuredPace' }, DEFAULT_SETTINGS, TODAY)

    expect(editInputs(storage, TEAM, { kind: 'useManualPace' }, DEFAULT_SETTINGS, TODAY)).toEqual({ ok: true })

    expect(forecastOf(storage)).toMatchObject({ pace: { source: 'manual', low: 2, high: 4 } })
  })

  test('editing the manual range while on measured pace keeps measured pace', () => {
    const storage = teamWithMilestone(EIGHT_WEEKS)
    enterManualPace(storage, '2', '4')
    editInputs(storage, TEAM, { kind: 'useMeasuredPace' }, DEFAULT_SETTINGS, TODAY)

    enterManualPace(storage, '3', '5')

    expect(forecastOf(storage)).toMatchObject({ pace: { source: 'measured' } })
    expect(paceOf(storage)).toMatchObject({ mode: 'measured', manual: { low: 3, high: 5 } })
  })

  test('going back to the manual range is refused when there is none', () => {
    const storage = teamWithMilestone(EIGHT_WEEKS)
    editInputs(storage, TEAM, { kind: 'useMeasuredPace' }, DEFAULT_SETTINGS, TODAY)

    expect(editInputs(storage, TEAM, { kind: 'useManualPace' }, DEFAULT_SETTINGS, TODAY)).toEqual({
      ok: false,
      error: 'Enter a manual range first.',
    })
  })

  test('chosen measured pace pauses back to the manual range when the milestone has fewer weeks than it needs', () => {
    const storage = teamWithMilestone(EIGHT_WEEKS)
    enterManualPace(storage, '2', '4')
    editInputs(storage, TEAM, { kind: 'useMeasuredPace' }, DEFAULT_SETTINGS, TODAY)

    const stricter = { ...DEFAULT_SETTINGS, minMeasuredPaceWeeks: 10 }
    expect(forecastOf(storage, stricter)).toMatchObject({
      pace: { source: 'manual', low: 2, high: 4 },
      notes: ['Measured pace is paused. Only 8 weeks of finished tickets. Measured pace needs 10.'],
    })
    expect(paceOf(storage, stricter)).toMatchObject({ mode: 'measured', paused: true, measured: undefined })
  })

  test('with no manual range, paused measured pace asks for one and says why', () => {
    const storage = teamWithMilestone(EIGHT_WEEKS)
    editInputs(storage, TEAM, { kind: 'useMeasuredPace' }, DEFAULT_SETTINGS, TODAY)

    expect(forecastOf(storage, { ...DEFAULT_SETTINGS, minMeasuredPaceWeeks: 10 })).toEqual({
      kind: 'needsPace',
      message: 'Measured pace is paused. Only 8 weeks of finished tickets. Measured pace needs 10.',
    })
  })
})
