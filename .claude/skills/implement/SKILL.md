---
name: implement
description: "Implement a piece of work based on a spec or set of tickets."
disable-model-invocation: true
---

Implement the work described by the user in the spec or tickets.

If the user passes a ticket reference, fetch it from the issue tracker and state its title before starting. If the reference is ambiguous, ask.

If your arguments hold the ticket in a `<ticket>` block, the factory is running you (`.github/workflows/factory.yml`), and nobody is there to answer. Then:

- Build from that block, and make no call to GitHub at all, read or write: no `gh`, no labels or comments, no issues or PRs, no push. The factory has no token for you and does those itself.
- Give `code-review` that block as the ticket to review against.
- Where you would ask, choose the reading of the ticket that changes least, and say so in your commit message.

Call the Skill tool with "tdd" where possible, at pre-agreed seams.

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

Once done, call the Skill tool with "code-review" to review the work.

Commit your work to the current branch.
