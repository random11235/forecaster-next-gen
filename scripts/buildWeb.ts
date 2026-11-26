// The web build (#114): the whole app in one self-contained HTML file, fonts included, shared by sending the file
// (#57). Run with `npm run build:web`, which builds the app first; the file lands at dist/web/forecaster.html.
// The page is the Milestone forecast screen in its empty state, as a first open shows it, with the app's script
// inline at the end: once it runs, it shows the screen and data the EM's browser has kept.
import { build, type BuildOptions, type Plugin } from 'esbuild'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const out = new URL('../dist/web/forecaster.html', import.meta.url)

const { FONT_FACES }: typeof import('../src/app/fonts.js') = await import(new URL('../dist/app/fonts.js', import.meta.url).href)
const { APP_VERSION }: typeof import('../src/forecast/index.js') = await import(new URL('../dist/forecast/index.js', import.meta.url).href)
const { FEEDBACK_REPO }: typeof import('../src/app/feedbackRepo.js') = await import(new URL('../dist/app/feedbackRepo.js', import.meta.url).href)

/**
 * What the bundles get in place of a file, matched by the file an import resolves to: another folder's file of the same
 * name is its own (#280). `src/app/fonts.ts` reads its font files from disk, which a browser can't, so the bundle gets
 * the faces it read. `src/forecast/lib/appVersion.ts` imports `package.json`, which the page is shared without (#57): the
 * bundle gets its version alone, none of its scripts or dependencies. `src/app/feedbackRepo.ts` records no repo, which
 * `npm run build` records in dist/ alone (#370): the bundle gets `feedbackRepo`, the one recorded unless told another.
 */
function inline(feedbackRepo: string | undefined): Plugin {
  const inlined: Record<string, string> = {
    [fileURLToPath(new URL('../src/app/fonts.js', import.meta.url))]: `export const FONT_FACES = ${JSON.stringify(FONT_FACES)}`,
    [fileURLToPath(new URL('../package.json', import.meta.url))]: `export default { version: ${JSON.stringify(APP_VERSION)} }`,
    [fileURLToPath(new URL('../src/app/feedbackRepo.js', import.meta.url))]: `export const FEEDBACK_REPO = ${JSON.stringify(feedbackRepo)}`,
  }
  return {
    name: 'inline',
    setup(build) {
      build.onResolve({ filter: /\/(fonts\.js|feedbackRepo\.js|package\.json)$/ }, (args) => {
        const file = resolve(args.resolveDir, args.path)
        return file in inlined ? { path: file, namespace: 'inline' } : undefined
      })
      build.onLoad({ filter: /.*/, namespace: 'inline' }, (args) => {
        const contents = inlined[args.path]
        return contents === undefined ? undefined : { contents, loader: 'js' }
      })
    },
  }
}

/**
 * The web build's page, sending Feedback to `feedbackRepo`, or with no Send feedback link for none (#371). The first
 * page is rendered from a bundle of the app made as the page's script is, so it carries the same repo as the screens
 * the script goes on to show.
 */
export async function webPage(feedbackRepo: string | undefined): Promise<string> {
  const options = {
    plugins: [inline(feedbackRepo)],
    absWorkingDir: root,
    bundle: true,
    target: 'es2022',
    write: false,
    logLevel: 'warning',
  } as const satisfies BuildOptions
  const [browser, renderer] = await Promise.all([
    build({ ...options, entryPoints: ['src/app/webMain.ts'], format: 'iife', platform: 'browser', minify: true }),
    build({
      ...options,
      stdin: {
        contents: "export { openWebApp } from './src/app/webApp.ts'\nexport { openWebStorage } from './src/storage/webStorage.ts'",
        resolveDir: root,
        loader: 'ts',
      },
      format: 'esm',
      platform: 'node',
    }),
  ])
  const script = browser.outputFiles[0]!.text
  if (script.includes('</script')) throw new Error('The bundled script would close its <script> tag early.')

  const { openWebApp, openWebStorage }: typeof import('../src/app/webApp.js') & typeof import('../src/storage/webStorage.js') = await import(
    `data:text/javascript;base64,${Buffer.from(renderer.outputFiles[0]!.text).toString('base64')}`
  )
  const firstOpen = await openWebApp({ storage: openWebStorage(undefined) }).show({ method: 'GET', path: '/' })
  return firstOpen.html.replace('</body>', () => `<script>${script}</script>\n</body>`)
}

if (import.meta.main) {
  const page = await webPage(FEEDBACK_REPO)
  mkdirSync(new URL('.', out), { recursive: true })
  writeFileSync(out, page)
  console.log(`Wrote ${fileURLToPath(out)} (${Math.round(page.length / 1024)} KB)`)
}
