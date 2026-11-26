# Review rules

This repo's rules for `/code-review` and for `/implement-spec`'s review loop (its step 7). Both skills come from an outside skills repo, so these rules live here and override them where they differ. Paste the Severity section, in full, into each reviewer sub-agent's prompt: the sub-agents have no other access to it.

## Severity

Every finding, on both axes, carries one severity:

- **high**: wrong behaviour a user or the factory will hit, lost or misread stored data, a one-way door, or a hole an attacker the spec names can use.
- **medium**: a documented standard breached, or a bug on an edge path someone can reach.
- **low**: naming, wording, layout, readability, and defences against an attacker or failure the spec doesn't name.

Judge robustness against the bar the spec or its linked research sets (a threat model, a list of risks). Where it sets none, the bar is honest mistakes, and a defence against a deliberately evasive actor is low.

A finding on code the diff didn't change is **pre-existing**: label it so, and rank it low unless it is high.

The review's closing summary counts findings per axis by severity.

## The review loop

- The fix implementer fixes every high and medium finding. Low findings are **carried**: list them in the PR body under `Left from review`, or in the run's report if there is no PR.
- Each review of a fix branch gets the earlier rounds' findings and the implementer's decisions on them, pasted into both sub-agents' prompts. It reports a finding only where the fix introduced it or left it unfixed. A decision an earlier round settled, fixed or declined with a reason, stays settled; it comes back only at high.
- The loop is done when a round raises no new high or medium finding. After the third review of a fix branch, stop with any still open and report them to the user instead of starting another round.
- Leave `main` out of the integration branch until the loop is done: a `main` merged in mid-loop hands the next round findings the spec never caused.
