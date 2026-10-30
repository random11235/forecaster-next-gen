// The web build (#114): the whole app in one self-contained HTML file, to publish as a claude.ai artifact or on any
// static host. Run with `npm run build:web`, which builds the app first; the file lands at dist/web/forecaster.html.
// The page is the Milestone forecast screen in its empty state, as a first open shows it, with the app's script
// inline at the end: once it runs, it shows the screen and data the EM's browser has kept.
import { build } from 'esbuild'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const out = new URL('../dist/web/forecaster.html', import.meta.url)

const { openWebApp }: typeof import('../src/app/webApp.js') = await import(new URL('../dist/app/webApp.js', import.meta.url).href)
const { openWebStorage }: typeof import('../src/storage/webStorage.js') = await import(
  new URL('../dist/storage/webStorage.js', import.meta.url).href
)

const bundled = await build({
  absWorkingDir: root,
  entryPoints: ['src/app/webMain.ts'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  write: false,
  logLevel: 'warning',
})
const script = bundled.outputFiles[0]!.text
if (script.includes('</script')) throw new Error('The bundled script would close its <script> tag early.')

const firstOpen = openWebApp({ storage: openWebStorage(undefined) }).show({ method: 'GET', path: '/' })
const page = firstOpen.html.replace('</body>', () => `<script>${script}</script>\n</body>`)

mkdirSync(new URL('.', out), { recursive: true })
writeFileSync(out, page)
console.log(`Wrote ${fileURLToPath(out)} (${Math.round(page.length / 1024)} KB)`)
