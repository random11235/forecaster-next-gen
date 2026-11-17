// File size check: a code or docs file over MAX_TOKENS is refused, with guidance on how to split it.
// A token is estimated as four bytes. Run on the files a commit or branch changes (scripts/checkChanges.ts).

/** About 20,000 bytes: past this an agent reads the file in pieces and loses track of it. */
export const MAX_TOKENS = 5_000

const COVERED = /\.(ts|js|cjs|mjs|md|html|css)$/
/**
 * Kept as written or imported from elsewhere, like `.prettierignore`'s second group; and CHANGELOG.md, which grows by a
 * section each release, written by the release, not a PR (docs/design/architecture.md#release).
 */
const EXEMPT = [/^docs\/research\//, /^docs\/design\/.*\.html$/, /^\.claude\//, /^CHANGELOG\.md$/]

export interface Sized {
  path: string
  bytes: number
}

export interface Oversized {
  path: string
  tokens: number
}

export const tokensOf = (bytes: number): number => Math.ceil(bytes / 4)

/** The files the limit covers that are over it. */
export function oversized(files: Sized[]): Oversized[] {
  return files
    .filter(({ path }) => COVERED.test(path) && !EXEMPT.some((exempt) => exempt.test(path)))
    .map(({ path, bytes }) => ({ path, tokens: tokensOf(bytes) }))
    .filter(({ tokens }) => tokens > MAX_TOKENS)
}

const HOW_TO_SPLIT = {
  src: `Source in src/: split along the module's seams (docs/design/architecture-folders.md and architecture-test-seams.md).
  - Keep this file as the entry point: the functions and types callers import stay here, with the same names.
  - Move what it hides into the module's lib/ subfolder, one file per concept, named with the GLOSSARY.md term
    (src/storage/lib/setupDraft.ts is the pattern). Callers outside the module keep importing the root file.
  - A file holding several screens, sections or steps becomes one file per section beside it.
  - Avoid a barrel or a utils file: each new file owns one concept.`,
  test: `Tests in test/: split by behaviour, keeping each test at the seam it tests (docs/design/architecture-test-seams.md).
  - One file per entry point, or per top-level describe block, named for the behaviour (setup.rename.test.ts).
  - Move shared arrangement into a helper beside the tests, arranging through the module's own functions.
  - Every case keeps its assertions: a split moves tests, it changes none.`,
  docs: `Docs (.md): split by top-level heading into sibling files.
  - Leave this file as a short index that links each new file, so existing links still land somewhere.
  - Update links elsewhere that point at a moved heading (grep for the file name).`,
  other: `Split it by responsibility into files of one concept each, and keep the original path as the entry point.`,
} as const

const kindOf = (path: string): keyof typeof HOW_TO_SPLIT =>
  path.endsWith('.md') ? 'docs' : path.startsWith('src/') ? 'src' : path.startsWith('test/') ? 'test' : 'other'

/** What to tell the agent: each file over the limit, then how to split each kind among them. */
export function splitGuidance(files: Oversized[]): string {
  const listed = files.map(({ path, tokens }) => `  ${path}: ~${tokens} tokens`).join('\n')
  const kinds = [...new Set(files.map(({ path }) => kindOf(path)))]
  return [
    `These files are over ${MAX_TOKENS} tokens (bytes ÷ 4), the limit for one file:`,
    listed,
    '',
    'Split each before committing. Shrinking it by deleting comments, joining lines or minifying is not a fix.',
    '',
    ...kinds.map((kind) => HOW_TO_SPLIT[kind]),
    '',
    'Split in a commit of its own, with no behaviour change, then make your change. Run the tests after the split.',
  ].join('\n')
}
