import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // agents' git worktrees under .claude/ each hold a full copy of the repo and its tests
    exclude: [...configDefaults.exclude, '.claude/**'],
    // with --coverage (`npm run test:coverage`): what the tests run, failing a little below the figures at #101
    coverage: {
      include: ['src/**'],
      // the web build's page script runs only in a browser: its demo checks it, as #114 agreed
      exclude: ['src/app/webMain.ts'],
      reporter: ['text', 'html'],
      thresholds: { statements: 92, branches: 88, functions: 94, lines: 92 },
    },
  },
})
