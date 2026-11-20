// Module boundaries: dependency-cruiser over src, test and scripts (or the paths passed), with the rules in
// .dependency-cruiser.cjs: code outside a module imports only its entry points, each module imports only the modules
// docs/design/architecture-dependency-rules.md allows it, and no dependency cycles. src/README.md sets out the layout.
// Run with `npm run lint:boundaries`; exits 1 on a violation, and on a run that cruises no modules, as dependency-cruiser
// does on a TypeScript it can't parse, rather than passing on nothing.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const paths = process.argv.length > 2 ? process.argv.slice(2) : ['src', 'test', 'scripts']
const depcruise = (outputType: string) =>
  spawnSync(
    process.execPath,
    [`${root}node_modules/dependency-cruiser/bin/dependency-cruiser.mjs`, '--config', `${root}.dependency-cruiser.cjs`, '--output-type', outputType, ...paths],
    { encoding: 'utf8' },
  )

const run = depcruise('json')
if (run.error !== undefined || run.stdout === '') {
  console.error(`lint:boundaries could not run dependency-cruiser:\n${run.stderr}`)
  process.exit(1)
}
const { summary } = JSON.parse(run.stdout) as { summary: { totalCruised: number; error: number } }
if (summary.totalCruised === 0) {
  console.error(`lint:boundaries cruised no modules in ${paths.join(', ')}, so it checked nothing; it fails rather than pass.`)
  process.exit(1)
}
if (summary.error > 0) {
  console.error(depcruise('err-long').stdout)
  process.exit(1)
}
console.log(`lint:boundaries: no dependency violations found (${summary.totalCruised} modules cruised in ${paths.join(', ')}).`)
