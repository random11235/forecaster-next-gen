import { describe, expect, test } from 'vitest'
import { mutationSummary, type MutationReport } from '../../scripts/mutationSummary.ts'

type Mutant = MutationReport['files'][string]['mutants'][number]

/** A mutant as Stryker's JSON report gives it, on one line. */
function mutant(line: number, status: Mutant['status'], mutatorName = 'ConditionalExpression', replacement = 'true'): Mutant {
  return { mutatorName, replacement, status, location: { start: { line, column: 5 }, end: { line, column: 9 } } }
}

/** Stryker's JSON report of one file, with `lines` lines of source. */
function reportOf(files: Record<string, { lines: number; mutants: Mutant[] }>): MutationReport {
  return {
    files: Object.fromEntries(Object.entries(files).map(([path, { lines, mutants }]) => [path, { source: 'x\n'.repeat(lines), mutants }])),
  }
}

describe('the summary of a mutation run', () => {
  test('counts the lines mutated, the mutants by status and the survivors per line, and lists each survivor', () => {
    const report = reportOf({
      'src/engine/pace.ts': { lines: 50, mutants: [mutant(10, 'Killed'), mutant(11, 'Survived', 'EqualityOperator', 'a >= b')] },
    })

    const summary = mutationSummary(report, ['src/engine/pace.ts:10-12'])

    expect(summary).toContain('**Lines mutated:** 3 · **Mutants:** 2 · **Survivors:** 1, 0.33 per line mutated')
    expect(summary).toContain('| Killed | 1 |')
    expect(summary).toContain('| Survived | 1 |')
    expect(summary).toContain('| `src/engine/pace.ts` | 11 | EqualityOperator | Survived | `a >= b` |')
  })

  test('a new file, mutated throughout, counts each of its lines as mutated', () => {
    const report = reportOf({
      'src/engine/pace.ts': { lines: 50, mutants: [mutant(10, 'Survived')] },
      'src/engine/cadence.ts': { lines: 20, mutants: [mutant(4, 'Killed')] },
    })

    const summary = mutationSummary(report, ['src/engine/pace.ts:10-14', 'src/engine/cadence.ts'])

    expect(summary).toContain('**Lines mutated:** 25 ·')
  })

  test('a mutant no test ran is a survivor too, listed as having no coverage; one a test caught is not', () => {
    const report = reportOf({
      'src/engine/pace.ts': {
        lines: 50,
        mutants: [mutant(10, 'NoCoverage', 'BlockStatement', '{}'), mutant(11, 'Timeout'), mutant(12, 'Killed'), mutant(13, 'Ignored')],
      },
    })

    const summary = mutationSummary(report, ['src/engine/pace.ts:10-13'])

    expect(summary).toContain('**Survivors:** 1, 0.25 per line mutated')
    expect(summary).toContain('| `src/engine/pace.ts` | 10 | BlockStatement | NoCoverage | `{}` |')
    expect(summary).not.toContain('| `src/engine/pace.ts` | 11 |')
  })

  test('a run every mutant of which was caught says it has no survivors, with no table of them', () => {
    const report = reportOf({ 'src/engine/pace.ts': { lines: 50, mutants: [mutant(10, 'Killed')] } })

    const summary = mutationSummary(report, ['src/engine/pace.ts:10-10'])

    expect(summary).toContain('No survivors.')
    expect(summary).not.toContain('| File |')
  })

  test('a replacement over several lines, or with a | in it, stays on its row of the table', () => {
    const report = reportOf({
      'src/engine/pace.ts': { lines: 50, mutants: [mutant(10, 'Survived', 'LogicalOperator', 'a ||\n  b')] },
    })

    const summary = mutationSummary(report, ['src/engine/pace.ts:10-11'])

    expect(summary).toContain('| `src/engine/pace.ts` | 10 | LogicalOperator | Survived | `a \\|\\| b` |')
  })
})
