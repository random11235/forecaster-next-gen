// Vitest global setup: builds the app and its web build once, before any test file runs.
// test/app/smoke.test.ts runs dist/app/main.js and test/app/webBuild.test.ts reads dist/web/forecaster.html.
// When each built for itself, one could rewrite dist/app/ while the other was starting the app from it.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export default function buildOnce(): void {
  execFileSync('npm', ['run', 'build:web'], { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'ignore' })
}
