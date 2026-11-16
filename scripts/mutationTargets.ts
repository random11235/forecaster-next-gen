// Which changed files a mutation run mutates (scripts/mutateDiff.ts).

const SOURCE = /^src\/.*\.ts$/
/** Run only in a browser, so no test runs it and every mutant would survive: its demo checks it, as #114 agreed. */
const UNTESTED = ['src/app/webMain.ts']

/** The changed files Stryker should mutate: the TypeScript source the tests run. */
export function mutationTargets(changed: string[]): string[] {
  return changed.filter((path) => SOURCE.test(path) && !UNTESTED.includes(path))
}
