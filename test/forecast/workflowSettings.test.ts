import { afterEach, describe, expect, test } from 'vitest'
import { milestoneForecastView } from '../../src/forecast/milestoneForecastView.js'
import { DEFAULT_SETTINGS } from '../../src/forecast/settings.js'
import { teamFacts } from '../../src/forecast/teamFacts.js'
import { editInputs, inputsView } from '../../src/forecast/inputs.js'
import type { WorkflowEdit } from '../../src/forecast/workflowSettings.js'
import type { WorkItem, WorkItemEvent } from '../../src/model/workItem.js'
import { loadSampleDataIfEmpty } from '../../src/sample/loadSampleData.js'
import { SAMPLE_DATA } from '../../src/sample/sampleData.js'
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

/** A ticket under epic E1 and the board statuses it moved through, each `[status, ISO timestamp]`. */
interface TicketSpec {
  id: string
  path: [string, string][]
  type?: string
  labels?: string[]
}

/**
 * A Jira team whose board says nothing about started, done or cancelled except through its status history, as a
 * connector records it. Its milestone holds epic E1, whose children are `tickets`.
 */
function teamWithBoard(tickets: TicketSpec[]): Storage {
  storage = openSqliteStorage(':memory:')
  storage.saveTeam({ id: TEAM, name: TEAM, source: 'jira', sourceRef: TEAM })
  const workItems: WorkItem[] = [item('E1', 'epic', { title: 'Epic E1' })]
  const events: WorkItemEvent[] = []
  for (const ticket of tickets) {
    workItems.push(item(ticket.id, ticket.type ?? 'story', { parentId: 'E1', labels: ticket.labels ?? [] }))
    let from: string | undefined
    for (const [status, at] of ticket.path) {
      events.push({ itemId: ticket.id, at, kind: 'status', ...(from !== undefined && { from }), to: status })
      from = status
    }
  }
  storage.addFacts(TEAM, { workItems, events })
  storage.saveMilestone({ id: MILESTONE, teamId: TEAM, name: 'Launch', committedDate: '2026-12-18', epicIds: ['E1'] })
  storage.savePaceSetting({ teamId: TEAM, milestoneId: MILESTONE, mode: 'measured' })
  return storage
}

function item(id: string, type: string, fields: Partial<WorkItem> = {}): WorkItem {
  return { id, teamId: TEAM, sourceKey: id, type, labels: [], createdAt: CREATED, lastSyncedAt: CREATED, ...fields }
}

/** A ticket that went from Backlog through Building to Shipped, shipped at `at`. */
function shipped(id: string, at: string): TicketSpec {
  return { id, path: [['Backlog', CREATED], ['Building', '2026-10-01T09:00:00Z'], ['Shipped', at]] }
}

/** The settings the EM would submit for this board: `categories` by status, and the rest as typed. */
function form(categories: Record<string, string>, fields: Partial<WorkflowEdit> = {}): WorkflowEdit {
  return {
    categories,
    startedStatus: 'Building',
    commitLabel: '',
    blockedRule: { statuses: [], labels: [] },
    ...fields,
  }
}

const BOARD = { Backlog: 'notStarted', Building: 'started', Shipped: 'done', Dropped: 'cancelled' }

function save(storage: Storage, typed: WorkflowEdit): void {
  const result = editInputs(storage, TEAM, { kind: 'editWorkflow', ...typed })
  if (!result.ok) throw new Error(`settings refused: ${result.error}`)
}

function forecastView(storage: Storage) {
  const view = milestoneForecastView(storage, TEAM, { today: TODAY, settings: DEFAULT_SETTINGS })
  if (view.kind !== 'milestone') throw new Error('expected a milestone')
  return view
}

describe('status mapping', () => {
  test('a ticket counts as done once it reaches a status mapped to done', () => {
    const storage = teamWithBoard([shipped('T1', '2026-10-20T16:00:00Z'), shipped('T2', '2026-10-13T16:00:00Z')])

    save(storage, form({ ...BOARD, Shipped: 'started' }))
    expect(forecastView(storage).forecast).toMatchObject({ kind: 'thinData' })

    save(storage, form(BOARD))
    expect(forecastView(storage).forecast).toMatchObject({ kind: 'forecast', pace: { mode: 'measured' } })
  })

  test("a ticket in a status mapped to cancelled no longer counts among the epic's items", () => {
    const storage = teamWithBoard([
      shipped('T1', '2026-10-20T16:00:00Z'),
      { id: 'T2', path: [['Backlog', CREATED], ['Dropped', '2026-10-02T09:00:00Z']] },
    ])

    save(storage, form({ ...BOARD, Dropped: 'notStarted' }))
    expect(forecastView(storage).epics[0]).toMatchObject({ currentCount: 2 })

    save(storage, form(BOARD))
    expect(forecastView(storage).epics[0]).toMatchObject({ currentCount: 1 })
  })

  test('a ticket reopened from done counts as not done', () => {
    const storage = teamWithBoard([
      { id: 'T1', path: [['Backlog', CREATED], ['Shipped', '2026-10-05T09:00:00Z'], ['Building', '2026-10-06T09:00:00Z']] },
    ])
    save(storage, form(BOARD))

    expect(forecastView(storage).forecast).toMatchObject({ kind: 'thinData' })
  })

  test('a ticket is done from when it entered the first of a run of done statuses', () => {
    // Shipped in the week before last, Verified last week: done the week it shipped, so two weeks of pace (1, 0),
    // which vary a lot. Counted from Verified, there would be one week, too few for a pace variation note.
    const storage = teamWithBoard([
      { id: 'T1', path: [['Backlog', CREATED], ['Shipped', '2026-10-13T09:00:00Z'], ['Verified', '2026-10-21T09:00:00Z']] },
    ])
    save(storage, form({ ...BOARD, Verified: 'done' }))

    expect(forecastView(storage).forecast).toMatchObject({
      kind: 'forecast',
      notes: ['Your weekly pace varies a lot, so the range is wide.'],
    })
  })

  test('a status that is not mapped counts as not started', () => {
    const storage = teamWithBoard([shipped('T1', '2026-10-20T16:00:00Z')])
    // A Jira team that hasn't set its workflow has the sample board's, which has no Shipped status

    expect(forecastView(storage).forecast).toMatchObject({ kind: 'thinData' })
  })
})

describe('cycle time start', () => {
  function startedAt(storage: Storage, id: string): string | undefined {
    return teamFacts(storage, TEAM).facts.workItems.find((item) => item.id === id)?.startedAt
  }

  test('a ticket starts when it first enters the started status', () => {
    const storage = teamWithBoard([
      { id: 'T1', path: [['Backlog', CREATED], ['Review', '2026-10-01T09:00:00Z'], ['Building', '2026-10-02T09:00:00Z'], ['Shipped', '2026-10-05T09:00:00Z']] },
    ])
    save(storage, form({ ...BOARD, Review: 'started' }))

    expect(startedAt(storage, 'T1')).toBe('2026-10-02T09:00:00Z')
  })

  test('a ticket that skips the started status starts when it first enters another status mapped to started', () => {
    const storage = teamWithBoard([
      { id: 'T1', path: [['Backlog', CREATED], ['Review', '2026-10-01T09:00:00Z'], ['Shipped', '2026-10-05T09:00:00Z']] },
    ])
    save(storage, form({ ...BOARD, Review: 'started' }))

    expect(startedAt(storage, 'T1')).toBe('2026-10-01T09:00:00Z')
  })

  test('a ticket that skips every started status starts when it first enters a status mapped to done', () => {
    const storage = teamWithBoard([{ id: 'T1', path: [['Backlog', CREATED], ['Shipped', '2026-10-05T09:00:00Z']] }])
    save(storage, form(BOARD))

    expect(startedAt(storage, 'T1')).toBe('2026-10-05T09:00:00Z')
  })

  test('a ticket that has only been in not-started or cancelled statuses has not started', () => {
    const storage = teamWithBoard([{ id: 'T1', path: [['Backlog', CREATED], ['Dropped', '2026-10-05T09:00:00Z']] }])
    save(storage, form(BOARD))

    expect(startedAt(storage, 'T1')).toBeUndefined()
  })
})

describe('team facts', () => {
  test("a ticket with no status history keeps the connector's started, done and cancelled times whatever the mapping", () => {
    const storage = teamWithBoard([shipped('T1', '2026-10-20T16:00:00Z')])
    const fromConnector = {
      T2: { startedAt: '2026-10-02T09:00:00Z', doneAt: '2026-10-09T09:00:00Z' },
      T3: { startedAt: '2026-10-03T09:00:00Z', cancelledAt: '2026-10-10T09:00:00Z' },
    }
    storage.addFacts(TEAM, {
      workItems: [item('T2', 'story', { parentId: 'E1', ...fromConnector.T2 }), item('T3', 'story', { parentId: 'E1', ...fromConnector.T3 })],
      events: [],
    })
    const times = () =>
      teamFacts(storage, TEAM)
        .facts.workItems.filter((ticket) => ticket.id !== 'T1' && ticket.id !== 'E1')
        .map(({ id, startedAt, doneAt, cancelledAt }) => ({ id, startedAt, doneAt, cancelledAt }))
    const expected = [
      { id: 'T2', startedAt: '2026-10-02T09:00:00Z', doneAt: '2026-10-09T09:00:00Z', cancelledAt: undefined },
      { id: 'T3', startedAt: '2026-10-03T09:00:00Z', doneAt: undefined, cancelledAt: '2026-10-10T09:00:00Z' },
    ]

    expect(times()).toEqual(expected)
    save(storage, form(BOARD))
    expect(times()).toEqual(expected)
    save(storage, form({ ...BOARD, Shipped: 'cancelled', Dropped: 'done' }))
    expect(times()).toEqual(expected)
  })
})

describe('workflow settings view', () => {
  test("a team that hasn't set its workflow has the sample board's, then its own statuses still to map", () => {
    const storage = teamWithBoard([shipped('T1', '2026-10-20T16:00:00Z')])

    expect(inputsView(storage, TEAM).workflow).toEqual({
      statuses: [
        { status: 'To Do', category: 'notStarted' },
        { status: 'In Progress', category: 'started' },
        { status: 'Done', category: 'done' },
        { status: 'Cancelled', category: 'cancelled' },
        { status: 'Backlog', category: undefined },
        { status: 'Building', category: undefined },
        { status: 'Shipped', category: undefined },
      ],
      startedStatus: 'In Progress',
      commitLabel: undefined,
      blockedRule: { statuses: [], labels: ['blocked'] },
    })
  })

  test('shows the settings as saved: the mapping in order, the started status, commit label and blocked marker', () => {
    const storage = teamWithBoard([shipped('T1', '2026-10-20T16:00:00Z')])

    save(
      storage,
      form(
        { Backlog: 'notStarted', Building: 'started', Review: 'started', Shipped: 'done' },
        {
          startedStatus: ' Building ',
          commitLabel: ' committed ',
          blockedRule: { statuses: ['Review'], labels: ['blocked', ' waiting', 'blocked'] },
        },
      ),
    )

    expect(inputsView(storage, TEAM).workflow).toEqual({
      statuses: [
        { status: 'Backlog', category: 'notStarted' },
        { status: 'Building', category: 'started' },
        { status: 'Review', category: 'started' },
        { status: 'Shipped', category: 'done' },
      ],
      startedStatus: 'Building',
      commitLabel: 'committed',
      blockedRule: { statuses: ['Review'], labels: ['blocked', 'waiting'] },
    })
  })

  test('a status no ticket has been in can be left blank, which removes it', () => {
    const storage = teamWithBoard([shipped('T1', '2026-10-20T16:00:00Z')])

    save(storage, form({ 'To Do': '', 'In Progress': '', Done: '', Cancelled: '', ...BOARD }))

    expect(inputsView(storage, TEAM).workflow.statuses.map((entry) => entry.status)).toEqual([
      'Backlog',
      'Building',
      'Shipped',
      'Dropped',
    ])
  })

  test('a blank commit label means none', () => {
    const storage = teamWithBoard([shipped('T1', '2026-10-20T16:00:00Z')])
    save(storage, form(BOARD, { commitLabel: 'committed' }))

    save(storage, form(BOARD, { commitLabel: '  ' }))

    expect(inputsView(storage, TEAM).workflow).toMatchObject({ commitLabel: undefined })
  })
})

describe('the sample data', () => {
  function sampleTeam(): Storage {
    storage = openSqliteStorage(':memory:')
    loadSampleDataIfEmpty(storage)
    storage.savePaceSetting({ teamId: SAMPLE_DATA.team.id, milestoneId: SAMPLE_DATA.milestone.id, mode: 'measured' })
    return storage
  }

  test("ships with its board's mapping started status and commit label", () => {
    const storage = sampleTeam()

    expect(inputsView(storage, SAMPLE_DATA.team.id).workflow).toEqual({
      statuses: [
        { status: 'To Do', category: 'notStarted' },
        { status: 'In Progress', category: 'started' },
        { status: 'Done', category: 'done' },
        { status: 'Cancelled', category: 'cancelled' },
      ],
      startedStatus: 'In Progress',
      commitLabel: 'committed',
      blockedRule: { statuses: [], labels: ['blocked'] },
    })
  })

  test('changing the mapping changes which tickets the forecast counts as done', () => {
    const storage = sampleTeam()
    const teamId = SAMPLE_DATA.team.id
    const before = milestoneForecastView(storage, teamId, { today: TODAY, settings: DEFAULT_SETTINGS })
    expect(before).toMatchObject({ forecast: { kind: 'forecast' } })

    const result = editInputs(storage, teamId, {
      kind: 'editWorkflow',
      categories: { 'To Do': 'notStarted', 'In Progress': 'started', Done: 'started', Cancelled: 'cancelled' },
      startedStatus: 'In Progress',
      commitLabel: '',
      blockedRule: { statuses: [], labels: ['blocked'] },
    })

    expect(result).toEqual({ ok: true })
    expect(milestoneForecastView(storage, teamId, { today: TODAY, settings: DEFAULT_SETTINGS })).toMatchObject({
      forecast: { kind: 'thinData' },
    })
  })
})

const UNMAPPED_SHIPPED = 'Choose what "Shipped" means: not started, started, done or cancelled.'
const NOT_A_STARTED_STATUS = 'Choose a started status from the statuses mapped to started.'

describe('refused workflow settings', () => {
  test.each([
    { why: 'a status on the board left unmapped', categories: { Backlog: 'notStarted', Building: 'started' }, fields: {}, error: UNMAPPED_SHIPPED },
    { why: 'a status given no category', categories: { ...BOARD, Shipped: '' }, fields: {}, error: UNMAPPED_SHIPPED },
    { why: 'a started status not mapped to started', categories: BOARD, fields: { startedStatus: 'Backlog' }, error: NOT_A_STARTED_STATUS },
    { why: 'a started status not on the board', categories: BOARD, fields: { startedStatus: 'Coding' }, error: NOT_A_STARTED_STATUS },
    { why: 'a blocked status not on the board', categories: BOARD, fields: { blockedRule: { statuses: ['On hold'], labels: [] } }, error: `"On hold" isn't a status on the board.` },
  ])('$why says why and changes nothing', ({ categories, fields, error }) => {
    const storage = teamWithBoard([shipped('T1', '2026-10-20T16:00:00Z')])
    save(storage, form(BOARD))
    const before = inputsView(storage, TEAM).workflow

    expect(editInputs(storage, TEAM, { kind: 'editWorkflow', ...form(categories, fields) })).toEqual({ ok: false, error })
    expect(inputsView(storage, TEAM).workflow).toEqual(before)
  })
})
