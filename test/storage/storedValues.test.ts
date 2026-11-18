import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { STORED_UNIONS } from './storedUnions.js'
import { storedValueProblems, type Branch } from './storedValues.js'

// The stored-value part of CODING_STANDARDS.md's One-way doors: a value saved data can hold is renamed or removed only
// with a migration that maps it. storedUnions.ts lists the stored unions, bound to their types by the typecheck.

const root = fileURLToPath(new URL('../..', import.meta.url))
const FILES = { snapshot: 'test/storage/storedValues.snapshot', migrations: 'src/storage/sqliteStorage.ts', webStorage: 'src/storage/webStorage.ts' } as const

/** The branch as `read` gives each of its files, undefined for one it doesn't have: only the snapshot may be missing. */
function branchOf(read: (path: string) => string | undefined): Branch {
  const required = (path: string) => {
    const text = read(path)
    if (text === undefined) throw new Error(`no ${path}`)
    return text
  }
  return { snapshot: read(FILES.snapshot), migrations: required(FILES.migrations), webStorage: required(FILES.webStorage) }
}

/** The branch's merge-base with CHECK_BASE (origin/main by default), as `check:static` and the migration check diff from. */
function base(): Branch {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const at = git('merge-base', process.env.CHECK_BASE ?? 'origin/main', 'HEAD').trim()
  return branchOf((path) => {
    try {
      return git('show', `${at}:${path}`)
    } catch {
      return undefined
    }
  })
}

test('on this branch, the snapshot holds every stored value, and a value renamed or removed since its base is mapped by a migration', () => {
  const listed = Object.fromEntries(Object.entries(STORED_UNIONS).map(([name, { values, web }]) => [name, { values: Object.keys(values), web }]))
  const head = branchOf((path) => (existsSync(`${root}/${path}`) ? readFileSync(`${root}/${path}`, 'utf8') : undefined))

  expect(storedValueProblems(listed, base(), head)).toEqual([])
})

const listed = { TicketsSource: { values: ['tracker', 'typed'], web: true }, SetupClosed: { values: ['done', 'skipped'], web: false } }
const snapshot = 'TicketsSource: tracker, typed\nSetupClosed: done, skipped\n'
const steps = "const MIGRATIONS: readonly string[] = [\n  // 1: tickets\n  `\nCREATE TABLE t (source TEXT NOT NULL DEFAULT 'typed');\n`,\n]\n"
const released: Branch = { snapshot, migrations: steps, webStorage: 'export {}' }

describe('stored values', () => {
  test('a branch that changes no stored value has no problem', () => {
    expect(storedValueProblems(listed, released, released)).toEqual([])
  })

  test("on a base from before the snapshot, saved data may hold what this branch's snapshot holds", () => {
    const before = { ...released, snapshot: undefined }

    expect(storedValueProblems(listed, before, released)).toEqual([])
    expect(storedValueProblems({ ...listed, SetupClosed: { values: ['done'], web: false } }, before, released)).toEqual([
      "SetupClosed 'skipped' is no longer a value, but saved data may hold it: a migration must map it, and no step in MIGRATIONS (src/storage/sqliteStorage.ts) on this branch names 'skipped'.",
    ])
  })

  test('a value added to a stored union is in the snapshot too', () => {
    const added = { ...listed, SetupClosed: { values: ['done', 'skipped', 'abandoned'], web: false } }

    expect(storedValueProblems(added, released, released)).toEqual([
      "SetupClosed 'abandoned' is stored but not in the snapshot: add it to test/storage/storedValues.snapshot.",
    ])
    expect(storedValueProblems(added, released, { ...released, snapshot: 'TicketsSource: tracker, typed\nSetupClosed: done, skipped, abandoned\n' })).toEqual(
      [],
    )
  })

  describe('a value renamed', () => {
    const renamed = { ...listed, SetupClosed: { values: ['done', 'passed'], web: false } }
    const snapshotRenamed = 'TicketsSource: tracker, typed\nSetupClosed: done, passed\n'
    const mapping = "  // 2: skipped is passed\n  `\nUPDATE setups SET closed = 'passed' WHERE closed = 'skipped';\n`,\n"
    const mapped = steps.replace(/\]\n$/, `${mapping}]\n`)

    test('with no migration fails, naming the value and saying a migration must map it', () => {
      expect(storedValueProblems(renamed, released, { ...released, snapshot: snapshotRenamed })).toEqual([
        "SetupClosed 'skipped' is no longer a value, but saved data may hold it: a migration must map it, and no step in MIGRATIONS (src/storage/sqliteStorage.ts) on this branch names 'skipped'.",
      ])
    })

    test('with a migration step that maps it passes, once the snapshot is updated', () => {
      expect(storedValueProblems(renamed, released, { ...released, snapshot: snapshotRenamed, migrations: mapped })).toEqual([])
      expect(
        storedValueProblems(renamed, released, { ...released, snapshot: snapshotRenamed.replace('passed', 'skipped, passed'), migrations: mapped }),
      ).toEqual(["SetupClosed 'skipped' is mapped by a migration on this branch and no longer a value: take it out of test/storage/storedValues.snapshot."])
    })

    test('a released step, or a comment, naming the old value maps nothing', () => {
      const typedGone = { ...listed, TicketsSource: { values: ['tracker'], web: false } }
      const commented = steps.replace(/\]\n$/, "  // 2: 'typed' goes -- and 'typed' again\n  `\nSELECT 1; -- 'typed'\n`,\n]\n")

      expect(
        storedValueProblems(typedGone, released, { ...released, snapshot: 'TicketsSource: tracker\nSetupClosed: done, skipped\n', migrations: commented }),
      ).toEqual([
        "TicketsSource 'typed' is no longer a value, but saved data may hold it: a migration must map it, and no step in MIGRATIONS (src/storage/sqliteStorage.ts) on this branch names 'typed'.",
      ])
    })

    test("kept by the web build's storage too, also needs src/storage/webStorage.ts to map it as it reads", () => {
      const typedManual = { ...listed, TicketsSource: { values: ['tracker', 'manual'], web: true } }
      const head = { ...released, snapshot: 'TicketsSource: tracker, manual\nSetupClosed: done, skipped\n' }
      const migrated = {
        ...head,
        migrations: steps.replace(/\]\n$/, "  // 2: typed is manual\n  `\nUPDATE t SET source = 'manual' WHERE source = 'typed';\n`,\n]\n"),
      }
      const read = "const source = (stored: string) => (stored === 'typed' ? 'manual' : stored)"

      expect(storedValueProblems(typedManual, released, migrated)).toEqual([
        "TicketsSource 'typed' is no longer a value, but saved data may hold it: the web build's storage keeps it too, so src/storage/webStorage.ts must map it as it reads, and on this branch it names 'typed' no more than before.",
      ])
      expect(storedValueProblems(typedManual, released, { ...migrated, webStorage: read })).toEqual([])
      expect(storedValueProblems(typedManual, released, { ...head, webStorage: read })).toEqual([
        "TicketsSource 'typed' is no longer a value, but saved data may hold it: a migration must map it, and no step in MIGRATIONS (src/storage/sqliteStorage.ts) on this branch names 'typed'.",
      ])
    })
  })

  test('a value added on this branch and gone again before it merges needs no migration, only taking out of the snapshot', () => {
    const base = { ...released, snapshot: 'TicketsSource: tracker, typed\nSetupClosed: done\n' }

    expect(storedValueProblems(listed, base, released)).toEqual([])
    expect(storedValueProblems({ ...listed, SetupClosed: { values: ['done'], web: false } }, base, released)).toEqual([
      "SetupClosed 'skipped' is in the snapshot but no longer a value, and saved data can't hold it yet: take it out of test/storage/storedValues.snapshot.",
    ])
  })
})
