// The stored unions and the check that keeps their values: storedValues.test.ts runs it on this branch.

/** Each stored union's values, by its name, and whether the web build's storage keeps it too (`web`). */
export type Listed = Readonly<Record<string, { values: readonly string[]; web: boolean }>>

/** What a branch holds that the check reads: the snapshot, `src/storage/sqliteStorage.ts` and `src/storage/webStorage.ts`. */
export interface Branch {
  /** `test/storage/storedValues.snapshot`; none on a base from before it. */
  snapshot: string | undefined
  migrations: string
  webStorage: string
}

const SNAPSHOT = 'test/storage/storedValues.snapshot'

/** The snapshot's values, by union: a line each, `Name: value, value`; a line starting `#` says what the file is. */
function snapshotValues(snapshot: string): Map<string, string[]> {
  const lines = snapshot.split('\n').filter((line) => line.trim() !== '' && !line.startsWith('#'))
  return new Map(
    lines.map((line) => {
      const [, name, values] = /^([^:]+):(.*)$/.exec(line) ?? []
      if (name === undefined || values === undefined) throw new Error(`${SNAPSHOT}: \`${line}\` is not \`Name: value, value\``)
      return [name.trim(), values.split(',').map((value) => value.trim())]
    }),
  )
}

/** The steps of `const MIGRATIONS` in `sqliteStorage`, the source of `src/storage/sqliteStorage.ts`, less their comments. */
function migrationSteps(sqliteStorage: string): string {
  const block = /^const MIGRATIONS[^\n]*\n([\s\S]*?)^\]/m.exec(sqliteStorage)?.[1]
  if (block === undefined) throw new Error('no `const MIGRATIONS` array in src/storage/sqliteStorage.ts')
  return block.replace(/^\s*\/\/.*$/gm, '').replace(/--.*$/gm, '')
}

/** `source`, a TypeScript file's, less its comments. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

/** How many times `source` names `value` as a string, quoted as SQL or JSON quotes it. */
function namings(source: string, value: string): number {
  return source.split(`'${value}'`).length + source.split(`"${value}"`).length - 2
}

/** Each value in `values` that `listed` no longer has, with its union's name. */
function notListed(listed: Listed, values: Map<string, string[]>): { name: string; value: string }[] {
  return [...values].flatMap(([name, kept]) => kept.filter((value) => !listed[name]?.values.includes(value)).map((value) => ({ name, value })))
}

/**
 * What is wrong with the stored values `listed` on a branch at `head`, from its base at `base`: one sentence each. The
 * snapshot holds every listed value, and only those. A value on the base's snapshot that is no longer listed is
 * renamed or removed, so saved data may hold it: a migration step must map it, naming it on this branch more often than
 * on the base, and so must the web build's storage where it keeps the value too.
 */
export function storedValueProblems(listed: Listed, base: Branch, head: Branch): string[] {
  const inSnapshot = snapshotValues(head.snapshot ?? '')
  const added = Object.entries(listed).flatMap(([name, { values }]) =>
    values
      .filter((value) => !inSnapshot.get(name)?.includes(value))
      .map((value) => `${name} '${value}' is stored but not in the snapshot: add it to ${SNAPSHOT}.`),
  )
  // what saved data may hold: the base's snapshot, or this branch's when the base has none
  const saved = snapshotValues(base.snapshot ?? head.snapshot ?? '')
  const newlyNamed = (value: string, of: (branch: Branch) => string) => namings(of(head), value) > namings(of(base), value)
  const gone = notListed(listed, saved).flatMap(({ name, value }) => {
    const unmapped = [
      ...(newlyNamed(value, ({ migrations }) => migrationSteps(migrations))
        ? []
        : [`a migration must map it, and no step in MIGRATIONS (src/storage/sqliteStorage.ts) on this branch names '${value}'`]),
      ...(!listed[name]?.web || newlyNamed(value, ({ webStorage }) => code(webStorage))
        ? []
        : [
            `the web build's storage keeps it too, so src/storage/webStorage.ts must map it as it reads, and on this branch it names '${value}' no more than before`,
          ]),
    ]
    if (unmapped.length > 0) return [`${name} '${value}' is no longer a value, but saved data may hold it: ${unmapped.join('; ')}.`]
    return inSnapshot.get(name)?.includes(value)
      ? [`${name} '${value}' is mapped by a migration on this branch and no longer a value: take it out of ${SNAPSHOT}.`]
      : []
  })
  const unsaved = notListed(listed, inSnapshot)
    .filter(({ name, value }) => !saved.get(name)?.includes(value))
    .map(({ name, value }) => `${name} '${value}' is in the snapshot but no longer a value, and saved data can't hold it yet: take it out of ${SNAPSHOT}.`)
  return [...added, ...gone, ...unsaved]
}
