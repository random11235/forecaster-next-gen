import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import type { EditResult } from '../../src/forecast/editResult.js'
import { editMilestone, milestoneDefinitionView } from '../../src/forecast/milestoneDefinition.js'
import { milestoneForecastView } from '../../src/forecast/milestoneForecastView.js'
import { teamFacts } from '../../src/forecast/teamFacts.js'
import { DEFAULT_SETTINGS } from '../../src/forecast/settings.js'
import type { WorkItem, WorkItemEvent } from '../../src/model/workItem.js'
import { openSqliteStorage } from '../../src/storage/sqliteStorage.js'
import type { Storage } from '../../src/storage/storage.js'

const TEAM = 'ACME'
const MILESTONE = 'ACME-M'
const TODAY = '2026-10-24'
const CREATED = '2026-09-01T09:00:00Z'
const KICKOFF = '2026-10-01T09:00:00Z'
const COMMITTED = '2026-10-02T12:00:00Z'

let storage: Storage | undefined

afterEach(() => {
  storage?.close()
  storage = undefined
})

/** A Jira team whose milestone holds one epic, E1, with `children` tickets not yet done, started at kickoff. */
function teamWithEpic(children: number): Storage {
  storage = openSqliteStorage(':memory:')
  storage.saveTeam({ id: TEAM, name: TEAM, source: 'jira', sourceRef: TEAM })
  storage.addFacts(TEAM, {
    workItems: [ticket('E1', 'epic', { title: 'Epic E1' }), ...childTickets('E1', 0, children)],
    events: [
      { itemId: 'E1', at: CREATED, kind: 'status', to: 'To Do' },
      { itemId: 'E1', at: KICKOFF, kind: 'status', from: 'To Do', to: 'In Progress' },
    ],
  })
  storage.saveMilestone({ id: MILESTONE, teamId: TEAM, name: 'Launch', committedDate: '2026-12-18', epicIds: ['E1'] })
  return storage
}

function ticket(id: string, type: string, fields: Partial<WorkItem> = {}): WorkItem {
  return { id, teamId: TEAM, sourceKey: id, type, labels: [], createdAt: CREATED, lastSyncedAt: CREATED, ...fields }
}

/** `count` tickets under the epic, numbered from `from`. */
function childTickets(epicId: string, from: number, count: number): WorkItem[] {
  return Array.from({ length: count }, (_, i) => ticket(`${epicId}-${from + i}`, 'story', { parentId: epicId }))
}

/** A sync that brings new tickets under the epic. */
function addChildren(storage: Storage, epicId: string, from: number, count: number): void {
  storage.addFacts(TEAM, { workItems: childTickets(epicId, from, count), events: [] })
}

/** A sync that brings a status change of the epic. */
function moveEpic(storage: Storage, at: string, from: string, to: string): void {
  const event: WorkItemEvent = { itemId: 'E1', at, kind: 'status', from, to }
  storage.addFacts(TEAM, { workItems: [], events: [event] })
}

/** The EM commits the epic at `at`. */
function tryCommit(storage: Storage, epicId: string, at: string): EditResult {
  return editMilestone(storage, TEAM, { kind: 'commitEpic', epicId, at })
}

/** The EM commits the epic, failing the test if it is refused. */
function commit(storage: Storage, epicId: string, at: string): void {
  const result = tryCommit(storage, epicId, at)
  if (!result.ok) throw new Error(`commit refused: ${result.error}`)
}

function enterManualPace(storage: Storage, low: number, high: number): void {
  storage.savePaceSetting({ teamId: TEAM, milestoneId: MILESTONE, mode: 'manual', low, high })
}

/** The milestone's finish dates at 50%, 85% and 95%. */
function datesOf(storage: Storage): (string | null)[] {
  const { forecast } = view(storage)
  if (forecast.kind !== 'forecast') throw new Error('expected a forecast')
  return forecast.dates.map((entry) => entry.date)
}

function view(storage: Storage) {
  const shown = milestoneForecastView(storage, TEAM, { today: TODAY, settings: DEFAULT_SETTINGS })
  if (shown.kind !== 'milestone') throw new Error('expected a milestone')
  return shown
}

describe('committing an epic', () => {
  test("records the epic's child count as its baseline, and the epic no longer shows as not committed", () => {
    const storage = teamWithEpic(5)

    commit(storage, 'E1', COMMITTED)
    addChildren(storage, 'E1', 5, 3)

    expect(view(storage).epics).toEqual([
      { epicId: 'E1', key: 'E1', name: 'Epic E1', itemsNow: 8, commit: { baseline: 5 } },
    ])
  })

  test('growth applies to the baseline, not to the epic as it has grown since', () => {
    const storage = teamWithEpic(5)
    commit(storage, 'E1', COMMITTED)
    addChildren(storage, 'E1', 5, 5)
    // 10 a week. Committed at 5: medium growth (1 to 2×) gives 5 to 10, never below the 10 there now, so one week.
    // Growth on the 10 now would give 10 to 20, so two weeks at the median.
    enterManualPace(storage, 10, 10)

    expect(datesOf(storage)).toEqual(['2026-10-31', '2026-10-31', '2026-10-31'])
  })

  test("the Inputs screen shows each of the milestone's epics with its baseline once committed", () => {
    const storage = teamWithEpic(5)
    storage.addFacts(TEAM, { workItems: [ticket('E2', 'epic', { title: 'Epic E2' })], events: [] })
    editMilestone(storage, TEAM, { kind: 'addEpic', epicId: 'E2' })

    commit(storage, 'E1', COMMITTED)

    expect(milestoneDefinitionView(storage, TEAM, teamFacts(storage, TEAM))).toMatchObject({
      epics: [
        { epicId: 'E1', key: 'E1', name: 'Epic E1', commit: { baseline: 5 } },
        { epicId: 'E2', key: 'E2', name: 'Epic E2', commit: undefined },
      ],
    })
  })

  test('an epic outside the milestone cannot be committed', () => {
    const storage = teamWithEpic(5)
    storage.addFacts(TEAM, { workItems: [ticket('E2', 'epic')], events: [] })

    expect(tryCommit(storage, 'E2', COMMITTED)).toEqual({ ok: false, error: 'That epic is not in the milestone.' })
  })

  test('an epic already committed is not committed again, so its baseline stays', () => {
    const storage = teamWithEpic(5)
    commit(storage, 'E1', COMMITTED)
    addChildren(storage, 'E1', 5, 3)

    expect(tryCommit(storage, 'E1', '2026-10-09T09:00:00Z')).toEqual({ ok: false, error: 'That epic is already committed.' })
    expect(view(storage).epics[0]).toMatchObject({ commit: { baseline: 5 } })
  })

  test('a commit survives a restart', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'forecaster-')), 'forecaster.db')
    storage = openSqliteStorage(file)
    storage.saveTeam({ id: TEAM, name: TEAM, source: 'jira', sourceRef: TEAM })
    storage.addFacts(TEAM, { workItems: [ticket('E1', 'epic'), ...childTickets('E1', 0, 4)], events: [] })
    storage.saveMilestone({ id: MILESTONE, teamId: TEAM, name: 'Launch', committedDate: '2026-12-18', epicIds: ['E1'] })
    commit(storage, 'E1', COMMITTED)

    storage.close()
    storage = openSqliteStorage(file)

    expect(view(storage).epics[0]).toMatchObject({ commit: { baseline: 4 } })
    rmSync(dirname(file), { recursive: true, force: true })
  })
})

describe('pulling an epic back to not started', () => {
  test('loses its baseline: it shows as not committed and grows from its current count', () => {
    const storage = teamWithEpic(5)
    commit(storage, 'E1', COMMITTED)
    addChildren(storage, 'E1', 5, 5)
    moveEpic(storage, '2026-10-09T09:00:00Z', 'In Progress', 'To Do')
    // 10 a week: growth on the 10 now gives 10 to 20, so two weeks at the median
    enterManualPace(storage, 10, 10)

    expect(view(storage).epics).toEqual([
      { epicId: 'E1', key: 'E1', name: 'Epic E1', itemsNow: 10, commit: undefined },
    ])
    expect(datesOf(storage)).toEqual(['2026-11-07', '2026-11-07', '2026-11-07'])
  })

  test('reads the pull-back under the EM’s status mapping', () => {
    const storage = teamWithEpic(5)
    storage.saveWorkflowSettings({
      teamId: TEAM,
      statuses: [
        { status: 'To Do', category: 'notStarted' },
        { status: 'Ready', category: 'notStarted' },
        { status: 'In Progress', category: 'started' },
        { status: 'Review', category: 'started' },
      ],
      startedStatus: 'In Progress',
      spikeRule: { types: ['spike'], labels: [] },
      blockedRule: { statuses: [], labels: [] },
    })
    commit(storage, 'E1', COMMITTED)
    // started to started: not a pull-back
    moveEpic(storage, '2026-10-05T09:00:00Z', 'In Progress', 'Review')
    expect(view(storage).epics[0]).toMatchObject({ commit: { baseline: 5 } })

    // started to a status mapped to not started: a pull-back
    moveEpic(storage, '2026-10-09T09:00:00Z', 'Review', 'Ready')
    expect(view(storage).epics[0]).toMatchObject({ commit: undefined })
  })

  test('the EM can commit the restarted epic again, recording a new baseline', () => {
    const storage = teamWithEpic(5)
    commit(storage, 'E1', COMMITTED)
    moveEpic(storage, '2026-10-09T09:00:00Z', 'In Progress', 'To Do')
    addChildren(storage, 'E1', 5, 2)
    moveEpic(storage, '2026-10-16T09:00:00Z', 'To Do', 'In Progress')

    commit(storage, 'E1', '2026-10-16T12:00:00Z')
    addChildren(storage, 'E1', 7, 1)

    expect(view(storage).epics).toEqual([
      { epicId: 'E1', key: 'E1', name: 'Epic E1', itemsNow: 8, commit: { baseline: 7 } },
    ])
  })
})
