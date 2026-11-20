import { describe, expect, test } from 'vitest'
import type { Connection } from '../../src/model/connection.js'
import { connectionView, submitConnection } from '../../src/forecast/connection.js'
import { TEAM, TOKEN, connecting, github, jira, storage } from './connectionScenario.js'

// Connecting a tracker (#180): the Connect step's view, and a submit that checks the connection before saving it.
// Arranged through connectionScenario.ts.

describe('the Connect step', () => {
  const PERMISSIONS = { github: 'Issues: read', jira: 'read:jira-work' }

  test('before connecting, it shows a blank GitHub form and the permissions each tracker’s token needs', () => {
    expect(connectionView(connecting(), TEAM)).toEqual({
      kind: 'connect',
      form: { tracker: 'github', repo: '', site: '', projectKey: '', email: '' },
      permissions: PERMISSIONS,
    })
  })

  test('connected, it shows the connection, its form filled in to change it, but never the token', async () => {
    const using = connecting()
    await submitConnection(using, TEAM, jira())

    const view = connectionView(using, TEAM)

    expect(view).toEqual({
      kind: 'connected',
      connection: { tracker: 'jira', site: 'shop.atlassian.net', projectKey: 'SHOP', email: 'em@shop.example' },
      form: { tracker: 'jira', repo: '', site: 'shop.atlassian.net', projectKey: 'SHOP', email: 'em@shop.example' },
      permissions: PERMISSIONS,
    })
    expect(JSON.stringify(view)).not.toContain(TOKEN)
  })

  test('connected to GitHub, the form names the repo as owner/repo', async () => {
    const using = connecting()
    await submitConnection(using, TEAM, github('shop-team/shop'))

    const view = connectionView(using, TEAM)

    expect(view.kind === 'connected' && view.form).toEqual({ tracker: 'github', repo: 'shop-team/shop', site: '', projectKey: '', email: '' })
  })

  test('the browser build, with nothing to connect with, has no Connect step', () => {
    expect(connectionView(undefined, TEAM)).toEqual({ kind: 'noConnect' })
  })
})

describe('connecting', () => {
  test('a good GitHub connect is checked, saves the connection and the token, and moves on to the milestone', async () => {
    const using = connecting()

    const submitted = await submitConnection(using, TEAM, github())

    expect(submitted).toEqual({ saved: true, next: 'milestone' })
    expect(using.built).toEqual([{ connection: { tracker: 'github', owner: 'shop-team', repo: 'shop' }, token: TOKEN }])
    expect(storage.connection(TEAM)).toEqual({ tracker: 'github', owner: 'shop-team', repo: 'shop' })
    expect(await using.secrets.token(TEAM)).toBe(TOKEN)
  })

  test('a good Jira connect saves the site, the project and the account email, as typed but tidied', async () => {
    const using = connecting()

    const submitted = await submitConnection(using, TEAM, jira({ site: ' https://shop.atlassian.net/ ', projectKey: 'shop ', email: ' em@shop.example' }))

    const connection: Connection = { tracker: 'jira', site: 'shop.atlassian.net', projectKey: 'SHOP', email: 'em@shop.example' }
    expect(submitted).toEqual({ saved: true, next: 'milestone' })
    expect(using.built).toEqual([{ connection, token: TOKEN }])
    expect(storage.connection(TEAM)).toEqual(connection)
    expect(await using.secrets.token(TEAM)).toBe(TOKEN)
  })
})

describe('changing the connection', () => {
  const NEW_TOKEN = 'github_pat_22NEWTOKEN9876543210_secret'

  test('to another repo with a new token replaces both, once checked', async () => {
    const using = connecting()
    await submitConnection(using, TEAM, github('shop-team/shop'))

    const submitted = await submitConnection(using, TEAM, github('shop-team/payments', NEW_TOKEN))

    expect(submitted).toEqual({ saved: true, next: 'milestone' })
    expect(using.built.at(-1)).toEqual({ connection: { tracker: 'github', owner: 'shop-team', repo: 'payments' }, token: NEW_TOKEN })
    expect(storage.connection(TEAM)).toEqual({ tracker: 'github', owner: 'shop-team', repo: 'payments' })
    expect(await using.secrets.token(TEAM)).toBe(NEW_TOKEN)
  })

  test('with the token left blank, reuses the saved token, checks the change with it, and keeps it', async () => {
    const using = connecting()
    await submitConnection(using, TEAM, github('shop-team/shop'))

    const submitted = await submitConnection(using, TEAM, github('shop-team/payments', ' '))

    expect(submitted).toEqual({ saved: true, next: 'milestone' })
    expect(using.built.at(-1)).toEqual({ connection: { tracker: 'github', owner: 'shop-team', repo: 'payments' }, token: TOKEN })
    expect(storage.connection(TEAM)).toEqual({ tracker: 'github', owner: 'shop-team', repo: 'payments' })
    expect(await using.secrets.token(TEAM)).toBe(TOKEN)
  })

  test('with the token left blank and the check refused, keeps the connection it had', async () => {
    const using = connecting()
    await submitConnection(using, TEAM, github('shop-team/shop'))
    const refusing = { ...using, connector: connecting({ failure: 'unauthorised' }).connector }

    const submitted = await submitConnection(refusing, TEAM, github('shop-team/payments', ''))

    expect(submitted.saved === false && submitted.view.refusal).toBe(
      'GitHub refused the token. Check it hasn’t expired, and that it has Issues: read on this repo.',
    )
    expect(storage.connection(TEAM)).toEqual({ tracker: 'github', owner: 'shop-team', repo: 'shop' })
    expect(await using.secrets.token(TEAM)).toBe(TOKEN)
  })

  test('refused, keeps the connection and token it had, and shows the change as typed, without the token', async () => {
    const using = connecting()
    await submitConnection(using, TEAM, github('shop-team/shop'))
    const refusing = { ...using, connector: connecting({ failure: 'notFound' }).connector }

    const submitted = await submitConnection(refusing, TEAM, github('shop-team/shopp', NEW_TOKEN))

    expect(submitted).toEqual({
      saved: false,
      view: {
        kind: 'connected',
        connection: { tracker: 'github', owner: 'shop-team', repo: 'shop' },
        form: { tracker: 'github', repo: 'shop-team/shopp', site: '', projectKey: '', email: '' },
        permissions: { github: 'Issues: read', jira: 'read:jira-work' },
        refusal: 'GitHub can’t see shop-team/shopp with this token. Check the repo’s name, and that the token covers it.',
      },
    })
    expect(JSON.stringify(submitted)).not.toContain(NEW_TOKEN)
    expect(storage.connection(TEAM)).toEqual({ tracker: 'github', owner: 'shop-team', repo: 'shop' })
    expect(await using.secrets.token(TEAM)).toBe(TOKEN)
  })
})

describe('disconnecting', () => {
  test('removes the connection and forgets the token, going back to the Connect step', async () => {
    const using = connecting()
    await submitConnection(using, TEAM, jira())

    const submitted = await submitConnection(using, TEAM, { kind: 'disconnect' })

    expect(submitted).toEqual({ saved: true, next: 'connect' })
    expect(storage.connection(TEAM)).toBeUndefined()
    expect(await using.secrets.token(TEAM)).toBeUndefined()
    expect(connectionView(using, TEAM).kind).toBe('connect')
  })

  test('with no connection, there is nothing to remove', async () => {
    const using = connecting()

    expect(await submitConnection(using, TEAM, { kind: 'disconnect' })).toEqual({ saved: true, next: 'connect' })
    expect(using.built).toEqual([])
  })
})
