import { describe, expect, test } from 'vitest'
import { paceVersusMilestoneOwn } from '../../src/forecast/paceVersusOwn.js'

// How a pace compares with the milestone's own (#158): faster, slower, about the same within 0.5 a period, or too few
// of the milestone's own periods (under 3) to compare.

describe('a median a period against the milestone’s own periods since it started', () => {
  test('slower, by how much, when below the milestone’s own median by more than 0.5', () => {
    expect(paceVersusMilestoneOwn(2, [3, 4, 3, 5])).toEqual({ kind: 'slower', by: 1.5 })
  })

  test('faster, by how much, when above it by more than 0.5', () => {
    expect(paceVersusMilestoneOwn(4, [2, 3, 3])).toEqual({ kind: 'faster', by: 1 })
  })

  test('about the same within 0.5 a period', () => {
    expect(paceVersusMilestoneOwn(3.5, [3, 3, 4, 4])).toEqual({ kind: 'aboutTheSame' })
    expect(paceVersusMilestoneOwn(2.6, [3, 3, 3])).toEqual({ kind: 'aboutTheSame' })
    expect(paceVersusMilestoneOwn(2.5, [3, 3, 3])).toEqual({ kind: 'aboutTheSame' })
  })

  test('too few to compare with under 3 periods of the milestone’s own', () => {
    expect(paceVersusMilestoneOwn(5, [1, 1])).toEqual({ kind: 'tooFewToCompare' })
    expect(paceVersusMilestoneOwn(5, [])).toEqual({ kind: 'tooFewToCompare' })
  })
})
