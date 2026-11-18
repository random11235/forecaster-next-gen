// The check that keeps stored string values: storedUnions.ts lists the stored unions, the snapshot freezes their
// values, and storedValues.test.ts runs this on the branch.
import { MIGRATIONS_FILE, migrationSteps } from '../../scripts/migrationSteps.ts'

/** A column of the SQLite file: its table, and its name in that table. */
export interface Column {
  table: string
  column: string
}

/**
 * A union whose values reach storage: its values, the columns that store them, and whether the web build's storage
 * keeps it too.
 */
export interface StoredUnion {
  values: Readonly<Record<string, true>>
  columns: readonly Column[]
  web: boolean
}

/** Each stored union, by name. */
export type StoredUnions = Readonly<Record<string, StoredUnion>>

/** The files of a branch the check reads, by the part each plays. */
export const FILES = { snapshot: 'test/storage/storedValues.snapshot', migrations: MIGRATIONS_FILE, webStorage: 'src/storage/webStorage.ts' } as const

/** What the check reads of a branch, at its base or its head: the snapshot is missing on a base from before it. */
export interface Branch {
  snapshot: string | undefined
  migrations: string
}

/**
 * What the check reads of the branch at its head: its Branch files, and the web build's storage, read at the head only,
 * since it must still read a value gone.
 */
export interface Head extends Branch {
  webStorage: string
}

/** A union as the snapshot holds it: the columns that store it, and its values. */
type Snapshotted = { columns: readonly Column[]; values: readonly string[] }

/** The snapshot's unions, by name: a line each, `Name (table.column, …): value, …`; a line starting `#` says what the file is. */
function snapshotUnions(snapshot: string): Map<string, Snapshotted> {
  const lines = snapshot.split('\n').filter((line) => line.trim() !== '' && !line.startsWith('#'))
  return new Map(
    lines.map((line) => {
      const [, name, columns, values] = /^([^:(]+)\(([^)]*)\):(.*)$/.exec(line) ?? []
      if (name === undefined || columns === undefined || values === undefined)
        throw new Error(`${FILES.snapshot}: \`${line}\` is not \`Name (table.column, …): value, …\``)
      return [name.trim(), { columns: listOf(columns).map((each) => columnIn(each, line)), values: listOf(values) }]
    }),
  )
}

const listOf = (commaSeparated: string): string[] => commaSeparated.split(',').map((each) => each.trim())

/** The column `table.column` names, on the snapshot's `line`. */
function columnIn(tableColumn: string, line: string): Column {
  const [table, column, ...more] = tableColumn.split('.')
  if (!table || !column || more.length > 0) throw new Error(`${FILES.snapshot}: \`${tableColumn}\` in \`${line}\` is not \`table.column\``)
  return { table, column }
}

/** The column as the snapshot and the check's messages write it. */
const nameOf = ({ table, column }: Column): string => `${table}.${column}`
/** The columns as the snapshot and the check's messages write them. */
const namesOf = (columns: readonly Column[]): string => columns.map(nameOf).join(', ')
/** Whether `a` and `b` are the same column: the same table, and the same column in it. */
const sameColumn = (a: Column, b: Column): boolean => a.table === b.table && a.column === b.column
/** Whether `a` and `b` are the same columns, in the same order. */
const sameColumns = (a: readonly Column[], b: readonly Column[]): boolean => a.length === b.length && a.every((column, i) => sameColumn(column, b[i]!))
/** Whether `columns` holds `column`. */
const holds = (columns: readonly Column[], column: Column): boolean => columns.some((each) => sameColumn(each, column))

/** Each SQL statement in the steps of MIGRATIONS in `sqliteStorage`, the source of FILES.migrations, less comments. */
function migrationStatements(sqliteStorage: string): string[] {
  return migrationSteps(sqliteStorage, FILES.migrations).flatMap((step) =>
    step
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/--.*$/gm, '')
      .split(';'),
  )
}

/** Whether `statement` is on the column: it names both its table and the column, anywhere in it. */
function isOn(statement: string, { table, column }: Column): boolean {
  return [table, column].every((name) => new RegExp(`\\b${name}\\b`).test(statement))
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
 * the base, and where the web build's storage keeps the union too, its code must still name it, to map it as it reads.
 * A union only renamed, its values stored where they were, needs no migration.
 */
export function storedValueProblems(listed: StoredUnions, base: Branch, head: Head): string[] {
  const inSnapshot = snapshotUnions(head.snapshot ?? '')
  // what saved data may hold: the base's snapshot, or this branch's when the base has none
  const saved = snapshotUnions(base.snapshot ?? head.snapshot ?? '')
  const unions = Object.values(listed)
  const statements = { base: migrationStatements(base.migrations), head: migrationStatements(head.migrations) }

  /** How many times the migration statements on `column` name `value`, at the base or here. */
  const namedOn = (at: 'base' | 'head', column: Column, value: string) =>
    statements[at].filter((statement) => isOn(statement, column)).reduce((count, statement) => count + namings(statement, value), 0)
  /** Whether a migration on this branch maps `value` in `column`: its statements there name it more often than the base's. */
  const mappedIn = (column: Column, value: string) => namedOn('head', column, value) > namedOn('base', column, value)
  /** Whether a listed union, whatever its name, still stores `value` in `column`. */
  const storedIn = (column: Column, value: string) => unions.some((union) => holds(union.columns, column) && union.values[value])
  const byName = new Map(Object.entries(listed))
  /** Whether the web build's storage keeps the union named `name`, or one now stored in its `columns`. */
  const keptByTheWeb = (name: string, columns: readonly Column[]) =>
    byName.get(name)?.web === true || unions.some((union) => union.web && union.columns.some((column) => holds(columns, column)))
  /** Whether the web build's storage on this branch still names `value` in its code, so can map it as it reads. */
  const mappedForTheWeb = (value: string) => namings(code(head.webStorage), value) > 0
  const inHeadSnapshot = (name: string, value: string) => inSnapshot.get(name)?.values.includes(value) === true

  const added = Object.entries(listed).flatMap(([name, { values }]) =>
    Object.keys(values)
      .filter((value) => !inHeadSnapshot(name, value))
      .map((value) => `${name} '${value}' is stored but not in the snapshot: add it to ${FILES.snapshot}.`),
  )
  const misplaced = Object.entries(listed).flatMap(([name, { columns }]) => {
    const snapshotted = inSnapshot.get(name)?.columns
    if (snapshotted === undefined || sameColumns(snapshotted, columns)) return []
    return [
      `${name} is stored in ${namesOf(columns)}, but the snapshot says ${namesOf(snapshotted)}: write its columns in ${FILES.snapshot} as STORED_UNIONS lists them.`,
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
          `a migration must map it, and no step in MIGRATIONS (${FILES.migrations}) on this branch names '${value}' in a statement on ${namesOf(unmappedIn)}`,
        )
      if (keptByTheWeb(name, columns) && !mappedForTheWeb(value))
        unmapped.push(
          `the web build's storage keeps it too, so ${FILES.webStorage} must map it as it reads, and on this branch its code doesn't name '${value}'`,
        )
      if (unmapped.length > 0) return [`${name} '${value}' is no longer a value, but saved data may hold it: ${unmapped.join('; ')}.`]
      // a union no longer listed is taken out of the snapshot whole (unlisted, below)
      if (byName.has(name) && inHeadSnapshot(name, value))
        return [`${name} '${value}' is mapped by a migration on this branch and no longer a value: take it out of ${FILES.snapshot}.`]
      return []
    }),
  )
  const unsaved = Object.entries(listed).flatMap(([name, union]) =>
    (inSnapshot.get(name)?.values ?? [])
      .filter((value) => !union.values[value] && !saved.get(name)?.values.includes(value))
      .map((value) => `${name} '${value}' is in the snapshot but no longer a value, and saved data can't hold it yet: take it out of ${FILES.snapshot}.`),
  )
  const unlisted = [...inSnapshot.keys()]
    .filter((name) => !byName.has(name))
    .map((name) => `${name} is in the snapshot, but STORED_UNIONS no longer lists it: take it out of ${FILES.snapshot}.`)
  return [...added, ...misplaced, ...gone, ...unsaved, ...unlisted]
}
