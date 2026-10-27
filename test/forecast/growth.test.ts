import { afterEach, describe, expect, test } from 'vitest'
import { editInputs, inputsView, type InputsEdit } from '../../src/forecast/inputs.js'
import { milestoneForecastView } from '../../src/forecast/milestoneForecastView.js'
import { DEFAULT_SETTINGS } from '../../src/forecast/settings.js'
import { defaultWorkflowSettings } from '../../src/model/workflow.js'
import type { WorkItem, WorkItemEvent } from '../../src/model/workItem.js'
import { openSqliteStorage } from '../../src/storage/sqliteStorage.js'
import type { Storage } from '../../src/storage/storage.js'

const TEAM = 'ACME'
const MILESTONE = 'ACME-M'
const TODAY = '2026-10-24'
const CREATED = '2026-06-01T09:00:00Z'
const KICKOFF = '2026-06-08T09:00:00Z'
const COMMITTED = '2026-06-09T09:00:00Z'
const GREW = '2026-06-20T09:00:00Z'
const FINISHED = '2026-08-01T09:00:00Z'

let storage: Storage | undefined

afterEach(() => {
  storage?.close()
  storage = undefined
})

function ticket(id: string, type: string, fields: Partial<WorkItem> = {}): WorkItem {
  return { id, teamId: TEAM, sourceKey: id, type, labels: [], createdAt: CREATED, lastSyncedAt: CREATED, ...fields }
}

function children(epicId: string, from: number, count: number, createdAt = CREATED): WorkItem[] {
  return Array.from({ length: count }, (_, i) => ticket(`${epicId}-${from + i}`, 'story', { parentId: epicId, createdAt }))
}

function status(itemId: string, at: string, to: string, from?: string): WorkItemEvent {
  return { itemId, at, kind: 'status', ...(from !== undefined && { from }), to }
}

/**
 * A Jira team whose milestone holds the epics given, each started at kickoff with `count` tickets not yet done
 * a manual pace of 2 tickets a week, and `committed` as the commit label.
 */
function team(epics: Record<string, number> = { E1: 10 }): Storage {
  storage = openSqliteStorage(':memory:')
  storage.saveTeam({ id: TEAM, name: TEAM, source: 'jira', sourceRef: TEAM })
  storage.saveWorkflowSettings({ ...defaultWorkflowSettings(TEAM), commitLabel: 'committed' })
  const ids = Object.keys(epics)
  storage.addFacts(TEAM, {
    workItems: ids.flatMap((id) => [ticket(id, 'epic', { title: `Epic ${id}` }), ...children(id, 0, epics[id]!)]),
    events: ids.flatMap((id) => [status(id, CREATED, 'To Do'), status(id, KICKOFF, 'In Progress', 'To Do')]),
  })
  storage.saveMilestone({ id: MILESTONE, teamId: TEAM, name: 'Launch', committedDate: '2026-12-18', epicIds: ids })
  storage.savePaceSetting({ teamId: TEAM, milestoneId: MILESTONE, mode: 'manual', low: 2, high: 2 })
  return storage
}

/** A finished epic outside the milestone: `baseline` tickets at its commit, `final` when it was done. */
function finishedEpic(
  storage: Storage,
  id: string,
  baseline: number,
  final: number,
  committed: 'inTool' | 'label' | 'not' = 'inTool',
): void {
  const label = committed === 'label' ? ['committed'] : []
  storage.addFacts(TEAM, {
    workItems: [
      ticket(id, 'epic', { title: `Epic ${id}`, labels: label }),
      ...children(id, 0, baseline),
      ...children(id, baseline, final - baseline, GREW),
    ],
    events: [
      status(id, CREATED, 'To Do'),
      status(id, KICKOFF, 'In Progress', 'To Do'),
      status(id, FINISHED, 'Done', 'In Progress'),
      ...(committed === 'label' ? [{ itemId: id, at: COMMITTED, kind: 'label' as const, to: 'committed' }] : []),
    ],
  })
  if (committed === 'inTool') storage.saveEpicCommit({ teamId: TEAM, epicId: id, committedAt: COMMITTED, baseline })
}

function edit(storage: Storage, change: InputsEdit): void {
  const result = editInputs(storage, TEAM, change)
  if (!result.ok) throw new Error(`edit refused: ${result.error}`)
}

function view(storage: Storage) {
  const shown = milestoneForecastView(storage, TEAM, { today: TODAY, settings: DEFAULT_SETTINGS })
  if (shown.kind !== 'milestone') throw new Error('expected a milestone')
  return shown
}

/** The milestone's finish dates at 50%, 85% and 95%. */
function datesOf(storage: Storage): (string | null)[] {
  const { forecast } = view(storage)
  if (forecast.kind !== 'forecast') throw new Error('expected a forecast')
  return forecast.dates.map((entry) => entry.date)
}

describe('ambiguity', () => {
  test('each epic is of medium ambiguity until the EM says otherwise, and grows by its range', () => {
    const storage = team({ E1: 10, E2: 4 })

    expect(view(storage).epics.map(({ ambiguity, growthSource }) => ({ ambiguity, growthSource }))).toEqual([
      { ambiguity: 'medium', growthSource: 'ambiguity' },
      { ambiguity: 'medium', growthSource: 'ambiguity' },
    ])
    const milestone = inputsView(storage, TEAM).milestone
    expect(milestone.kind === 'milestone' && milestone.epics.map((epic) => epic.ambiguity)).toEqual(['medium', 'medium'])
  })

  test('an epic the EM marks high forecasts later, one marked low sooner', () => {
    const medium = datesOf(team())
    edit(storage!, { kind: 'setEpicAmbiguity', epicId: 'E1', ambiguity: 'high' })
    const high = datesOf(storage!)
    edit(storage!, { kind: 'setEpicAmbiguity', epicId: 'E1', ambiguity: 'low' })
    const low = datesOf(storage!)

    expect(high[1]! > medium[1]!).toBe(true)
    expect(low[1]! < medium[1]!).toBe(true)
    expect(view(storage!).epics[0]).toMatchObject({ ambiguity: 'low', growthSource: 'ambiguity' })
  })

  test('the level stays with the epic when the milestone is reordered', () => {
    const storage = team({ E1: 10, E2: 4 })
    edit(storage, { kind: 'setEpicAmbiguity', epicId: 'E2', ambiguity: 'high' })

    edit(storage, { kind: 'moveEpic', epicId: 'E2', direction: 'up' })

    expect(view(storage).epics.map(({ epicId, ambiguity }) => [epicId, ambiguity])).toEqual([
      ['E2', 'high'],
      ['E1', 'medium'],
    ])
  })

  test('refuses a level that is not low, medium or high, or an epic not in the milestone', () => {
    const storage = team()

    expect(editInputs(storage, TEAM, { kind: 'setEpicAmbiguity', epicId: 'E1', ambiguity: 'huge' })).toEqual({
      ok: false,
      error: 'Choose low, medium or high ambiguity.',
    })
    expect(editInputs(storage, TEAM, { kind: 'setEpicAmbiguity', epicId: 'E9', ambiguity: 'high' })).toEqual({
      ok: false,
      error: 'That epic is not in the milestone.',
    })
    expect(view(storage).epics[0]!.ambiguity).toBe('medium')
  })
})

describe('ambiguity ranges', () => {
  const typed = (low: string, high: string) => ({ low, high })
  const ranges = (medium: { low: string; high: string }): InputsEdit => ({
    kind: 'setAmbiguityRanges',
    low: typed('1', '1.5'),
    medium,
    high: typed('1.5', '3'),
  })

  test('start at low 1–1.5×, medium 1–2× and high 1.5–3×', () => {
    expect(inputsView(team(), TEAM).growth.ranges).toEqual({
      low: { low: 1, high: 1.5 },
      medium: { low: 1, high: 2 },
      high: { low: 1.5, high: 3 },
    })
  })

  test('the EM edits them, and the epics of each level grow by the edited range', () => {
    const before = datesOf(team())

    edit(storage!, ranges(typed(' 2.5 ', '3')))

    expect(inputsView(storage!, TEAM).growth.ranges.medium).toEqual({ low: 2.5, high: 3 })
    expect(datesOf(storage!)[0]! > before[2]!).toBe(true)
  })

  test.each([
    [typed('', '2'), 'Enter each range as two numbers, such as 1 to 1.5.'],
    [typed('one', '2'), 'Enter each range as two numbers, such as 1 to 1.5.'],
    [typed('0', '2'), 'Enter growth above 0 and at most 10 times.'],
    [typed('1', '11'), 'Enter growth above 0 and at most 10 times.'],
    [typed('2', '1.5'), 'The low end must not be above the high end.'],
  ])('refuses a medium range typed %o', (medium, error) => {
    const storage = team()

    expect(editInputs(storage, TEAM, ranges(medium))).toEqual({ ok: false, error })
    expect(inputsView(storage, TEAM).growth.ranges.medium).toEqual({ low: 1, high: 2 })
  })
})

describe('an epic with no tickets', () => {
  test('is sized as a whole epic, from the default range until finished epics give sizes', () => {
    const storage = team({ E1: 0 })
    const byDefault = datesOf(storage)
    finishedEpic(storage, 'F1', 30, 40, 'not')

    expect(view(storage).epics[0]!.growthSource).toBe('epicSize')
    expect(datesOf(storage)).toEqual(byDefault)
  })

  test("draws its size from committed epics' final sizes once any have finished", () => {
    const storage = team({ E1: 0 })
    const byDefault = datesOf(storage)

    finishedEpic(storage, 'F1', 30, 40)
    finishedEpic(storage, 'F2', 0, 35, 'label')

    expect(datesOf(storage)[0]! > byDefault[2]!).toBe(true)
  })
})

describe('measured growth', () => {
  /** Finished committed epics F1 to F`count`: F1 grew 10 to 12 tickets (1.2×), the rest 10 to 30 (3×). */
  function finishedEpics(storage: Storage, count: number): void {
    for (let i = 1; i <= count; i++) finishedEpic(storage, `F${i}`, 10, i === 1 ? 12 : 30, i % 2 === 0 ? 'label' : 'inTool')
  }

  test('suggests no medium range before 7 finished committed epics, and counts only those with a baseline', () => {
    const storage = team()
    finishedEpics(storage, 6)
    finishedEpic(storage, 'U1', 10, 30, 'not')
    finishedEpic(storage, 'Z1', 0, 30)

    expect(inputsView(storage, TEAM).growth).toMatchObject({ finishedEpics: 6, mediumMeasured: false, suggestion: undefined })
  })

  test('from 7 finished committed epics, suggests their range for medium, rounded out to the half, which changes nothing until the EM adopts it', () => {
    const storage = team()
    const before = datesOf(storage)
    finishedEpics(storage, 7)

    expect(inputsView(storage, TEAM).growth).toMatchObject({
      finishedEpics: 7,
      mediumMeasured: false,
      suggestion: { low: 1, high: 3, basis: 'Measured from 7 finished committed epics' },
    })
    expect(view(storage).epics[0]!.growthSource).toBe('ambiguity')
    expect(datesOf(storage)).toEqual(before)
  })

  test('measures each epic at its children when done: tickets added or moved away since change nothing', () => {
    const storage = team()
    finishedEpics(storage, 7)
    const after = '2026-09-01T09:00:00Z'
    const moved = ['F1-0', 'F1-1', 'F1-2', 'F1-3']
    storage.addFacts(TEAM, {
      // F2 gains 20 tickets after it finished, and 4 of F1's tickets move to F9
      workItems: [...children('F2', 30, 20, after), ...moved.map((id) => ticket(id, 'story', { parentId: 'F9' }))],
      events: moved.map((id) => ({ itemId: id, at: after, kind: 'parent' as const, from: 'F1', to: 'F9' })),
    })

    expect(inputsView(storage, TEAM).growth.suggestion).toMatchObject({ low: 1, high: 3 })
  })

  test('once adopted, medium epics draw from the measured growth, while low and high keep their ranges', () => {
    const storage = team({ E1: 10, E2: 10 })
    finishedEpics(storage, 7)
    edit(storage, { kind: 'setEpicAmbiguity', epicId: 'E2', ambiguity: 'high' })
    const before = datesOf(storage)

    edit(storage, { kind: 'useMeasuredMedium' })

    expect(inputsView(storage, TEAM).growth.mediumMeasured).toBe(true)
    expect(view(storage).epics.map((epic) => epic.growthSource)).toEqual(['samples', 'ambiguity'])
    expect(datesOf(storage)[1]! > before[1]!).toBe(true)
  })

  test('the EM can go back to the medium range, and edits to the ranges keep the choice', () => {
    const storage = team()
    finishedEpics(storage, 7)
    const before = datesOf(storage)
    edit(storage, { kind: 'useMeasuredMedium' })
    edit(storage, {
      kind: 'setAmbiguityRanges',
      low: { low: '1', high: '1.5' },
      medium: { low: '1', high: '2' },
      high: { low: '1.5', high: '3' },
    })
    expect(inputsView(storage, TEAM).growth.mediumMeasured).toBe(true)

    edit(storage, { kind: 'useMediumRange' })

    expect(view(storage).epics[0]!.growthSource).toBe('ambiguity')
    expect(datesOf(storage)).toEqual(before)
  })

  test('adopted, and then too few finished epics: medium is back on its range, and both screens say why', () => {
    const storage = team()
    finishedEpics(storage, 7)
    edit(storage, { kind: 'useMeasuredMedium' })

    storage.addFacts(TEAM, { workItems: [], events: [status('F3', '2026-09-01T09:00:00Z', 'In Progress', 'Done')] })

    expect(inputsView(storage, TEAM).growth).toMatchObject({ mediumMeasured: true, finishedEpics: 6, needed: 7, suggestion: undefined })
    expect(view(storage).epics[0]).toMatchObject({
      growthSource: 'ambiguity',
      growthBasis: 'Medium ambiguity: grows 1–2× (measured growth paused: 6 of 7 finished epics)',
    })
  })

  test('Inputs and the forecast read the same threshold from the settings given', () => {
    const storage = team()
    finishedEpics(storage, 5)
    const settings = { ...DEFAULT_SETTINGS, minGrowthSamples: 5 }

    expect(inputsView(storage, TEAM, settings).growth.suggestion).toMatchObject({ low: 1, high: 3 })
    expect(editInputs(storage, TEAM, { kind: 'useMeasuredMedium' }, settings)).toEqual({ ok: true })
    const shown = milestoneForecastView(storage, TEAM, { today: TODAY, settings })
    expect(shown.kind === 'milestone' && shown.epics[0]!.growthSource).toBe('samples')
  })

  test('refuses measured growth before 7 finished committed epics', () => {
    const storage = team()
    finishedEpics(storage, 6)

    expect(editInputs(storage, TEAM, { kind: 'useMeasuredMedium' })).toEqual({
      ok: false,
      error: 'Measured growth needs 7 finished committed epics; there are 6 so far.',
    })
    expect(inputsView(storage, TEAM).growth.mediumMeasured).toBe(false)
  })
})
