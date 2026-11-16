import { describe, expect, test } from 'vitest'
import { xoshiro128StarStar } from '../../src/engine/random.js'

// Expected outputs come from the authors' reference C code (xoshiro128** 1.1,
// https://prng.di.unimi.it/xoshiro128starstar.c), compiled and run from each state.
describe('xoshiro128** matches the reference implementation', () => {
  test.each<[string, [number, number, number, number], number[]]>([
    ['a small state', [1, 2, 3, 4], [11520, 0, 5927040, 70819200, 2031721883, 1637235492, 1287239034, 3734860849]],
    [
      'a mixed state',
      [0x9e3779b9, 0x243f6a88, 0xb7e15162, 0xdeadbeef],
      [2463954730, 5524658, 74256371, 1905451993, 3123413897, 314453775, 1263677054, 1531511215],
    ],
  ])('from %s', (_, state, expected) => {
    const next = xoshiro128StarStar(...state)

    expect(Array.from({ length: expected.length }, next)).toEqual(expected)
  })
})
