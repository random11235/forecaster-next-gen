// The tree the factory's build (scripts/factoryBuild.ts) hands Sandcastle: a checkout of the branch the ticket is built
// on, apart from the runner's own checkout of the default branch, whose code, dependencies and hooks are all that run
// on the host. A spec's ticket is built on spec/<n>, which holds earlier agents' code: nothing from it may run outside
// the sandbox, so its dependencies, if they aren't the runner's, are installed inside it.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** What Sandcastle copies into the worktree from the tree, and the commands it runs in the sandbox before the agent. */
export type TreeSetup = {
  copyToWorktree: string[]
  hooks?: { sandbox: { onSandboxReady: { command: string; timeoutMs: number }[] } }
}

const PACKAGE_FILES = ['package.json', 'package-lock.json']

/** An install's time: about the setup action's `npm ci`, with room to spare. */
const INSTALL_MS = 600_000

const read = (dir: string, name: string): string | undefined => {
  const path = join(dir, name)
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined
}

/**
 * The runner's node_modules is copied in when the tree's package files are the runner's; otherwise the sandbox runs
 * `npm ci`, whose lifecycle scripts are then the tree's, in bwrap. The skills are copied in either way: the tree holds
 * the ones git tracks, and the build adds the runner's installed ones.
 */
export function treeSetup(runnerDir: string, treeDir: string): TreeSetup {
  const same = PACKAGE_FILES.every((name) => read(runnerDir, name) === read(treeDir, name))
  if (same) return { copyToWorktree: ['node_modules', '.claude/skills'] }
  return { copyToWorktree: ['.claude/skills'], hooks: { sandbox: { onSandboxReady: [{ command: 'npm ci', timeoutMs: INSTALL_MS }] } } }
}
