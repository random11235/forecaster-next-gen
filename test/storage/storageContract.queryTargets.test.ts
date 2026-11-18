import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import type { MilestoneQuery } from '../../src/model/milestoneQuery.js'
import type { SavedRead } from '../../src/model/savedRead.js'
import { openSqliteStorage, type SqliteStorage } from '../../src/storage/sqliteStorage.js'
import type { SetupState, Storage } from '../../src/storage/storage.js'
import { TEAM } from './storageContractFixtures.js'

// The Storage contract's cases for the team's queries and reads in each target, which only the SQLite file keeps,
// beside storageContract.test.ts.

let dir: string | undefined
let open: Storage | undefined

afterEach(() => {
  open?.close()
  open = undefined
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

describe("SQLite storage's query targets", () => {
  const LAUNCH_QUERY: MilestoneQuery = { picks: [{ kind: 'milestone', name: 'Launch', query: 'milestone:"Launch"' }], query: 'milestone:"Launch"' }
  const BETA_QUERY: MilestoneQuery = { picks: [], query: 'label:"beta"' }
  const EPIC_QUERY: MilestoneQuery = {
    picks: [{ kind: 'epic', name: 'Checkout redesign', query: 'parent-issue:acme/checkout#106' }],
    query: 'parent-issue:acme/checkout#106',
  }
  const readAt = (at: string): SavedRead => ({ tickets: [{ id: 'I_1' }], incomplete: false, readAt: at, finishedSince: '2026-09-01T09:00:00Z' })
  const FIRST = readAt('2026-11-10T09:00:00Z')
  const SECOND = readAt('2026-11-11T09:00:00Z')
  const THIRD = readAt('2026-11-12T09:00:00Z')
  const launch = { teamId: 'team', query: LAUNCH_QUERY.query }
  const epic = { teamId: 'team', query: EPIC_QUERY.query }

  function sqliteFile(): { storage: SqliteStorage; reopen: () => SqliteStorage } {
    dir = mkdtempSync(join(tmpdir(), 'forecaster-'))
    const file = join(dir, 'forecaster.db')
    const reopen = (): SqliteStorage => {
      open?.close()
      const storage = openSqliteStorage(file)
      open = storage
      return storage
    }
    return { storage: reopen(), reopen }
  }

  /** A team with the Launch milestone saved and read once, its setup as `state`. */
  function saved(state: SetupState): { storage: SqliteStorage; reopen: () => SqliteStorage } {
    const opened = sqliteFile()
    opened.storage.saveTeam(TEAM)
    opened.storage.saveMilestoneQuery('team', LAUNCH_QUERY)
    opened.storage.saveRead(launch, FIRST)
    opened.storage.saveSetupState('team', state)
    return opened
  }

  test('with setup closed, every target reads and saves what is saved, drafting nothing', () => {
    for (const target of ['current', 'saved'] as const) {
      const { storage, reopen } = saved({ open: false, closed: 'done' })
      const { milestoneQueries, reads } = storage.teamQueries(target)

      expect(milestoneQueries.milestoneQuery('team')).toEqual(LAUNCH_QUERY)
      expect(reads.savedRead(launch)).toEqual(FIRST)
      milestoneQueries.saveComparableWorkQuery('team', BETA_QUERY)
      reads.saveRead(launch, SECOND)

      const again = reopen()
      expect(again.comparableWorkQuery('team')).toEqual(BETA_QUERY)
      expect(again.savedRead(launch)).toEqual(SECOND)
      expect(again.previousRead(launch)).toEqual(FIRST)
      expect(again.setupDraft('team')).toBeUndefined()
    }
  })

  test('with setup open, current reads the draft over what is saved and saves into it, the saved read its previous', () => {
    const { storage, reopen } = saved({ open: true, reopened: 'done' })
    const current = storage.teamQueries('current')

    expect(current.milestoneQueries.milestoneQuery('team')).toEqual(LAUNCH_QUERY)
    expect(current.reads.savedRead(launch)).toEqual(FIRST)
    current.milestoneQueries.saveMilestoneQuery('team', EPIC_QUERY)
    current.milestoneQueries.saveComparableWorkQuery('team', BETA_QUERY)
    current.reads.saveRead(epic, SECOND)
    current.reads.saveRead(launch, THIRD)

    const again = reopen().teamQueries('current')
    expect(again.milestoneQueries.milestoneQuery('team')).toEqual(EPIC_QUERY)
    expect(again.milestoneQueries.comparableWorkQuery('team')).toEqual(BETA_QUERY)
    expect(again.reads.savedRead(epic)).toEqual(SECOND)
    expect(again.reads.previousRead(epic)).toBeUndefined()
    expect(again.reads.savedRead(launch)).toEqual(THIRD)
    expect(again.reads.previousRead(launch)).toEqual(FIRST)
    expect(reopen().setupDraft('team')).toEqual({
      milestoneQuery: EPIC_QUERY,
      comparableWorkQuery: BETA_QUERY,
      reads: [
        { query: epic.query, read: SECOND },
        { query: launch.query, read: THIRD },
      ],
    })
  })

  test('with setup open, saved reads and saves only what is saved, never the draft', () => {
    const { storage, reopen } = saved({ open: true })
    storage.saveSetupDraft('team', { milestoneQuery: EPIC_QUERY, reads: [{ query: launch.query, read: SECOND }] })
    const { milestoneQueries, reads } = storage.teamQueries('saved')

    expect(milestoneQueries.milestoneQuery('team')).toEqual(LAUNCH_QUERY)
    expect(reads.savedRead(launch)).toEqual(FIRST)
    milestoneQueries.saveComparableWorkQuery('team', BETA_QUERY)
    reads.saveRead(launch, THIRD)

    const again = reopen()
    expect(again.comparableWorkQuery('team')).toEqual(BETA_QUERY)
    expect(again.savedRead(launch)).toEqual(THIRD)
    expect(again.setupDraft('team')).toEqual({ milestoneQuery: EPIC_QUERY, reads: [{ query: launch.query, read: SECOND }] })
  })

  test('the draft’s sources and its picks’ failures save into it, keeping the rest, a draft started if there is none', () => {
    const { storage, reopen } = saved({ open: true })
    const failure = { 'label:"bug"': { failure: 'notFound' as const, at: '2026-11-12T09:00:00Z' } }

    storage.saveDraftSources('team', { pace: 'range' })
    reopen().teamQueries('current').milestoneQueries.saveMilestoneQuery('team', EPIC_QUERY)
    reopen().saveDraftPickFailures('team', failure)
    expect(reopen().setupDraft('team')).toEqual({ milestoneQuery: EPIC_QUERY, reads: [], sources: { pace: 'range' }, pickFailures: failure })

    reopen().saveDraftPickFailures('team', undefined)
    expect(reopen().setupDraft('team')).toEqual({ milestoneQuery: EPIC_QUERY, reads: [], sources: { pace: 'range' } })
  })

  test.each([
    ['done', { open: false, closed: 'done' }],
    ['skipped', { open: false, closed: 'skipped' }],
  ] as const)('with setup closed (%s), the draft’s sources and its picks’ failures draft nothing', (_, state) => {
    const { storage, reopen } = saved(state)

    storage.saveDraftSources('team', { pace: 'range' })
    reopen().saveDraftPickFailures('team', { 'label:"bug"': { failure: 'notFound', at: '2026-11-12T09:00:00Z' } })

    expect(reopen().setupDraft('team')).toBeUndefined()
  })

  test('applying the draft saves its queries and reads over the saved ones, its picks’ failures over theirs, and discards it', () => {
    const { storage, reopen } = saved({ open: true, reopened: 'done' })
    storage.saveReadFailures('team', {
      whole: { failure: 'unavailable', at: '2026-11-09T09:00:00Z' },
      picks: { [launch.query]: { failure: 'unavailable', at: '2026-11-09T09:00:00Z' }, 'label:"ui"': { failure: 'notFound', at: '2026-11-09T09:00:00Z' } },
    })
    storage.saveSetupDraft('team', {
      milestoneQuery: EPIC_QUERY,
      comparableWorkQuery: BETA_QUERY,
      reads: [
        { query: launch.query, read: SECOND },
        { query: epic.query, read: THIRD },
      ],
      pickFailures: { 'label:"bug"': { failure: 'invalidQuery', message: 'No such label.', at: '2026-11-12T09:00:00Z' } },
    })

    reopen().applySetupDraft('team')

    const again = reopen()
    expect(again.milestoneQuery('team')).toEqual(EPIC_QUERY)
    expect(again.comparableWorkQuery('team')).toEqual(BETA_QUERY)
    expect(again.savedRead(epic)).toEqual(THIRD)
    expect(again.savedRead(launch)).toEqual(SECOND)
    expect(again.previousRead(launch)).toEqual(FIRST)
    // the pick read well in the draft fails no longer
    expect(again.readFailures('team')).toEqual({
      whole: { failure: 'unavailable', at: '2026-11-09T09:00:00Z' },
      picks: {
        'label:"ui"': { failure: 'notFound', at: '2026-11-09T09:00:00Z' },
        'label:"bug"': { failure: 'invalidQuery', message: 'No such label.', at: '2026-11-12T09:00:00Z' },
      },
    })
    expect(again.setupDraft('team')).toBeUndefined()
    expect(again.teamQueries('current').milestoneQueries.milestoneQuery('team')).toEqual(EPIC_QUERY)
  })

  test('applying with no draft changes nothing', () => {
    const { storage, reopen } = saved({ open: true })

    storage.applySetupDraft('team')

    expect(reopen().milestoneQuery('team')).toEqual(LAUNCH_QUERY)
    expect(reopen().savedRead(launch)).toEqual(FIRST)
    expect(reopen().readFailures('team')).toBeUndefined()
  })

  test('discarding the draft leaves what is saved, and current reads it again', () => {
    const { storage, reopen } = saved({ open: true })
    storage.teamQueries('current').milestoneQueries.saveMilestoneQuery('team', EPIC_QUERY)
    storage.teamQueries('current').reads.saveRead(launch, SECOND)

    reopen().discardSetupDraft('team')

    const current = reopen().teamQueries('current')
    expect(current.milestoneQueries.milestoneQuery('team')).toEqual(LAUNCH_QUERY)
    expect(current.reads.savedRead(launch)).toEqual(FIRST)
    expect(reopen().setupDraft('team')).toBeUndefined()
  })
})
