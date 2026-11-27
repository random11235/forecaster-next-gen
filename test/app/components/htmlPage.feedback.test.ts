import { describe, expect, test, vi } from 'vitest'
import { APP_VERSION } from '../../../src/forecast/index.js'
import { byRole, one, render, text } from '../dom.js'
import { SCREENS } from './htmlPageHarness.js'

// Send feedback in every screen's footer (#370), for a build that recorded its GitHub repo, as `npm run build` does
// (scripts/feedbackRepo.ts). The app layer reads the repo from src/app/feedbackRepo.ts, which records none in src/, so
// this file gives it one; htmlPage.test.ts checks the footer with none.
vi.mock('../../../src/app/feedbackRepo.js', () => ({ FEEDBACK_REPO: 'owner/repo' }))

/** The new issue's body as GitHub's form opens with it, for the version and screen given. */
const body = (version: string, screen: string) => `> This issue is public, screenshots included. Blur or crop anything about a real team's work.

### What happened


### What you expected


### Screenshots

<!-- Paste or drag screenshots here. -->

---
Version: ${version}
Screen: ${screen}`

describe('every screen, in a build with a GitHub repo', () => {
  test.each(SCREENS)(
    "%s: the footer reads the version, then Send feedback, which opens a new tab on the repo's new-issue form, prefilled for triage",
    async (screen, _, drawn) => {
      const page = render(await drawn())

      expect(text(one(page, 'footer'))).toBe(`Forecaster ${APP_VERSION} · Send feedback`)
      const link = byRole(one(page, 'footer'), 'link', { name: 'Send feedback' })
      expect(link.getAttribute('target')).toBe('_blank')
      const opened = new URL(link.getAttribute('href') ?? '')
      expect(`${opened.origin}${opened.pathname}`).toBe('https://github.com/owner/repo/issues/new')
      expect(opened.searchParams.get('labels')).toBe('needs-triage')
      expect(opened.searchParams.get('title')).toBe('Feedback: ')
      expect(opened.searchParams.get('body')).toBe(body(APP_VERSION, screen))
    },
  )
})
