// Module depth, for the CI summary's report of the shallowest modules (scripts/reportShallowModules.ts): a report, not
// a check, so nothing here fails the build.
//
// An entry point is a file at the root of one of src/'s modules (src/forecast/inputs.ts, src/connectors/github.ts):
// the files the rest of the app imports. What it hides is its own lines and those of each file it reaches through its
// imports into the module's subfolders (its private lib/, or a connector's own folder), at any depth there.
import { dirname, join, normalize } from 'node:path'

/** An entry point's depth: how many functions and types it exports, and how many lines they hide. */
export interface ModuleDepth {
  file: string
  exports: number
  lines: number
}

/** A declared function or type: `export function`, `class`, `enum`, `interface`, `type`, or a const holding a function. */
const DECLARED =
  /^export\s+(?:declare\s+)?(?:default\s+)?(?:(?:async\s+)?function\b|(?:abstract\s+)?class\b|enum\b|interface\b|type\s+\w|const\s+\w+(?:\s*:[^=]+)?\s*=\s*(?:async\s+)?(?:\([^)]*\)|\w+)\s*(?::[^=]+)?=>)/gm
/** An export list, `export { a, type B }` or `export { a } from '…'`; each name in it counts. */
const LISTED = /^export\s+(?:type\s+)?\{([^}]*)\}/gm
/** A relative import or re-export: `import … from './x.js'`, `export … from './x.js'`, `import './x.js'`. */
const IMPORTED = /\b(?:import|export)\b[^'";]*?'(\.[^']+)'/g

const linesOf = (source: string): number => source.replace(/\n$/, '').split('\n').length

function exportsOf(source: string): number {
  const listed = [...source.matchAll(LISTED)].flatMap(([, names = '']) => names.split(',').filter((name) => name.trim() !== ''))
  return (source.match(DECLARED)?.length ?? 0) + listed.length
}

/** What `file` imports, each as a path under `src/` ending in `.ts`. */
function importsOf(file: string, source: string): string[] {
  return [...source.matchAll(IMPORTED)].map(([, imported = '']) => normalize(join(dirname(file), imported)).replace(/\.js$/, '.ts'))
}

/** `file` and each file it reaches through imports into its module's subfolders. */
function hiddenBehind(entry: string, files: Record<string, string>): Set<string> {
  const subfolders = `${dirname(entry)}/`
  const hidden = new Set<string>()
  const pending = [entry]
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (hidden.has(file)) continue
    hidden.add(file)
    const source = files[file] ?? ''
    pending.push(...importsOf(file, source).filter((imported) => imported.startsWith(subfolders) && dirname(imported) !== dirname(entry) && imported in files))
  }
  return hidden
}

/** Each entry point among `files` (each a path under `src/` with its source), with its depth. */
export function moduleDepths(files: Record<string, string>): ModuleDepth[] {
  return Object.entries(files)
    .filter(([file]) => file.split('/').length === 2)
    .map(([file, source]) => ({
      file,
      exports: exportsOf(source),
      lines: [...hiddenBehind(file, files)].reduce((lines, hidden) => lines + linesOf(files[hidden] ?? ''), 0),
    }))
}

const perHundredLines = ({ exports, lines }: ModuleDepth): number => (exports * 100) / lines

/** The CI summary's report: the `count` entry points exporting the most per line hidden, shallowest first, in Markdown. */
export function shallowestModules(depths: ModuleDepth[], count = 10): string {
  const shallowest = [...depths].sort((a, b) => perHundredLines(b) - perHundredLines(a) || a.file.localeCompare(b.file)).slice(0, count)
  return [
    '### The shallowest modules',
    '',
    "Each module's entry point by its exported functions and types per line they hide, the shallowest first: a prompt to look with `/codebase-design`, not a failure.",
    '',
    '| Entry point | Exports | Lines hidden | Exports per 100 lines |',
    '|---|--:|--:|--:|',
    ...shallowest.map((depth) => `| \`src/${depth.file}\` | ${depth.exports} | ${depth.lines} | ${perHundredLines(depth).toFixed(1)} |`),
    '',
  ].join('\n')
}
