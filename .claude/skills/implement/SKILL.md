---
name: implement
description: "Implement a piece of work based on a spec or set of tickets."
disable-model-invocation: true
---

Implement the work described by the user in the spec or tickets.

If your arguments hold the ticket in a `<ticket>` block, the factory is running you (`.github/workflows/factory.yml`), and nobody is there to answer. Then, in place of what this skill says below about fetching and asking:

- Build from that block, and make no call to GitHub at all, read or write: no `gh`, no labels or comments, no issues or PRs, no push. The factory has no token for you and does those itself.
- A `<spec>` block after it holds the spec the ticket is part of, for context: build only the ticket. Your commits are merged into the spec's branch, where earlier tickets' code already is.
- Give `code-review` that block as the ticket to review against.
- Where you would ask, choose the reading of the ticket that changes least, and say so in your commit message.
- If you change the app, add its change file, `changes/<ticket>.md`, as `docs/agents/pull-requests.md` says under Version: the factory runs `npm run check`, which fails without it.
- Commit everything you change: the factory doesn't open a PR from a tree left dirty.
- End your reply with the PR's body, written with the `pr` skill, in a `<pr-body>` block. The factory opens the PR with it and adds the line closing the ticket itself.

If the user passes a ticket reference, fetch it from the issue tracker and state its title before starting. If the reference is ambiguous, ask.

Call the Skill tool with "tdd" where possible, at pre-agreed seams.

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

Once done, call the Skill tool with "code-review" to review the work.

Commit your work to the current branch.
