// The web build (#114): the whole app in one self-contained HTML file, fonts included, shared by sending the file
// (#57). Run with `npm run build:web`, which builds the app first; the file lands at dist/web/forecaster.html.
// The page is the Milestone forecast screen in its empty state, as a first open shows it, with the app's script
// inline at the end: once it runs, it shows the screen and data the EM's browser has kept.
import { build, type Plugin } from 'esbuild'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const out = new URL('../dist/web/forecaster.html', import.meta.url)

const { openWebApp }: typeof import('../src/app/webApp.js') = await import(new URL('../dist/app/webApp.js', import.meta.url).href)
const { openWebStorage }: typeof import('../src/storage/webStorage.js') = await import(new URL('../dist/storage/webStorage.js', import.meta.url).href)
const { FONT_FACES }: typeof import('../src/app/fonts.js') = await import(new URL('../dist/app/fonts.js', import.meta.url).href)
/**
 * `src/app/fonts.ts` reads its font files from disk, which a browser can't: the bundle gets the faces it read. Only that
 * module is swapped, matched by the file an import resolves to: another folder's file of the same name is its own (#280).
 */
const fonts = fileURLToPath(new URL('../src/app/fonts.js', import.meta.url))
const inlineFonts: Plugin = {
  name: 'inline-fonts',
  setup(build) {
    build.onResolve({ filter: /\/fonts\.js$/ }, (args) =>
      resolve(args.resolveDir, args.path) === fonts ? { path: 'fonts', namespace: 'inline-fonts' } : undefined,
    )
    build.onLoad({ filter: /^fonts$/, namespace: 'inline-fonts' }, () => ({
      contents: `export const FONT_FACES = ${JSON.stringify(FONT_FACES)}`,
      loader: 'js',
    }))
  },
}

const bundled = await build({
  plugins: [inlineFonts],
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
