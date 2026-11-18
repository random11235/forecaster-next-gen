// The check that keeps stored string values: storedUnions.ts lists the stored unions, the snapshot freezes their
// values, and storedValues.test.ts runs this on the branch.
import { MIGRATIONS_FILE, migrationSteps } from '../../scripts/migrationSteps.ts'

/**
 * A union whose values reach storage: its values, the columns that store them (`table.column`), and whether the web
 * build's storage keeps it too.
 */
export interface StoredUnion {
  values: Readonly<Record<string, true>>
  columns: readonly string[]
  web: boolean
}

/** Each stored union, by name. */
export type StoredUnions = Readonly<Record<string, StoredUnion>>

/** The files of a branch the check reads, by the part each plays. */
export const FILES = { snapshot: 'test/storage/storedValues.snapshot', migrations: MIGRATIONS_FILE, webStorage: 'src/storage/webStorage.ts' } as const

/** What a branch holds that the check reads, each of FILES: the snapshot is missing on a base from before it. */
export interface Branch {
  snapshot: string | undefined
  migrations: string
  webStorage: string
}

/** A union as the snapshot holds it: the columns that store it, and its values. */
type Snapshotted = { columns: readonly string[]; values: readonly string[] }

/** The snapshot's unions, by name: a line each, `Name (table.column, …): value, …`; a line starting `#` says what the file is. */
function snapshotUnions(snapshot: string): Map<string, Snapshotted> {
  const lines = snapshot.split('\n').filter((line) => line.trim() !== '' && !line.startsWith('#'))
  return new Map(
    lines.map((line) => {
      const [, name, columns, values] = /^([^:(]+)\(([^)]*)\):(.*)$/.exec(line) ?? []
      if (name === undefined || columns === undefined || values === undefined)
        throw new Error(`${FILES.snapshot}: \`${line}\` is not \`Name (table.column, …): value, …\``)
      return [name.trim(), { columns: listOf(columns), values: listOf(values) }]
    }),
  )
}

const listOf = (commaSeparated: string): string[] => commaSeparated.split(',').map((each) => each.trim())

/** Each SQL statement in the steps of MIGRATIONS in `sqliteStorage`, the source of FILES.migrations, less comments. */
function migrationStatements(sqliteStorage: string): string[] {
  return migrationSteps(sqliteStorage, FILES.migrations).flatMap((step) =>
    step
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/--.*$/gm, '')
      .split(';'),
  )
}

/** Whether `statement` is on `column`, a `table.column`: it names both. */
function isOn(statement: string, column: string): boolean {
  return column.split('.').every((name) => new RegExp(`\\b${name}\\b`).test(statement))
}

/** `source`, a TypeScript file's, less its comments. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

/** How many times `source` names `value` as a string, quoted as SQL or JSON quotes it. */
function namings(source: string, value: string): number {
  return source.split(`'${value}'`).length + source.split(`"${value}"`).length - 2
}

/**
 * What is wrong with the stored values `listed` on a branch at `head`, from its base at `base`: one sentence each. The
 * snapshot holds every listed union, where it is stored and its values, and only those. A value on the base's snapshot
 * that a column no longer stores, under any union's name, is renamed or removed there, so saved data may hold it: a
 * migration step must map it in that column, its statements on the column naming it on this branch more often than on
 * the base, and so must the web build's storage where it keeps the union too. A union only renamed, its values stored
 * where they were, needs no migration.
 */
export function storedValueProblems(listed: StoredUnions, base: Branch, head: Branch): string[] {
  const inSnapshot = snapshotUnions(head.snapshot ?? '')
  // what saved data may hold: the base's snapshot, or this branch's when the base has none
  const saved = snapshotUnions(base.snapshot ?? head.snapshot ?? '')
  const unions = Object.values(listed)
  const statements = { base: migrationStatements(base.migrations), head: migrationStatements(head.migrations) }

  /** How many times the migration statements on `column` name `value`, at the base or here. */
  const namedOn = (at: 'base' | 'head', column: string, value: string) =>
    statements[at].filter((statement) => isOn(statement, column)).reduce((count, statement) => count + namings(statement, value), 0)
  /** Whether a migration on this branch maps `value` in `column`: its statements there name it more often than the base's. */
  const mappedIn = (column: string, value: string) => namedOn('head', column, value) > namedOn('base', column, value)
  /** Whether a listed union, whatever its name, still stores `value` in `column`. */
  const storedIn = (column: string, value: string) => unions.some((union) => union.columns.includes(column) && union.values[value])
  /** Whether the web build's storage keeps the union named `name`, or one now stored in its `columns`. */
  const keptByTheWeb = (name: string, columns: readonly string[]) =>
    listed[name]?.web === true || unions.some((union) => union.web && union.columns.some((column) => columns.includes(column)))
  /** Whether the web build's storage on this branch names `value` more often than the base's, so maps it as it reads. */
  const mappedForTheWeb = (value: string) => namings(code(head.webStorage), value) > namings(code(base.webStorage), value)
  const inHeadSnapshot = (name: string, value: string) => inSnapshot.get(name)?.values.includes(value) === true

  const added = Object.entries(listed).flatMap(([name, { values }]) =>
    Object.keys(values)
      .filter((value) => !inHeadSnapshot(name, value))
      .map((value) => `${name} '${value}' is stored but not in the snapshot: add it to ${FILES.snapshot}.`),
  )
  const misplaced = Object.entries(listed).flatMap(([name, { columns }]) => {
    const snapshotted = inSnapshot.get(name)?.columns.join(', ')
    if (snapshotted === undefined || snapshotted === columns.join(', ')) return []
    return [
      `${name} is stored in ${columns.join(', ')}, but the snapshot says ${snapshotted}: write its columns in ${FILES.snapshot} as STORED_UNIONS lists them.`,
    ]
  })
  const gone = [...saved].flatMap(([name, { columns, values }]) =>
    values.flatMap((value) => {
      const goneFrom = columns.filter((column) => !storedIn(column, value))
      if (goneFrom.length === 0) return []
      const unmappedIn = goneFrom.filter((column) => !mappedIn(column, value))
      const unmapped: string[] = []
      if (unmappedIn.length > 0)
        unmapped.push(
          `a migration must map it, and no step in MIGRATIONS (${FILES.migrations}) on this branch names '${value}' in a statement on ${unmappedIn.join(', ')}`,
        )
      if (keptByTheWeb(name, columns) && !mappedForTheWeb(value))
        unmapped.push(
          `the web build's storage keeps it too, so ${FILES.webStorage} must map it as it reads, and on this branch it names '${value}' no more than before`,
        )
      if (unmapped.length > 0) return [`${name} '${value}' is no longer a value, but saved data may hold it: ${unmapped.join('; ')}.`]
      if (listed[name] !== undefined && inHeadSnapshot(name, value))
        return [`${name} '${value}' is mapped by a migration on this branch and no longer a value: take it out of ${FILES.snapshot}.`]
      return []
    }),
  )
  const unsaved = [...inSnapshot].flatMap(([name, { values }]) =>
    listed[name] === undefined
      ? []
      : values
          .filter((value) => !listed[name]?.values[value] && !saved.get(name)?.values.includes(value))
          .map((value) => `${name} '${value}' is in the snapshot but no longer a value, and saved data can't hold it yet: take it out of ${FILES.snapshot}.`),
  )
  const unlisted = [...inSnapshot.keys()]
    .filter((name) => listed[name] === undefined)
    .map((name) => `${name} is in the snapshot, but STORED_UNIONS no longer lists it: take it out of ${FILES.snapshot}.`)
  return [...added, ...misplaced, ...gone, ...unsaved, ...unlisted]
}
