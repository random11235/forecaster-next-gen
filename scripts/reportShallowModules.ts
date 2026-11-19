// Prints the shallowest modules in src/ as Markdown (scripts/moduleDepth.ts), for CI's job summary: CI appends it to
// $GITHUB_STEP_SUMMARY. A report, not a check: it exits 0 whatever it finds.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { moduleDepths, shallowestModules } from './moduleDepth.ts'

const src = fileURLToPath(new URL('../src', import.meta.url))
const files = Object.fromEntries(
  readdirSync(src, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.ts'))
    .map((file) => [file, readFileSync(join(src, file), 'utf8')]),
)

console.log(shallowestModules(moduleDepths(files)))
