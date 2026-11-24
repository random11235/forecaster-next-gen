import type { Team } from '../../src/model/team.js'

// The team either build adds on first open, for the tests of both: no server or storage here, so the web build's
// test (webApp.test.ts) imports it without the local server's harness.

/** The team either build adds on first open, when nothing is stored yet, installed at `installedAt`. */
export const defaultTeam = (installedAt: string): Team => ({ id: 'team', name: 'My team', source: 'manual', sourceRef: '', installedAt })
