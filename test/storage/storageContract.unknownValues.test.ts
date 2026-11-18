import { DatabaseSync } from 'node:sqlite'
import { describe, expect, test } from 'vitest'
import type { MilestoneQuery } from '../../src/model/milestoneQuery.js'
import { TEAM, temporarySqliteFiles } from './storageContractFixtures.js'

// The Storage contract's cases for stored values this version doesn't know, as a later version would leave them,
// beside storageContract.setup.test.ts and storageContract.sqlite.test.ts: each is written straight into the SQLite
// file, which storage can't write, and read back as nothing rather than as something it isn't.

const sqliteFile = temporarySqliteFiles()

describe("SQLite storage's setup, with values it doesn't know", () => {
  test('reads back setup closed in a way it doesn’t know, from a later version, as open, and a connection change it doesn’t know as none', () => {
    const { file, storage, reopen } = sqliteFile()
    storage.saveTeam(TEAM)
    storage.saveSetupState('team', { open: false, closed: 'done' })
    const db = new DatabaseSync(file)
    db.prepare("UPDATE setups SET closed = 'archived'").run()
    db.close()
    expect(reopen().setupState('team')).toStrictEqual({ open: true })

    reopen().saveSetupState('team', { open: true, reopened: 'done', connection: 'made' })
    const again = new DatabaseSync(file)
    again.prepare("UPDATE setups SET connection = 'moved'").run()
    again.close()
    expect(reopen().setupState('team')).toStrictEqual({ open: true, reopened: 'done' })
  })

  test('keeps nothing of a drafted pick but its kind, name and query, and reads back no source it doesn’t know', () => {
    const { file, storage, reopen } = sqliteFile()
    storage.saveTeam(TEAM)
    const handed = { kind: 'label' as const, name: 'payments', query: 'label:"payments"', overHundred: true }
    storage.saveSetupDraft('team', {
      milestoneQuery: { picks: [handed], query: handed.query },
      reads: [],
      sources: { ticketsRemaining: 'typed', pace: 'counts' },
    })
    const db = new DatabaseSync(file)
    db.prepare("UPDATE setup_drafts SET tickets_source = 'estimated', pace_mode = 'velocity'").run()
    db.close()

    expect(reopen().setupDraft('team')).toStrictEqual({
      milestoneQuery: { picks: [{ kind: 'label', name: 'payments', query: 'label:"payments"' }], query: 'label:"payments"' },
      reads: [],
    })
  })

  test('reads back no failure it doesn’t know, from a later version', () => {
    const { file, storage, reopen } = sqliteFile()
    storage.saveTeam(TEAM)
    storage.saveReadFailures('team', {
      whole: { failure: 'unavailable', at: '2026-11-12T09:00:00Z' },
      picks: { 'label:bug': { failure: 'notFound', at: '2026-11-12T09:00:00Z' } },
    })
    const db = new DatabaseSync(file)
    db.prepare("UPDATE read_failures SET failure = 'melted' WHERE of = 'whole'").run()
    db.close()

    expect(reopen().readFailures('team')).toStrictEqual({ picks: { 'label:bug': { failure: 'notFound', at: '2026-11-12T09:00:00Z' } } })
  })
})

describe("SQLite storage's milestone and comparable work queries, with picks it doesn't know", () => {
  const PICKED: MilestoneQuery = {
    picks: [
      { kind: 'epic', name: 'Checkout redesign', query: 'parent-issue:acme/checkout#106' },
      { kind: 'label', name: 'payments', query: 'label:"payments"' },
    ],
    query: 'parent-issue:acme/checkout#106 OR label:"payments"',
  }

  test('reads back no pick of a kind it doesn’t know, keeping the query and the other picks', () => {
    const { file, storage, reopen } = sqliteFile()
    storage.saveTeam(TEAM)
    storage.saveMilestoneQuery('team', PICKED)
    const db = new DatabaseSync(file)
    const stored = [{ kind: 'component', name: 'Payments', query: 'component = Payments' }, ...PICKED.picks]
    db.prepare('UPDATE milestone_queries SET picks = ?').run(JSON.stringify(stored))
    db.close()

    expect(reopen().milestoneQuery('team')).toEqual(PICKED)
  })

  test("reads back no comparable-work pick of a kind it doesn't know, keeping the query", () => {
    const { file, storage, reopen } = sqliteFile()
    storage.saveTeam(TEAM)
    storage.saveComparableWorkQuery('team', PICKED)
    const db = new DatabaseSync(file)
    const stored = [{ kind: 'component', name: 'Payments', query: 'component = Payments' }, ...PICKED.picks]
    db.prepare('UPDATE comparable_work_queries SET picks = ?').run(JSON.stringify(stored))
    db.close()

    expect(reopen().comparableWorkQuery('team')).toEqual(PICKED)
  })
})
