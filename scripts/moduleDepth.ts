// Module depth, for the CI summary's report of the shallowest modules (scripts/reportShallowModules.ts): a report, not
// a check, so nothing here fails the build.
//
// An entry point is what the rest of the app imports of one of src/'s modules. A module with an `index.ts`
// (src/engine/index.ts) has that one; any other has each file at its root (src/forecast/inputs.ts,
// src/connectors/github.ts). What an entry point hides is its own lines and those of each file it reaches through its
// imports into its private folders, at any depth there: for an `index.ts`, the whole module; for any other, the
// module's lib/ and the folder of its own name (a connector's, src/connectors/github/).
import { importedPaths, resolveImport } from './sourceFiles.ts'

/** How many entry points the CI summary lists. */
export const SHALLOWEST_LISTED = 10

/** An entry point's depth: how many functions and types it exports, and how many lines they hide. */
export interface ModuleDepth {
  file: string
  exports: number
  lines: number
}

/** What an exported name is where it is declared: a function or type counts towards an entry point's exports; a value doesn't. */
type ExportKind = 'function or type' | 'value'

/** A function after `async` or a type parameter list: `function`, or an arrow's parameters. */
const FUNCTION_VALUE = String.raw`(?:async\s+)?(?:function\b|(?:<[^>]*>\s*)?(?:\([^)]*\)|\w+)\s*(?::[^=]+)?=>)`
/**
 * A top-level declaration, exported or not: a function, class, enum, interface or type (`counted`), or a `const`,
 * `let` or `var` (`value`), its type annotation a function's too, with `fn` if it holds a function.
 */
const DECLARATION = new RegExp(
  String.raw`^(?<exported>export\s+)?(?:declare\s+)?(?:default\s+)?(?:(?:(?:async\s+)?function\*?|(?:abstract\s+)?class|(?:const\s+)?enum|interface|type)\s+(?<counted>(?!extends\b)\w+)|(?:const|let|var)\s+(?<value>\w+)(?:\s*:(?:[^=]|=>)+?)?\s*=(?!>)\s*(?<fn>${FUNCTION_VALUE})?)`,
  'gm',
)
/** A nameless default function or class: `export default function (`, `export default class {`. */
const NAMELESS_DEFAULT = /^export\s+default\s+(?:async\s+)?(?:function\*?\s*[(<]|(?:abstract\s+)?class\s*(?:\{|extends\b))/m
/** An export list, `export { a, type B as C }`, from the file itself or `from './x.js'`. */
const LISTED = /^export\s+(?<typeOnly>type\s+)?\{(?<names>[^}]*)\}(?:\s*from\s+'(?<from>[^']+)')?/gm
/** One name in an export list: `a`, `type B`, `b as c`. */
const LISTED_NAME = /^(?<typeOnly>type\s+)?(?<name>\w+)(?:\s+as\s+(?<alias>\w+))?$/
/** Everything another file exports, passed on: `export * from './x.js'`, or as a namespace, `export * as ns from …`. */
const ALL_FROM = /^export\s+\*\s+(?:as\s+(?<namespace>\w+)\s+)?from\s+'(?<from>[^']+)'/gm

const linesOf = (source: string): number => source.replace(/\n$/, '').split('\n').length

/** The source file under `src/` that `file` imports as `imported`: `./x.js` names `x.ts`. */
const sourceImported = (file: string, imported: string): string => resolveImport(file, imported).replace(/\.js$/, '.ts')

/**
 * Each name `file` exports, with what it is where it is declared. `known` keeps each file's as it is read, so a file
 * passed on twice is read once, and an import cycle ends.
 */
function exportsOf(file: string, files: Record<string, string>, known = new Map<string, Map<string, ExportKind>>()): Map<string, ExportKind> {
  const cached = known.get(file)
  if (cached !== undefined) return cached
  const exports = new Map<string, ExportKind>()
  known.set(file, exports)
  const source = files[file] ?? ''
  const declared = new Map<string, ExportKind>()
  for (const { groups = {} } of source.matchAll(DECLARATION)) {
    const name = groups.counted ?? groups.value ?? ''
    const kind = groups.counted !== undefined || groups.fn !== undefined ? 'function or type' : 'value'
    declared.set(name, kind)
    if (groups.exported) exports.set(name, kind)
  }
  if (NAMELESS_DEFAULT.test(source)) exports.set('default', 'function or type')
  for (const { groups = {} } of source.matchAll(LISTED)) {
    const from = groups.from === undefined ? declared : exportsOf(sourceImported(file, groups.from), files, known)
    for (const listed of (groups.names ?? '').split(',')) {
      const { typeOnly, name = '', alias } = LISTED_NAME.exec(listed.trim())?.groups ?? {}
      if (name !== '') exports.set(alias ?? name, from.get(name) ?? ((groups.typeOnly ?? typeOnly) ? 'function or type' : 'value'))
    }
  }
  for (const { groups = {} } of source.matchAll(ALL_FROM)) {
    for (const [name, kind] of exportsOf(sourceImported(file, groups.from ?? ''), files, known)) {
      exports.set(groups.namespace === undefined ? name : `${groups.namespace}.${name}`, kind)
    }
  }
  return exports
}

/**
 * Each entry point among `files`, with its private folders: a module's `index.ts`, the whole module; each file at the
 * root of a module without one, the module's lib/ and the folder of its own name.
 */
function entryPoints(files: Record<string, string>): { entry: string; privateFolders: string[] }[] {
  return Object.keys(files).flatMap((entry) => {
    const [module, name, ...deeper] = entry.split('/')
    if (name === undefined || deeper.length > 0) return []
    if (name === 'index.ts') return [{ entry, privateFolders: [`${module}/`] }]
    if (`${module}/index.ts` in files) return []
    return [{ entry, privateFolders: [`${module}/lib/`, `${entry.replace(/\.ts$/, '')}/`] }]
  })
}

/** `entry` and each file it reaches through imports into `privateFolders`. */
function hiddenBehind(entry: string, privateFolders: string[], files: Record<string, string>): Set<string> {
  const hidden = new Set<string>()
  const pending = [entry]
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (hidden.has(file)) continue
    hidden.add(file)
    const imported = importedPaths(files[file] ?? '').map((path) => sourceImported(file, path))
    pending.push(...imported.filter((path) => path in files && privateFolders.some((folder) => path.startsWith(folder))))
  }
  return hidden
}

/** Each entry point among `files` (each a path under `src/` with its source), with its depth. */
export function moduleDepths(files: Record<string, string>): ModuleDepth[] {
  return entryPoints(files).map(({ entry, privateFolders }) => ({
    file: entry,
    exports: [...exportsOf(entry, files).values()].filter((kind) => kind === 'function or type').length,
    lines: [...hiddenBehind(entry, privateFolders, files)].reduce((lines, hidden) => lines + linesOf(files[hidden] ?? ''), 0),
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
