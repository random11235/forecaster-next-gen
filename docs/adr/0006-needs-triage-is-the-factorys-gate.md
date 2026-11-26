---
status: accepted
---

# `needs-triage` is the factory's gate, so an agent can triage and start a build

ADR-0005 made `ready-for-agent` the gate: only the owner or a collaborator could add it, after triaging by hand. Feedback sent from the app, and every other issue, should reach a build without that hand step when its change is clear, so a sandboxed triage agent now decides `ready-for-agent` and starts the build itself. The gate moves one step earlier, to `needs-triage`: the triage stage starts only when that label is added, and on this repo only someone with triage permission or above can add it. A collaborator's Feedback carries it from the app's prefilled link, because GitHub applies a link's `labels` only for people allowed to label; an outsider's issue arrives without it and reaches no agent until a collaborator vouches for it by adding the label.

## Considered Options

- **Keep `ready-for-agent` as the only gate, added by hand.** Rejected: every issue waits for the owner, so the factory still stops when they do.
- **Triage everything on the public repo.** Rejected: any stranger could spend runner minutes and model usage, and put text in front of an agent unvouched.
- **An issue template that labels `needs-triage`.** Rejected: a template's labels are applied for everyone, which would open the gate to outsiders.

## Consequences

- Replaces ADR-0005's last consequence: an agent, not only the owner or a collaborator, adds `ready-for-agent`, and dispatches the build with `workflow_dispatch`, since a label added with `GITHUB_TOKEN` starts no workflow. The build trusts the triage bot's brief as it trusts its `merged` comment.
- The triage agent holds no token and returns a plan in a closed format; a separate job checks it whole and writes it. It may close only duplicates and already-implemented issues. Anything touching design, the forecast's maths, security, storage or the ledger, anything that conflicts with an open ticket, ADR or design doc, and any rejection goes to `ready-for-human`.
- No human sees an agent-triaged change until its PR. Merging stays the human check.
- A collaborator who adds `needs-triage` to an outsider's issue vouches for its text.
