import { afterEach, describe, expect, test } from 'vitest'
import { milestoneForecastView } from '../../src/forecast/milestoneForecastView.js'
import type { Facts, WorkItem } from '../../src/model/workItem.js'
import { openSqliteStorage } from '../../src/storage/sqliteStorage.js'
import type { Storage } from '../../src/storage/storage.js'

const TEAM = 'ACME'
const MILESTONE = 'ACME-M'
const TODAY = '2026-10-24'
const CREATED = '2026-09-01T09:00:00Z'

let storage: Storage | undefined

afterEach(() => {
  storage?.close()
  storage = undefined
})

interface EpicSpec {
  id: string
  /** Children not yet done. */
  open: number
  /** When each done child was done (ISO timestamps). */
  doneAt?: string[]
}

/** A Jira team whose milestone holds `epics` in rank order, plus any `extra` tickets outside it. */
function teamWithMilestone(epics: EpicSpec[], extra: WorkItem[] = []): Storage {
  storage = openSqliteStorage(':memory:')
  storage.saveTeam({ id: TEAM, name: TEAM, source: 'jira', sourceRef: TEAM })
  const workItems: WorkItem[] = []
  for (const epic of epics) {
    workItems.push(ticket(epic.id, 'epic', { title: `Epic ${epic.id}` }))
    for (let i = 0; i < epic.open; i++) workItems.push(ticket(`${epic.id}-open-${i}`, 'story', { parentId: epic.id }))
    ;(epic.doneAt ?? []).forEach((doneAt, i) =>
      workItems.push(ticket(`${epic.id}-done-${i}`, 'story', { parentId: epic.id, startedAt: CREATED, doneAt })),
    )
  }
  const facts: Facts = { workItems: [...workItems, ...extra], events: [] }
  storage.addFacts(TEAM, facts)
  storage.saveMilestone({
    id: MILESTONE,
    teamId: TEAM,
    name: 'Launch',
    committedDate: '2026-12-18',
    epicIds: epics.map((epic) => epic.id),
  })
  return storage
}

function ticket(id: string, type: string, fields: Partial<WorkItem> = {}): WorkItem {
  return { id, teamId: TEAM, sourceKey: id, type, labels: [], createdAt: CREATED, lastSyncedAt: CREATED, ...fields }
}

function enterManualPace(storage: Storage, low: number, high: number): void {
  storage.savePaceSetting({ teamId: TEAM, milestoneId: MILESTONE, mode: 'manual', low, high })
}

function useMeasuredPace(storage: Storage): void {
  storage.savePaceSetting({ teamId: TEAM, milestoneId: MILESTONE, mode: 'measured' })
}

/** Done times for `counts[i]` tickets in each week up to today, oldest week first. */
function doneInWeeks(counts: number[]): string[] {
  const todayStart = Date.parse(`${TODAY}T00:00:00Z`)
  return counts.flatMap((count, i) => {
    const weeksBack = counts.length - 1 - i
    const midWeek = new Date(todayStart - (weeksBack * 7 + 3) * 86_400_000).toISOString()
    return Array<string>(count).fill(midWeek)
  })
}

function forecastOf(storage: Storage) {
  const view = milestoneForecastView(storage, TEAM, { today: TODAY })
  if (view.kind !== 'milestone') throw new Error('expected a milestone')
  return view.forecast
}

function datesOf(storage: Storage): (string | null)[] {
  const forecast = forecastOf(storage)
  if (forecast.kind !== 'forecast') throw new Error('expected a forecast')
  return forecast.dates.map((entry) => entry.date)
}

describe('first forecast from a manual pace range', () => {
  test('shows the milestone finish at 50%, 85% and 95%, a week out when one week of pace covers all the work', () => {
    const storage = teamWithMilestone([{ id: 'E1', open: 4 }])
    // 4 tickets grow to at most 8 (medium ambiguity, up to 2×): one week at 10 a week finishes them
    enterManualPace(storage, 10, 10)

    expect(forecastOf(storage)).toEqual({
      kind: 'forecast',
      pace: { mode: 'manual', low: 10, high: 10 },
      dates: [
        { percent: 50, date: '2026-10-31' },
        { percent: 85, date: '2026-10-31' },
        { percent: 95, date: '2026-10-31' },
      ],
      horizonDate: '2029-10-20',
      notes: [],
    })
  })

  test('epics are uncommitted, so they grow by the medium ambiguity range: 10 tickets become 10 to 20', () => {
    const storage = teamWithMilestone([{ id: 'E1', open: 10 }])
    // 10 a week: without growth, one week; with up to 2× growth, never more than two
    enterManualPace(storage, 10, 10)

    expect(datesOf(storage)).toEqual(['2026-11-07', '2026-11-07', '2026-11-07'])
  })

  test('done tickets count as work already finished', () => {
    const storage = teamWithMilestone([{ id: 'E1', open: 5, doneAt: Array(5).fill('2026-10-20T16:00:00Z') }])
    // 10 tickets grow to at most 20, 5 of them done: at most 15 left, one week at 15 a week
    enterManualPace(storage, 15, 15)

    expect(datesOf(storage)).toEqual(['2026-10-31', '2026-10-31', '2026-10-31'])
  })

  test('an epic with no children draws a size from the default range, so it is not counted as no work', () => {
    const storage = teamWithMilestone([{ id: 'E1', open: 0 }])
    enterManualPace(storage, 1000, 1000)

    expect(datesOf(storage)).toEqual(['2026-10-31', '2026-10-31', '2026-10-31'])
  })

  test('a confidence level beyond the horizon has no date, and the horizon date is given to show "later than"', () => {
    const storage = teamWithMilestone([{ id: 'E1', open: 4 }])
    enterManualPace(storage, 0, 0)

    expect(forecastOf(storage)).toMatchObject({
      dates: [
        { percent: 50, date: null },
        { percent: 85, date: null },
        { percent: 95, date: null },
      ],
      horizonDate: '2029-10-20',
    })
  })

  test('the same inputs give the same forecast', () => {
    const storage = teamWithMilestone([{ id: 'E1', open: 12 }, { id: 'E2', open: 3 }])
    enterManualPace(storage, 2, 6)

    expect(forecastOf(storage)).toEqual(forecastOf(storage))
  })

  test('with no pace entered, there is no forecast yet', () => {
    const storage = teamWithMilestone([{ id: 'E1', open: 4 }])

    expect(forecastOf(storage)).toEqual({ kind: 'needsPace' })
  })

  test('a newly entered pace range replaces the old one', () => {
    const storage = teamWithMilestone([{ id: 'E1', open: 4 }])
    enterManualPace(storage, 0, 0)
    enterManualPace(storage, 10, 10)

    expect(forecastOf(storage)).toMatchObject({ pace: { mode: 'manual', low: 10, high: 10 } })
    expect(datesOf(storage)).toEqual(['2026-10-31', '2026-10-31', '2026-10-31'])
  })
})

describe('pace variation note', () => {
  test.each([
    { weeks: [5, 5, 5, 5], note: 'Your weekly pace is steady, so the range is narrow.' },
    // relative standard error about 12%
    { weeks: [4, 6, 4, 6], note: 'Your weekly pace is steady, so the range is narrow.' },
    // about 35%
    { weeks: [2, 8, 2, 8], note: 'Your weekly pace varies, so the range is wider.' },
    // about 58%
    { weeks: [10, 0, 10, 0], note: 'Your weekly pace varies a lot, so the range is wide.' },
  ])('measured weeks $weeks give the note "$note"', ({ weeks, note }) => {
    const storage = teamWithMilestone([{ id: 'E1', open: 30, doneAt: doneInWeeks(weeks) }])
    useMeasuredPace(storage)

    expect(forecastOf(storage)).toMatchObject({ kind: 'forecast', pace: { mode: 'measured' }, notes: [note] })
  })

  test('a manual pace range has no pace variation note', () => {
    const storage = teamWithMilestone([{ id: 'E1', open: 30, doneAt: doneInWeeks([0, 10, 0, 10]) }])
    enterManualPace(storage, 2, 8)

    expect(forecastOf(storage)).toMatchObject({ notes: [] })
  })
})

