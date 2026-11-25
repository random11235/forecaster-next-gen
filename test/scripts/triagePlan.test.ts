import { describe, expect, test } from 'vitest'
import { BRIEF_MARK, checkPlan, TRIAGE_DISCLAIMER, type Write } from '../../scripts/triagePlan.ts'

/** A batch of issues 5, 6 and 7, oldest first. */
const BATCH = [5, 6, 7]

const issue = (number: number, more: Record<string, unknown> = {}) => ({
  number,
  category: 'enhancement',
  state: 'needs-info',
  comment: `Notes on #${number}`,
  ...more,
})

const said = (text: string) => `${TRIAGE_DISCLAIMER}\n\n${text}`
const brief = (text: string) => `${TRIAGE_DISCLAIMER}\n\n${BRIEF_MARK}\n\n${text}`

const writesOf = (batch: readonly number[], plan: unknown): readonly Write[] => {
  const checked = checkPlan(batch, plan)
  if (!checked.accepted) throw new Error(`refused: ${checked.reasons.join('; ')}`)
  return checked.writes
}

describe("the triage plan's check, accepting", () => {
  test('turns a ready-for-agent issue into its brief, its labels and a build dispatch, in that order', () => {
    const plan = { issues: [{ number: 5, category: 'bug', state: 'ready-for-agent', comment: '## Agent Brief\nFix it.' }] }

    expect(checkPlan([5], plan)).toEqual({
      accepted: true,
      writes: [
        { kind: 'comment', issue: 5, body: brief('## Agent Brief\nFix it.') },
        { kind: 'labels', issue: 5, category: 'bug', state: 'ready-for-agent' },
        { kind: 'dispatch', issue: 5 },
      ],
    })
  })

  test('marks a ready-for-human comment as a brief, dispatching nothing, and a needs-info one as neither', () => {
    const plan = { issues: [issue(5, { state: 'ready-for-human', comment: 'Brief' }), issue(6, { comment: 'Questions' })] }

    expect(writesOf([5, 6], plan)).toEqual([
      { kind: 'comment', issue: 5, body: brief('Brief') },
      { kind: 'labels', issue: 5, category: 'enhancement', state: 'ready-for-human' },
      { kind: 'comment', issue: 6, body: said('Questions') },
      { kind: 'labels', issue: 6, category: 'enhancement', state: 'needs-info' },
    ])
  })

  test('labels an already-implemented issue wontfix and closes it as such', () => {
    expect(writesOf([5], { issues: [issue(5, { state: 'already-implemented', comment: 'Lives in src/forecast' })] })).toEqual([
      { kind: 'comment', issue: 5, body: said('Lives in src/forecast') },
      { kind: 'labels', issue: 5, category: 'enhancement', state: 'wontfix' },
      { kind: 'close-as-implemented', issue: 5 },
    ])
  })

  test("writes surviving issues first, in the batch's order whatever the plan's, then their duplicates, labelled as their survivor and closed onto it", () => {
    const plan = {
      issues: [
        issue(7, { duplicate_of: 5, comment: 'Same as #5', category: 'bug', state: 'needs-info' }),
        issue(6, { state: 'already-implemented' }),
        issue(5, { category: 'bug', state: 'ready-for-agent', comment: 'Brief' }),
      ],
    }

    expect(writesOf(BATCH, plan)).toEqual([
      { kind: 'comment', issue: 5, body: brief('Brief') },
      { kind: 'labels', issue: 5, category: 'bug', state: 'ready-for-agent' },
      { kind: 'dispatch', issue: 5 },
      { kind: 'comment', issue: 6, body: said('Notes on #6') },
      { kind: 'labels', issue: 6, category: 'enhancement', state: 'wontfix' },
      { kind: 'close-as-implemented', issue: 6 },
      { kind: 'comment', issue: 7, body: said('Same as #5') },
      { kind: 'labels', issue: 7, category: 'bug', state: 'ready-for-agent' },
      { kind: 'close-as-duplicate', issue: 7, of: 5 },
    ])
  })

  test('puts a duplicate, which needs no state or category of its own, after its survivor even when it is older than another survivor', () => {
    const plan = { issues: [issue(5, { state: 'already-implemented' }), { number: 6, comment: 'Dup', duplicate_of: 5 }, issue(7)] }

    expect(writesOf(BATCH, plan).map(({ kind, issue }) => `${kind} #${issue}`)).toEqual([
      'comment #5',
      'labels #5',
      'close-as-implemented #5',
      'comment #7',
      'labels #7',
      'comment #6',
      'labels #6',
      'close-as-duplicate #6',
    ])
    expect(writesOf(BATCH, plan)).toContainEqual({ kind: 'labels', issue: 6, category: 'enhancement', state: 'wontfix' })
  })

  test('never adds in-progress, whatever the states, nor dispatches anything but a ready-for-agent survivor', () => {
    const states = ['needs-info', 'ready-for-agent', 'ready-for-human', 'already-implemented']
    for (const state of states) {
      const writes = writesOf([5, 6], { issues: [issue(5, { state }), issue(6, { duplicate_of: 5 })] })

      expect(JSON.stringify(writes)).not.toContain('in-progress')
      expect(writes.filter(({ kind }) => kind === 'dispatch')).toEqual(state === 'ready-for-agent' ? [{ kind: 'dispatch', issue: 5 }] : [])
    }
  })
})

describe("the triage plan's check, refusing", () => {
  const refusal = (batch: readonly number[], plan: unknown) => {
    const checked = checkPlan(batch, plan)
    expect(checked).not.toHaveProperty('writes')
    return checked
  }

  test('refuses a plan that is not an object with a list of issues', () => {
    for (const plan of [null, 'plan', [], {}, { issues: 'all' }]) {
      expect(refusal(BATCH, plan)).toEqual({ accepted: false, reasons: ['the plan is not an object with a list of issues'] })
    }
  })

  test("refuses issues that don't match the batch, naming each one missing, extra or listed twice", () => {
    expect(refusal(BATCH, { issues: [issue(5), issue(5), issue(8), issue(9)] })).toEqual({
      accepted: false,
      reasons: [
        '#6 of the batch is missing from the plan',
        '#7 of the batch is missing from the plan',
        '#8 is in the plan but not the batch',
        '#9 is in the plan but not the batch',
        '#5 is in the plan 2 times',
      ],
    })
  })

  test('refuses an entry that is malformed, with an unknown state or category, or an empty comment, naming every reason', () => {
    const plan = {
      issues: [
        'six',
        issue(5, { state: 'in-progress', category: 'chore', comment: '  \n' }),
        issue(6, { state: 'wontfix', comment: 4 }),
        { number: 7, comment: 'No state' },
        issue(-1),
      ],
    }

    expect(refusal(BATCH, plan)).toEqual({
      accepted: false,
      reasons: [
        'issue 1 of the plan is not an object',
        'issue 2 of the plan has an unknown category: "chore"',
        'issue 2 of the plan has an unknown state: "in-progress"',
        'issue 2 of the plan has an empty comment',
        'issue 3 of the plan has an unknown state: "wontfix"',
        'issue 3 of the plan has an empty comment',
        'issue 4 of the plan has an unknown category: none',
        'issue 4 of the plan has an unknown state: none',
        'issue 5 of the plan has no issue number: -1',
        '#5 of the batch is missing from the plan',
        '#6 of the batch is missing from the plan',
        '#7 of the batch is missing from the plan',
      ],
    })
  })

  test("refuses a duplicate's own state or category that is unknown, and a duplicate_of that is no issue number", () => {
    const plan = { issues: [issue(5), issue(6, { duplicate_of: 5, state: 'done' }), issue(7, { duplicate_of: '#5' })] }

    expect(refusal(BATCH, plan)).toEqual({
      accepted: false,
      reasons: [
        'issue 2 of the plan has an unknown state: "done"',
        'issue 3 of the plan has a duplicate_of that is no issue number: "#5"',
        '#6 of the batch is missing from the plan',
        '#7 of the batch is missing from the plan',
      ],
    })
  })

  test('refuses a duplicate_of outside the batch, at itself, at a duplicate, or at a newer issue, as the oldest must survive', () => {
    expect(refusal(BATCH, { issues: [issue(5, { duplicate_of: 9 }), issue(6, { duplicate_of: 6 }), issue(7)] })).toEqual({
      accepted: false,
      reasons: ['#5 is a duplicate of #9, which is not in the batch', '#6 is a duplicate of itself'],
    })
    expect(refusal(BATCH, { issues: [issue(5), issue(6, { duplicate_of: 5 }), issue(7, { duplicate_of: 6 })] })).toEqual({
      accepted: false,
      reasons: ['#7 is a duplicate of #6, which is a duplicate itself'],
    })
    expect(refusal(BATCH, { issues: [issue(5, { duplicate_of: 7 }), issue(6), issue(7)] })).toEqual({
      accepted: false,
      reasons: ['#5 is a duplicate of #7, which is newer, but the oldest must survive'],
    })
  })
})
