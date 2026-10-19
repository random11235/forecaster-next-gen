## Agent skills

### Issue tracker

GitHub Issues on random11235/forecaster-next-gen, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Testing

Production code is written test-first through the agreed seams (`/tdd`), one red-green slice at a time.

### Ticket lifecycle (cycle time)

We measure ticket cycle time: from the `in-progress` label being added to the issue being closed.

- Before writing any code for a ticket, run `gh issue edit <n> --add-label in-progress`. With `/implement-spec`, label each ticket when its implementer starts, not when the run starts.
- If work on a ticket stops without finishing, remove the label.
- Issues labelled `epic` only group child tickets. Never work on, label or close an epic directly.
- Non-epic tickets should be roughly the same size. When splitting work, aim for similar cycle times.

### Triage labels

The default five labels: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
