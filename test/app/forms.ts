import type { RunningApp } from '../../src/app/launch.js'

// Forms posted to the local server as the app's own pages post them, for any test of the running app.

/**
 * The header the Inputs screen's script sends when it saves in place, staying on the Inputs screen. It pins the wire value
 * of `SAVE_IN_PLACE` in `src/app/inputsScript.ts` on purpose: TEST_SEAMS doesn't let app tests import that file.
 */
export const SAVE_IN_PLACE = { header: 'forecaster-save', value: 'in-place' } as const

/** A form's fields, in any shape `URLSearchParams` takes. */
type FormFields = Record<string, string> | [string, string][] | URLSearchParams

/**
 * Posts `fields` to `path` as a form on the app's own page does: from its origin, which the server checks, not following
 * a redirect. Takes anything with the app's `url`, so a test of the built app can post to the address it printed.
 */
export const post = (running: Pick<RunningApp, 'url'>, path: string, fields: FormFields, headers: Record<string, string> = {}): Promise<Response> =>
  fetch(new URL(path, running.url), {
    method: 'POST',
    body: new URLSearchParams(fields),
    headers: { origin: new URL(running.url).origin, ...headers },
    redirect: 'manual',
  })

/** Posts `fields` as the Inputs screen's script does when a field changes: it asks to stay on the Inputs screen. */
export const saveInPlace = (running: Pick<RunningApp, 'url'>, path: string, fields: FormFields): Promise<Response> =>
  post(running, path, fields, { [SAVE_IN_PLACE.header]: SAVE_IN_PLACE.value })

/** Where `response` redirects the browser after a post: its location, failing if it isn't a 303 to one. */
export function redirectedTo(response: Response): string | null {
  if (response.status !== 303) throw new Error(`Expected a 303 redirect, but it was ${response.status}`)
  return response.headers.get('location')
}
