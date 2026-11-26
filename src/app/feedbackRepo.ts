/**
 * The GitHub repo this build sends Feedback to (#370), as `owner/repo`, or none. `npm run build` records it once tsc
 * has built dist/ (`scripts/feedbackRepo.ts`), writing the built `dist/app/feedbackRepo.js` in place of this file's,
 * which records none: the tests, run from src/, and the web build, bundled from it, have no repo.
 */
export const FEEDBACK_REPO: string | undefined = undefined
