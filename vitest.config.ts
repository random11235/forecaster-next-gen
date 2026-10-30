import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // agents' git worktrees under .claude/ each hold a full copy of the repo and its tests
    exclude: [...configDefaults.exclude, '.claude/**'],
    // with --coverage (`npm run test:coverage`): what the tests run, failing a little below the figures at #101
    coverage: {
      include: ['src/**'],
      reporter: ['text', 'html'],
      thresholds: { statements: 92, branches: 88, functions: 94, lines: 92 },
    },
  },
})
