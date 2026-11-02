/**
 * The screens' fonts, Geist and Geist Mono (OFL-1.1, from Fontsource), as `@font-face` rules with the font files
 * inline, so a page loads nothing from outside: the web build is shared as one file, and may be opened offline.
 * Latin only, one variable file per family covering every weight. Read from `node_modules`, so only Node can load
 * this module: the web build's bundle gets `FONT_FACES` as a string instead (`scripts/buildWeb.ts`).
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

function fontFace(family: string, file: string): string {
  const base64 = readFileSync(require.resolve(file)).toString('base64')
  return `@font-face { font-family: '${family}'; src: url(data:font/woff2;base64,${base64}) format('woff2'); font-weight: 100 900; font-display: swap; }`
}

export const FONT_FACES = [
  fontFace('Geist', '@fontsource-variable/geist/files/geist-latin-wght-normal.woff2'),
  fontFace('Geist Mono', '@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2'),
].join('\n')
