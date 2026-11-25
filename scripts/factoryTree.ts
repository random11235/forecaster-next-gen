// The tree the factory's build (scripts/factoryBuild.ts) hands Sandcastle: TREE, a clone of the branch the ticket is
// built on, which the workflow makes apart from the runner's own checkout of the default branch, whose code,
// dependencies and hooks are all that run on the host. A spec's ticket is built on spec/<n>, which holds earlier agents'
// code: nothing from it may run outside the sandbox, so its dependencies, if they aren't the runner's, are installed
// inside it, and nothing in it is read but as plain files.

import { appendFileSync, cpSync, lstatSync, mkdirSync, readdirSync, readFileSync, symlinkSync, type Stats } from 'node:fs'
import { join } from 'node:path'

/** What Sandcastle copies into the worktree from the tree, and the commands it runs in the sandbox before the agent. */
export type TreeSetup = {
  copyToWorktree: string[]
  hooks?: { sandbox: { onSandboxReady: { command: string; timeoutMs: number }[] } }
}

const PACKAGE_FILES = ['package.json', 'package-lock.json']

/** An install's time: about the setup action's `npm ci`, with room to spare. */
const INSTALL_MS = 600_000

/**
 * The install runs the tree's lifecycle scripts; it needs no model, so it doesn't get the agent's token, which
 * Sandcastle puts in every sandbox command's env. The agent runs the tree's code later with it all the same (R3).
 */
const INSTALL = 'env -u CLAUDE_CODE_OAUTH_TOKEN npm ci'

const statOf = (path: string): Stats | undefined => lstatSync(path, { throwIfNoEntry: false })

/** A plain file's text; a link, a device or a FIFO is never read, and counts as nothing. */
const plainText = (path: string): string | undefined => (statOf(path)?.isFile() ? readFileSync(path, 'utf8') : undefined)

/**
 * Readies the tree for Sandcastle, or throws why the factory won't build on it, and says what to copy into the
 * worktree. Sandcastle reads the tree's .sandcastle/.env into the sandbox's env, filling a key left empty from the
 * host's, so a tree holding .sandcastle is refused; and so is one holding node_modules, or linking .claude or its skills
 * elsewhere, where the runner's go. The runner's skills that the tree lacks are copied in: the ones it tracks stay its
 * own. The runner's node_modules is linked in, to be copied, when the tree's package files are the runner's, read only
 * if plain files; otherwise the sandbox runs `npm ci`, whose lifecycle scripts are then the tree's, in bwrap.
 */
export function prepareTree(runnerDir: string, treeDir: string): TreeSetup {
  for (const path of ['.sandcastle', 'node_modules']) {
    if (statOf(join(treeDir, path))) throw new Error(`the branch holds ${path}, which the factory won't build on`)
  }
  for (const path of ['.claude', '.claude/skills']) {
    if (statOf(join(treeDir, path))?.isSymbolicLink()) throw new Error(`the branch links ${path} elsewhere, which the factory won't build on`)
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
