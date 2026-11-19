// Prints the shallowest modules in src/ as Markdown (scripts/moduleDepth.ts), for CI's job summary: CI appends it to
// $GITHUB_STEP_SUMMARY. A report, not a check: it exits 0 whatever it finds.
import { fileURLToPath } from 'node:url'
import { moduleDepths, shallowestModules } from './moduleDepth.ts'
import { typeScriptSourcesUnder } from './sourceFiles.ts'

const src = fileURLToPath(new URL('../src', import.meta.url))
const files = Object.fromEntries(typeScriptSourcesUnder(src).map(({ file, source }) => [file, source]))

console.log(shallowestModules(moduleDepths(files)))
