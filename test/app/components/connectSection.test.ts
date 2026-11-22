import { describe, expect, test } from 'vitest'
import { connectSection } from '../../../src/app/connectSection.js'
import type { ConnectStep } from '../../../src/forecast/index.js'
import { allByRole, byRole, hasRole, render, text } from '../dom.js'

// The Connect step (#236), rendered from a view built by hand: before connecting, refused, and connected. Which view
// the team is shown, and why a connect is refused, are Seam B's (test/forecast/connection.test.ts).

const named = {
  permissions: { github: 'Issues: Read', jira: 'read:jira-work' },
  trackerNames: { github: 'GitHub', jira: 'Jira' },
} as const
const blank = { tracker: 'github', repo: '', site: '', projectKey: '', email: '' } as const
const connect: ConnectStep = { kind: 'connect', form: blank, ...named }
const connected: ConnectStep = {
  kind: 'connected',
  connection: { tracker: 'github', owner: 'shop-team', repo: 'shop' },
  trackerName: 'GitHub',
  where: 'shop-team/shop',
  form: { ...blank, repo: 'shop-team/shop' },
  ...named,
}
const step = (view: ConnectStep) => render(connectSection(view))

describe('the Connect step', () => {
  test('before connecting: a choice of tracker, GitHub first, its fields blank, with Connect and Skip', () => {
    const page = step(connect)

    expect(allByRole(page, 'radio').map((radio) => [radio.getAttribute('value'), radio.hasAttribute('checked')])).toEqual([
      ['github', true],
      ['jira', false],
    ])
    expect(byRole(page, 'textbox', { name: 'Repo' }).getAttribute('value')).toBe('')
    expect(byRole(page, 'button', { name: 'Connect' })).toBeTruthy()
    expect(byRole(page, 'button', { name: 'Skip: type the inputs instead' }).getAttribute('formaction')).toBe('/inputs/setup/skip')
    expect(hasRole(page, 'alert')).toBe(false)
  })

  test('says the read-only permission to make each tracker’s token with, and the token field is blank', () => {
    const page = step(connect)

    expect(text(page)).toContain('on GitHub a fine-grained token with Issues: Read on the one repo; on Jira a scoped API token with read:jira-work.')
    expect(page.querySelector('input[name="token"]')?.getAttribute('value')).toBe('')
    expect(page.querySelector('input[name="token"]')?.getAttribute('placeholder')).toBe('read-only, never shown again')
  })

  test('refused: says why, the form as typed, the chosen tracker kept', () => {
    const page = step({
      ...connect,
      form: { ...blank, tracker: 'jira', site: 'shop.atlassian.net', projectKey: '<SHOP>' },
      refusal: 'Jira didn’t answer: <timeout>',
    })

    expect(text(byRole(page, 'alert'))).toBe('Jira didn’t answer: <timeout>')
    expect(byRole(page, 'radio', { name: 'Jira' }).hasAttribute('checked')).toBe(true)
    expect(byRole(page, 'textbox', { name: 'Project key' }).getAttribute('value')).toBe('<SHOP>')
    expect(byRole(page, 'textbox', { name: 'Site' }).getAttribute('value')).toBe('shop.atlassian.net')
  })

  test('connected: says to what, with Disconnect, and the form to change it folded away, offering no skip', () => {
    const page = step(connected)

    expect(text(page)).toMatch(/^Connected to GitHub · shop-team\/shop Disconnect Change the connection/)
    expect(byRole(page, 'button', { name: 'Disconnect' }).closest('form')?.getAttribute('action')).toBe('/inputs/connect/disconnect#connect')
    expect(hasRole(page, 'button', { name: 'Change connection' })).toBe(false)
    expect(hasRole(page, 'button', { name: /Skip/ })).toBe(false)
    expect(page.querySelector('input[name="token"]')?.getAttribute('placeholder')).toBe('blank keeps the saved token')
  })

  test('connected, a change refused: the change form open, saying why, with the repo as typed', () => {
    const page = step({ ...connected, form: { ...blank, repo: 'shop-team/nope' }, refusal: 'GitHub has no repo shop-team/nope.' })

    expect(text(byRole(page, 'alert'))).toBe('GitHub has no repo shop-team/nope.')
    expect(byRole(page, 'button', { name: 'Change connection' })).toBeTruthy()
    expect(byRole(page, 'textbox', { name: 'Repo' }).getAttribute('value')).toBe('shop-team/nope')
  })
})
