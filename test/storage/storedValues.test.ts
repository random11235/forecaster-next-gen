import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { MAIN_REF, MAIN_REF_HINT, mergeBase } from '../../scripts/mergeBase.ts'
import { migrationsSource } from '../migrationsSource.js'
import { STORED_UNIONS } from './storedUnions.js'
import { FILES, storedValueProblems, type Branch, type Column, type Head, type StoredUnion } from './storedValues.js'

// A value saved data can hold outlives the release that wrote it, so it is renamed or removed only with a migration
// that maps it. storedUnions.ts lists the stored unions, bound to their types by the typecheck.

const root = fileURLToPath(new URL('../..', import.meta.url))

/** The file at `path`, as `read` gives it: it must be there. */
function required(read: (path: string) => string | undefined, path: string): string {
  const text = read(path)
  if (text === undefined) throw new Error(`no ${path}`)
  return text
}

/** The branch as `read` gives each of its files, undefined for one it doesn't have: only the snapshot may be missing. */
function branchOf(read: (path: string) => string | undefined): Branch {
  return { snapshot: read(FILES.snapshot), migrations: required(read, FILES.migrations) }
}

/** The branch at its merge-base with released main (MAIN_REF), as the migration check diffs from: only released values can be in saved data. */
function branchAtBase(): Branch {
  const at = mergeBase(root, MAIN_REF, MAIN_REF_HINT)
  return branchOf((path) => {
    try {
      return execFileSync('git', ['show', `${at}:${path}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    } catch {
      return undefined
    }
  })
}

test('on this branch, the snapshot holds every stored value, and a value renamed or removed since its base is mapped by a migration', () => {
  const read = (path: string) => (existsSync(`${root}/${path}`) ? readFileSync(`${root}/${path}`, 'utf8') : undefined)
  const head: Head = { ...branchOf(read), webStorage: required(read, FILES.webStorage) }

  expect(storedValueProblems(STORED_UNIONS, branchAtBase(), head)).toEqual([])
})

/** A stored union of `values`, kept in `columns`, and by the web build's storage too when `web`. */
const union = (values: string[], columns: Column[], web: boolean): StoredUnion => ({
  values: Object.fromEntries(values.map((value) => [value, true])),
  columns,
  web,
})
const ticketsSource = (...values: string[]) => union(values, [{ table: 'tickets', column: 'source' }], true)
const setupClosed = (...values: string[]) => union(values, [{ table: 'setups', column: 'closed' }], false)
/** The snapshot of the two unions below, holding these values. */
const snapshotOf = (ticketsSources: string, setupsClosed: string) =>
  `TicketsSource (tickets.source): ${ticketsSources}\nSetupClosed (setups.closed): ${setupsClosed}\n`

const listed = { TicketsSource: ticketsSource('tracker', 'typed'), SetupClosed: setupClosed('done', 'skipped') }
const snapshot = snapshotOf('tracker, typed', 'done, skipped')
/** MIGRATIONS with a released first step making the tables, then a step for each of `more`. */
const stepsWith = (...more: string[]) =>
  migrationsSource("CREATE TABLE tickets (source TEXT NOT NULL DEFAULT 'typed');\nCREATE TABLE setups (closed TEXT);", ...more)
const released: Head = { snapshot, migrations: stepsWith(), webStorage: 'export {}' }

describe('stored values', () => {
  test('a branch that changes no stored value has no problem', () => {
    expect(storedValueProblems(listed, released, released)).toEqual([])
  })

  test("on a base from before the snapshot, saved data may hold what this branch's snapshot holds", () => {
    const before = { ...released, snapshot: undefined }

    expect(storedValueProblems(listed, before, released)).toEqual([])
    expect(storedValueProblems({ ...listed, SetupClosed: setupClosed('done') }, before, released)).toEqual([
      "SetupClosed 'skipped' is no longer a value, but saved data may hold it: a migration must map it, and no step in MIGRATIONS (src/storage/sqliteStorage.ts) on this branch names 'skipped' in a statement on setups.closed.",
    ])
  })

  test('a value added to a stored union is in the snapshot too', () => {
    const added = { ...listed, SetupClosed: setupClosed('done', 'skipped', 'abandoned') }

    expect(storedValueProblems(added, released, released)).toEqual([
      "SetupClosed 'abandoned' is stored but not in the snapshot: add it to test/storage/storedValues.snapshot.",
    ])
    expect(storedValueProblems(added, released, { ...released, snapshot: snapshotOf('tracker, typed', 'done, skipped, abandoned') })).toEqual([])
  })

  describe('a value renamed', () => {
    const renamed = { ...listed, SetupClosed: setupClosed('done', 'passed') }
    const snapshotRenamed = snapshotOf('tracker, typed', 'done, passed')
    const mapped = stepsWith("UPDATE setups SET closed = 'passed' WHERE closed = 'skipped';")

    test('with no migration fails, naming the value and saying a migration must map it', () => {
      expect(storedValueProblems(renamed, released, { ...released, snapshot: snapshotRenamed })).toEqual([
        "SetupClosed 'skipped' is no longer a value, but saved data may hold it: a migration must map it, and no step in MIGRATIONS (src/storage/sqliteStorage.ts) on this branch names 'skipped' in a statement on setups.closed.",
      ])
    })

    test('with a migration step that maps it passes, once the snapshot is updated', () => {
      expect(storedValueProblems(renamed, released, { ...released, snapshot: snapshotRenamed, migrations: mapped })).toEqual([])
      expect(
        storedValueProblems(renamed, released, { ...released, snapshot: snapshotOf('tracker, typed', 'done, skipped, passed'), migrations: mapped }),
      ).toEqual(["SetupClosed 'skipped' is mapped by a migration on this branch and no longer a value: take it out of test/storage/storedValues.snapshot."])
    })

    test('a released step, or a comment, naming the old value maps nothing', () => {
      const typedGone = { ...listed, TicketsSource: union(['tracker'], [{ table: 'tickets', column: 'source' }], false) }
      const commented = stepsWith("SELECT 1; -- 'typed'").replace('// 2: a change', "// 2: 'typed' goes -- and 'typed' again")

      expect(storedValueProblems(typedGone, released, { ...released, snapshot: snapshotOf('tracker', 'done, skipped'), migrations: commented })).toEqual([
        "TicketsSource 'typed' is no longer a value, but saved data may hold it: a migration must map it, and no step in MIGRATIONS (src/storage/sqliteStorage.ts) on this branch names 'typed' in a statement on tickets.source.",
      ])
    })

    test("kept by the web build's storage too, also needs src/storage/webStorage.ts to map it as it reads", () => {
      const typedManual = { ...listed, TicketsSource: ticketsSource('tracker', 'manual') }
      const head = { ...released, snapshot: snapshotOf('tracker, manual', 'done, skipped') }
      const migrated = { ...head, migrations: stepsWith("UPDATE tickets SET source = 'manual' WHERE source = 'typed';") }
      const read = "const source = (stored: string) => (stored === 'typed' ? 'manual' : stored)"

      expect(storedValueProblems(typedManual, released, migrated)).toEqual([
        "TicketsSource 'typed' is no longer a value, but saved data may hold it: the web build's storage keeps it too, so src/storage/webStorage.ts must map it as it reads, and on this branch its code doesn't name 'typed'.",
      ])
      expect(storedValueProblems(typedManual, released, { ...migrated, webStorage: read })).toEqual([])
      expect(storedValueProblems(typedManual, released, { ...head, webStorage: read })).toEqual([
        "TicketsSource 'typed' is no longer a value, but saved data may hold it: a migration must map it, and no step in MIGRATIONS (src/storage/sqliteStorage.ts) on this branch names 'typed' in a statement on tickets.source.",
      ])
    })

    test("the web build's storage maps it when its code on this branch names it, in a default or a test alike", () => {
      const typedEntered = { ...listed, TicketsSource: ticketsSource('tracker', 'entered') }
      const head: Head = {
        snapshot: snapshotOf('tracker, entered', 'done, skipped'),
        migrations: stepsWith("UPDATE tickets SET source = 'entered' WHERE source = 'typed';"),
        webStorage: "const source = (stored?: string) => (stored === 'typed' ? 'entered' : (stored ?? 'entered'))",
      }

      expect(storedValueProblems(typedEntered, released, head)).toEqual([])
      expect(storedValueProblems(typedEntered, released, { ...head, webStorage: "const source = (stored?: string) => stored ?? 'typed'" })).toEqual([])
    })
  })

  describe('a value is mapped only where its union is stored', () => {
    test("a step on another union's column that names the value maps nothing", () => {
      const withPaceMode = { ...listed, PaceMode: union(['range', 'tracker'], [{ table: 'inputs', column: 'pace_mode' }], false) }
      const base = { ...released, snapshot: `${snapshot}PaceMode (inputs.pace_mode): range, tracker\n` }
      const head: Head = {
        snapshot: `${snapshotOf('read, typed', 'done, skipped')}PaceMode (inputs.pace_mode): range, tracker\n`,
        migrations: stepsWith("UPDATE inputs SET pace_mode = 'range' WHERE pace_mode = 'tracker';"),
        webStorage: "const source = (stored: string) => (stored === 'tracker' ? 'read' : stored)",
      }

      expect(storedValueProblems({ ...withPaceMode, TicketsSource: ticketsSource('read', 'typed') }, base, head)).toEqual([
        "TicketsSource 'tracker' is no longer a value, but saved data may hold it: a migration must map it, and no step in MIGRATIONS (src/storage/sqliteStorage.ts) on this branch names 'tracker' in a statement on tickets.source.",
      ])
    })

    test('a union stored in two columns is mapped in both', () => {
      const twoColumns = (...values: string[]) => ({
        ...listed,
        SetupClosed: union(
          values,
          [
            { table: 'setups', column: 'closed' },
            { table: 'drafts', column: 'closed' },
          ],
          false,
        ),
      })
      const base = { ...released, snapshot: 'TicketsSource (tickets.source): tracker, typed\nSetupClosed (setups.closed, drafts.closed): done, skipped\n' }
      const head = { ...released, snapshot: 'TicketsSource (tickets.source): tracker, typed\nSetupClosed (setups.closed, drafts.closed): done, passed\n' }
      const setups = "UPDATE setups SET closed = 'passed' WHERE closed = 'skipped';"
      const drafts = "UPDATE drafts SET closed = 'passed' WHERE closed = 'skipped';"

      expect(storedValueProblems(twoColumns('done', 'passed'), base, { ...head, migrations: stepsWith(setups) })).toEqual([
        "SetupClosed 'skipped' is no longer a value, but saved data may hold it: a migration must map it, and no step in MIGRATIONS (src/storage/sqliteStorage.ts) on this branch names 'skipped' in a statement on drafts.closed.",
      ])
      expect(storedValueProblems(twoColumns('done', 'passed'), base, { ...head, migrations: stepsWith(`${setups}\n${drafts}`) })).toEqual([])
    })
  })

  describe('a union renamed', () => {
    const renamed = { TicketsSource: listed.TicketsSource, SetupEnd: setupClosed('done', 'skipped') }
    const head = { ...released, snapshot: 'TicketsSource (tickets.source): tracker, typed\nSetupEnd (setups.closed): done, skipped\n' }

    test('keeping its values where they are stored needs no migration', () => {
      expect(storedValueProblems(renamed, released, head)).toEqual([])
    })

    test('is taken out of the snapshot under its old name', () => {
      expect(storedValueProblems(renamed, released, { ...head, snapshot: `${head.snapshot}SetupClosed (setups.closed): done, skipped\n` })).toEqual([
        'SetupClosed is in the snapshot, but STORED_UNIONS no longer lists it: take it out of test/storage/storedValues.snapshot.',
      ])
    })
  })

  test('the snapshot says where each union is stored, as STORED_UNIONS lists it', () => {
    expect(storedValueProblems(listed, released, { ...released, snapshot: snapshot.replace('setups.closed', 'setups.ended') })).toEqual([
      'SetupClosed is stored in setups.closed, but the snapshot says setups.ended: write its columns in test/storage/storedValues.snapshot as STORED_UNIONS lists them.',
    ])
    expect(() => storedValueProblems(listed, released, { ...released, snapshot: snapshot.replace('setups.closed', 'setups') })).toThrow(
      'test/storage/storedValues.snapshot: `setups` in `SetupClosed (setups): done, skipped` is not `table.column`',
    )
  })

  test('a value added on this branch and gone again before it merges needs no migration, only taking out of the snapshot', () => {
    const base = { ...released, snapshot: snapshotOf('tracker, typed', 'done') }

    expect(storedValueProblems(listed, base, released)).toEqual([])
    expect(storedValueProblems({ ...listed, SetupClosed: setupClosed('done') }, base, released)).toEqual([
      "SetupClosed 'skipped' is in the snapshot but no longer a value, and saved data can't hold it yet: take it out of test/storage/storedValues.snapshot.",
    ])
  })
})
