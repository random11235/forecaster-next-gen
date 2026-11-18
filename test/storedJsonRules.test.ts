import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { src } from './importScan.js'

// The One-way doors rule in CODING_STANDARDS.md, for persisted JSON: storage reads every stored JSON value through
// one parser, which checks its shape, never `JSON.parse` cast straight to a type.

/** The one file in `src/storage/` that may call `JSON.parse`: the parser that checks each value's shape. */
const PARSER = 'lib/storedJson.ts'

/** Each `.ts` file under `src/storage/`, relative to it, with its source. */
function storageFiles(): { file: string; source: string }[] {
  const dir = join(src, 'storage')
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.ts'))
    .map((file) => ({ file, source: readFileSync(join(dir, file), 'utf8') }))
}

describe('stored JSON rules', () => {
  test(`in src/storage/, only ${PARSER} calls JSON.parse; everything else reads stored JSON through it`, () => {
    const bare = storageFiles().filter(({ file, source }) => file !== PARSER && /\bJSON\s*\.\s*parse\b/.test(source))

    expect(bare.map(({ file }) => file)).toEqual([])
  })
})
