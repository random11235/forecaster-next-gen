import { afterAll, describe, expect, test } from 'vitest'
import { openKeychainSecrets } from '../../src/secrets/keychainSecrets.js'
import { openMemorySecrets } from '../../src/secrets/memorySecrets.js'
import type { Secrets } from '../../src/secrets/secrets.js'

// What every Secrets keeps, whatever it keeps it in: the in-memory fake Seam B uses and the OS keychain.

// The keychain cases keep their tokens under a service of their own, never the app's, and delete them afterwards. They
// run only where an OS keychain answers, as on a developer's Mac; elsewhere they are skipped, saying so.
const TEST_SERVICE = `forecaster-test-${process.pid}`
const TEAMS = ['team', 'other']

async function keychainAnswers(): Promise<boolean> {
  try {
    const secrets = openKeychainSecrets({ service: TEST_SERVICE })
    await secrets.saveToken('probe', 'probe')
    await secrets.deleteToken('probe')
    return true
  } catch {
    return false
  }
}

const keychain = await keychainAnswers()
if (!keychain) console.warn('No OS keychain answers here: the keychain cases of the Secrets contract are skipped.')

const subjects: [string, () => Secrets][] = [['in memory', () => openMemorySecrets()]]
if (keychain) subjects.push(['the OS keychain', () => openKeychainSecrets({ service: TEST_SERVICE })])

afterAll(async () => {
  if (!keychain) return
  const secrets = openKeychainSecrets({ service: TEST_SERVICE })
  for (const team of TEAMS) await secrets.deleteToken(team)
})

describe.each(subjects)('Secrets contract: %s', (_name, open) => {
  test("a team's saved token reads back", async () => {
    const secrets = open()

    await secrets.saveToken('team', 'github_pat_one')

    expect(await secrets.token('team')).toBe('github_pat_one')
  })

  test('a team with no saved token has none', async () => {
    const secrets = open()

    await secrets.deleteToken('team')

    expect(await secrets.token('team')).toBeUndefined()
  })

  test('saving a new token replaces the old one', async () => {
    const secrets = open()

    await secrets.saveToken('team', 'github_pat_one')
    await secrets.saveToken('team', 'github_pat_two')

    expect(await secrets.token('team')).toBe('github_pat_two')
  })

  test("a deleted token is gone, and deleting again doesn't fail", async () => {
    const secrets = open()
    await secrets.saveToken('team', 'github_pat_one')

    await secrets.deleteToken('team')
    await secrets.deleteToken('team')

    expect(await secrets.token('team')).toBeUndefined()
  })

  test("tokens are kept by team: saving or deleting one team's leaves another's", async () => {
    const secrets = open()
    await secrets.saveToken('team', 'github_pat_one')
    await secrets.saveToken('other', 'jira_token_other')

    await secrets.deleteToken('team')

    expect(await secrets.token('other')).toBe('jira_token_other')
  })
})

test('the keychain keeps tokens across openings, as a restart does', async () => {
  if (!keychain) return
  await openKeychainSecrets({ service: TEST_SERVICE }).saveToken('team', 'github_pat_kept')

  expect(await openKeychainSecrets({ service: TEST_SERVICE }).token('team')).toBe('github_pat_kept')
})
