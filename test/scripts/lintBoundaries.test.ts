import { afterEach, beforeEach, expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Runs `npm run lint:boundaries`'s script (scripts/lintBoundaries.ts) as the npm script does: over the real repo, and
// over a stand-in repo of its own, whose modules a case writes, with the repo's .dependency-cruiser.cjs.
const root = fileURLToPath(new URL('../..', import.meta.url))
const script = join(root, 'scripts/lintBoundaries.ts')

/** This test's stand-in repo. */
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'forecaster-boundaries-'))
  writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { module: 'NodeNext', allowImportingTsExtensions: true } }))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** Writes each file, by its path in the stand-in repo. */
function write(files: Record<string, string>): void {
  for (const [path, source] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), source)
  }
}

/** Runs the script in `cwd` over `paths`, returning its exit code and everything it printed. */
function lint(cwd: string, ...paths: string[]): { code: number | null; output: string } {
  const run = spawnSync(process.execPath, [script, ...paths], { cwd, encoding: 'utf8' })
  return { code: run.status, output: run.stdout + run.stderr }
}

const modules = {
  'src/billing/invoice.ts': 'export const total = (amount: number): number => amount\n',
  'src/billing/lib/rounding.ts': 'export const round = (amount: number): number => Math.round(amount)\n',
}

test("the repo's src, test and scripts import each module only through its entry points", () => {
  const { code, output } = lint(root)

  expect(output).toMatch(/no dependency violations found \([1-9]\d* modules/)
  expect(code).toBe(0)
})

test("a module reaching into another module's subfolder fails, naming the rule", () => {
  write({ ...modules, 'src/orders/order.ts': "import { round } from '../billing/lib/rounding.ts'\nexport const price = round(1.5)\n" })

  const { code, output } = lint(dir, 'src')

  expect(output).toContain('entrypoint-boundary-across-packages')
  expect(output).toContain('src/orders/order.ts → src/billing/lib/rounding.ts')
  expect(code).not.toBe(0)
})

test("a module importing another's entry point, and its own subfolder, passes", () => {
  write({
    ...modules,
    'src/billing/invoice.ts': "import { round } from './lib/rounding.ts'\nexport const total = (amount: number): number => round(amount)\n",
    'src/orders/order.ts': "import { total } from '../billing/invoice.ts'\nexport const price = total(1.5)\n",
  })

  const { code, output } = lint(dir, 'src')

  expect(output).toContain('no dependency violations found (3 modules')
  expect(code).toBe(0)
})

test('a test reaching into a module subfolder fails', () => {
  write({ ...modules, 'test/billing.test.ts': "import { round } from '../src/billing/lib/rounding.ts'\nround(1)\n" })

  const { code, output } = lint(dir, 'src', 'test')

  expect(output).toContain('entrypoint-boundary-from-app')
  expect(code).not.toBe(0)
})

test('an import type counts as a dependency', () => {
  write({ ...modules, 'src/orders/order.ts': "import type { round } from '../billing/lib/rounding.ts'\nexport type Round = typeof round\n" })

  const { code } = lint(dir, 'src')

  expect(code).not.toBe(0)
})

test('a dependency cycle fails', () => {
  write({
    'src/billing/invoice.ts': "import { price } from '../orders/order.ts'\nexport const total = price\n",
    'src/orders/order.ts': "import { total } from '../billing/invoice.ts'\nexport const price = 1\nexport const both = total\n",
  })

  const { code, output } = lint(dir, 'src')

  expect(output).toContain('no-circular')
  expect(code).not.toBe(0)
})

test('a run that cruises no modules fails rather than passing', () => {
  write({ 'src/README.md': 'no source here\n' })

  const { code, output } = lint(dir, 'src')

  expect(output).toContain('cruised no modules')
  expect(code).not.toBe(0)
})
