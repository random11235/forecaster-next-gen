import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { UnbuildableTree } from '../factoryOutcome.ts'
import { ONLY_DIRECTORIES, prepareTree, REFUSED_PATHS } from '../factoryTree.ts'

const made: string[] = []
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A checkout holding these files, by path. */
const checkout = (files: Record<string, string>): string => {
  const dir = mkdtempSync(join(tmpdir(), 'factory-tree-'))
  made.push(dir)
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  return dir
}

const PACKAGE = { 'package.json': '{"name":"forecaster"}', 'package-lock.json': '{"lockfileVersion":3}' }

/** The runner's checkout of the default branch: its package files, node_modules and skills. */
const runner = () =>
  checkout({
    ...PACKAGE,
    'node_modules/vitest/index.js': '',
    '.claude/skills/tdd/SKILL.md': 'runner tdd',
    '.claude/skills/implement/SKILL.md': 'runner implement',
  })

const COPY = { copyToWorktree: ['node_modules', '.claude/skills'] }

const INSTALL = {
  copyToWorktree: ['.claude/skills'],
  hooks: { sandbox: { onSandboxReady: [{ command: 'npm ci', timeoutMs: 600_000 }] } },
}

describe('the tree the factory builds a ticket in, apart from the runner’s checkout', () => {
  test("gets the runner's node_modules, linked, to be copied into the worktree, when its package files are the runner's", () => {
    const from = runner()
    const tree = checkout(PACKAGE)

    expect(prepareTree(from, tree)).toEqual(COPY)
    expect(readlinkSync(join(tree, 'node_modules'))).toBe(join(from, 'node_modules'))
    expect(readFileSync(join(tree, '.git/info/exclude'), 'utf8')).toContain('node_modules\n')
  })

  test("gets the runner's skills that it lacks, and keeps the ones it tracks as its own", () => {
    const tree = checkout({ ...PACKAGE, '.claude/skills/implement/SKILL.md': 'tree implement' })

    prepareTree(runner(), tree)

    expect(readFileSync(join(tree, '.claude/skills/tdd/SKILL.md'), 'utf8')).toBe('runner tdd')
    expect(readFileSync(join(tree, '.claude/skills/implement/SKILL.md'), 'utf8')).toBe('tree implement')
    expect(lstatSync(join(tree, '.claude/skills/tdd')).isSymbolicLink()).toBe(false)
  })

  test('installs its own dependencies with npm ci in the sandbox when its lockfile or package.json differs', () => {
    expect(prepareTree(runner(), checkout({ ...PACKAGE, 'package-lock.json': '{"lockfileVersion":3,"packages":{}}' }))).toEqual(INSTALL)
    expect(prepareTree(runner(), checkout({ ...PACKAGE, 'package.json': '{"name":"forecaster","scripts":{}}' }))).toEqual(INSTALL)
    expect(prepareTree(runner(), checkout({ 'package.json': PACKAGE['package.json'] }))).toEqual(INSTALL)
  })

  test("takes a package file that isn't a plain file as differing, without reading through it", () => {
    const from = runner()
    const tree = checkout({ 'package.json': PACKAGE['package.json'] })
    symlinkSync(join(from, 'package-lock.json'), join(tree, 'package-lock.json'))
    const device = checkout({ 'package.json': PACKAGE['package.json'] })
    symlinkSync('/dev/zero', join(device, 'package-lock.json'))

    expect(prepareTree(from, tree)).toEqual(INSTALL)
    expect(prepareTree(from, device)).toEqual(INSTALL)
  })

  test('refuses a tree holding .sandcastle or node_modules, or .claude or its skills as anything but a directory, saying which', () => {
    const elsewhere = checkout({})
    const linked = (path: string) => {
      const tree = checkout(PACKAGE)
      mkdirSync(dirname(join(tree, path)), { recursive: true })
      symlinkSync(elsewhere, join(tree, path))
      return tree
    }

    expect(() => prepareTree(runner(), checkout({ ...PACKAGE, '.sandcastle/.env': 'GH_TOKEN=' }))).toThrow(
      "the branch holds .sandcastle, which the factory won't build on",
    )
    expect(() => prepareTree(runner(), checkout({ ...PACKAGE, 'node_modules/x.js': '' }))).toThrow(
      "the branch holds node_modules, which the factory won't build on",
    )
    expect(() => prepareTree(runner(), linked('node_modules'))).toThrow('the branch holds node_modules')
    expect(() => prepareTree(runner(), linked('.claude'))).toThrow(
      "the branch holds .claude as something other than a directory, which the factory won't build on",
    )
    expect(() => prepareTree(runner(), linked('.claude/skills'))).toThrow(
      "the branch holds .claude/skills as something other than a directory, which the factory won't build on",
    )
    expect(() => prepareTree(runner(), checkout({ ...PACKAGE, '.claude': '' }))).toThrow('the branch holds .claude as something other than a directory')
    expect(() => prepareTree(runner(), checkout({ ...PACKAGE, '.claude/skills': '' }))).toThrow(UnbuildableTree)
    expect(existsSync(join(elsewhere, 'tdd'))).toBe(false)
  })
})

test("the factory's workflow refuses to push a branch holding what the build refuses", () => {
  const workflow = readFileSync(new URL('../../.github/workflows/factory.yml', import.meta.url), 'utf8')
  const line = (marker: string) => workflow.split('\n').find((each) => each.endsWith(`# ${marker} in factory/factoryTree.ts`))

  expect(line('REFUSED_PATHS')).toContain(`$(git ls-tree --name-only "$BRANCH" -- ${REFUSED_PATHS.join(' ')})`)
  expect(line('ONLY_DIRECTORIES')).toContain(`$(git ls-tree "$BRANCH" -- ${ONLY_DIRECTORIES.join(' ')} | awk '$2 != "tree" { print $4 }')`)
})
