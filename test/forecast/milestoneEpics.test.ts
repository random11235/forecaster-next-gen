import { afterEach, describe, expect, test } from 'vitest'
import { editInputs } from '../../src/forecast/inputs.js'
import { baselineOf, milestoneEpics, type MilestoneEpic } from '../../src/forecast/milestoneEpics.js'
import { DEFAULT_SETTINGS } from '../../src/forecast/settings.js'
import { teamFacts } from '../../src/forecast/teamFacts.js'
import type { WorkItem } from '../../src/model/workItem.js'
import { openSqliteStorage } from '../../src/storage/sqliteStorage.js'
import type { Storage } from '../../src/storage/storage.js'

/** Before any ticket the tests finish, so installation leaves out none of them. */
const INSTALLED = '2026-01-01T00:00:00Z'

const TEAM = 'ACME'
const CREATED = '2026-09-01T09:00:00Z'
const KICKOFF = '2026-10-01T09:00:00Z'
const DONE = '2026-10-05T09:00:00Z'
const TODAY = '2026-10-24'
const MILESTONE = { id: 'ACME-M', teamId: TEAM, name: 'Launch', committedDate: '2026-12-18', epicIds: ['E2', 'E1'] }

let storage: Storage | undefined

afterEach(() => {
  storage?.close()
  storage = undefined
})

function ticket(id: string, type: string, fields: Partial<WorkItem> = {}): WorkItem {
  return { id, teamId: TEAM, sourceKey: id, type, labels: [], createdAt: CREATED, lastSyncedAt: CREATED, ...fields }
}

/**
 * A milestone of two started epics, ranked E2 then E1. E1 has three children: one done, one not, one cancelled.
 * E2 has one child, not done, and no title.
 */
function twoEpics(): Storage {
  storage = openSqliteStorage(':memory:')
  storage.saveTeam({ id: TEAM, name: TEAM, source: 'jira', sourceRef: TEAM, installedAt: INSTALLED })
  storage.addFacts(TEAM, {
    workItems: [
      ticket('E1', 'epic', { title: 'Epic E1' }),
      ticket('E1-1', 'story', { parentId: 'E1', doneAt: DONE }),
      ticket('E1-2', 'story', { parentId: 'E1' }),
      ticket('E1-3', 'story', { parentId: 'E1', cancelledAt: DONE }),
      ticket('E2', 'epic'),
      ticket('E2-1', 'story', { parentId: 'E2' }),
    ],
    events: ['E1', 'E2'].flatMap((itemId) => [
      { itemId, at: CREATED, kind: 'status' as const, to: 'To Do' },
      { itemId, at: KICKOFF, kind: 'status' as const, from: 'To Do', to: 'In Progress' },
    ]),
  })
  storage.saveMilestone(MILESTONE)
  return storage
}

function epicsOf(storage: Storage): MilestoneEpic[] {
  return milestoneEpics(MILESTONE, teamFacts(storage, TEAM), new Map())
}

describe("a milestone's epics", () => {
  test('come in rank order with their current and done counts, not counting cancelled children', () => {
    expect(epicsOf(twoEpics())).toEqual([
      { epicId: 'E2', key: 'E2', name: 'E2', currentCount: 1, doneCount: 0, commit: undefined, inProgress: true, finished: false, blocked: false, labelCommitReset: false, ambiguity: 'medium' },
      { epicId: 'E1', key: 'E1', name: 'Epic E1', currentCount: 2, doneCount: 1, commit: undefined, inProgress: true, finished: false, blocked: false, labelCommitReset: false, ambiguity: 'medium' },
    ])
  })
})

describe('the baseline', () => {
  test("of an uncommitted epic is provisional: its current count", () => {
    const [, e1] = epicsOf(twoEpics())

    expect(baselineOf(e1!)).toBe(2)
  })

  test("of a committed epic is its commit's, however the epic has grown since", () => {
    const storage = twoEpics()
    expect(editInputs(storage, TEAM, { kind: 'commitEpic', epicId: 'E1', at: '2026-10-02T12:00:00Z' }, DEFAULT_SETTINGS, TODAY)).toEqual({ ok: true })
    storage.addFacts(TEAM, { workItems: [ticket('E1-4', 'story', { parentId: 'E1' })], events: [] })

    const [, e1] = epicsOf(storage)

    expect(e1).toMatchObject({ currentCount: 3, commit: { baseline: 2 } })
    expect(baselineOf(e1!)).toBe(2)
  })
})
