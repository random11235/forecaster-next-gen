import { describe, expect, test } from 'vitest'
import type { CannedFixture } from '../../src/connectors/canned.js'
import type { Failure } from '../../src/connectors/connector.js'
import type { Fails } from './forecastingForTest.js'
import { TEAM, TOKEN, connect, github, jira, newTeam, refusal, refusedStep, PERMISSIONS, TRACKER_NAMES } from './connectionScenario.js'

// Connecting a tracker (#180): a connect or disconnect refused, by the form, the tracker, the keychain or the data file.
// Arranged through connectionScenario.ts.

describe('a connect refused before the tracker is asked', () => {
  test.each([
    ['a missing token', github('shop-team/shop', '  '), 'Paste a token to connect.'],
    ['a missing repo', github(''), 'Give the repo as owner/repo, like shop-team/shop.'],
    ['a repo without its owner', github('shop'), 'Give the repo as owner/repo, like shop-team/shop.'],
    ['a path beyond the repo', github('shop-team/shop/issues'), 'Give the repo as owner/repo, like shop-team/shop.'],
    ['a missing site', jira({ site: '' }), 'Give the Jira site, like your-team.atlassian.net.'],
    ['a missing project key', jira({ projectKey: ' ' }), 'Give the Jira project key, like SHOP.'],
    ['a missing email', jira({ email: '' }), 'Give the email of the Atlassian account that made the token.'],
  ])('%s is refused with no connector built, keeping the form', async (_, edit, why) => {
    const team = await newTeam()

    const submitted = await connect(team, edit)

    expect(refusal(submitted)).toBe(why)
    expect(refusedStep(submitted)?.form).toEqual({ ...edit, kind: undefined, token: undefined })
    expect(team.calls.built).toEqual([])
    expect(team.storage.connection(TEAM)).toBeUndefined()
  })
})

describe('a connect the tracker refuses', () => {
  const refusedBy = (failure: Failure['failure']): CannedFixture['milestoneChoices'] => (failure === 'invalidQuery' ? { failure, message: 'no' } : { failure })

  test('a refused GitHub token says so, saves nothing, and keeps the form as typed without the token', async () => {
    const team = await newTeam(refusedBy('unauthorised'))

    const submitted = await connect(team, github('shop-team/shop'))

    expect(submitted.kind).toBe('refused')
    expect(refusedStep(submitted)).toEqual({
      kind: 'connect',
      form: { tracker: 'github', repo: 'shop-team/shop', site: '', projectKey: '', email: '' },
      permissions: PERMISSIONS,
      trackerNames: TRACKER_NAMES,
      refusal: 'GitHub refused the token. Check it hasn’t expired, and that it has Issues: read on this repo.',
    })
    expect(team.storage.connection(TEAM)).toBeUndefined()
    expect(await team.secrets.token(TEAM)).toBeUndefined()
  })

  test.each([
    ['github', 'unauthorised', 'GitHub refused the token. Check it hasn’t expired, and that it has Issues: read on this repo.'],
    ['github', 'notFound', 'GitHub can’t see shop-team/shop with this token. Check the repo’s name, and that the token covers it.'],
    ['github', 'unavailable', 'GitHub can’t be reached just now, or is limiting requests. Try again in a few minutes.'],
    [
      'jira',
      'unauthorised',
      'Jira refused the token. Check it hasn’t expired, that it has read:jira-work, and that em@shop.example is the account that made it.',
    ],
    [
      'jira',
      'notFound',
      'Jira can’t find project SHOP on shop.atlassian.net with this token. Check the site and the project key, and that the account can see it.',
    ],
    ['jira', 'unavailable', 'Jira can’t be reached just now, or is limiting requests. Try again in a few minutes.'],
  ] as const)('%s failing the check as %s says so, and saves nothing', async (tracker, failure, why) => {
    const team = await newTeam(refusedBy(failure))

    const submitted = await connect(team, tracker === 'github' ? github() : jira())

    expect(refusal(submitted)).toBe(why)
    expect(team.storage.connection(TEAM)).toBeUndefined()
    expect(await team.secrets.token(TEAM)).toBeUndefined()
  })

  test('no refusal, nor the view it comes with, includes the token', async () => {
    const failures: Failure['failure'][] = ['unauthorised', 'notFound', 'unavailable', 'invalidQuery', 'outOfScope']
    const refused = await Promise.all(
      failures.flatMap((failure) => [github(), jira(), github('shop')].map(async (edit) => connect(await newTeam(refusedBy(failure)), edit))),
    )

    expect(refused.every((submitted) => submitted.kind === 'refused')).toBe(true)
    expect(JSON.stringify(refused)).not.toContain(TOKEN)
  })
})

describe('a connect or disconnect the keychain or the data file fails', () => {
  const KEYCHAIN_FAILED =
    'This computer’s keychain couldn’t be used, so nothing changed. Check it’s unlocked and that the Forecaster may use it, then try again.'
  const DATA_FILE_FAILED = 'The data file couldn’t be written, so nothing changed. Try again.'
  const NEW_TOKEN = 'github_pat_22NEWTOKEN9876543210_secret'

  test('a first connect whose connection can’t be saved is refused, and leaves no token behind', async () => {
    const team = await newTeam()
    team.fails.saveConnection = true

    const submitted = await connect(team, github())

    expect(refusal(submitted)).toBe(DATA_FILE_FAILED)
    expect(team.storage.connection(TEAM)).toBeUndefined()
    expect(await team.secrets.token(TEAM)).toBeUndefined()
  })

  test('a first connect the keychain can’t keep the token of is refused, and saves no connection', async () => {
    const team = await newTeam()
    team.fails.saveToken = true

    const submitted = await connect(team, github())

    expect(refusedStep(submitted)).toMatchObject({ kind: 'connect', refusal: KEYCHAIN_FAILED, form: { repo: 'shop-team/shop' } })
    expect(team.storage.connection(TEAM)).toBeUndefined()
    expect(await team.secrets.token(TEAM)).toBeUndefined()
  })

  test('a change the keychain can’t keep the new token of keeps the connection and token the team had', async () => {
    const team = await newTeam()
    await connect(team, github('shop-team/shop'))
    team.fails.saveToken = true

    const submitted = await connect(team, github('shop-team/payments', NEW_TOKEN))

    expect(refusedStep(submitted)).toMatchObject({ kind: 'connected', refusal: KEYCHAIN_FAILED })
    expect(team.storage.connection(TEAM)).toEqual({ tracker: 'github', owner: 'shop-team', repo: 'shop' })
    expect(await team.secrets.token(TEAM)).toBe(TOKEN)
  })

  test('a change whose connection can’t be saved keeps the connection and token the team had', async () => {
    const team = await newTeam()
    await connect(team, github('shop-team/shop'))
    team.fails.saveConnection = true

    const submitted = await connect(team, github('shop-team/payments', NEW_TOKEN))

    expect(refusal(submitted)).toBe(DATA_FILE_FAILED)
    expect(team.storage.connection(TEAM)).toEqual({ tracker: 'github', owner: 'shop-team', repo: 'shop' })
    expect(await team.secrets.token(TEAM)).toBe(TOKEN)
  })

  test.each([
    ['the keychain can’t forget the token', { deleteToken: true }, KEYCHAIN_FAILED],
    ['the data file can’t remove the connection', { removeConnection: true }, DATA_FILE_FAILED],
  ] as const)('a disconnect where %s is refused, and the team stays connected with its token', async (_, fails, why) => {
    const team = await newTeam()
    await connect(team, github('shop-team/shop'))
    Object.assign(team.fails, fails)

    const submitted = await connect(team, { kind: 'disconnect' })

    expect(submitted.kind).toBe('refused')
    expect(refusedStep(submitted)).toEqual({
      kind: 'connected',
      connection: { tracker: 'github', owner: 'shop-team', repo: 'shop' },
      trackerName: 'GitHub',
      where: 'shop-team/shop',
      form: { tracker: 'github', repo: 'shop-team/shop', site: '', projectKey: '', email: '' },
      permissions: PERMISSIONS,
      trackerNames: TRACKER_NAMES,
      refusal: why,
    })
    expect(team.storage.connection(TEAM)).toEqual({ tracker: 'github', owner: 'shop-team', repo: 'shop' })
    expect(await team.secrets.token(TEAM)).toBe(TOKEN)
  })

  test('a change with the token left blank that the keychain can’t read the saved token for is refused, before any check', async () => {
    const team = await newTeam()
    await connect(team, github('shop-team/shop'))
    const built = team.calls.built.length
    team.fails.token = true

    const submitted = await connect(team, github('shop-team/payments', ''))

    expect(refusal(submitted)).toBe(KEYCHAIN_FAILED)
    expect(team.calls.built).toHaveLength(built)
    expect(team.storage.connection(TEAM)).toEqual({ tracker: 'github', owner: 'shop-team', repo: 'shop' })
  })

  test('no refusal for a failing keychain or data file shows the token or the error thrown', async () => {
    const all: Fails = { saveToken: true, token: true, deleteToken: true, saveConnection: true, removeConnection: true }
    const team = await newTeam()
    Object.assign(team.fails, all)

    const refused = [await connect(team, github()), await connect(team, github('shop-team/shop', '')), await connect(team, { kind: 'disconnect' })]

    expect(refused.every((submitted) => submitted.kind === 'refused')).toBe(true)
    expect(JSON.stringify(refused)).not.toContain(TOKEN)
    expect(JSON.stringify(refused)).not.toContain('failed')
  })
})
