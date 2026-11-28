# Architecture: Script tests

Part of the test seams; see [`architecture-test-seams.md`](architecture-test-seams.md), whose index is [`architecture.md`](architecture.md).

None of `test/scripts/` is a forecasting seam. Each test file tests one script, named below with the input it is driven through, its seam. What a workflow or a runner does around a script is checked by a real run, not by tests, as each section says.

## Local app and checks

- **`restartLocal.test.ts`** runs `scripts/restartLocal.sh` against the built app on a spare `PORT`, with a stand-in `open` on `PATH`, writing the app's launch agent to its own directory (`LAUNCH_AGENTS_DIR`), so the app runs under launchd, in the login session, where it can read the keychain (#290). The script runs only on macOS, as the runner does, so the test skips on CI's Linux and runs in the pre-push hook. The restart workflow (`.github/workflows/restart-local.yml`) and the runner setup wizard (`scripts/setupRunner.sh`) are checked by a real merge.
- **`prePush.test.ts`** runs the pre-push hook (`.husky/pre-push`) in a stand-in clone whose `npm run check` passes or fails.
- **`changeFiles.test.ts`** tests `changeFileProblems` in `scripts/changeFiles.ts`, the change-file check `check:static` runs, on a branch's files at its base and head. `scripts/bumpFloors.ts` is tested through it, with the `MIGRATIONS` source built by `test/migrationsSource.ts`, which `test/storage/storedValues.test.ts` shares.
- **`mergeBase.test.ts`** tests `scripts/mergeBase.ts`, how those checks find the commit they diff from.
- **`lintBoundaries.test.ts`** and **`lintBoundaries.layering.test.ts`** run the module-boundary check (`scripts/lintBoundaries.ts`) over the real repo and over the stand-in repos of `test/scripts/boundariesRepo.ts`.
- **`sourceFiles.test.ts`** tests `scripts/sourceFiles.ts`, how the scans find and resolve imports.
- **`moduleDepth.test.ts`** tests `scripts/moduleDepth.ts`, the shallowest modules CI's summary lists, on stand-in modules and then the real `src/`.
- **`ownFolderCoverage.test.ts`** tests `scripts/ownFolderCoverage.ts` on Vitest's coverage summary. CI runs the measuring itself.
- **`mutationTargets.test.ts`** tests `scripts/mutationTargets.ts` on diffs written in `git diff -U0`'s format. **`mutationSummary.test.ts`** tests `scripts/mutationSummary.ts` on reports written in Stryker's schema; a real PR's run checks that Stryker writes the report and that CI shows it.

## Build and release

- **`feedbackRepo.test.ts`** tests `scripts/feedbackRepo.ts`, which `npm run build` runs to record the GitHub repo the build sends Feedback to (#370), on `GITHUB_REPOSITORY` and origin's URL.
- `scripts/buildWeb.ts`'s `webPage` is tested by the web build smoke test, in [`architecture-test-seams-app.md`](architecture-test-seams-app.md).
- **The release** ([`architecture.md`](architecture.md#release)), `scripts/release.ts`, is tested in git repos of its own, never the real repo's, each with the tags, branches and merges its case needs (`test/scripts/releaseRepo.ts`). `release.test.ts` calls it on such a repo; `release.run.test.ts` runs the script as the release job does, from a clone of a bare repo standing in for GitHub. The job itself is checked by a real merge.

## The factory

The factory's workflows (`.github/workflows/factory.yml`, which runs `scripts/factoryBuild.ts`, `scripts/factoryNext.ts`, `scripts/factorySpecOpen.ts`, `scripts/factorySpecClose.ts` and `scripts/factoryAsk.ts`, and `factory-smoke.yml`, which runs `scripts/factorySmoke.ts`) need a GitHub runner, bwrap and the OAuth token, so they are checked by real runs: the factory on throwaway tickets, recorded in each ticket's PR; the smoke test only when dispatched by hand, never in CI. The scripts they run are tested on what GitHub, Sandcastle and Claude Code give them:

- **`factoryAgent.test.ts`** tests `scripts/factoryAgent.ts`, the Claude Code agent the factory runs, on the command it builds, run through `sh -c` with a stand-in `claude`, as Sandcastle runs it. It throws if `claudeCode()` stops ending its command in `-p -`, which only a Sandcastle bump past the pinned 0.14.0 would do.
- **`factoryTicket.test.ts`** tests `scripts/factoryTicket.ts`, the prompt for a ticket or a spec's ticket, on the ticket and its comments as GitHub's REST API gives them, and the check command the factory runs, which the prompt's rules block names.
- **`factoryDecisionLog.test.ts`** tests `scripts/factoryDecisionLog.ts`, the decision-log entry `publish` comments on the spec for a ticket merged into `spec/<n>`, on the agent's reply. The prompts read the log back, so `factoryTicket.test.ts` and `factoryQuestion.test.ts` cover it too.
- **`factoryPullRequest.test.ts`** tests `scripts/factoryPullRequest.ts`, the body of the PR the factory opens, on the agent's reply.
- **`factoryOutcome.test.ts`** tests `scripts/factoryOutcome.ts`, how a build ended, on what Sandcastle's `run()` returned or threw and Claude Code's stream-json. Sandcastle's errors come as its `run()` throws them, inside effect's FiberFailure, made with the effect and error classes Sandcastle bundles.
- **`factoryFrontier.test.ts`** tests `scripts/factoryFrontier.ts`, what the factory does next on a spec, on the spec's sub-issues as GitHub's GraphQL API gives them and how many runs chained before this one.
- **`factorySpecPullRequest.test.ts`** tests `scripts/factorySpecPullRequest.ts`, the title and body of a spec's PR to `main`, on the spec and its sub-issues as GitHub's REST API gives them.
- **`factorySpecMerged.test.ts`** tests `scripts/factorySpecMerged.ts`, what the factory does once a PR closes, on the `pull_request_target` event's PR and the spec and its sub-issues as GitHub's REST API gives them.
- **`factoryTree.test.ts`** tests `scripts/factoryTree.ts`, how the factory readies the tree it builds on, on the runner's and the tree's checkouts.
- **`factoryQuestion.test.ts`** tests `scripts/factoryQuestion.ts`, a question for the factory, on the comment that asks it, what the workflow fetched from GitHub's APIs, and the default branch's `git log`. **`factoryAsked.test.ts`** pins that `scripts/factoryAsked.ts`, which the workflow runs before it installs anything, imports no package, through all it imports.
- `scripts/factoryTrust.ts`, whose words the factory believes, is tested through the prompts and the frontier.
- **`workflowPermissions.test.ts`** reads the workflow files: what `factoryTrust.ts`'s github-actions rule rests on.
- **`smokeVerdict.test.ts`** tests `scripts/smokeVerdict.ts`, the smoke test's checks, on Claude Code's stream-json, the agent's `<smoke-report>` and what changed on the host. **`smokeHost.test.ts`** tests `scripts/smokeHost.ts`, whether a write reached the host and how to undo it, on what was at the target and its directory before the run and after. `scripts/factorySmoke.ts` does the I/O.
- **`triagePlan.test.ts`** tests `scripts/triagePlan.ts`, the check between the triage agent's plan and any write (ADR 0006), on a batch's issue numbers and the plan as the agent returns it. Nothing runs it yet.
