import { describe, expect, test } from 'vitest'
import type { Connection } from '../../src/model/connection.js'
import {
  TEAM,
  TOKEN,
  browserTeam,
  connect,
  connectStep,
  github,
  jira,
  newTeam,
  refusal,
  refusedStep,
  PERMISSIONS,
  TRACKER_NAMES,
} from './connectionScenario.js'

// Connecting a tracker (#180): the Connect step's view, and a submit that checks the connection before saving it.
// Arranged through connectionScenario.ts.

describe('the Connect step', () => {
  test('before connecting, it shows a blank GitHub form and the permissions each tracker’s token needs', async () => {
    expect(await connectStep(await newTeam())).toEqual({
      kind: 'connect',
      form: { tracker: 'github', repo: '', site: '', projectKey: '', email: '' },
      permissions: PERMISSIONS,
      trackerNames: TRACKER_NAMES,
    })
  })

  test('connected, it shows the connection, its form filled in to change it, but never the token', async () => {
    const team = await newTeam()
    await connect(team, jira())

    const view = await connectStep(team)

    expect(view).toEqual({
      kind: 'connected',
      connection: { tracker: 'jira', site: 'shop.atlassian.net', projectKey: 'SHOP', email: 'em@shop.example' },
      trackerName: 'Jira',
      where: 'shop.atlassian.net · SHOP',
      form: { tracker: 'jira', repo: '', site: 'shop.atlassian.net', projectKey: 'SHOP', email: 'em@shop.example' },
      permissions: PERMISSIONS,
      trackerNames: TRACKER_NAMES,
    })
    expect(JSON.stringify(view)).not.toContain(TOKEN)
  })

  test('connected to GitHub, the form names the repo as owner/repo', async () => {
    const team = await newTeam()
    await connect(team, github('shop-team/shop'))

    const view = await connectStep(team)

    expect(view?.kind === 'connected' && view.form).toEqual({ tracker: 'github', repo: 'shop-team/shop', site: '', projectKey: '', email: '' })
  })

  test('the browser build, with nothing to connect with, has no Connect step', async () => {
    expect(await connectStep(await browserTeam())).toBeUndefined()
  })
})

describe('connecting', () => {
  test('a good GitHub connect is checked, saves the connection and the token, and moves on to the milestone', async () => {
    const team = await newTeam()

    const submitted = await connect(team, github())

    expect(submitted).toEqual({ kind: 'saved', next: { screen: 'inputs', step: 'milestone' } })
    expect(team.calls.built).toEqual([{ connection: { tracker: 'github', owner: 'shop-team', repo: 'shop' }, token: TOKEN }])
    expect(team.storage.connection(TEAM)).toEqual({ tracker: 'github', owner: 'shop-team', repo: 'shop' })
    expect(await team.secrets.token(TEAM)).toBe(TOKEN)
  })

  test('a good Jira connect saves the site, the project and the account email, as typed but tidied', async () => {
    const team = await newTeam()

    const submitted = await connect(team, jira({ site: ' https://shop.atlassian.net/ ', projectKey: 'shop ', email: ' em@shop.example' }))

    const connection: Connection = { tracker: 'jira', site: 'shop.atlassian.net', projectKey: 'SHOP', email: 'em@shop.example' }
    expect(submitted).toEqual({ kind: 'saved', next: { screen: 'inputs', step: 'milestone' } })
    expect(team.calls.built).toEqual([{ connection, token: TOKEN }])
    expect(team.storage.connection(TEAM)).toEqual(connection)
    expect(await team.secrets.token(TEAM)).toBe(TOKEN)
  })
})

describe('changing the connection', () => {
  const NEW_TOKEN = 'github_pat_22NEWTOKEN9876543210_secret'

  test('to another repo with a new token replaces both, once checked', async () => {
    const team = await newTeam()
    await connect(team, github('shop-team/shop'))

    const submitted = await connect(team, github('shop-team/payments', NEW_TOKEN))

    expect(submitted).toEqual({ kind: 'saved', next: { screen: 'inputs', step: 'milestone' } })
    expect(team.calls.built.at(-1)).toEqual({ connection: { tracker: 'github', owner: 'shop-team', repo: 'payments' }, token: NEW_TOKEN })
    expect(team.storage.connection(TEAM)).toEqual({ tracker: 'github', owner: 'shop-team', repo: 'payments' })
    expect(await team.secrets.token(TEAM)).toBe(NEW_TOKEN)
  })

  test('with the token left blank, reuses the saved token, checks the change with it, and keeps it', async () => {
    const team = await newTeam()
    await connect(team, github('shop-team/shop'))

    const submitted = await connect(team, github('shop-team/payments', ' '))

    expect(submitted).toEqual({ kind: 'saved', next: { screen: 'inputs', step: 'milestone' } })
    expect(team.calls.built.at(-1)).toEqual({ connection: { tracker: 'github', owner: 'shop-team', repo: 'payments' }, token: TOKEN })
    expect(team.storage.connection(TEAM)).toEqual({ tracker: 'github', owner: 'shop-team', repo: 'payments' })
    expect(await team.secrets.token(TEAM)).toBe(TOKEN)
  })

  test('with the token left blank and the check refused, keeps the connection it had', async () => {
    const team = await newTeam()
    await connect(team, github('shop-team/shop'))
    team.fixture.milestoneChoices = { failure: 'unauthorised' }

    const submitted = await connect(team, github('shop-team/payments', ''))

    expect(refusal(submitted)).toBe('GitHub refused the token. Check it hasn’t expired, and that it has Issues: read on this repo.')
    expect(team.storage.connection(TEAM)).toEqual({ tracker: 'github', owner: 'shop-team', repo: 'shop' })
    expect(await team.secrets.token(TEAM)).toBe(TOKEN)
  })

  test('refused, keeps the connection and token it had, and shows the change as typed, without the token', async () => {
    const team = await newTeam()
    await connect(team, github('shop-team/shop'))
    team.fixture.milestoneChoices = { failure: 'notFound' }

    const submitted = await connect(team, github('shop-team/shopp', NEW_TOKEN))

    expect(submitted.kind).toBe('refused')
    expect(refusedStep(submitted)).toEqual({
      kind: 'connected',
      connection: { tracker: 'github', owner: 'shop-team', repo: 'shop' },
      trackerName: 'GitHub',
      where: 'shop-team/shop',
      form: { tracker: 'github', repo: 'shop-team/shopp', site: '', projectKey: '', email: '' },
      permissions: PERMISSIONS,
      trackerNames: TRACKER_NAMES,
      refusal: 'GitHub can’t see shop-team/shopp with this token. Check the repo’s name, and that the token covers it.',
    })
    expect(JSON.stringify(submitted)).not.toContain(NEW_TOKEN)
    expect(team.storage.connection(TEAM)).toEqual({ tracker: 'github', owner: 'shop-team', repo: 'shop' })
    expect(await team.secrets.token(TEAM)).toBe(TOKEN)
  })
})

describe('disconnecting', () => {
  test('removes the connection and forgets the token, going back to the Connect step', async () => {
    const team = await newTeam()
    await connect(team, jira())

    const submitted = await connect(team, { kind: 'disconnect' })

    expect(submitted).toEqual({ kind: 'saved', next: { screen: 'inputs', step: 'connect' } })
    expect(team.storage.connection(TEAM)).toBeUndefined()
    expect(await team.secrets.token(TEAM)).toBeUndefined()
    expect((await connectStep(team))?.kind).toBe('connect')
  })

  test('with no connection, there is nothing to remove', async () => {
    const team = await newTeam()

    expect(await connect(team, { kind: 'disconnect' })).toEqual({ kind: 'saved', next: { screen: 'inputs', step: 'connect' } })
    expect(team.calls.built).toEqual([])
  })
})
