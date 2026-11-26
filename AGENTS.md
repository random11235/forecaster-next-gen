## Agent skills

- **Issues, specs and tickets** (GitHub): `docs/agents/issue-tracker.md`. Before starting, pausing or splitting a ticket, follow its Ticket lifecycle.
- **Triage labels**: `docs/agents/triage-labels.md`.
- **Domain terms, glossary and ADRs**: before exploring, or when naming a domain concept, read `docs/agents/domain.md`.
- **Coding standards**: `CODING_STANDARDS.md`, when writing or reviewing code.
- **Code review**: when running `/code-review`, or `/implement-spec`'s review loop, follow `docs/agents/review.md`. Its rules override both skills'.
- **Module layout**: `src/README.md`. Import a module only through its root files; `npm run lint:boundaries` checks it.
- **Production code**: test-first via `/tdd`, at the seams in `docs/design/architecture-test-seams.md`.
- **Demos**: a ticket with a visible change ships screenshots in its PR. When writing, building or reviewing one, follow `docs/agents/demos.md`.
- **Browser**: to check a change in the running app, or reproduce a reported UI bug, follow `docs/agents/browser.md`.
- **PR bodies**: when writing or updating one, follow `docs/agents/pull-requests.md` with `/pr`.
- **Path to production**: when a PR merges, follow "After a PR merges" in `docs/agents/pull-requests.md`: update `main` locally. CI's green run on `main` releases the merge and restarts the local app.
- **Design and v1 scope**: `docs/design/README.md`, the index of the design docs.
- **Research** (`docs/research/`): background behind design decisions. Cite it by link at the line it informs; read it only when such a link bears on your task.
