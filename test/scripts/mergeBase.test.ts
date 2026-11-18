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
    expect(mergeBase(root, 'HEAD')).toMatch(/^[0-9a-f]{40}$/)
  })

  test('missing, fails saying so and how to get it, rather than with git’s own error', () => {
    expect(() => mergeBase(root, 'origin/no-such-branch')).toThrow(
      'no origin/no-such-branch here to check this branch against: fetch it (`git fetch origin`), or set CHECK_BASE to the branch this one merges into',
    )
  })
})
