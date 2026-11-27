import { describe, expect, test, vi } from 'vitest'
import { APP_VERSION } from '../../../src/forecast/index.js'
import { byRole, one, render, text } from '../dom.js'
import { SCREENS } from './htmlPageHarness.js'

// Send feedback in every screen's footer (#370), for a build that recorded its GitHub repo, as `npm run build` does
// (scripts/feedbackRepo.ts). The app layer reads the repo from src/app/feedbackRepo.ts, which records none in src/, so
// this file gives it one; htmlPage.test.ts checks the footer with none.
vi.mock('../../../src/app/feedbackRepo.js', () => ({ FEEDBACK_REPO: 'owner/repo' }))

describe('every screen, in a build with a GitHub repo', () => {
  test.each(SCREENS)(
    "%s: the footer reads the version, then Send feedback, which opens a new tab on the repo's Feedback form, which labels it",
    async (screen, _, drawn) => {
      const page = render(await drawn())

      expect(text(one(page, 'footer'))).toBe(`Forecaster ${APP_VERSION} · Send feedback`)
      const link = byRole(one(page, 'footer'), 'link', { name: 'Send feedback' })
      expect(link.getAttribute('target')).toBe('_blank')
      const opened = new URL(link.getAttribute('href') ?? '')
      expect(`${opened.origin}${opened.pathname}`).toBe('https://github.com/owner/repo/issues/new')
      // the form's own labels apply for any reporter, where a `labels` query applies only for someone with triage (#389)
      expect(Object.fromEntries(opened.searchParams)).toEqual({ template: 'feedback.yml', version: APP_VERSION, screen })
    },
  )
})
