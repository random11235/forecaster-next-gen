import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // agents' git worktrees under .claude/ each hold a full copy of the repo and its tests
    exclude: [...configDefaults.exclude, '.claude/**'],
  },
})
