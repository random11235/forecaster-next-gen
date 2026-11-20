import { describe, expect, test } from 'vitest'
import type { CannedFixture } from '../../src/connectors/canned.js'
import type { Choice } from '../../src/connectors/connector.js'
import { forecastingForTest, TEAM, type ForecastingForTest } from './forecastingForTest.js'

// Moving on to the next milestone by renaming it (#207): a milestone query that is just the tracker's milestone of the
// old name follows the new name, and is read again.

const RENAMED = { from: 'Checkout v2', to: 'Loyalty launch' }

const checkout: Choice = { kind: 'milestone', name: 'Checkout v2', query: 'milestone:"Checkout v2"' }
const loyalty: Choice = { kind: 'milestone', name: 'Loyalty launch', query: 'milestone:"Loyalty launch"' }
const payments: Choice = { kind: 'label', name: 'payments', query: 'label:"payments"' }
const checkoutVersion: Choice = { kind: 'fixVersion', name: 'Checkout v2', query: 'fixVersion = "Checkout v2"' }
const loyaltyVersion: Choice = { kind: 'fixVersion', name: 'Loyalty launch', query: 'fixVersion = "Loyalty launch"' }

const READS: CannedFixture['reads'] = {
  'milestone:"Checkout v2"': { tickets: [{ id: 'c1' }, { id: 'c2', finishedAt: '2026-11-01T10:00:00Z' }], incomplete: false },
  'milestone:"Loyalty launch"': { tickets: [{ id: 'l1' }, { id: 'l2' }, { id: 'l3' }], incomplete: false },
  'label:"payments"': { tickets: [{ id: 'p1' }], incomplete: false },
  'milestone:"Checkout v2" OR label:"payments"': { tickets: [{ id: 'c1' }, { id: 'p1' }], incomplete: false },
  'fixVersion = "Checkout v2"': { tickets: [{ id: 'c1' }], incomplete: false },
  'fixVersion = "Loyalty launch"': { tickets: [{ id: 'l1' }, { id: 'l2' }], incomplete: false },
}

const GITHUB: CannedFixture = {
  milestoneChoices: [
    { kind: 'milestone', choices: [checkout, loyalty], pastLimit: false },
    { kind: 'label', choices: [payments], pastLimit: false },
  ],
  reads: READS,
}

/** The milestone, named `name`, as the Inputs screen's Milestone form submits it. */
const named = (team: ForecastingForTest, name: string) =>
  team.submit({ form: 'inputs', edit: { kind: 'setMilestone', name, startDate: '2026-11-02', ticketsRemaining: '40' } })

/**
 * Connected on the canned connector answering from `fixture`, to GitHub or Jira, with the milestone query made of
 * `picks`, and the milestone entered as `RENAMED.from`; then the reads counted.
 */
async function pickedFrom(fixture: CannedFixture, connected: 'github' | 'jira', picks: Choice[]): Promise<ForecastingForTest> {
  const team = await forecastingForTest({ fixture, connected })
  for (const choice of picks) await team.submit({ form: 'stepQuery', step: 'milestone', edit: { kind: 'addPick', choice } })
  await named(team, RENAMED.from)
  team.calls.reads.length = 0
  return team
}

/** The milestone renamed `to`, which the query follows when it is just the tracker's milestone of the old name. */
const rename = (team: ForecastingForTest, to = RENAMED.to) => named(team, to)

describe('renaming the milestone', () => {
  test('a milestone query of the tracker milestone of the old name follows the new name, and is read again', async () => {
    const team = await pickedFrom(GITHUB, 'github', [checkout])

    expect(await rename(team)).toEqual({ kind: 'saved', next: { kind: 'screen', screen: 'inputs' }, followed: 'followed' })

    expect(team.storage.milestoneQuery(TEAM)).toEqual({ picks: [loyalty], query: 'milestone:"Loyalty launch"' })
    expect(team.calls.reads).toEqual(['milestone:"Loyalty launch"'])
    expect((await team.inputsScreen()).inputs.milestone.ticketsSource).toMatchObject({ reading: { count: 3 } })
  })

  test('on Jira, a query of the fix version of the old name follows the new name', async () => {
    const jira: CannedFixture = { milestoneChoices: [{ kind: 'fixVersion', choices: [checkoutVersion, loyaltyVersion], pastLimit: false }], reads: READS }
    const team = await pickedFrom(jira, 'jira', [checkoutVersion])

    await rename(team)

    expect(team.storage.milestoneQuery(TEAM)).toEqual({ picks: [loyaltyVersion], query: 'fixVersion = "Loyalty launch"' })
    expect(team.calls.reads).toEqual(['fixVersion = "Loyalty launch"'])
  })

  test('a milestone past those the tracker lists is searched for by the new name', async () => {
    const pastLimit: CannedFixture = {
      milestoneChoices: [{ kind: 'milestone', choices: [checkout], pastLimit: true }],
      reads: READS,
      searchable: { milestone: [checkout, loyalty] },
    }
    const team = await pickedFrom(pastLimit, 'github', [checkout])

    await rename(team)

    expect(team.storage.milestoneQuery(TEAM)).toEqual({ picks: [loyalty], query: 'milestone:"Loyalty launch"' })
  })

  test('with no tracker milestone of the new name, the query is left as it was, and not read', async () => {
    const team = await pickedFrom(GITHUB, 'github', [checkout])

    expect(await rename(team, 'Checkout v3')).toEqual({ kind: 'saved', next: { kind: 'screen', screen: 'inputs' } })

    expect(team.storage.milestoneQuery(TEAM)).toEqual({ picks: [checkout], query: 'milestone:"Checkout v2"' })
    expect(team.calls.reads).toEqual([])
  })

  test('when the tracker can’t be read, the query follows the new name, and the save says it is not yet read', async () => {
    const unavailable: CannedFixture = { ...GITHUB, reads: { ...READS, 'milestone:"Loyalty launch"': { failure: 'unavailable' } } }
    const team = await pickedFrom(unavailable, 'github', [checkout])

    expect(await rename(team)).toEqual({ kind: 'saved', next: { kind: 'screen', screen: 'inputs' }, followed: 'followedUnread' })

    expect(team.storage.milestoneQuery(TEAM)).toEqual({ picks: [loyalty], query: 'milestone:"Loyalty launch"' })
  })

  test('when the tracker rejects the new name’s query, the query is left as it was, the save says so, and the tracker asked once', async () => {
    const rejecting: CannedFixture = {
      ...GITHUB,
      reads: { ...READS, 'milestone:"Loyalty launch"': { failure: 'invalidQuery', message: 'No such milestone.' } },
    }
    const team = await pickedFrom(rejecting, 'github', [checkout])

    expect(await rename(team)).toEqual({ kind: 'saved', next: { kind: 'screen', screen: 'inputs' }, followed: 'refused' })

    expect(team.storage.milestoneQuery(TEAM)).toEqual({ picks: [checkout], query: 'milestone:"Checkout v2"' })
    expect(team.calls.reads).toEqual(['milestone:"Loyalty launch"'])
  })

  test.each([
    ['a label', [payments]],
    ['several picks', [checkout, payments]],
  ])('a query of %s is left as it was', async (_, picks) => {
    const team = await pickedFrom(GITHUB, 'github', picks)
    const before = team.storage.milestoneQuery(TEAM)

    await rename(team)

    expect(team.storage.milestoneQuery(TEAM)).toEqual(before)
    expect(team.calls.reads).toEqual([])
  })

  test('a query written by hand is left as it was, even when it names only the old milestone', async () => {
    const team = await pickedFrom(GITHUB, 'github', [])
    await team.submit({ form: 'stepQuery', step: 'milestone', edit: { kind: 'editQuery', query: 'milestone:"Checkout v2" -label:"bug"' } })
    const before = team.storage.milestoneQuery(TEAM)

    await rename(team)

    expect(team.storage.milestoneQuery(TEAM)).toEqual(before)
  })

  test('a milestone of another name than the old one is left as it was', async () => {
    const team = await pickedFrom(GITHUB, 'github', [loyalty])

    await rename(team, 'Checkout v3')

    expect(team.storage.milestoneQuery(TEAM)).toEqual({ picks: [loyalty], query: 'milestone:"Loyalty launch"' })
  })
})
