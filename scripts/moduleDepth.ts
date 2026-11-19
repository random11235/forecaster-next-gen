// Module depth, for the CI summary's report of the shallowest modules (scripts/reportShallowModules.ts): a report, not
// a check, so nothing here fails the build.
//
// An entry point is what the rest of the app imports of one of src/'s modules. A module with an `index.ts`
// (src/engine/index.ts) has that one; any other has each file at its root (src/forecast/inputs.ts,
// src/connectors/github.ts). What an entry point hides is its own lines and those of each file it reaches through its
// imports into its private folders, at any depth there: for an `index.ts`, the whole module; for any other, the
// module's lib/ and the folder of its own name (a connector's, src/connectors/github/).
import { basename, dirname, join, normalize } from 'node:path'
import { importedPaths } from './sourceFiles.ts'

/** How many entry points the CI summary lists. */
export const SHALLOWEST_LISTED = 10

/** An entry point's depth: how many functions and types it exports, and how many lines they hide. */
export interface ModuleDepth {
  file: string
  exports: number
  lines: number
}

/** A function or type it declares after `async` or a type parameter list: `function`, or an arrow's parameters. */
const FUNCTION_VALUE = String.raw`(?:async\s+)?(?:function\b|(?:<[^>]*>\s*)?(?:\([^)]*\)|\w+)\s*(?::[^=]+)?=>)`
/**
 * A top-level declaration, exported or not: a function, class, enum, interface or type (`counted`), or a `const`,
 * `let` or `var` (`value`), with `fn` if it holds a function.
 */
const DECLARATION = new RegExp(
  String.raw`^(?<exported>export\s+)?(?:declare\s+)?(?:default\s+)?(?:(?:(?:async\s+)?function\*?|(?:abstract\s+)?class|(?:const\s+)?enum|interface|type)\s+(?<counted>\w+)|(?:const|let|var)\s+(?<value>\w+)(?:\s*:[^=]+)?\s*=\s*(?<fn>${FUNCTION_VALUE})?)`,
  'gm',
)
/** An export list, `export { a, type B as C }`, from the file itself or `from './x.js'`. */
const LISTED = /^export\s+(?<typeOnly>type\s+)?\{(?<names>[^}]*)\}(?:\s*from\s+'(?<from>[^']+)')?/gm
/** One name in an export list: `a`, `type B`, `b as c`. */
const LISTED_NAME = /^(?<typeOnly>type\s+)?(?<name>\w+)(?:\s+as\s+(?<alias>\w+))?$/
/** Everything another file exports, passed on: `export * from './x.js'`. */
const ALL_FROM = /^export\s+\*\s+from\s+'(?<from>[^']+)'/gm

const linesOf = (source: string): number => source.replace(/\n$/, '').split('\n').length

/** The file under `src/` that `file` names as `imported`, ending in `.ts`. */
const resolved = (file: string, imported: string): string => normalize(join(dirname(file), imported)).replace(/\.js$/, '.ts')

/** Each name `file` exports, and whether it counts: whether it is a function or a type where it is declared. */
function exportsOf(file: string, files: Record<string, string>, seen = new Set<string>()): Map<string, boolean> {
  const exports = new Map<string, boolean>()
  if (seen.has(file)) return exports
  seen.add(file)
  const source = files[file] ?? ''
  const declared = new Map<string, boolean>()
  for (const { groups = {} } of source.matchAll(DECLARATION)) {
    const name = groups.counted ?? groups.value ?? ''
    declared.set(name, groups.counted !== undefined || groups.fn !== undefined)
    if (groups.exported) exports.set(name, declared.get(name) ?? false)
  }
  for (const { groups = {} } of source.matchAll(LISTED)) {
    const from = groups.from === undefined ? declared : exportsOf(resolved(file, groups.from), files, seen)
    for (const listed of (groups.names ?? '').split(',')) {
      const { typeOnly, name = '', alias } = LISTED_NAME.exec(listed.trim())?.groups ?? {}
      if (name !== '') exports.set(alias ?? name, from.get(name) ?? Boolean(groups.typeOnly ?? typeOnly))
    }
  }
  for (const { groups = {} } of source.matchAll(ALL_FROM)) {
    for (const [name, counts] of exportsOf(resolved(file, groups.from ?? ''), files, seen)) exports.set(name, counts)
  }
  return exports
}

/** `entry` and each file it reaches through imports into its private folders. */
function hiddenBehind(entry: string, files: Record<string, string>): Set<string> {
  const moduleFolder = `${dirname(entry)}/`
  const privateFolders = basename(entry) === 'index.ts' ? [moduleFolder] : [`${moduleFolder}lib/`, `${entry.replace(/\.ts$/, '')}/`]
  const hidden = new Set<string>()
  const pending = [entry]
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (hidden.has(file)) continue
    hidden.add(file)
    const imported = importedPaths(files[file] ?? '').map((path) => resolved(file, path))
    pending.push(...imported.filter((path) => path in files && privateFolders.some((folder) => path.startsWith(folder))))
  }
  return hidden
}

/** Whether `file` is an entry point: at a module's root, and the module's `index.ts` if it has one. */
function isEntryPoint(file: string, files: Record<string, string>): boolean {
  const [module, name, ...deeper] = file.split('/')
  return name !== undefined && deeper.length === 0 && (name === 'index.ts' || !(`${module}/index.ts` in files))
}

/** Each entry point among `files` (each a path under `src/` with its source), with its depth. */
export function moduleDepths(files: Record<string, string>): ModuleDepth[] {
  return Object.keys(files)
    .filter((file) => isEntryPoint(file, files))
    .map((file) => ({
      file,
      exports: [...exportsOf(file, files).values()].filter(Boolean).length,
      lines: [...hiddenBehind(file, files)].reduce((lines, hidden) => lines + linesOf(files[hidden] ?? ''), 0),
    }))
}

const perHundredLines = ({ exports, lines }: ModuleDepth): number => (exports * 100) / lines

/** The CI summary's report: the `SHALLOWEST_LISTED` entry points exporting the most per line hidden, shallowest first, in Markdown. */
export function shallowestModules(depths: ModuleDepth[]): string {
  const shallowest = [...depths].sort((a, b) => perHundredLines(b) - perHundredLines(a) || a.file.localeCompare(b.file)).slice(0, SHALLOWEST_LISTED)
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
