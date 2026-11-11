/**
 * Where a team's tracker token is kept, keyed by team: the OS keychain in the local server build
 * (`openKeychainSecrets`), in memory in tests (`openMemorySecrets`). The browser build has none. Nothing else holds
 * the token: it goes from here to the connector when the connector is built. No error or log from here includes it.
 */
export interface Secrets {
  /** Saves the team's tracker token, replacing the one it has. */
  saveToken(teamId: string, token: string): Promise<void>
  /** The team's tracker token, if one is saved. */
  token(teamId: string): Promise<string | undefined>
  /** Forgets the team's tracker token; nothing happens when it has none. */
  deleteToken(teamId: string): Promise<void>
}
