import { describe, expect, test } from 'vitest'
import type { CannedFixture } from '../../src/connectors/canned.js'
import type { Failure } from '../../src/connectors/connector.js'
import type { Connection } from '../../src/model/connection.js'
import { submitConnection, type Connecting } from '../../src/forecast/connection.js'
import { TEAM, TOKEN, connecting, github, jira, storage } from './connectionScenario.js'

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
  ])('%s is refused with no connector built, keeping the form', async (_, edit, refusal) => {
    const using = connecting()

    const submitted = await submitConnection(using, TEAM, edit)

    expect(submitted.saved === false && submitted.view.refusal).toBe(refusal)
    expect(submitted.saved === false && submitted.view.form).toEqual({ ...edit, kind: undefined, token: undefined })
    expect(using.built).toEqual([])
    expect(storage.connection(TEAM)).toBeUndefined()
  })
})

describe('a connect the tracker refuses', () => {
  const refusedBy = (failure: Failure['failure']): CannedFixture['milestoneChoices'] => (failure === 'invalidQuery' ? { failure, message: 'no' } : { failure })

  test('a refused GitHub token says so, saves nothing, and keeps the form as typed without the token', async () => {
    const using = connecting(refusedBy('unauthorised'))

    const submitted = await submitConnection(using, TEAM, github('shop-team/shop'))

    expect(submitted).toEqual({
      saved: false,
      view: {
        kind: 'connect',
        form: { tracker: 'github', repo: 'shop-team/shop', site: '', projectKey: '', email: '' },
        permissions: { github: 'Issues: read', jira: 'read:jira-work' },
        refusal: 'GitHub refused the token. Check it hasn’t expired, and that it has Issues: read on this repo.',
      },
    })
    expect(storage.connection(TEAM)).toBeUndefined()
    expect(await using.secrets.token(TEAM)).toBeUndefined()
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
  ] as const)('%s failing the check as %s says so, and saves nothing', async (tracker, failure, refusal) => {
    const using = connecting(refusedBy(failure))

    const submitted = await submitConnection(using, TEAM, tracker === 'github' ? github() : jira())

    expect(submitted.saved === false && submitted.view.refusal).toBe(refusal)
    expect(storage.connection(TEAM)).toBeUndefined()
    expect(await using.secrets.token(TEAM)).toBeUndefined()
  })

  test('no refusal, nor the view it comes with, includes the token', async () => {
    const failures: Failure['failure'][] = ['unauthorised', 'notFound', 'unavailable', 'invalidQuery', 'outOfScope']
    const refused = await Promise.all(
      failures.flatMap((failure) => [github(), jira(), github('shop')].map((edit) => submitConnection(connecting(refusedBy(failure)), TEAM, edit))),
    )

    expect(refused.every((submitted) => !submitted.saved)).toBe(true)
    expect(JSON.stringify(refused)).not.toContain(TOKEN)
  })
})

describe('a connect or disconnect the keychain or the data file fails', () => {
  const KEYCHAIN_FAILED =
    'This computer’s keychain couldn’t be used, so nothing changed. Check it’s unlocked and that the Forecaster may use it, then try again.'
  const DATA_FILE_FAILED = 'The data file couldn’t be written, so nothing changed. Try again.'
  const NEW_TOKEN = 'github_pat_22NEWTOKEN9876543210_secret'
  type Fails = Partial<Record<'saveToken' | 'token' | 'deleteToken' | 'saveConnection' | 'removeConnection', boolean>>

  /** `using`, its secrets and connection storage failing as `fails` says, as the keychain or SQLite would: by throwing. */
  function failing(using: Connecting, fails: Fails): Connecting {
    const fail = (what: string): never => {
      throw new Error(`${what} failed`)
    }
    const { secrets, connections } = using
    return {
      ...using,
      secrets: {
        saveToken: async (teamId, token) => (fails.saveToken ? fail('saveToken') : secrets.saveToken(teamId, token)),
        token: async (teamId) => (fails.token ? fail('token') : secrets.token(teamId)),
        deleteToken: async (teamId) => (fails.deleteToken ? fail('deleteToken') : secrets.deleteToken(teamId)),
      },
      connections: {
        saveConnection: (teamId, connection) => (fails.saveConnection ? fail('saveConnection') : connections.saveConnection(teamId, connection)),
        connection: (teamId) => connections.connection(teamId),
        removeConnection: (teamId) => (fails.removeConnection ? fail('removeConnection') : connections.removeConnection(teamId)),
      },
    }
  }

  test('a first connect whose connection can’t be saved is refused, and leaves no token behind', async () => {
    const using = connecting()

    const submitted = await submitConnection(failing(using, { saveConnection: true }), TEAM, github())

    expect(submitted.saved === false && submitted.view.refusal).toBe(DATA_FILE_FAILED)
    expect(storage.connection(TEAM)).toBeUndefined()
    expect(await using.secrets.token(TEAM)).toBeUndefined()
  })

  test('a first connect the keychain can’t keep the token of is refused, and saves no connection', async () => {
    const using = connecting()

    const submitted = await submitConnection(failing(using, { saveToken: true }), TEAM, github())

    expect(submitted.saved === false && submitted.view).toMatchObject({ kind: 'connect', refusal: KEYCHAIN_FAILED, form: { repo: 'shop-team/shop' } })
    expect(storage.connection(TEAM)).toBeUndefined()
    expect(await using.secrets.token(TEAM)).toBeUndefined()
  })

  test('a change the keychain can’t keep the new token of keeps the connection and token the team had', async () => {
    const using = connecting()
    await submitConnection(using, TEAM, github('shop-team/shop'))

    const submitted = await submitConnection(failing(using, { saveToken: true }), TEAM, github('shop-team/payments', NEW_TOKEN))

    expect(submitted.saved === false && submitted.view).toMatchObject({ kind: 'connected', refusal: KEYCHAIN_FAILED })
    expect(storage.connection(TEAM)).toEqual({ tracker: 'github', owner: 'shop-team', repo: 'shop' })
    expect(await using.secrets.token(TEAM)).toBe(TOKEN)
  })

  test('a change whose connection can’t be saved keeps the connection and token the team had', async () => {
    const using = connecting()
    await submitConnection(using, TEAM, github('shop-team/shop'))

    const submitted = await submitConnection(failing(using, { saveConnection: true }), TEAM, github('shop-team/payments', NEW_TOKEN))

    expect(submitted.saved === false && submitted.view.refusal).toBe(DATA_FILE_FAILED)
    expect(storage.connection(TEAM)).toEqual({ tracker: 'github', owner: 'shop-team', repo: 'shop' })
    expect(await using.secrets.token(TEAM)).toBe(TOKEN)
  })

  test.each([
    ['the keychain can’t forget the token', { deleteToken: true }, KEYCHAIN_FAILED],
    ['the data file can’t remove the connection', { removeConnection: true }, DATA_FILE_FAILED],
  ] as const)('a disconnect where %s is refused, and the team stays connected with its token', async (_, fails, refusal) => {
    const using = connecting()
    await submitConnection(using, TEAM, github('shop-team/shop'))

    const submitted = await submitConnection(failing(using, fails), TEAM, { kind: 'disconnect' })

    expect(submitted).toEqual({
      saved: false,
      view: {
        kind: 'connected',
        connection: { tracker: 'github', owner: 'shop-team', repo: 'shop' },
        form: { tracker: 'github', repo: 'shop-team/shop', site: '', projectKey: '', email: '' },
        permissions: { github: 'Issues: read', jira: 'read:jira-work' },
        refusal,
      },
    })
    expect(storage.connection(TEAM)).toEqual({ tracker: 'github', owner: 'shop-team', repo: 'shop' })
    expect(await using.secrets.token(TEAM)).toBe(TOKEN)
  })

  test('a change with the token left blank that the keychain can’t read the saved token for is refused, before any check', async () => {
    const using = connecting()
    await submitConnection(using, TEAM, github('shop-team/shop'))
    const built = using.built.length

    const submitted = await submitConnection(failing(using, { token: true }), TEAM, github('shop-team/payments', ''))

    expect(submitted.saved === false && submitted.view.refusal).toBe(KEYCHAIN_FAILED)
    expect(using.built).toHaveLength(built)
    expect(storage.connection(TEAM)).toEqual({ tracker: 'github', owner: 'shop-team', repo: 'shop' })
  })

  test('no refusal for a failing keychain or data file shows the token or the error thrown', async () => {
    const all: Fails = { saveToken: true, token: true, deleteToken: true, saveConnection: true, removeConnection: true }
    const using = failing(connecting(), all)

    const refused = [
      await submitConnection(using, TEAM, github()),
      await submitConnection(using, TEAM, github('shop-team/shop', '')),
      await submitConnection(using, TEAM, { kind: 'disconnect' }),
    ]

    expect(refused.every((submitted) => !submitted.saved)).toBe(true)
    expect(JSON.stringify(refused)).not.toContain(TOKEN)
    expect(JSON.stringify(refused)).not.toContain('failed')
  })
})
