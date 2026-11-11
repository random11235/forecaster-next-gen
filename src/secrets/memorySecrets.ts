import type { Secrets } from './secrets.js'

/** Tracker tokens held in memory, forgotten when the process ends: the fake Seam B tests use in place of the keychain. */
export function openMemorySecrets(): Secrets {
  const tokens = new Map<string, string>()
  return {
    saveToken: async (teamId, token) => void tokens.set(teamId, token),
    token: async (teamId) => tokens.get(teamId),
    deleteToken: async (teamId) => void tokens.delete(teamId),
  }
}
