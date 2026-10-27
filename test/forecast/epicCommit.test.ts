import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import type { EditResult } from '../../src/forecast/editResult.js'
import { editInputs, inputsView } from '../../src/forecast/inputs.js'
import { milestoneForecastView } from '../../src/forecast/milestoneForecastView.js'
import { DEFAULT_SETTINGS } from '../../src/forecast/settings.js'
import { defaultWorkflowSettings, type WorkflowSettings } from '../../src/model/workflow.js'
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

/** `count` tickets under the epic, numbered from `from`, created at `createdAt`. */
function childTickets(epicId: string, from: number, count: number, createdAt = CREATED): WorkItem[] {
  return Array.from({ length: count }, (_, i) => ticket(`${epicId}-${from + i}`, 'story', { parentId: epicId, createdAt }))
}

/** A sync that brings new tickets under the epic, created at `createdAt`. */
function addChildren(storage: Storage, epicId: string, from: number, count: number, createdAt = CREATED): void {
  storage.addFacts(TEAM, { workItems: childTickets(epicId, from, count, createdAt), events: [] })
}

/** The EM's workflow: the sample board's, with these settings changed. */
function useWorkflow(storage: Storage, changes: Partial<WorkflowSettings>): void {
  storage.saveWorkflowSettings({ ...defaultWorkflowSettings(TEAM), ...changes })
}

/** A sync that brings E1 now carrying `labels`, with the label events that got it there. */
function labelEpic(storage: Storage, labels: string[], events: Omit<WorkItemEvent, 'itemId' | 'kind'>[]): void {
  storage.addFacts(TEAM, {
    workItems: [ticket('E1', 'epic', { title: 'Epic E1', labels })],
    events: events.map((event) => ({ itemId: 'E1', kind: 'label', ...event })),
  })
}

/** A sync that brings a ticket moved from one epic to another at `at`. */
function moveChild(storage: Storage, item: WorkItem, at: string, to: string): void {
  storage.addFacts(TEAM, {
    workItems: [{ ...item, parentId: to }],
    events: [{ itemId: item.id, at, kind: 'parent', ...(item.parentId !== undefined && { from: item.parentId }), to }],
  })
}

/** A sync that brings a status change of the epic. */
function moveEpic(storage: Storage, at: string, from: string, to: string): void {
  const event: WorkItemEvent = { itemId: 'E1', at, kind: 'status', from, to }
  storage.addFacts(TEAM, { workItems: [], events: [event] })
}

/** The EM commits the epic at `at`. */
function tryCommit(storage: Storage, epicId: string, at: string): EditResult {
  return editInputs(storage, TEAM, { kind: 'commitEpic', epicId, at })
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
      { epicId: 'E1', key: 'E1', name: 'Epic E1', currentCount: 8, doneCount: 0, commit: { baseline: 5, source: 'inTool' }, inProgress: true, finished: false, blocked: false, labelCommitReset: false, ambiguity: 'medium', growthSource: 'ambiguity', growthBasis: 'Medium ambiguity: grows 1–2×' },
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
    editInputs(storage, TEAM, { kind: 'addEpic', epicId: 'E2' })

    commit(storage, 'E1', COMMITTED)

    expect(inputsView(storage, TEAM).milestone).toMatchObject({
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
      { epicId: 'E1', key: 'E1', name: 'Epic E1', currentCount: 10, doneCount: 0, commit: undefined, inProgress: false, finished: false, blocked: false, labelCommitReset: false, ambiguity: 'medium', growthSource: 'ambiguity', growthBasis: 'Medium ambiguity: grows 1–2×' },
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

  test('a move to not started that comes without the status it left is still a pull-back', () => {
    const storage = teamWithEpic(5)
    commit(storage, 'E1', COMMITTED)
    storage.addFacts(TEAM, { workItems: [], events: [{ itemId: 'E1', at: '2026-10-09T09:00:00Z', kind: 'status', to: 'To Do' }] })

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
      { epicId: 'E1', key: 'E1', name: 'Epic E1', currentCount: 8, doneCount: 0, commit: { baseline: 7, source: 'inTool' }, inProgress: true, finished: false, blocked: false, labelCommitReset: false, ambiguity: 'medium', growthSource: 'ambiguity', growthBasis: 'Medium ambiguity: grows 1–2×' },
    ])
  })
})

describe('the commit label', () => {
  const LABELLED = '2026-10-03T09:00:00Z'
  const LATER = '2026-10-10T09:00:00Z'

  test('applying it commits the epic, with the child count at that moment as its baseline', () => {
    const storage = teamWithEpic(5)
    useWorkflow(storage, { commitLabel: 'committed' })

    labelEpic(storage, ['committed'], [{ at: LABELLED, to: 'committed' }])
    addChildren(storage, 'E1', 5, 3, LATER)

    expect(view(storage).epics[0]).toMatchObject({ currentCount: 8, commit: { baseline: 5, source: 'label' } })
  })

  test('the baseline counts the children the epic had then, not the ones it has now', () => {
    const storage = teamWithEpic(4)
    useWorkflow(storage, { commitLabel: 'committed' })
    const elsewhere = ticket('X', 'story', { parentId: 'E2' })
    storage.addFacts(TEAM, {
      workItems: [ticket('E2', 'epic'), elsewhere],
      events: [
        { itemId: 'E1-1', at: CREATED, kind: 'status', to: 'To Do' },
        { itemId: 'E1-1', at: KICKOFF, kind: 'status', from: 'To Do', to: 'Cancelled' },
        { itemId: 'E1-2', at: CREATED, kind: 'status', to: 'To Do' },
      ],
    })

    labelEpic(storage, ['committed'], [{ at: LABELLED, to: 'committed' }])
    // E1-0 moves away and E1-2 is cancelled after the label: both were children then. X moves in after: it wasn't.
    // E1-1 was cancelled before the label, so it doesn't count.
    moveChild(storage, childTickets('E1', 0, 1)[0]!, LATER, 'E2')
    storage.addFacts(TEAM, { workItems: [], events: [{ itemId: 'E1-2', at: LATER, kind: 'status', from: 'To Do', to: 'Cancelled' }] })
    moveChild(storage, elsewhere, LATER, 'E1')

    expect(view(storage).epics[0]).toMatchObject({ currentCount: 2, commit: { baseline: 3, source: 'label' } })
  })

  test('commits nothing until the EM sets it, and only the label the EM set commits', () => {
    const storage = teamWithEpic(5)
    labelEpic(storage, ['committed'], [{ at: LABELLED, to: 'committed' }])
    expect(view(storage).epics[0]).toMatchObject({ commit: undefined })

    useWorkflow(storage, { commitLabel: 'kicked-off' })
    expect(view(storage).epics[0]).toMatchObject({ commit: undefined })

    useWorkflow(storage, { commitLabel: 'committed' })
    expect(view(storage).epics[0]).toMatchObject({ commit: { baseline: 5, source: 'label' } })
  })

  test('a pull-back resets a label commit, and applying the label again on restart records a new baseline', () => {
    const storage = teamWithEpic(5)
    useWorkflow(storage, { commitLabel: 'committed' })
    labelEpic(storage, ['committed'], [{ at: LABELLED, to: 'committed' }])
    moveEpic(storage, '2026-10-09T09:00:00Z', 'In Progress', 'To Do')
    expect(view(storage).epics[0]).toMatchObject({ commit: undefined })

    addChildren(storage, 'E1', 5, 2, LATER)
    moveEpic(storage, '2026-10-16T09:00:00Z', 'To Do', 'In Progress')
    labelEpic(storage, ['committed'], [
      { at: '2026-10-16T10:00:00Z', from: 'committed' },
      { at: '2026-10-16T11:00:00Z', to: 'committed' },
    ])
    addChildren(storage, 'E1', 7, 1, '2026-10-20T09:00:00Z')

    expect(view(storage).epics[0]).toMatchObject({ currentCount: 8, commit: { baseline: 7, source: 'label' } })
  })

  test('an epic committed by its label is committed: the EM cannot commit it again', () => {
    const storage = teamWithEpic(5)
    useWorkflow(storage, { commitLabel: 'committed' })
    labelEpic(storage, ['committed'], [{ at: LABELLED, to: 'committed' }])

    expect(tryCommit(storage, 'E1', LATER)).toEqual({ ok: false, error: 'That epic is already committed.' })
  })

  test('applying the label to an epic the EM already committed keeps the EM’s commit and baseline', () => {
    const storage = teamWithEpic(5)
    useWorkflow(storage, { commitLabel: 'committed' })
    commit(storage, 'E1', COMMITTED)
    addChildren(storage, 'E1', 5, 3, LABELLED)

    labelEpic(storage, ['committed'], [{ at: LATER, to: 'committed' }])

    expect(view(storage).epics[0]).toMatchObject({ commit: { baseline: 5, source: 'inTool' } })
  })

  test('the earlier commit stands, so a label commit stands over a later one by the EM', () => {
    const storage = teamWithEpic(5)
    labelEpic(storage, ['committed'], [{ at: '2026-10-01T10:00:00Z', to: 'committed' }])
    addChildren(storage, 'E1', 5, 2, '2026-10-01T12:00:00Z')
    commit(storage, 'E1', COMMITTED)

    useWorkflow(storage, { commitLabel: 'committed' })

    expect(view(storage).epics[0]).toMatchObject({ commit: { baseline: 5, source: 'label' } })
  })
})

describe('the commit label coming off', () => {
  const LABELLED = '2026-10-03T09:00:00Z'
  const REMOVED = '2026-10-10T09:00:00Z'

  test('warns that the epic no longer has the label, and keeps its commit', () => {
    const storage = teamWithEpic(5)
    useWorkflow(storage, { commitLabel: 'committed' })
    labelEpic(storage, ['committed'], [{ at: LABELLED, to: 'committed' }])
    expect(view(storage).warnings).toEqual([])

    labelEpic(storage, [], [{ at: REMOVED, from: 'committed' }])

    expect(view(storage)).toMatchObject({
      epics: [{ commit: { baseline: 5, source: 'label', labelRemoved: true } }],
      warnings: ['Epic E1 is committed but no longer has the “committed” label'],
    })
  })

  test('applying the label again clears the warning, keeping the first baseline', () => {
    const storage = teamWithEpic(5)
    useWorkflow(storage, { commitLabel: 'committed' })
    labelEpic(storage, ['committed'], [{ at: LABELLED, to: 'committed' }])
    labelEpic(storage, [], [{ at: REMOVED, from: 'committed' }])
    addChildren(storage, 'E1', 5, 2, REMOVED)

    labelEpic(storage, ['committed'], [{ at: '2026-10-12T09:00:00Z', to: 'committed' }])

    expect(view(storage)).toMatchObject({
      epics: [{ commit: { baseline: 5, source: 'label', labelRemoved: false } }],
      warnings: [],
    })
  })

  test.each(['Done', 'Cancelled'])('is not raised once the epic moves to %s', (status) => {
    const storage = teamWithEpic(5)
    useWorkflow(storage, { commitLabel: 'committed' })
    labelEpic(storage, ['committed'], [{ at: LABELLED, to: 'committed' }])
    labelEpic(storage, [], [{ at: REMOVED, from: 'committed' }])

    moveEpic(storage, '2026-10-20T09:00:00Z', 'In Progress', status)

    expect(view(storage).warnings).toEqual([])
  })

  test('an epic the EM committed in the tool is not warned about for lacking the label', () => {
    const storage = teamWithEpic(5)
    useWorkflow(storage, { commitLabel: 'committed' })

    commit(storage, 'E1', COMMITTED)

    expect(view(storage).warnings).toEqual([])
  })
})

describe('the commit label left on through a pull-back', () => {
  const LABELLED = '2026-10-03T09:00:00Z'
  const PULLED_BACK = '2026-10-09T09:00:00Z'
  const WARNING =
    "Epic E1 has the “committed” label but isn't committed: it moved back to not started after the label went on. " +
    'Commit it on Inputs, or take the label off and put it back.'

  /** E1, committed by its label, then pulled back with the label still on. */
  function pulledBackWithLabel(): Storage {
    const storage = teamWithEpic(5)
    useWorkflow(storage, { commitLabel: 'committed' })
    labelEpic(storage, ['committed'], [{ at: LABELLED, to: 'committed' }])
    moveEpic(storage, PULLED_BACK, 'In Progress', 'To Do')
    return storage
  }

  test('warns that the epic carries the label but isn’t committed, and how to commit it', () => {
    const storage = pulledBackWithLabel()

    expect(view(storage)).toMatchObject({ epics: [{ commit: undefined }], warnings: [WARNING] })
  })

  test('once restarted, warns about the label in place of the in-progress warning', () => {
    const storage = pulledBackWithLabel()

    moveEpic(storage, '2026-10-16T09:00:00Z', 'To Do', 'In Progress')

    expect(view(storage)).toMatchObject({ epics: [{ commit: undefined }], warnings: [WARNING] })
  })

  test('the EM committing it in the tool clears the warning', () => {
    const storage = pulledBackWithLabel()
    moveEpic(storage, '2026-10-16T09:00:00Z', 'To Do', 'In Progress')

    commit(storage, 'E1', '2026-10-16T12:00:00Z')

    expect(view(storage)).toMatchObject({ epics: [{ commit: { source: 'inTool' } }], warnings: [] })
  })

  test('taking the label off and putting it back commits it by label and clears the warning', () => {
    const storage = pulledBackWithLabel()
    moveEpic(storage, '2026-10-16T09:00:00Z', 'To Do', 'In Progress')

    labelEpic(storage, [], [{ at: '2026-10-16T10:00:00Z', from: 'committed' }])
    labelEpic(storage, ['committed'], [{ at: '2026-10-16T11:00:00Z', to: 'committed' }])

    expect(view(storage)).toMatchObject({ epics: [{ commit: { source: 'label' } }], warnings: [] })
  })

  test('is not raised for an epic carrying the label with no record of it going on, so never pulled back', () => {
    const storage = teamWithEpic(5)
    useWorkflow(storage, { commitLabel: 'committed' })

    labelEpic(storage, ['committed'], [])

    expect(view(storage).warnings).toEqual(["Epic E1 is in progress but isn't committed"])
  })

  test.each(['Done', 'Cancelled'])('is not raised once the epic moves to %s', (status) => {
    const storage = pulledBackWithLabel()

    moveEpic(storage, '2026-10-16T09:00:00Z', 'To Do', status)

    expect(view(storage).warnings).toEqual([])
  })
})

describe('the in-progress-but-not-committed warning', () => {
  test('flags an epic whose own status is started with no commit standing, before any pace is entered', () => {
    const storage = teamWithEpic(5)

    expect(view(storage)).toMatchObject({
      forecast: { kind: 'needsPace' },
      warnings: ["Epic E1 is in progress but isn't committed"],
    })
  })

  test('is not raised once the epic is committed', () => {
    const storage = teamWithEpic(5)

    commit(storage, 'E1', COMMITTED)

    expect(view(storage).warnings).toEqual([])
  })

  test("its children's statuses play no part", () => {
    const storage = teamWithEpic(5)
    moveEpic(storage, '2026-10-02T09:00:00Z', 'In Progress', 'To Do')
    storage.addFacts(TEAM, {
      workItems: [],
      events: [{ itemId: 'E1-0', at: '2026-10-05T09:00:00Z', kind: 'status', from: 'To Do', to: 'In Progress' }],
    })

    expect(view(storage).warnings).toEqual([])
  })

  test('reads the epic’s status under the EM’s status mapping', () => {
    const storage = teamWithEpic(5)
    moveEpic(storage, '2026-10-05T09:00:00Z', 'In Progress', 'Review')
    // Review is unmapped, so it counts as not started
    expect(view(storage).warnings).toEqual([])

    useWorkflow(storage, { statuses: [...defaultWorkflowSettings(TEAM).statuses, { status: 'Review', category: 'started' }] })
    expect(view(storage).warnings).toEqual(["Epic E1 is in progress but isn't committed"])
  })

  test('is not raised for a done epic', () => {
    const storage = teamWithEpic(5)

    moveEpic(storage, '2026-10-20T09:00:00Z', 'In Progress', 'Done')

    expect(view(storage).warnings).toEqual([])
  })
})

describe('a blocked epic', () => {
  const BLOCKED = '2026-10-09T09:00:00Z'

  test('is flagged blocked by a blocked label, keeps its baseline and stays in the milestone and forecast', () => {
    const storage = teamWithEpic(5)
    commit(storage, 'E1', COMMITTED)
    enterManualPace(storage, 2, 4)
    const unblocked = datesOf(storage)

    labelEpic(storage, ['blocked'], [{ at: BLOCKED, to: 'blocked' }])

    expect(view(storage).epics).toEqual([
      {
        epicId: 'E1',
        key: 'E1',
        name: 'Epic E1',
        currentCount: 5,
        doneCount: 0,
        commit: { baseline: 5, source: 'inTool' },
        inProgress: true,
        finished: false,
        blocked: true,
        labelCommitReset: false, ambiguity: 'medium', growthSource: 'ambiguity', growthBasis: 'Medium ambiguity: grows 1–2×',
      },
    ])
    expect(datesOf(storage)).toEqual(unblocked)
  })

  test('is flagged blocked by a blocked status, and keeps its commit even when that status is mapped to not started', () => {
    const storage = teamWithEpic(5)
    useWorkflow(storage, {
      statuses: [...defaultWorkflowSettings(TEAM).statuses, { status: 'Blocked', category: 'notStarted' }],
      blockedRule: { statuses: ['Blocked'], labels: [] },
    })
    commit(storage, 'E1', COMMITTED)

    moveEpic(storage, BLOCKED, 'In Progress', 'Blocked')

    expect(view(storage).epics[0]).toMatchObject({ blocked: true, commit: { baseline: 5 } })
  })

  test('keeps its commit when unblocked, back to started or to not started', () => {
    const storage = teamWithEpic(5)
    useWorkflow(storage, {
      statuses: [...defaultWorkflowSettings(TEAM).statuses, { status: 'Blocked', category: 'notStarted' }],
      blockedRule: { statuses: ['Blocked'], labels: [] },
    })
    commit(storage, 'E1', COMMITTED)
    moveEpic(storage, BLOCKED, 'In Progress', 'Blocked')
    moveEpic(storage, '2026-10-12T09:00:00Z', 'Blocked', 'In Progress')
    expect(view(storage).epics[0]).toMatchObject({ blocked: false, commit: { baseline: 5 } })

    // started, blocked, then not started: not a pull-back, since an epic out of scope is removed from the milestone
    moveEpic(storage, '2026-10-14T09:00:00Z', 'In Progress', 'Blocked')
    moveEpic(storage, '2026-10-16T09:00:00Z', 'Blocked', 'To Do')
    expect(view(storage).epics[0]).toMatchObject({ blocked: false, commit: { baseline: 5 } })
  })

  test('keeps its commit when moved to not started while it carries a blocked label, and after the label comes off', () => {
    const storage = teamWithEpic(5)
    commit(storage, 'E1', COMMITTED)
    labelEpic(storage, ['blocked'], [{ at: BLOCKED, to: 'blocked' }])

    moveEpic(storage, '2026-10-12T09:00:00Z', 'In Progress', 'To Do')
    expect(view(storage).epics[0]).toMatchObject({ blocked: true, commit: { baseline: 5 } })

    labelEpic(storage, [], [{ at: '2026-10-14T09:00:00Z', from: 'blocked' }])
    expect(view(storage).epics[0]).toMatchObject({ blocked: false, commit: { baseline: 5 } })
  })

  test('is no longer flagged once unblocked', () => {
    const storage = teamWithEpic(5)
    labelEpic(storage, ['blocked'], [{ at: BLOCKED, to: 'blocked' }])

    labelEpic(storage, [], [{ at: '2026-10-12T09:00:00Z', from: 'blocked' }])

    expect(view(storage).epics[0]).toMatchObject({ blocked: false })
  })

  test('a label the EM has not set as blocking flags nothing', () => {
    const storage = teamWithEpic(5)
    useWorkflow(storage, { blockedRule: { statuses: [], labels: ['on-hold'] } })

    labelEpic(storage, ['blocked'], [{ at: BLOCKED, to: 'blocked' }])

    expect(view(storage).epics[0]).toMatchObject({ blocked: false })
  })
})
