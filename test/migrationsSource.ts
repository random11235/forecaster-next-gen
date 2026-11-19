/**
 * The source of a `const MIGRATIONS` array as src/storage/sqliteStorage.ts holds it, a step for each of `steps`' SQL,
 * each under its `// N:` comment, numbered from 1, as scripts/migrationSteps.ts reads them.
 */
export function migrationsSource(...steps: string[]): string {
  return ['const MIGRATIONS: readonly string[] = [', ...steps.map((sql, i) => `  // ${i + 1}: a change\n  \`\n${sql}\n\`,`), ']', ''].join('\n')
}
