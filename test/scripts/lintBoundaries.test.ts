import { expect, test } from 'vitest'
import { lint, root, standInRepo } from './boundariesRepo.ts'

// The module-boundary rules: code outside a module imports only its entry points, and no dependency cycles. The
// layering rules between modules are in lintBoundaries.layering.test.ts.
const repo = standInRepo()

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
  repo.write({ ...modules, 'src/orders/order.ts': "import { round } from '../billing/lib/rounding.ts'\nexport const price = round(1.5)\n" })

  const { code, output } = repo.lint('src')

  expect(output).toContain('entrypoint-boundary-across-packages')
  expect(output).toContain('src/orders/order.ts → src/billing/lib/rounding.ts')
  expect(code).not.toBe(0)
})

test("a module importing another's entry point, and its own subfolder, passes", () => {
  repo.write({
    ...modules,
    'src/billing/invoice.ts': "import { round } from './lib/rounding.ts'\nexport const total = (amount: number): number => round(amount)\n",
    'src/orders/order.ts': "import { total } from '../billing/invoice.ts'\nexport const price = total(1.5)\n",
  })

  const { code, output } = repo.lint('src')

  expect(output).toContain('no dependency violations found (3 modules')
  expect(code).toBe(0)
})

test('a test reaching into a module subfolder fails', () => {
  repo.write({ ...modules, 'test/billing.test.ts': "import { round } from '../src/billing/lib/rounding.ts'\nround(1)\n" })

  const { code, output } = repo.lint('src', 'test')

  expect(output).toContain('entrypoint-boundary-from-app')
  expect(code).not.toBe(0)
})

test('an import type counts as a dependency', () => {
  repo.write({ ...modules, 'src/orders/order.ts': "import type { round } from '../billing/lib/rounding.ts'\nexport type Round = typeof round\n" })

  const { code } = repo.lint('src')

  expect(code).not.toBe(0)
})

test('a dependency cycle fails', () => {
  repo.write({
    'src/billing/invoice.ts': "import { price } from '../orders/order.ts'\nexport const total = price\n",
    'src/orders/order.ts': "import { total } from '../billing/invoice.ts'\nexport const price = 1\nexport const both = total\n",
  })

  const { code, output } = repo.lint('src')

  expect(output).toContain('no-circular')
  expect(code).not.toBe(0)
})

test('a run that cruises no modules fails rather than passing', () => {
  repo.write({ 'src/README.md': 'no source here\n' })

  const { code, output } = repo.lint('src')

  expect(output).toContain('cruised no modules')
  expect(code).not.toBe(0)
})
