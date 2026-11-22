import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // agents' git worktrees under .claude/, and a Stryker sandbox left in .stryker-tmp/, each hold a full copy of the
    // repo and its tests
    exclude: [...configDefaults.exclude, '.claude/**', '.stryker-tmp/**'],
    // `npm run build:web` once, before any test file: the smoke and web build tests read what it writes
    globalSetup: ['test/buildOnce.ts'],
    // with --coverage (`npm run test:coverage`): what the tests run, failing a little below the figures at #101
    coverage: {
      // the web build's page script too: its tests run it in happy-dom, in Vitest's own process (#237)
      include: ['src/**'],
      reporter: ['text', 'html'],
      thresholds: { statements: 92, branches: 88, functions: 94, lines: 92 },
    },
  },
})
