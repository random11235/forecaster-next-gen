// Which changed lines a mutation run mutates (scripts/mutateDiff.ts).

const SOURCE = /^src\/.*\.ts$/
/**
 * Run only in a browser, so no test runs it and every mutant would survive: its demo checks it, as #114 agreed.
 * stryker.config.mjs leaves it out of a full run too; `--mutate` replaces that config, so it's left out here as well.
 */
const UNTESTED = ['src/app/webMain.ts']
/** A `git diff -U0` hunk header: the lines it adds start at `start` and run for `count`, 1 when it's left out. */
const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/
/** The escapes git uses in a quoted path, besides 3-digit octal bytes. */
const ESCAPES: Record<string, string> = { '"': '"', '\\': '\\', a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' }

/**
 * What Stryker should mutate, as its `--mutate` patterns: the lines `diff` (`git diff -U0`, with `a/` and `b/`
 * prefixes) adds or changes in the TypeScript source the tests run, as `path:start-end` ranges, and each of the
 * `untracked` files throughout. Mutating only those lines, not each changed file throughout, keeps a branch that moves
 * files from mutating code it didn't change: a file moved unchanged has no lines to mutate.
 */
export function mutationTargets(diff: string, untracked: string[]): string[] {
  const targets: string[] = []
  let path: string | undefined
  // a file's header runs from `diff --git` to its first hunk: only there is `+++ ` its path, not an added line
  let inHeader = false
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      ;[path, inHeader] = [undefined, true]
    } else if (inHeader && line.startsWith('+++ ')) {
      ;[path, inHeader] = [newPath(line.slice('+++ '.length)), false]
    } else if (!inHeader) {
      const hunk = HUNK.exec(line)
      if (!hunk || path === undefined || !isMutationSource(path)) continue
      const start = Number(hunk[1])
      const count = hunk[2] === undefined ? 1 : Number(hunk[2])
      if (count > 0) targets.push(`${path}:${start}-${start + count - 1}`)
    }
  }
  return [...targets, ...untracked.filter(isMutationSource)]
}

/** The path a `+++ ` line names: git pads a path with spaces with a tab, and quotes one with special characters. */
function newPath(named: string): string | undefined {
  const path = named.startsWith('"') ? unquote(named.replace(/\t$/, '')) : named.replace(/\t$/, '')
  return path.startsWith('b/') ? path.slice('b/'.length) : undefined
}

/** A path git quoted, C-style: octal escapes are the bytes of its UTF-8. */
function unquote(quoted: string): string {
  const bytes: number[] = []
  const body = quoted.slice(1, -1)
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== '\\') {
      bytes.push(...Buffer.from(body[i]!))
    } else if (/[0-7]{3}/.test(body.slice(i + 1, i + 4))) {
      bytes.push(parseInt(body.slice(i + 1, i + 4), 8))
      i += 3
    } else {
      bytes.push(...Buffer.from(ESCAPES[body[i + 1]!] ?? body[i + 1]!))
      i += 1
    }
  }
  return Buffer.from(bytes).toString('utf8')
}

/** The TypeScript source the tests run, which a mutation run mutates. */
function isMutationSource(path: string): boolean {
  return SOURCE.test(path) && !UNTESTED.includes(path)
}
