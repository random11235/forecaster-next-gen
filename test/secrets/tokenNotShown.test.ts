import { afterEach, describe, expect, test, vi } from 'vitest'
import { openKeychainSecrets, type Keychain } from '../../src/secrets/keychainSecrets.js'

// No error or log from secrets/ includes the token, even when the keychain's own error does.

const TOKEN = 'github_pat_11ABCDEFG0123456789_secret'

/** A keychain that fails every call, its error naming the last password it was given, as a careless one might. */
function failingKeychain(): Keychain {
  let given = ''
  return () => ({
    setPassword: async (password) => {
      given = password
      throw new Error(`refused to store ${password}`)
    },
    getPassword: async () => {
      throw new Error(`locked; last stored ${given}`)
    },
    deletePassword: async () => {
      throw new Error(`locked; last stored ${given}`)
    },
  })
}

const consoleCalls: unknown[][] = []

afterEach(() => {
  vi.restoreAllMocks()
  consoleCalls.length = 0
})

function watchConsole(): void {
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void consoleCalls.push(args))
  }
}

async function failureOf(attempt: Promise<unknown>): Promise<Error> {
  const failure = await attempt.then(
    () => undefined,
    (error: unknown) => error,
  )
  if (!(failure instanceof Error)) throw new Error('Expected the attempt to fail')
  return failure
}

describe('the keychain failing', () => {
  test('saving fails naming the team, without the token', async () => {
    watchConsole()
    const secrets = openKeychainSecrets({ keychain: failingKeychain() })

    const failure = await failureOf(secrets.saveToken('team', TOKEN))

    expect(failure.message).toBe(
      `The OS keychain couldn't save the tracker token for team "team". Check the keychain is unlocked and the Forecaster may use it.`,
    )
    expect(failure.stack).not.toContain(TOKEN)
    expect(failure.cause).toBeUndefined()
    expect(JSON.stringify(consoleCalls)).not.toContain(TOKEN)
  })

  test('reading and deleting fail without the token', async () => {
    watchConsole()
    const keychain = failingKeychain()
    const secrets = openKeychainSecrets({ keychain })
    await secrets.saveToken('team', TOKEN).catch(() => undefined)

    const failures = [await failureOf(secrets.token('team')), await failureOf(secrets.deleteToken('team'))]

    expect(failures.map((failure) => failure.message)).toEqual([
      `The OS keychain couldn't read the tracker token for team "team". Check the keychain is unlocked and the Forecaster may use it.`,
      `The OS keychain couldn't delete the tracker token for team "team". Check the keychain is unlocked and the Forecaster may use it.`,
    ])
    expect(failures.map((failure) => failure.stack).join()).not.toContain(TOKEN)
    expect(JSON.stringify(consoleCalls)).not.toContain(TOKEN)
  })
})
