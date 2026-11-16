import { describe, expect, test } from 'vitest'
import { mutationTargets } from '../../scripts/mutationTargets.ts'

describe('the files a branch mutates', () => {
  test('a changed source file is mutated', () => {
    expect(mutationTargets(['src/engine/pace.ts'])).toEqual(['src/engine/pace.ts'])
  })

  test('files outside src, and files in it that are not TypeScript, are not mutated', () => {
    const changed = [
      'test/engine/pace.test.ts',
      'scripts/checkChanges.ts',
      'docs/design/README.md',
      'package.json',
      'src/connectors/canned/demoFixture.json',
      'src/app/styles.css',
    ]
    expect(mutationTargets(changed)).toEqual([])
  })

  test("the web build's page script, which only its demo checks, is not mutated", () => {
    expect(mutationTargets(['src/app/webMain.ts', 'src/app/webApp.ts'])).toEqual(['src/app/webApp.ts'])
  })
})
