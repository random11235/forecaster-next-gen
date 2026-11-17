// The web build (#114): the whole app in one self-contained HTML file, fonts included, shared by sending the file
// (#57). Run with `npm run build:web`, which builds the app first; the file lands at dist/web/forecaster.html.
// The page is the Milestone forecast screen in its empty state, as a first open shows it, with the app's script
// inline at the end: once it runs, it shows the screen and data the EM's browser has kept.
import { build, type Plugin } from 'esbuild'
import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const out = new URL('../dist/web/forecaster.html', import.meta.url)

const { openWebApp }: typeof import('../src/app/webApp.js') = await import(new URL('../dist/app/webApp.js', import.meta.url).href)
const { openWebStorage }: typeof import('../src/storage/webStorage.js') = await import(new URL('../dist/storage/webStorage.js', import.meta.url).href)
const { FONT_FACES }: typeof import('../src/app/fonts.js') = await import(new URL('../dist/app/fonts.js', import.meta.url).href)
const { APP_VERSION }: typeof import('../src/forecast/appVersion.js') = await import(new URL('../dist/forecast/appVersion.js', import.meta.url).href)

/**
 * `src/app/fonts.ts` reads its font files from disk, and `src/forecast/appVersion.ts` reads `package.json`, which a
 * browser can't: the bundle gets what they read. Only those two modules are swapped, matched by the file an import
 * resolves to: another folder's file of the same name, such as the engine's `version.ts`, is its own (#280).
 */
const inlineReadOnDisk: Plugin = {
  name: 'inline-read-on-disk',
  setup(build) {
    const inline = (module: string, contents: string): void => {
      const file = fileURLToPath(new URL(`../src/${module}.js`, import.meta.url))
      const name = basename(file)
      build.onResolve({ filter: new RegExp(`/${name.replace('.', '\\.')}$`) }, (args) =>
        resolve(args.resolveDir, args.path) === file ? { path: module, namespace: 'inline-read-on-disk' } : undefined,
      )
      build.onLoad({ filter: new RegExp(`^${module}$`), namespace: 'inline-read-on-disk' }, () => ({ contents, loader: 'js' }))
    }
    inline('app/fonts', `export const FONT_FACES = ${JSON.stringify(FONT_FACES)}`)
    inline('forecast/appVersion', `export const APP_VERSION = ${JSON.stringify(APP_VERSION)}`)
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
