// The tree the factory's build (factory/factoryBuild.ts) hands Sandcastle: TREE, a clone of the branch the ticket is
// built on, which the workflow makes apart from the runner's own checkout of the default branch, whose code,
// dependencies and hooks are all that run on the host. A spec's ticket is built on spec/<n>, which holds earlier agents'
// code: nothing from it may run outside the sandbox, so its dependencies, if they aren't the runner's, are installed
// inside it, and nothing in it is read but as plain files.

import { appendFileSync, cpSync, lstatSync, mkdirSync, readdirSync, readFileSync, symlinkSync, type Stats } from 'node:fs'
import { join } from 'node:path'
import { UnbuildableTree } from './factoryOutcome.ts'

/** What Sandcastle copies into the worktree from the tree, and the commands it runs in the sandbox before the agent. */
export type TreeSetup = {
  copyToWorktree: string[]
  hooks?: { sandbox: { onSandboxReady: { command: string; timeoutMs: number }[] } }
}

const PACKAGE_FILES = ['package.json', 'package-lock.json']

/** An install's time: about the setup action's `npm ci`, with room to spare. */
const INSTALL_MS = 600_000

/** The install runs the tree's lifecycle scripts, in the sandbox, which holds the agent's OAuth token (R3). */
const INSTALL = 'npm ci'

/**
 * What the factory won't build on, as a branch holds it, so won't push either (the workflow's publish job): Sandcastle
 * reads a tree's .sandcastle/.env into the sandbox's env, filling a key left empty from the host's, and the runner's
 * node_modules goes where the tree's would.
 */
export const REFUSED_PATHS = ['.sandcastle', 'node_modules']

/** What must be a directory if the branch holds it, as the runner's skills go in it. */
export const ONLY_DIRECTORIES = ['.claude', '.claude/skills']

const statOf = (path: string): Stats | undefined => lstatSync(path, { throwIfNoEntry: false })

/** A plain file's text; a link, a device or a FIFO is never read, and counts as nothing. */
const plainText = (path: string): string | undefined => (statOf(path)?.isFile() ? readFileSync(path, 'utf8') : undefined)

/**
 * Readies the tree for Sandcastle, or throws UnbuildableTree, and says what to copy into the worktree. The runner's
 * skills that the tree lacks are copied in: the ones it tracks stay its own. The runner's node_modules is linked in, to
 * be copied, when the tree's package files are the runner's, read only if plain files; otherwise the sandbox runs
 * `npm ci`, whose lifecycle scripts are then the tree's, in bwrap.
 */
export function prepareTree(runnerDir: string, treeDir: string): TreeSetup {
  for (const path of REFUSED_PATHS) {
    if (statOf(join(treeDir, path))) throw new UnbuildableTree(`the branch holds ${path}, which the factory won't build on`)
  }
  for (const path of ONLY_DIRECTORIES) {
    const stats = statOf(join(treeDir, path))
    if (stats && !stats.isDirectory()) {
      throw new UnbuildableTree(`the branch holds ${path} as something other than a directory, which the factory won't build on`)
    }
  }
  const skills = join(treeDir, '.claude/skills')
  mkdirSync(skills, { recursive: true })
  const runnerSkills = join(runnerDir, '.claude/skills')
  for (const name of readdirSync(runnerSkills)) {
    if (!statOf(join(skills, name))) cpSync(join(runnerSkills, name), join(skills, name), { recursive: true, dereference: true })
  }
  const same = PACKAGE_FILES.every((name) => {
    const theirs = plainText(join(treeDir, name))
    return theirs !== undefined && theirs === plainText(join(runnerDir, name))
  })
  if (!same) return { copyToWorktree: ['.claude/skills'], hooks: { sandbox: { onSandboxReady: [{ command: INSTALL, timeoutMs: INSTALL_MS }] } } }
  symlinkSync(join(runnerDir, 'node_modules'), join(treeDir, 'node_modules'))
  // .gitignore's `node_modules/` matches a directory, not a link to one, which would leave the tree dirty
  mkdirSync(join(treeDir, '.git/info'), { recursive: true })
  appendFileSync(join(treeDir, '.git/info/exclude'), 'node_modules\n')
  return { copyToWorktree: ['node_modules', '.claude/skills'] }
}
