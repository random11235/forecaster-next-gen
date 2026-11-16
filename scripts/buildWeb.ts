// The web build (#114): the whole app in one self-contained HTML file, fonts included, shared by sending the file
// (#57). Run with `npm run build:web`, which builds the app first; the file lands at dist/web/forecaster.html.
// The page is the Milestone forecast screen in its empty state, as a first open shows it, with the app's script
// inline at the end: once it runs, it shows the screen and data the EM's browser has kept.
import { build, type Plugin } from 'esbuild'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const out = new URL('../dist/web/forecaster.html', import.meta.url)

const { openWebApp }: typeof import('../src/app/webApp.js') = await import(new URL('../dist/app/webApp.js', import.meta.url).href)
const { openWebStorage }: typeof import('../src/storage/webStorage.js') = await import(new URL('../dist/storage/webStorage.js', import.meta.url).href)
const { FONT_FACES }: typeof import('../src/app/fonts.js') = await import(new URL('../dist/app/fonts.js', import.meta.url).href)
const { VERSION }: typeof import('../src/app/version.js') = await import(new URL('../dist/app/version.js', import.meta.url).href)

/**
 * `src/app/fonts.ts` reads its font files from disk, and `src/app/version.ts` reads `package.json`, which a browser
 * can't: the bundle gets what they read.
 */
const inlineReadOnDisk: Plugin = {
  name: 'inline-read-on-disk',
  setup(build) {
    const inline = (file: string, contents: string): void => {
      build.onResolve({ filter: new RegExp(`^\\./${file}\\.js$`) }, () => ({ path: file, namespace: 'inline-read-on-disk' }))
      build.onLoad({ filter: new RegExp(`^${file}$`), namespace: 'inline-read-on-disk' }, () => ({ contents, loader: 'js' }))
    }
    inline('fonts', `export const FONT_FACES = ${JSON.stringify(FONT_FACES)}`)
    inline('version', `export const VERSION = ${JSON.stringify(VERSION)}`)
  },
}

const bundled = await build({
  plugins: [inlineReadOnDisk],
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
