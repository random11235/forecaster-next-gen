import { AsyncEntry } from '@napi-rs/keyring'
import type { Secrets } from './secrets.js'

/** One keychain item, as `@napi-rs/keyring`'s `AsyncEntry` reads and writes it. */
export interface KeychainItem {
  setPassword(password: string): Promise<void>
  /** The item's password, or null when there is no such item. */
  getPassword(): Promise<string | null>
  /** True when an item was deleted, false when there was none. */
  deletePassword(): Promise<boolean>
}

/** Opens the keychain item for a service and account. */
export type Keychain = (service: string, account: string) => KeychainItem

/** The OS keychain: the macOS Keychain, the Windows Credential Manager, or the Secret Service on Linux. */
const osKeychain: Keychain = (service, account) => new AsyncEntry(service, account)

/** The keychain service the app keeps tracker tokens under; each team's is the item whose account is the team's ID. */
export const TOKEN_SERVICE = 'forecaster-tracker-token'

/**
 * Tracker tokens in the OS keychain, keyed by team. `service` names the keychain service (tests use their own), and
 * `keychain` stands in for the OS keychain in the tests that make it fail. A failure throws an error naming what
 * failed and for which team, without the keychain's own error, which might quote the token.
 */
export function openKeychainSecrets(options: { service?: string; keychain?: Keychain } = {}): Secrets {
  const { service = TOKEN_SERVICE, keychain = osKeychain } = options

  async function attempt<T>(doing: string, teamId: string, action: (item: KeychainItem) => Promise<T>): Promise<T> {
    try {
      return await action(keychain(service, teamId))
    } catch {
      // The keychain's own error is dropped, message and all: nothing here can tell whether it quotes the token.
      throw new Error(`The OS keychain couldn't ${doing} the tracker token for team "${teamId}". Check the keychain is unlocked and the Forecaster may use it.`)
    }
  }

  return {
    saveToken: (teamId, token) => attempt('save', teamId, (item) => item.setPassword(token)),
    token: (teamId) => attempt('read', teamId, async (item) => (await item.getPassword()) ?? undefined),
    deleteToken: (teamId) => attempt('delete', teamId, async (item) => void (await item.deletePassword())),
  }
}
