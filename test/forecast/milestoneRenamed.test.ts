import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cannedConnector, type CannedFixture } from '../../src/connectors/canned/cannedConnector.js'
import type { Choice, Connector } from '../../src/connectors/connector.js'
import { submitConnection, type ConnectionEdit } from '../../src/forecast/connection.js'
import { followRenamedMilestone } from '../../src/forecast/milestoneRenamed.js'
import { queryStepView, submitStepQuery, type QueryStepping } from '../../src/forecast/queryStep.js'
import { openMemorySecrets } from '../../src/secrets/memorySecrets.js'
import { openSqliteStorage } from '../../src/storage/sqliteStorage.js'
import type { TeamStorage } from '../trackerScenario.js'

// Moving on to the next milestone by renaming it (#207): a milestone query that is just the tracker's milestone of the
// old name follows the new name, and is read again.

const TEAM = 'team'
const READ_AT = '2026-11-12T09:00:00Z'
const AT = { readAt: READ_AT, today: '2026-11-12', timeZone: 'UTC' }
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

const GITHUB_REPO: ConnectionEdit = { kind: 'connect', tracker: 'github', repo: 'shop-team/shop', site: '', projectKey: '', email: '', token: 'token' }
const JIRA_PROJECT: ConnectionEdit = { kind: 'connect', tracker: 'jira', repo: '', site: 'shop.atlassian.net', projectKey: 'SHOP', email: 'em@shop.test', token: 'token' }

let dir: string
let storage: TeamStorage

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'forecaster-milestone-renamed-'))
  storage = openSqliteStorage(join(dir, 'forecaster.db'))
  storage.saveTeam({ id: TEAM, name: 'My team', source: 'manual', sourceRef: '', installedAt: '2026-01-01T00:00:00Z' })
  storage.saveSetupState(TEAM, { open: false, closed: 'done' })
})

afterEach(() => {
  storage.close()
  rmSync(dir, { recursive: true, force: true })
})

/** Connected on the canned connector answering from `fixture`, with the milestone query made of `picks`; then the reads counted. */
async function pickedFrom(fixture: CannedFixture, connect: ConnectionEdit, picks: Choice[]): Promise<QueryStepping & { queriesRead: string[] }> {
  const queriesRead: string[] = []
  const canned = cannedConnector(fixture)
  const connector = (): Connector => ({
    milestoneChoices: () => canned.milestoneChoices(),
    searchChoices: (kind, text) => canned.searchChoices(kind, text),
    read: (query, since) => {
      queriesRead.push(query)
      return canned.read(query, since)
    },
  })
  const using: QueryStepping = { connections: storage, queries: storage, setup: storage, secrets: openMemorySecrets(), connector, milestoneInputs: storage, at: AT }
  await submitConnection(using, TEAM, connect)
  for (const choice of picks) await submitStepQuery(using, TEAM, { kind: 'addPick', choice }, READ_AT)
  queriesRead.length = 0
  return Object.assign(using, { queriesRead })
}

describe('renaming the milestone', () => {
  test('a milestone query of the tracker milestone of the old name follows the new name, and is read again', async () => {
    const using = await pickedFrom(GITHUB, GITHUB_REPO, [checkout])

    await followRenamedMilestone(using, TEAM, RENAMED, READ_AT)

    expect(storage.milestoneQuery(TEAM)).toEqual({ picks: [loyalty], query: 'milestone:"Loyalty launch"' })
    expect(using.queriesRead).toEqual(['milestone:"Loyalty launch"'])
    expect(await queryStepView(using, TEAM, '', { unlisted: true })).toMatchObject({
      picks: [loyalty],
      query: 'milestone:"Loyalty launch"',
      read: '3 open · 0 finished in the last 9 weeks',
    })
  })

  test('on Jira, a query of the fix version of the old name follows the new name', async () => {
    const jira: CannedFixture = { milestoneChoices: [{ kind: 'fixVersion', choices: [checkoutVersion, loyaltyVersion], pastLimit: false }], reads: READS }
    const using = await pickedFrom(jira, JIRA_PROJECT, [checkoutVersion])

    await followRenamedMilestone(using, TEAM, RENAMED, READ_AT)

    expect(storage.milestoneQuery(TEAM)).toEqual({ picks: [loyaltyVersion], query: 'fixVersion = "Loyalty launch"' })
    expect(using.queriesRead).toEqual(['fixVersion = "Loyalty launch"'])
  })

  test('a milestone past those the tracker lists is searched for by the new name', async () => {
    const pastLimit: CannedFixture = { milestoneChoices: [{ kind: 'milestone', choices: [checkout], pastLimit: true }], reads: READS, searchable: { milestone: [checkout, loyalty] } }
    const using = await pickedFrom(pastLimit, GITHUB_REPO, [checkout])

    await followRenamedMilestone(using, TEAM, RENAMED, READ_AT)

    expect(storage.milestoneQuery(TEAM)).toEqual({ picks: [loyalty], query: 'milestone:"Loyalty launch"' })
  })

  test('with no tracker milestone of the new name, the query is left as it was, and not read', async () => {
    const using = await pickedFrom(GITHUB, GITHUB_REPO, [checkout])

    await followRenamedMilestone(using, TEAM, { from: 'Checkout v2', to: 'Checkout v3' }, READ_AT)

    expect(storage.milestoneQuery(TEAM)).toEqual({ picks: [checkout], query: 'milestone:"Checkout v2"' })
    expect(using.queriesRead).toEqual([])
  })

  test.each([
    ['a label', [payments]],
    ['several picks', [checkout, payments]],
  ])('a query of %s is left as it was', async (_, picks) => {
    const using = await pickedFrom(GITHUB, GITHUB_REPO, picks)
    const before = storage.milestoneQuery(TEAM)

    await followRenamedMilestone(using, TEAM, RENAMED, READ_AT)

    expect(storage.milestoneQuery(TEAM)).toEqual(before)
    expect(using.queriesRead).toEqual([])
  })

  test('a query written by hand is left as it was, even when it names only the old milestone', async () => {
    const using = await pickedFrom(GITHUB, GITHUB_REPO, [])
    await submitStepQuery(using, TEAM, { kind: 'editQuery', query: 'milestone:"Checkout v2" -label:"bug"' }, READ_AT)
    const before = storage.milestoneQuery(TEAM)

    await followRenamedMilestone(using, TEAM, RENAMED, READ_AT)

    expect(storage.milestoneQuery(TEAM)).toEqual(before)
  })

  test('a milestone of another name than the old one is left as it was', async () => {
    const using = await pickedFrom(GITHUB, GITHUB_REPO, [loyalty])

    await followRenamedMilestone(using, TEAM, { from: 'Checkout v2', to: 'Checkout v3' }, READ_AT)

    expect(storage.milestoneQuery(TEAM)).toEqual({ picks: [loyalty], query: 'milestone:"Loyalty launch"' })
  })
})
