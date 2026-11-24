// Mutation testing: `npm run test:mutation` mutates the source lines a branch changes (scripts/mutateDiff.ts);
// `npx stryker run` mutates all of it. The report is in reports/mutation/.
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  // as `npm test` runs them: tests that set process.env.TZ need a process of their own, not Stryker's default threads
  vitest: { pool: 'forks' },
  mutate: ['src/**/*.ts'],
  reporters: ['html', 'clear-text', 'progress', 'json'], // json: reports/mutation/mutation.json, for scripts/mutationSummary.ts
  // Stryker rewrites tsconfig.json's `extends` and `references` paths through TypeScript's JS API, which
  // TypeScript 7 no longer has. Ours has neither, so it names no file here and Stryker skips the rewrite.
  tsconfigFile: 'no-tsconfig-to-rewrite.json',
}
