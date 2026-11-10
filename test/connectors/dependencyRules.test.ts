import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

// The dependency rules in docs/design/architecture.md that keep connectors at the edge.

const src = fileURLToPath(new URL('../../src', import.meta.url))

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.name.endsWith('.ts') ? [path] : []
  })
}

/** Each file under `src/<folder>` with what it imports from `src/`, as paths relative to `src/`. */
function importsFrom(folder: string): { file: string; imported: string }[] {
  return sourceFiles(join(src, folder)).flatMap((file) =>
    [...readFileSync(file, 'utf8').matchAll(/(?:import|export)[^'"]*from\s+'(\.[^']+)'/g)].map((match) => ({
      file: relative(src, file),
      imported: relative(src, resolve(dirname(file), match[1]!)),
    })),
  )
}

describe('dependency rules', () => {
  test('forecast/ reaches connectors only through the interface, never a concrete connector', () => {
    const concrete = importsFrom('forecast').filter(
      ({ imported }) => imported.startsWith('connectors/') && imported !== 'connectors/connector.js',
    )

    expect(concrete).toEqual([])
  })

  test("connectors/ import only the interface's types, what the network connectors share, their own folder, and model/", () => {
    const shared = ['connectors/connector.js', 'connectors/remote.js']
    const outside = importsFrom('connectors').filter(
      ({ file, imported }) => !imported.startsWith('model/') && !shared.includes(imported) && dirname(imported) !== dirname(file),
    )

    expect(outside).toEqual([])
  })
})
