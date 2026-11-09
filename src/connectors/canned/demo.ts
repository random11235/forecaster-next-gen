import type { Connector } from '../connector.js'
import { cannedConnector, type CannedFixture } from './cannedConnector.js'
import fixture from './demoFixture.json' with { type: 'json' }

/**
 * Demo mode's connector: canned, from a committed synthetic fixture (made up for demos, holding no real team's data),
 * so demo screenshots and the launch smoke test need no tracker or token.
 */
export function demoConnector(): Connector {
  return cannedConnector(fixture satisfies CannedFixture)
}
