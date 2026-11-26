/**
 * The GitHub repo (`owner/repo`) that the footer's "Send feedback" link opens an issue in (#370).
 *
 * This source file always says "no repo", which is what the tests see. When you run `npm run build`,
 * `scripts/feedbackRepo.ts` works out the real repo and overwrites the compiled `dist/app/feedbackRepo.js` with it.
 * The web build (`scripts/buildWeb.ts`) then bakes that value into its bundle.
 */
export const FEEDBACK_REPO: string | undefined = undefined
