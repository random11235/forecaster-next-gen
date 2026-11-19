import { describe, expect, test } from 'vitest'
import type { SavedRead } from '../../src/model/savedRead.js'
import { TEAM, temporarySqliteFiles } from './storageContractFixtures.js'

// The Storage contract's cases for the team's setup, which only the SQLite file keeps, beside storageContract.test.ts.

const sqliteFile = temporarySqliteFiles()

describe("SQLite storage's setup", () => {
  // Where the team's setup steps stand (#217): open in a first setup until closed, done with "Use these" or connecting
  // skipped, and open again from how they were closed, with what that opening did to the connection.
  test('keeps where setup stands, open in a first setup until saved otherwise, replacing it each time', () => {
    const { storage, reopen } = sqliteFile()
    storage.saveTeam(TEAM)
    storage.saveTeam({ ...TEAM, id: 'another' })

    expect(storage.setupState('team')).toStrictEqual({ open: true })
    for (const state of [
      { open: true, connection: 'made' },
      { open: false, closed: 'skipped' },
      { open: true, reopened: 'skipped', connection: 'made' },
      { open: false, closed: 'done' },
      { open: true, reopened: 'done' },
      { open: true, reopened: 'done', connection: 'changed' },
    ] as const) {
      reopen().saveSetupState('team', state)
      expect(reopen().setupState('team')).toStrictEqual(state)
    }
    expect(reopen().setupState('another')).toStrictEqual({ open: true })
  })

  // What the EM chooses inside setup (#218): the Milestone and Comparable work steps' picks and queries, their reads,
  // the sources chosen at Check (#220) and why a pick's read failed there (#222), held apart until "Use these".
  test('keeps the setup draft whole, every part of it, replacing it, until it is discarded', () => {
    const { storage, reopen } = sqliteFile()
    storage.saveTeam(TEAM)
    const read: SavedRead = {
      tickets: [{ id: 'I_1' }, { id: 'I_2', finishedAt: '2026-10-20T10:00:00Z' }],
      incomplete: true,
      readAt: '2026-11-12T09:00:00Z',
      finishedSince: '2026-09-17T09:00:00Z',
    }
    const draft = {
      milestoneQuery: { picks: [{ kind: 'milestone' as const, name: 'Launch', query: 'milestone:"Launch"' }], query: 'milestone:"Launch"' },
      comparableWorkQuery: { picks: [], query: 'label:"beta"' },
      reads: [
        { query: 'milestone:"Launch"', read },
        { query: 'label:"beta"', read: { tickets: [], incomplete: false, readAt: '2026-11-12T09:01:00Z', finishedSince: '2026-09-17T09:01:00Z' } },
      ],
      sources: { ticketsRemaining: 'tracker' as const, pace: 'range' as const },
      pickFailures: {
        'label:"bug"': { failure: 'invalidQuery' as const, message: 'No such label.', at: '2026-11-12T09:02:00Z' },
        'label:"ui"': { failure: 'keychainFailed' as const, at: '2026-11-12T09:03:00Z' },
      },
    }

    expect(storage.setupDraft('team')).toBeUndefined()
    storage.saveSetupDraft('team', draft)
    expect(reopen().setupDraft('team')).toStrictEqual(draft)
    reopen().saveSetupDraft('team', { reads: [], sources: { pace: 'tracker' } })
    expect(reopen().setupDraft('team')).toStrictEqual({ reads: [], sources: { pace: 'tracker' } })
    reopen().saveSetupDraft('team', { reads: [] })
    expect(reopen().setupDraft('team')).toStrictEqual({ reads: [] })
    expect(reopen().setupDraft('another')).toBeUndefined()

    reopen().discardSetupDraft('team')
    expect(reopen().setupDraft('team')).toBeUndefined()
  })

  // Why the last reads failed (#222), so the summary still says why after a reload; none once read again.
  test('keeps why the reads failed whole, a query’s apart from a pick’s of the same query, replacing it, until none is left', () => {
    const { storage, reopen } = sqliteFile()
    storage.saveTeam(TEAM)
    const failures = {
      whole: { failure: 'unauthorised' as const, at: '2026-11-12T09:00:00Z' },
      queries: { 'milestone:"Q3"': { failure: 'invalidQuery' as const, message: 'No such milestone.', at: '2026-11-12T09:00:00Z' } },
      picks: {
        'milestone:"Q3"': { failure: 'unavailable' as const, at: '2026-11-11T09:00:00Z' },
        'label:bug': { failure: 'outOfScope' as const, at: '2026-11-11T09:00:00Z' },
      },
    }

    expect(storage.readFailures('team')).toBeUndefined()
    storage.saveReadFailures('team', { whole: { failure: 'keychainFailed', at: '2026-11-12T08:00:00Z' } })
    storage.saveReadFailures('team', failures)
    expect(reopen().readFailures('team')).toStrictEqual(failures)
    expect(reopen().readFailures('another')).toBeUndefined()
    reopen().saveReadFailures('team', { picks: failures.picks })
    expect(reopen().readFailures('team')).toStrictEqual({ picks: failures.picks })

    reopen().saveReadFailures('team', {})
    expect(reopen().readFailures('team')).toBeUndefined()
  })
})

// The team's queries and reads in two targets (#244): `current`, what the setup steps read and save with, the setup
// draft over what's saved while setup is open; and `saved`, what's saved only. "Use these" applies the draft; Cancel
// discards it.
