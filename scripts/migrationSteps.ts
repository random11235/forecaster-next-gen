// The steps of `const MIGRATIONS` in src/storage/sqliteStorage.ts, as the migration check (checkMigrations.ts) and the
// stored-value check (test/storage/storedValues.ts) read them.

/** The file that holds `const MIGRATIONS`. */
export const MIGRATIONS_FILE = 'src/storage/sqliteStorage.ts'

/**
 * Each step's text, in order, from the `const MIGRATIONS` array in `source`, the source of MIGRATIONS_FILE: a step runs
 * from its `// N:` comment to the next, numbered from 1. No array, or a step numbered out of order, fails, naming
 * `where` the source is from.
 */
export function migrationSteps(source: string, where: string): string[] {
  const block = /^const MIGRATIONS[^\n]*\n([\s\S]*?)^\]/m.exec(source)?.[1]
  if (block === undefined) throw new Error(`${where}: no \`const MIGRATIONS\` array in ${MIGRATIONS_FILE}`)
  const parts = block.split(/^(?=  \/\/ \d+:)/m).filter((part) => /^  \/\/ \d+:/.test(part))
  parts.forEach((part, i) => {
    const number = Number(/^  \/\/ (\d+):/.exec(part)![1])
    if (number !== i + 1) throw new Error(`${where}: step comment \`// ${number}:\` should be \`// ${i + 1}:\``)
  })
  return parts.map((part) => part.trimEnd())
}
