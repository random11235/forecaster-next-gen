import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { treeSetup } from '../../scripts/factoryTree.ts'

/** A checkout holding just these package files. */
const checkout = (files: Record<string, string>): string => {
  const dir = mkdtempSync(join(tmpdir(), 'factory-tree-'))
  mkdirSync(dir, { recursive: true })
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text)
  return dir
}

const MAIN = { 'package.json': '{"name":"forecaster"}', 'package-lock.json': '{"lockfileVersion":3}' }

describe('how the sandbox gets the dependencies of the tree it builds on', () => {
  test("copies in the runner's node_modules, and the skills, when the tree's package files are the runner's", () => {
    expect(treeSetup(checkout(MAIN), checkout(MAIN))).toEqual({ copyToWorktree: ['node_modules', '.claude/skills'] })
  })

  test("installs the tree's own, with npm ci in the sandbox, when its lockfile or package.json differs", () => {
    const install = { copyToWorktree: ['.claude/skills'], hooks: { sandbox: { onSandboxReady: [{ command: 'npm ci', timeoutMs: 600_000 }] } } }

    expect(treeSetup(checkout(MAIN), checkout({ ...MAIN, 'package-lock.json': '{"lockfileVersion":3,"packages":{}}' }))).toEqual(install)
    expect(treeSetup(checkout(MAIN), checkout({ ...MAIN, 'package.json': '{"name":"forecaster","scripts":{}}' }))).toEqual(install)
    expect(treeSetup(checkout(MAIN), checkout({ 'package.json': MAIN['package.json'] }))).toEqual(install)
  })
})
