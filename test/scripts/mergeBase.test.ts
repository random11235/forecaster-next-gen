import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { checkBase, mergeBase } from '../../scripts/mergeBase.ts'

const root = fileURLToPath(new URL('../..', import.meta.url))

describe('the base a branch is checked against', () => {
  test('is CHECK_BASE, or origin/main when it is unset or empty, as `${CHECK_BASE:-origin/main}` in package.json', () => {
    expect(checkBase({})).toBe('origin/main')
    expect(checkBase({ CHECK_BASE: '' })).toBe('origin/main')
    expect(checkBase({ CHECK_BASE: 'origin/spec/255' })).toBe('origin/spec/255')
  })

  test('its merge-base with HEAD is a commit', () => {
    expect(mergeBase(root, 'HEAD', 'fetch it')).toMatch(/^[0-9a-f]{40}$/)
  })

  test('missing, fails naming it and how the caller gets it, rather than with git’s own error', () => {
    expect(() => mergeBase(root, 'origin/no-such-branch', 'pass the branch this one merges into')).toThrow(
      'no origin/no-such-branch here to check this branch against: pass the branch this one merges into',
    )
  })
})
