# Running the factory's agents in Sandcastle on GitHub Actions

Research date: 2026-11-25. Scope: how a GitHub Actions "software factory" for this repo should run Claude Code agents inside Sandcastle's `bwrap()` provider on free hosted runners. This builds on [ADR 0005](../adr/0005-public-repo-for-a-free-factory.md). It covers Sandcastle itself, keeping `FACTORY_TOKEN` away from the agent, headless Claude Code, the Actions mechanics, integration branches, and risks.

Citation convention: bracketed numbers such as [4] refer to the **Sources** list at the end. Every source was read on 2026-11-25. Where a claim could not be checked against a primary source, the text says "**Unverified**". Sections marked **Synthesis** are my own reasoning from those sources. Where the text mentions "a sibling project", that is a working factory in another repository. It counts as evidence of practice only, not of how the tools behave.

---

## 1. Sandcastle

### 1.1 What it is, and which version

- Sandcastle (`@ai-hero/sandcastle`) is a TypeScript library, MIT-licensed, by Matt Pocock. It runs a coding agent (Claude Code among others) against a git repo inside a sandbox, and collects the commits the agent makes [1].
- On npm, the `latest` tag is **0.14.0**. A prerelease line, `1.0.0-v1-next.*`, is published under the `v1-next` tag [2]. Pin `0.14.0` exactly. A pre-1.0 library with a 1.0 rewrite in flight will break its API.
- The core call is `run()`. Lower-level `createWorktree()` and `createSandbox()` are also exported, for running several steps in one worktree or sandbox [3][1].

### 1.2 The `run()` API (0.14.0)

These are the options that matter for the factory [3][4][5]:

| Option | Default | Notes |
| --- | --- | --- |
| `agent` | required | `claudeCode(model, { effort, env, permissionMode, captureSessions })` |
| `sandbox` | required | `bwrap({ env, mounts, maxOutputTailChars })`, `noSandbox()`, `docker()`, … |
| `prompt` / `promptFile`, `promptArgs` | | `{{KEY}}` substitution. `{{SOURCE_BRANCH}}` and `{{TARGET_BRANCH}}` are built in |
| `branchStrategy` | `head` for bind-mount providers | `head`, `merge-to-head`, `{ type: "branch", branch }` (see 1.5) |
| `maxIterations` | 1 | Each iteration is a fresh agent invocation |
| `completionSignal` | `<promise>COMPLETE</promise>` | Stops the iteration loop early |
| `idleTimeoutSeconds` | 600 | Resets on every agent output event |
| `completionTimeoutSeconds` | 60 | Grace period after the completion signal |
| `timeouts` | `copyToWorktreeMs` 60000, `gitSetupMs` 10000, `commitCollectionMs` 30000, `mergeToHostMs` 30000 | |
| `hooks` | 60 s each unless `timeoutMs` is set | `host.onWorktreeReady`, `host.onSandboxReady`, `sandbox.onSandboxReady` (for example `npm ci` inside the sandbox) |
| `copyToWorktree` | | Copy untracked files (such as `node_modules`) into the worktree |
| `output` | | `Output.object({ tag, schema, maxRetries })` or `Output.string(...)` (see 1.6) |
| `logging` | | `{ type: "stdout" }` streams to the job log; `{ type: "file" }` |
| `signal`, `resumeSession`, `name`, `cwd` | | |

`run()` resolves to a result with `iterations`, `completionSignal`, `stdout`, `commits` (`[{ sha }]`), `branch`, `logFilePath`, `output`, `preservedWorktreePath` and `resume` [3].

Under the hood, `claudeCode()` runs `claude --print --verbose --dangerously-skip-permissions --output-format stream-json --model <m> -p -`, and sends the prompt on stdin [6]. A slash command sent that way doesn't expand: the factory's smoke test (#335) found the model treats it as text and goes looking for the skill, while the same command as Claude Code's argument expands (run [45521771069](https://github.com/random11235/forecaster-next-gen/actions/runs/45521771069)). So `scripts/factoryAgent.ts` rewrites the command to pass the prompt as the argument, after `--`. With `permissionMode` set, it passes `--permission-mode <mode>` in place of the skip flag [6].

### 1.3 Providers

- **`bwrap()`**: Bubblewrap on Linux. Each exec gets a fresh sandbox [7][8].
- **`noSandbox()`**: runs the agent directly on the host.
- **`docker()`** / **`podman()`**: containers.
- **Seatbelt**: on macOS. ADR 0005 rejected it because it leaves the Keychain and localhost reachable [0005].

Sandcastle's own `agent-implement` workflow uses `noSandbox()` on its runner [9][10]. So does the sibling project. Neither has proved `bwrap()` in an agent workflow. Sandcastle's CI does run the bwrap test suite on `ubuntu-latest` (see 1.4) [11].

### 1.4 What `bwrap()` does, and what it needs on a hosted runner

What the sandbox does [7][8]:

- System dirs (`/usr`, `/etc`, `/bin`, `/sbin`, `/lib*`, `/opt`) and the host's `PATH` dirs are mounted **read-only**.
- The worktree and the repo's git dirs appear at their host paths.
- `/home` is a tmpfs. The agent gets a private `/home/agent` and a private `/tmp`, both deleted on close.
- It runs with `--clearenv --unshare-all --share-net --die-with-parent --new-session`. The environment starts empty. Only the variables Sandcastle passes are set, plus `PATH`, `HOME` and `TMPDIR`.
- The **network is open**, including localhost. There is no root. `interactive()` is not supported.
- At startup it runs the probe `bwrap --ro-bind / / true`. If the probe fails, it throws `NativeSandboxUnavailableError` with a fix command. It **never falls back to running unsandboxed** [8].
- The docs say it guards against accidents and prompt injection. It does not guard against kernel escapes (it is "about as strong as runc") or against services on localhost [7].

What the runner needs:

- Bubblewrap is **not** in the Ubuntu 24.04 or 26.04 runner toolsets, so the workflow must install it [12][13].
- Ubuntu 24.04+ uses AppArmor to restrict unprivileged user namespaces. On `ubuntu-24.04` runners this fails with "unshare: Operation not permitted" [14]. A PR to relax the restriction in the image was closed unmerged [15].
- The Sandcastle docs give two fixes [7]:
  - The narrow one: an AppArmor profile that lets only the bwrap binary make user namespaces. Write `abi <abi/4.0>, include <tunables/global> profile bwrap /usr/bin/bwrap flags=(unconfined) { userns, }` to `/etc/apparmor.d/bwrap`, then run `sudo apparmor_parser -r /etc/apparmor.d/bwrap`.
  - The blunt one: `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`.
- Sandcastle's own CI on `ubuntu-latest` does: `sudo apt-get update && sudo apt-get install -y bubblewrap`, then the sysctl, then `bwrap --ro-bind / / true` [11][16].
- Hosted runners have passwordless `sudo` [17], so both fixes work.
- `ubuntu-latest` is moving from 24.04 to **26.04** (rollout Oct 19 to Nov 19, 2026) [18]. The 26.04 image ships kernel 7.0, Node 24, Git 2.56 and gh 2.104 [13].
- **Unverified**: whether 26.04 keeps the userns restriction. The probe step will show it either way.

### 1.5 Worktrees and branches

The three strategies [5]:

- **`head`**: the agent writes into the host working directory. There is no worktree.
- **`merge-to-head`**: Sandcastle makes a temporary branch in a worktree. The agent works there, and Sandcastle merges the branch back into the branch that was checked out when `run()` was called.
  - The merge is a plain `git merge`. If it fails, Sandcastle aborts it and leaves HEAD unchanged. The temp branch is kept if it holds commits [5][19].
  - The docs call it the "safe default for automation" [5].
- **`{ type: "branch", branch }`**: commits land on a named branch in a worktree under `.sandcastle/worktrees/`. Re-running reuses the worktree and fast-forwards it from `origin` when that is safe [5].

The repo's `.git` dir is mounted into the sandbox, so the agent can commit. Inside the sandbox, `.git/config`, the hooks, `info` and the worktree's `.git` file are read-only. So `git config` without `--global` fails there [7]. On the host side, Sandcastle's own git calls ignore repo hooks, and ignore any repo config that would run a program [7][19].

### 1.6 Output and structured results

- `logging: { type: "stdout" }` streams the agent's events to the job log [3].
- `Output.object({ tag, schema })` asks the agent for JSON inside an XML tag, and checks it against any Standard Schema validator (Zod and others). It needs `maxIterations: 1`, and the prompt must mention the tag [4].
- If the JSON fails validation, it throws `StructuredOutputError`. `maxRetries` resumes the same session to ask again [4].
- The factory can use this to get a verdict back, for example `{ status: "done" | "blocked", summary, blockedReason }`. The workflow can then label and comment from it.
- **Synthesis:** don't trust the verdict on its own. Check the facts too: commits exist (`result.commits.length > 0`), the tree is clean, and the checks pass. Sandcastle's own `implement.ts` fails the run when the agent made no commits [10].

### 1.7 Credentials into the sandbox

This is from the source (`resolveEnv` in `dist/index.js`) [19] and the docs [7]:

- The sandbox gets only the keys **declared in `.sandcastle/.env`**. Each value comes from that file, or else from `process.env`.
- It also gets whatever is passed in `claudeCode({ env })` and `bwrap({ env })`. Those two maps are merged, and they must not share a key.
- So a `GH_TOKEN` that is only in the job's environment does **not** reach the agent, unless `.sandcastle/.env` names it or it is passed explicitly.
- Sandcastle's own host-side git commands run with the full `process.env` [19].
- Sandcastle copies the host's git identity into the sandbox [7].

---

## 2. Keeping `FACTORY_TOKEN` away from the agent

**Synthesis**, built on [7][19][20][21]:

1. **Never put `FACTORY_TOKEN` in job-level `env`.** Set it as `GH_TOKEN` only on the steps that need it: labeling, commenting, pushing, opening the PR, and dispatching. The agent step must not have it in its environment at all. Even then, `bwrap --clearenv` and `resolveEnv` are a second wall, not the only one. The sibling project does this, setting its PAT per step and never on the agent step.
2. **Check out with `persist-credentials: false`** [20]. Since `actions/checkout` v6, persisted credentials live in a file under `$RUNNER_TEMP`, not in `.git/config` [20]. The `.git` dir is mounted into the sandbox, so don't leave a credential anywhere it could point to.
3. **Push from a step after the agent finishes**, with the token sent as a one-off header. For example: `git -c http.extraheader="AUTHORIZATION: basic $(printf 'x-access-token:%s' "$GH_TOKEN" | base64 -w0)" -c core.hooksPath=/dev/null push origin spec/<n>`. Turning hooks off matters: the agent could have written into the worktree a hook that would run with the token present. The sibling project pushes this way.
4. **Give the agent only a read-only GitHub token, or none.** The skills call `gh` to read tickets (see [issue-tracker.md](../agents/issue-tracker.md)). Two options:
   - Pre-fetch the issue on the host and pass it in `promptArgs`. Sandcastle's own `implement.ts` does this with `gh issue view --comments` [10].
   - Pass the job's `GITHUB_TOKEN`, scoped to `contents: read, issues: read`, as `GH_TOKEN` into the sandbox. That token expires when the job ends [21]. For a public repo, a leak of it gives nothing away.

   Either way, every write to GitHub (labels, `merged` comments, PRs) moves out of the agent and into workflow steps.
5. **Keep the `GITHUB_TOKEN` default at read-only**, and raise it per job [22]. Anyone with write access can read every secret [22], so keep the collaborator list short.
6. **Never interpolate `${{ github.event.issue.title }}` or `body` into a `run:` script.** Pass them through `env:` [22].

`CLAUDE_CODE_OAUTH_TOKEN` must be inside the sandbox, because the agent uses it. It goes in `claudeCode("…", { env: { CLAUDE_CODE_OAUTH_TOKEN } })`. That token can only make model requests [23], but anything that runs in the sandbox can read it (see risk R3).

---

## 3. Headless Claude Code

- **Auth.**
  - `claude setup-token` makes a one-year OAuth token for a Pro, Max, Team or Enterprise plan. Set it as `CLAUDE_CODE_OAUTH_TOKEN` [23].
  - It comes fifth in auth precedence, after a cloud provider, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY` and `apiKeyHelper`. So none of those may be set in the sandbox [23].
  - Usage counts against the subscription's limits, not a metered API bill [23].
- **Do not use `--bare`.** It skips skills, and it does not read `CLAUDE_CODE_OAUTH_TOKEN` [24][23]. Plain `-p` (what Sandcastle runs) loads skills, hooks and the project's `.claude/settings.json` with no trust prompt [24].
- **Invoking a skill by name.**
  - In `-p` mode, put `/skill-name args` at the start of the prompt and Claude Code expands it [24][25].
  - `/implement` and `/implement-spec` both set `disable-model-invocation: true` ([implement](../../.claude/skills/implement/SKILL.md), [implement-spec](../../.claude/skills/implement-spec/SKILL.md)). So the slash command is the only way to run them, and the model can't pick them up on its own [25].
  - Only the first skill on the line loads. The rest of the line becomes its `$ARGUMENTS`, or is appended as `ARGUMENTS: …` when the skill has no placeholder [25].
  - So the prompt file is `/implement {{ISSUE_NUMBER}}`, plus any context lines after it.
  - Tested by the smoke test (#335): a stdin prompt (`-p -`), as Sandcastle sends it, doesn't expand; the model runs its Skill tool, or reads the file, to find the skill. As Claude Code's argument it expands, and the model says the skill's word before any tool call (run [45521771069](https://github.com/random11235/forecaster-next-gen/actions/runs/45521771069)). `scripts/factoryAgent.ts` passes the prompt that way.
- **Permissions.** Sandcastle passes `--dangerously-skip-permissions` [6]. The bwrap docs say to turn off the agent's own sandbox and let bwrap be the wall [7].
  - Since v2.1.302, `-p` starts in Manual mode when nothing sets a mode [24]. Sandcastle's flag sets one, so this does not affect the factory.
- **Long-running work.**
  - In `-p`, background subagents are waited for, with a 10-minute idle cap (`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`) [24].
  - Long shell commands need `BASH_DEFAULT_TIMEOUT_MS` raised [24].
  - `--max-budget-usd` exists [24]. `claudeCode()` has no option for it [6], so `scripts/factoryAgent.ts` adds it to the command. It caps under a subscription token too: a $0.0001 cap stopped a run after 1 turn at about $0.0012, with `error_max_budget_usd`, `terminal_reason: budget_exhausted` and `costBasis: list` (runs [45519591293](https://github.com/random11235/forecaster-next-gen/actions/runs/45519591293), [45521771069](https://github.com/random11235/forecaster-next-gen/actions/runs/45521771069)). Claude Code checks it after each turn, so a run overshoots it by up to a turn.

---

## 4. Actions mechanics

- **Trigger.** Use `on: issues: types: [labeled]`, then `if: github.event.label.name == 'ready-for-agent'`.
  - The workflow file must be on the default branch, and `GITHUB_SHA` is the default branch's last commit [26].
- **Who may trigger.** This is a personal-account repo, so there are only two roles: the owner and collaborators. Collaborators can manage labels [27]. So the label gate already means "owner or collaborator".
  - Still, check it explicitly, as defence in depth: call `GET /repos/{o}/{r}/collaborators/{actor}/permission` and require `admin` or `write` [28].
  - Read only comments whose `author_association` is OWNER, MEMBER or COLLABORATOR, as ADR 0005 says [0005].
- **One run per issue.** Use `concurrency: { group: factory-issue-${{ github.event.issue.number }}, cancel-in-progress: false }`.
  - A group allows one running and one pending run. A newer pending run replaces the older pending one [29].
  - Spec runs also need a group per spec, `factory-spec-<n>`, so two runs never push to the same integration branch at once.
  - `queue: max` (up to 100 pending) can't be combined with `cancel-in-progress` [29].
- **Events made by `GITHUB_TOKEN` start no workflows**, except `workflow_dispatch` and `repository_dispatch` [21][26]. So:
  - A label or PR created with `GITHUB_TOKEN` will not trigger the next stage. Use `FACTORY_TOKEN` for hand-offs. The sibling project adds its hand-off label with its PAT for this reason.
  - In a personal-account repo, `GITHUB_TOKEN` can't create PRs by default [30]. Use `FACTORY_TOKEN` for `gh pr create`.
- **Self-redispatch.**
  - To move to the next ticket, call `gh workflow run factory.yml -f spec=<n> -f hop=<k+1>` (or `POST …/dispatches`) with `FACTORY_TOKEN`. It has Actions read/write.
  - The REST docs don't name the `GITHUB_TOKEN` permission needed to dispatch. The `actions: write` permission is documented only as "cancel a workflow run" [31][32]. So `GITHUB_TOKEN` dispatch is **Unverified**.
  - `workflow_dispatch` allows at most 25 inputs and a 65,535-character payload [26].
- **Limits** [33][34]:
  - Free hosted runners in a public repo cost nothing.
  - The limits are 6 h per job, 35 days per run and 20 concurrent jobs on Free.
  - `GITHUB_TOKEN` gets 1,000 API requests per hour per repo; a PAT gets 5,000.
  - A standard Linux runner has 4 CPUs, 16 GB RAM and a 14 GB SSD [17].
  - Set `timeout-minutes` yourself. The sibling project uses 45 and Sandcastle's own workflow uses 60 [9].

---

## 5. Integration-branch mechanics

How we differ from the sibling project: it opens a draft PR straight to `main` for every ticket, on a branch named `agent/issue-<n>-<run_id>`. Our specs get one integration branch, `spec/<n>`. Each ticket is built on it and merged into it, and one PR goes to `main` at the end. That is what [implement-spec](../../.claude/skills/implement-spec/SKILL.md) does locally.

**Synthesis.** A per-ticket job maps well onto `merge-to-head`:

1. The job checks out `spec/<n>`, creating it from `main` on the first ticket. It uses `fetch-depth: 0` and `persist-credentials: false`.
2. It calls `run({ branchStrategy: { type: "merge-to-head" }, sandbox: bwrap(...), promptFile })` with `/implement <ticket>`.
   - The agent works on a temp branch in a worktree. When it finishes, Sandcastle merges the temp branch into `spec/<n>`.
   - On a conflict, Sandcastle aborts the merge, so `spec/<n>` is unchanged, and keeps the temp branch [5].
3. The job runs the checks the implement-spec merger runs (`npm run typecheck`, `npm test`, `npm run check:migrations`) on the **merged** tree. Run them inside a second `bwrap` exec, or in a step with no secrets. Ticket code is untrusted, so it must not run next to `FACTORY_TOKEN`.
4. If the checks pass, push `spec/<n>` with `FACTORY_TOKEN` (see section 2). Comment `merged` on the ticket, which ends its cycle time ([issue-tracker.md](../agents/issue-tracker.md)). Then dispatch the next ticket.
5. If the checks fail, or the merge conflicts, don't push. Label the ticket `agent:blocked`, comment the reason, and stop the chain.
6. After the first merge, open a draft PR `spec/<n>` → `main` with `FACTORY_TOKEN`. That way CI runs on every later push.

Things to know:

- **Closing keywords only work on PRs to the default branch, and a PR links at most 10 issues** [35]. Merging a ticket into `spec/<n>` closes nothing. The final PR body can say `Closes #a, closes #b, …` for up to 10 tickets. Larger specs need a closing step after merge.
- **Run the tickets in sequence, not in parallel.** The concurrency group per spec does this. It also stops the merges from racing.
- **The alternative: one long `/implement-spec` run.** The whole skill runs in one sandbox, with implementer subagents in their own worktrees. That hits three things:
  - The 10-minute idle cap on background subagents [24].
  - Sandcastle's 600 s idle timeout [3].
  - **Unverified** whether `git worktree add` works with `.git` mounted as it is in the sandbox [7].

  A day of work also fits uneasily in one 6 h job [33]. Per-ticket jobs keep each run short and let a failed ticket be retried alone. When a ticket is retried, the label is removed and re-added; the sibling project removes the trigger label at the start for this reason.

---

## 6. Risks

| # | Risk | Recommendation |
| --- | --- | --- |
| R1 | bwrap fails on the runner (AppArmor userns), or a changed image breaks it [14][18] | Pin `runs-on: ubuntu-24.04` (or 26.04 once tested). Install bubblewrap, load the AppArmor profile, and run the probe as an explicit step that fails fast. Sandcastle never runs unsandboxed when the probe fails [8] |
| R2 | Prompt injection through issue text. Public issue trackers get it: one Sandcastle issue title carries a shell command meant to send the environment out | Trigger only from the `ready-for-agent` label. Check the actor's permission. Feed the agent only collaborator-authored text. Keep tokens out of the sandbox (section 2) |
| R3 | The network is open, so the agent could leak `CLAUDE_CODE_OAUTH_TOKEN` [7] | Accept it: the token only makes model requests [23]. On `spec/<n>`, earlier agents' code runs in the sandbox with the token in its env, when the agent runs it; the sandbox's own `npm ci` of the branch's dependencies runs without it (`scripts/factoryTree.ts`). Rotate it with `claude setup-token` if it leaks, and on a schedule. The code is public anyway |
| R4 | `FACTORY_TOKEN` exposed to agent-written code (hooks, npm scripts, test files) | Set it per step only. Use `persist-credentials: false`. Push with `core.hooksPath=/dev/null`. Never run `npm` with the token in its environment |
| R5 | Runaway self-redispatch, or a loop on a failing ticket | Pass a `hop` counter as a dispatch input and stop at the number of tickets in the spec. Remove the trigger label at the start. Stop on the first blocked ticket |
| R6 | Silent hang: a long test run with no output trips the 600 s idle timeout, or a stuck agent burns the job [3] | Raise `idleTimeoutSeconds` (for example 1200). Set `timeout-minutes` around 90 per ticket. Raise `BASH_DEFAULT_TIMEOUT_MS` [24] |
| R7 | Subscription rate limits stop a spec halfway through [23] | Tickets run one at a time. A blocked or failed ticket leaves `spec/<n>` intact and resumable |
| R8 | Skill expansion over stdin doesn't work (section 3): confirmed by the smoke test (#335) | Pass the prompt as Claude Code's argument (`scripts/factoryAgent.ts`), which the smoke test showed expands |
| R9 | Sandcastle API churn (0.x now, a 1.0 in prerelease) [2] | Pin `@ai-hero/sandcastle@0.14.0` exactly, and keep the factory script small |
| R10 | Merge conflicts between tickets in one spec | `merge-to-head` aborts cleanly [5]. Label the ticket blocked, and let a human or a follow-up ticket resolve it |

---

## Recommendations for the factory spec

1. Pin `runs-on: ubuntu-24.04` (re-test on 26.04). Add a step that installs `bubblewrap`, loads the AppArmor `userns` profile for `/usr/bin/bwrap`, and runs `bwrap --ro-bind / / true`.
2. Pin `@ai-hero/sandcastle@0.14.0`. Run one ticket per job with `run({ agent: claudeCode(model, { env: { CLAUDE_CODE_OAUTH_TOKEN } }), sandbox: bwrap(), branchStrategy: { type: "merge-to-head" }, logging: { type: "stdout" } })`, from a checkout of `spec/<n>`.
3. Prompt with `/implement <n>`, passed as Claude Code's argument by `scripts/factoryAgent.ts`, since it doesn't expand through Sandcastle's stdin prompt (#335). Never use `--bare`.
4. Keep `FACTORY_TOKEN` per step only. Check out with `persist-credentials: false`. Push via a one-off extraheader with hooks off. Give the agent at most a read-only `GITHUB_TOKEN`, or pre-fetch the issue into `promptArgs`.
5. Move every GitHub write out of the skills and into workflow steps: labels, `merged` comments, the draft PR, closing tickets.
6. Gate on the `ready-for-agent` label, plus a collaborator-permission check (`admin` or `write`). Read only OWNER, MEMBER or COLLABORATOR comments. Pass event text through `env:`, never inline in a script.
7. Use concurrency groups per issue and per spec, with `cancel-in-progress: false`.
8. After each ticket, verify on the merged tree: commits exist, the tree is clean, and typecheck, test and `check:migrations` pass in a secret-free step. Only then push `spec/<n>` and comment `merged`.
9. Chain tickets with a `workflow_dispatch` sent with `FACTORY_TOKEN`, carrying a hop counter. Open the `spec/<n>` → `main` PR with `FACTORY_TOKEN` after the first merge. Close tickets explicitly when a spec has more than 10.
10. Set `timeout-minutes` around 90, `idleTimeoutSeconds` 1200, and `BASH_DEFAULT_TIMEOUT_MS`. Return a structured `{ status, summary }` with `Output.object`, but decide from the facts, not the verdict.

---

## Sources

- [0005] [ADR 0005: public repo for a free factory](../adr/0005-public-repo-for-a-free-factory.md)
- [1] Sandcastle README, v0.14.0. https://github.com/mattpocock/sandcastle/blob/v0.14.0/README.md
- [2] npm registry, `@ai-hero/sandcastle` dist-tags. https://www.npmjs.com/package/@ai-hero/sandcastle
- [3] Sandcastle docs, `run()`. https://github.com/mattpocock/sandcastle/blob/v0.14.0/docs/guide/run.md (with `iterations.md` and `hooks.md`)
- [4] Sandcastle docs, Structured output. https://github.com/mattpocock/sandcastle/blob/v0.14.0/docs/guide/structured-output.md
- [5] Sandcastle docs, Branch strategies. https://github.com/mattpocock/sandcastle/blob/v0.14.0/docs/guide/branch-strategies.md
- [6] Sandcastle 0.14.0 source, `claudeCode` command builder (`dist/chunk-H2PEFS4W.js` in the npm tarball); docs `agent-providers.md`
- [7] Sandcastle docs, Sandbox providers (bwrap section). https://github.com/mattpocock/sandcastle/blob/v0.14.0/docs/guide/sandbox-providers.md
- [8] Sandcastle 0.14.0 source, `dist/sandboxes/bwrap.js` in the npm tarball
- [9] Sandcastle's own workflow `.github/workflows/agent-implement.yml`, v0.14.0. https://github.com/mattpocock/sandcastle/blob/v0.14.0/.github/workflows/agent-implement.yml
- [10] Sandcastle's own `.sandcastle/agent-workflows/implement/implement.ts`, v0.14.0. https://github.com/mattpocock/sandcastle/blob/v0.14.0/.sandcastle/agent-workflows/implement/implement.ts
- [11] Sandcastle CI workflow `.github/workflows/ci.yml`, v0.14.0, "Install Bubblewrap" step. https://github.com/mattpocock/sandcastle/blob/v0.14.0/.github/workflows/ci.yml
- [12] actions/runner-images, Ubuntu 24.04 readme. https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md
- [13] actions/runner-images, Ubuntu 26.04 readme. https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2604-Readme.md
- [14] actions/runner-images issue #10443, "unshare: Operation not permitted" on ubuntu-24.04. https://github.com/actions/runner-images/issues/10443
- [15] actions/runner-images PR #11489 (closed). https://github.com/actions/runner-images/pull/11489
- [16] Sandcastle issue #1277 (bwrap in CI, closed 2026-11-01). https://github.com/mattpocock/sandcastle/issues/1277
- [17] GitHub Docs, GitHub-hosted runners (specs, passwordless sudo). https://docs.github.com/en/actions/reference/runners/github-hosted-runners
- [18] actions/runner-images issue #14748, ubuntu-latest moves to 26.04. https://github.com/actions/runner-images/issues/14748
- [19] Sandcastle 0.14.0 source, `resolveEnv` in `dist/index.js` and host git merge in `dist/chunk-G2R53CVZ.js`
- [20] actions/checkout README (`persist-credentials`, v6 credential storage). https://github.com/actions/checkout
- [21] GitHub Docs, GITHUB_TOKEN. https://docs.github.com/en/actions/concepts/security/github_token
- [22] GitHub Docs, Secure use reference (script injection, secrets, least privilege). https://docs.github.com/en/actions/reference/security/secure-use
- [23] Claude Code docs, Authentication. https://code.claude.com/docs/en/authentication
- [24] Claude Code docs, Headless mode. https://code.claude.com/docs/en/headless
- [25] Claude Code docs, Skills. https://code.claude.com/docs/en/skills
- [26] GitHub Docs, Events that trigger workflows (`issues`, `workflow_dispatch`, `pull_request` note). https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
- [27] GitHub Docs, Permission levels for a personal account repository. https://docs.github.com/en/account-and-profile/reference/permission-levels-for-a-personal-account-repository
- [28] GitHub REST, Get repository permissions for a user. https://docs.github.com/en/rest/collaborators/collaborators#get-repository-permissions-for-a-user
- [29] GitHub Docs, Control workflow concurrency. https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency
- [30] GitHub Docs, Managing GitHub Actions settings for a repository (fork approval; "Allow GitHub Actions to create and approve pull requests"). https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository
- [31] GitHub REST, Create a workflow dispatch event. https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event
- [32] GitHub Docs, Workflow syntax (`permissions`, `concurrency`). https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax
- [33] GitHub Docs, Actions limits. https://docs.github.com/en/actions/reference/limits
- [34] GitHub Docs, GitHub Actions billing. https://docs.github.com/en/billing/concepts/product-billing/github-actions
- [35] GitHub Docs, Linking a pull request to an issue. https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue
