import { afterEach, describe, expect, test } from 'vitest'
import { editMilestone, milestoneDefinitionView, type MilestoneEdit } from '../../src/forecast/milestoneDefinition.js'
import { milestoneForecastView } from '../../src/forecast/milestoneForecastView.js'
import { DEFAULT_SETTINGS } from '../../src/forecast/settings.js'
import type { WorkItem } from '../../src/model/workItem.js'
import { openSqliteStorage } from '../../src/storage/sqliteStorage.js'
import type { Storage } from '../../src/storage/storage.js'

const TEAM = 'ACME'
const TODAY = '2026-10-24'
const CREATED = '2026-09-01T09:00:00Z'

let storage: Storage | undefined

afterEach(() => {
  storage?.close()
  storage = undefined
})

/** A Jira team with no milestone yet. Each epic has `open` children not yet done; `fields` overrides the epic's own. */
function teamWithEpics(epics: { id: string; open: number; fields?: Partial<WorkItem> }[], extra: WorkItem[] = []): Storage {
  storage = openSqliteStorage(':memory:')
  storage.saveTeam({ id: TEAM, name: TEAM, source: 'jira', sourceRef: TEAM })
  const workItems: WorkItem[] = []
  for (const epic of epics) {
    workItems.push(ticket(epic.id, 'epic', { title: `Epic ${epic.id}`, ...epic.fields }))
    for (let i = 0; i < epic.open; i++) workItems.push(ticket(`${epic.id}-${i}`, 'story', { parentId: epic.id }))
  }
  storage.addFacts(TEAM, { workItems: [...workItems, ...extra], events: [] })
  return storage
}

function ticket(id: string, type: string, fields: Partial<WorkItem> = {}): WorkItem {
  return { id, teamId: TEAM, sourceKey: id, type, labels: [], createdAt: CREATED, lastSyncedAt: CREATED, ...fields }
}

/** Applies the EM's edit, failing the test if it is refused. */
function edit(storage: Storage, change: MilestoneEdit): void {
  const result = editMilestone(storage, TEAM, change)
  if (!result.ok) throw new Error(`edit refused: ${result.error}`)
}

function create(storage: Storage, epicIds: string[]): void {
  edit(storage, { kind: 'create', name: 'Launch', committedDate: '2026-12-18', epicIds })
}

function enterManualPace(storage: Storage, low: number, high: number): void {
  storage.savePaceSetting({ teamId: TEAM, milestoneId: storage.milestones(TEAM)[0]!.id, mode: 'manual', low, high })
}

function forecastView(storage: Storage) {
  const view = milestoneForecastView(storage, TEAM, { today: TODAY, settings: DEFAULT_SETTINGS })
  if (view.kind !== 'milestone') throw new Error('expected a milestone')
  return view
}

function epicKeys(storage: Storage): string[] {
  return forecastView(storage).epics.map((epic) => epic.key)
}

function datesOf(storage: Storage): (string | null)[] {
  const { forecast } = forecastView(storage)
  if (forecast.kind !== 'forecast') throw new Error(`expected a forecast, got ${forecast.kind}`)
  return forecast.dates.map((entry) => entry.date)
}

describe('creating a milestone', () => {
  test('gives it a name, a committed date and the chosen epics in the order chosen', () => {
    const storage = teamWithEpics([{ id: 'E1', open: 2 }, { id: 'E2', open: 3 }, { id: 'E3', open: 1 }])

    create(storage, ['E3', 'E1'])

    expect(milestoneForecastView(storage, TEAM, { today: TODAY, settings: DEFAULT_SETTINGS })).toEqual({
      kind: 'milestone',
      name: 'Launch',
      committedDate: '2026-12-18',
      forecast: { kind: 'needsPace' },
      epics: [
        { epicId: 'E3', key: 'E3', name: 'Epic E3', itemsNow: 1, status: 'notCommitted' },
        { epicId: 'E1', key: 'E1', name: 'Epic E1', itemsNow: 2, status: 'notCommitted' },
      ],
    })
  })

  test('trims spaces from the name', () => {
    const storage = teamWithEpics([{ id: 'E1', open: 2 }])

    edit(storage, { kind: 'create', name: '  Launch  ', committedDate: '2026-12-18', epicIds: ['E1'] })

    expect(forecastView(storage).name).toBe('Launch')
  })

  test.each([
    { why: 'a blank name', name: '  ', committedDate: '2026-12-18', epicIds: ['E1'], error: 'Give the milestone a name.' },
    { why: 'no date', name: 'Launch', committedDate: '', epicIds: ['E1'], error: 'Enter the committed date as a calendar date.' },
    { why: 'a date that does not exist', name: 'Launch', committedDate: '2026-02-30', epicIds: ['E1'], error: 'Enter the committed date as a calendar date.' },
    { why: 'no epics', name: 'Launch', committedDate: '2026-12-18', epicIds: [], error: 'Choose at least one epic.' },
    { why: 'a ticket that is not an epic', name: 'Launch', committedDate: '2026-12-18', epicIds: ['E1-0'], error: "Choose epics from the team's epics." },
    { why: 'a cancelled epic', name: 'Launch', committedDate: '2026-12-18', epicIds: ['E2'], error: "Choose epics from the team's epics." },
    { why: 'an unknown epic', name: 'Launch', committedDate: '2026-12-18', epicIds: ['NOPE'], error: "Choose epics from the team's epics." },
  ])('is refused for $why, and nothing is saved', ({ name, committedDate, epicIds, error }) => {
    const storage = teamWithEpics([{ id: 'E1', open: 2 }, { id: 'E2', open: 0, fields: { cancelledAt: '2026-10-01T09:00:00Z' } }])

    expect(editMilestone(storage, TEAM, { kind: 'create', name, committedDate, epicIds })).toEqual({ ok: false, error })
    expect(milestoneDefinitionView(storage, TEAM)).toMatchObject({ kind: 'noMilestone' })
  })

  test('an epic chosen twice is held once', () => {
    const storage = teamWithEpics([{ id: 'E1', open: 2 }, { id: 'E2', open: 1 }])

    create(storage, ['E1', 'E2', 'E1'])

    expect(epicKeys(storage)).toEqual(['E1', 'E2'])
  })

  test('is refused when the team already has one, since v1 forecasts one milestone', () => {
    const storage = teamWithEpics([{ id: 'E1', open: 2 }, { id: 'E2', open: 1 }])
    create(storage, ['E1'])

    expect(editMilestone(storage, TEAM, { kind: 'create', name: 'Other', committedDate: '2027-01-29', epicIds: ['E2'] })).toEqual({
      ok: false,
      error: 'This team already has a milestone.',
    })
    expect(forecastView(storage)).toMatchObject({ name: 'Launch', epics: [{ key: 'E1' }] })
  })
})

describe('the epics to choose from', () => {
  test("with no milestone yet, are the team's epics, not their tickets, and not cancelled epics", () => {
    const storage = teamWithEpics(
      [{ id: 'E1', open: 2 }, { id: 'E2', open: 0, fields: { cancelledAt: '2026-10-01T09:00:00Z' } }],
      [ticket('E3', 'epic'), ticket('BUG-1', 'bug', { labels: ['ktlo'] })],
    )

    expect(milestoneDefinitionView(storage, TEAM)).toEqual({
      kind: 'noMilestone',
      teamEpics: [
        { epicId: 'E1', key: 'E1', name: 'Epic E1' },
        { epicId: 'E3', key: 'E3', name: 'E3' },
      ],
    })
  })

  test('once the milestone exists, are the epics not already in it', () => {
    const storage = teamWithEpics([{ id: 'E1', open: 2 }, { id: 'E2', open: 3 }, { id: 'E3', open: 1 }])

    create(storage, ['E3', 'E1'])

    expect(milestoneDefinitionView(storage, TEAM)).toEqual({
      kind: 'milestone',
      name: 'Launch',
      committedDate: '2026-12-18',
      epics: [
        { epicId: 'E3', key: 'E3', name: 'Epic E3' },
        { epicId: 'E1', key: 'E1', name: 'Epic E1' },
      ],
      otherEpics: [{ epicId: 'E2', key: 'E2', name: 'Epic E2' }],
    })
  })
})

// At 10 tickets a week: E1's 4 tickets grow to at most 8, so one week; with E2's 10 as well, 14 to 28 tickets take
// two or three weeks.
const ONE_WEEK = '2026-10-31'
const TWO_OR_THREE_WEEKS = ['2026-11-07', '2026-11-14']

describe('adding an epic', () => {
  test('puts it last, and the forecast includes its work', () => {
    const storage = teamWithEpics([{ id: 'E1', open: 4 }, { id: 'E2', open: 10 }])
    create(storage, ['E1'])
    enterManualPace(storage, 10, 10)
    expect(datesOf(storage)).toEqual([ONE_WEEK, ONE_WEEK, ONE_WEEK])

    edit(storage, { kind: 'addEpic', epicId: 'E2' })

    expect(epicKeys(storage)).toEqual(['E1', 'E2'])
    for (const date of datesOf(storage)) expect(TWO_OR_THREE_WEEKS).toContain(date)
    expect(milestoneDefinitionView(storage, TEAM)).toMatchObject({ otherEpics: [] })
  })

  test.each([
    { why: 'already in the milestone', epicId: 'E1', error: 'That epic is already in the milestone.' },
    { why: 'not an epic', epicId: 'E2-0', error: "Choose epics from the team's epics." },
    { why: 'cancelled', epicId: 'E3', error: "Choose epics from the team's epics." },
  ])('is refused when the epic is $why', ({ epicId, error }) => {
    const storage = teamWithEpics([{ id: 'E1', open: 4 }, { id: 'E2', open: 1 }, { id: 'E3', open: 0, fields: { cancelledAt: CREATED } }])
    create(storage, ['E1'])

    expect(editMilestone(storage, TEAM, { kind: 'addEpic', epicId })).toEqual({ ok: false, error })
    expect(epicKeys(storage)).toEqual(['E1'])
  })
})

describe('removing an epic', () => {
  test('takes it out of the milestone, and the forecast drops its work', () => {
    const storage = teamWithEpics([{ id: 'E1', open: 4 }, { id: 'E2', open: 10 }])
    create(storage, ['E1', 'E2'])
    enterManualPace(storage, 10, 10)
    for (const date of datesOf(storage)) expect(TWO_OR_THREE_WEEKS).toContain(date)

    edit(storage, { kind: 'removeEpic', epicId: 'E2' })

    expect(epicKeys(storage)).toEqual(['E1'])
    expect(datesOf(storage)).toEqual([ONE_WEEK, ONE_WEEK, ONE_WEEK])
    expect(milestoneDefinitionView(storage, TEAM)).toMatchObject({ otherEpics: [{ key: 'E2' }] })
  })

  test('is refused for an epic not in the milestone', () => {
    const storage = teamWithEpics([{ id: 'E1', open: 4 }, { id: 'E2', open: 1 }])
    create(storage, ['E1'])

    expect(editMilestone(storage, TEAM, { kind: 'removeEpic', epicId: 'E2' })).toEqual({
      ok: false,
      error: 'That epic is not in the milestone.',
    })
  })

  test('is refused for the last epic, since a milestone holds at least one', () => {
    const storage = teamWithEpics([{ id: 'E1', open: 4 }])
    create(storage, ['E1'])

    expect(editMilestone(storage, TEAM, { kind: 'removeEpic', epicId: 'E1' })).toEqual({
      ok: false,
      error: 'A milestone holds at least one epic. Add another before removing this one.',
    })
    expect(epicKeys(storage)).toEqual(['E1'])
  })
})

describe('reordering epics', () => {
  test('moves an epic up or down one place in rank', () => {
    const storage = teamWithEpics([{ id: 'E1', open: 1 }, { id: 'E2', open: 1 }, { id: 'E3', open: 1 }])
    create(storage, ['E1', 'E2', 'E3'])

    edit(storage, { kind: 'moveEpic', epicId: 'E3', direction: 'up' })
    expect(epicKeys(storage)).toEqual(['E1', 'E3', 'E2'])

    edit(storage, { kind: 'moveEpic', epicId: 'E1', direction: 'down' })
    expect(epicKeys(storage)).toEqual(['E3', 'E1', 'E2'])
  })

  test('leaves the top epic where it is when moved up, and the bottom one when moved down', () => {
    const storage = teamWithEpics([{ id: 'E1', open: 1 }, { id: 'E2', open: 1 }])
    create(storage, ['E1', 'E2'])

    edit(storage, { kind: 'moveEpic', epicId: 'E1', direction: 'up' })
    edit(storage, { kind: 'moveEpic', epicId: 'E2', direction: 'down' })

    expect(epicKeys(storage)).toEqual(['E1', 'E2'])
  })

  test('keeps the milestone date the same: it is when all its epics are done, whatever their order', () => {
    const storage = teamWithEpics([{ id: 'E1', open: 4 }, { id: 'E2', open: 10 }, { id: 'E3', open: 0 }])
    create(storage, ['E1', 'E2', 'E3'])
    enterManualPace(storage, 2, 6)
    const before = datesOf(storage)

    edit(storage, { kind: 'moveEpic', epicId: 'E3', direction: 'up' })

    expect(epicKeys(storage)).toEqual(['E1', 'E3', 'E2'])
    expect(datesOf(storage)).toEqual(before)
  })

  test('is refused for an epic not in the milestone', () => {
    const storage = teamWithEpics([{ id: 'E1', open: 4 }, { id: 'E2', open: 1 }])
    create(storage, ['E1'])

    expect(editMilestone(storage, TEAM, { kind: 'moveEpic', epicId: 'E2', direction: 'up' })).toEqual({
      ok: false,
      error: 'That epic is not in the milestone.',
    })
  })
})

describe('editing epics before a milestone exists', () => {
  test.each<MilestoneEdit>([
    { kind: 'addEpic', epicId: 'E1' },
    { kind: 'removeEpic', epicId: 'E1' },
    { kind: 'moveEpic', epicId: 'E1', direction: 'down' },
  ])('$kind is refused', (change) => {
    const storage = teamWithEpics([{ id: 'E1', open: 4 }])

    expect(editMilestone(storage, TEAM, change)).toEqual({ ok: false, error: 'Define the milestone first.' })
  })
})
