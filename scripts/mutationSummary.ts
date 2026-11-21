// The Markdown CI's job summary shows for a mutation run (scripts/mutateDiff.ts): how many lines it mutated, its
// mutants by status, and each survivor, so survivors can be measured before we decide what to do about them
// (docs/research/mutation-survivors.md).

import { readFileSync } from 'node:fs'

/** The fields of Stryker's JSON report (mutation-testing-report-schema) the summary reads. */
export type MutationReport = {
  files: Record<string, { source: string; mutants: ReportedMutant[] }>
}

type ReportedMutant = {
  mutatorName: string
  replacement?: string
  status: string
  location: { start: { line: number; column: number }; end: { line: number; column: number } }
}

const RANGE = /^(.+):(\d+)-(\d+)$/

/** Code as one cell of a Markdown table row: on one line, its `|` escaped so it doesn't end the cell. */
const cell = (code: string): string => code.replace(/\s*\n\s*/g, ' ').replaceAll('|', '\\|')

/**
 * The summary of a run of `report` over `targets`, the `--mutate` patterns mutateDiff.ts passed (`path:start-end`).
 * A survivor is a mutant no test caught: Survived, or NoCoverage when no test ran it.
 */
export function mutationSummary(report: MutationReport, targets: string[]): string {
  const linesMutated = targets.reduce((lines, target) => {
    const range = RANGE.exec(target)
    if (range) return lines + Number(range[3]) - Number(range[2]) + 1
    // a new file, mutated throughout: each line of its source, the last ending in a newline or not
    const source = report.files[target]?.source ?? ''
    return lines + source.split('\n').length - (source.endsWith('\n') ? 1 : 0)
  }, 0)
  const mutants = Object.entries(report.files).flatMap(([path, file]) => file.mutants.map((m) => ({ path, ...m })))
  const survivors = mutants.filter((m) => m.status === 'Survived' || m.status === 'NoCoverage')
  const byStatus = new Map<string, number>()
  for (const m of mutants) byStatus.set(m.status, (byStatus.get(m.status) ?? 0) + 1)
  const rate = linesMutated === 0 ? 0 : survivors.length / linesMutated

  return [
    `**Lines mutated:** ${linesMutated} · **Mutants:** ${mutants.length} · **Survivors:** ${survivors.length}, ${rate.toFixed(2)} per line mutated`,
    '',
    '| Status | Mutants |',
    '| --- | ---: |',
    ...[...byStatus].map(([status, count]) => `| ${status} | ${count} |`),
    '',
    ...(survivors.length === 0
      ? ['No survivors.']
      : [
          '| File | Line | Mutator | Status | Replacement |',
          '| --- | ---: | --- | --- | --- |',
          ...survivors.map((m) => `| \`${m.path}\` | ${m.location.start.line} | ${m.mutatorName} | ${m.status} | \`${cell(m.replacement ?? '')}\` |`),
        ]),
  ].join('\n')
}

if (import.meta.main) {
  // `node scripts/mutationSummary.ts`, after `npm run test:mutation`: prints the summary of reports/mutation/
  const read = (name: string): unknown => JSON.parse(readFileSync(new URL(`../reports/mutation/${name}`, import.meta.url), 'utf8'))
  console.log(mutationSummary(read('mutation.json') as MutationReport, read('targets.json') as string[]))
}
