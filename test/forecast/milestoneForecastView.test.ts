import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { milestoneForecastView } from '../../src/forecast/milestoneForecastView.js'
import { loadSampleDataIfEmpty } from '../../src/sample/loadSampleData.js'
import { openSqliteStorage } from '../../src/storage/sqliteStorage.js'
import type { Storage } from '../../src/storage/storage.js'
import type { Facts } from '../../src/model/workItem.js'

let dir: string
let storage: Storage | undefined

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'forecaster-'))
})

afterEach(() => {
  storage?.close()
  storage = undefined
  rmSync(dir, { recursive: true, force: true })
})

/** Closes the app's storage and opens the same file again, as a restart does. */
function restart(): Storage {
  storage?.close()
  return openStorage()
}

/** A team of the EM's own, with one epic of `children` tickets and a milestone holding it. */
function saveOwnTeam(storage: Storage, teamId: string, children: number): void {
  const at = '2026-10-01T09:00:00Z'
  const item = (id: string, type: string, parentId?: string) => ({
    id,
    teamId,
    sourceKey: id,
    type,
    ...(parentId !== undefined && { parentId }),
    labels: [],
    createdAt: at,
    lastSyncedAt: at,
  })
  const facts: Facts = {
    workItems: [
      { ...item(`${teamId}-E`, 'epic'), title: `${teamId} epic` },
      ...Array.from({ length: children }, (_, i) => item(`${teamId}-${i}`, 'story', `${teamId}-E`)),
    ],
    events: [{ itemId: `${teamId}-0`, at, kind: 'parent', to: `${teamId}-E` }],
  }
  storage.saveTeam({ id: teamId, name: teamId, source: 'jira', sourceRef: teamId })
  storage.addFacts(facts)
  storage.saveMilestone({
    id: `${teamId}-M`,
    teamId,
    name: `${teamId} milestone`,
    committedDate: '2027-01-29',
    epicIds: [`${teamId}-E`],
  })
}

/** Opens the SQLite file the app would use, in a fresh directory per test. */
function openStorage(): Storage {
  storage = openSqliteStorage(join(dir, 'forecaster.db'))
  return storage
}

describe('milestone forecast view on sample data', () => {
  test('on first launch, lists the sample milestone with each epic’s items now and status', () => {
    const storage = openStorage()

    loadSampleDataIfEmpty(storage)

    expect(milestoneForecastView(storage, storage.teams()[0]!.id)).toEqual({
      kind: 'milestone',
      name: 'Checkout v2',
      committedDate: '2026-12-18',
      epics: [
        { epicId: 'PAY-1', key: 'PAY-1', name: 'Card vaulting', itemsNow: 6, status: 'notCommitted' },
        { epicId: 'PAY-2', key: 'PAY-2', name: 'Refunds', itemsNow: 14, status: 'notCommitted' },
        { epicId: 'PAY-3', key: 'PAY-3', name: 'Receipts redesign', itemsNow: 3, status: 'notCommitted' },
      ],
    })
  })

  test('sample data is not loaded when data is already stored, and stored data survives a restart', () => {
    saveOwnTeam(openStorage(), 'ACME', 2)

    const reopened = restart()
    loadSampleDataIfEmpty(reopened)

    expect(reopened.teams().map((team) => team.id)).toEqual(['ACME'])
    expect(milestoneForecastView(reopened, 'ACME')).toEqual({
      kind: 'milestone',
      name: 'ACME milestone',
      committedDate: '2027-01-29',
      epics: [{ epicId: 'ACME-E', key: 'ACME-E', name: 'ACME epic', itemsNow: 2, status: 'notCommitted' }],
    })
  })

  test("each team sees only its own milestone and tickets", () => {
    const storage = openStorage()
    saveOwnTeam(storage, 'ACME', 2)
    saveOwnTeam(storage, 'BETA', 5)

    const view = milestoneForecastView(storage, 'BETA')

    expect(view).toMatchObject({ kind: 'milestone', name: 'BETA milestone' })
    expect(view.kind === 'milestone' && view.epics.map((epic) => epic.itemsNow)).toEqual([5])
    expect(storage.facts('BETA').workItems.every((item) => item.teamId === 'BETA')).toBe(true)
    expect(storage.facts('BETA').events.map((event) => event.itemId)).toEqual(['BETA-0'])
  })

  test('a team with no milestone shows the empty state', () => {
    const storage = openStorage()
    storage.saveTeam({ id: 'ACME', name: 'ACME', source: 'jira', sourceRef: 'ACME' })

    expect(milestoneForecastView(storage, 'ACME')).toEqual({ kind: 'noMilestone' })
  })
})
