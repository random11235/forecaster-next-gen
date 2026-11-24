---
status: accepted
---

# The repo is public, so the software factory runs free on GitHub's runners

The software factory runs its agents in GitHub Actions: a label on an issue starts a workflow, and the issues hold its state between runs. GitHub-hosted runners are free and unmetered on a public repo and billed by the minute on a private one, so the repo is public and the factory runs on `ubuntu-latest`, each agent in sandcastle's `bwrap()` sandbox. The cost: everything in the repo can be read by anyone, its whole history included, and making it private again doesn't take back what was cloned or forked while it was public.

## Considered Options

- **Private, on GitHub-hosted runners.** Rejected: about $0.35 a ticket in minutes, on top of CI, which already uses more than a Pro plan's monthly allowance.
- **Private, on the self-hosted Mac runner, each agent in sandcastle's `seatbelt()`.** Rejected: free, but the Mac sleeps and jobs wait until it wakes. Seatbelt doesn't promise to keep the agent away from the Keychain, and it leaves `localhost` open, where the local app runs with real data.
- **Private, on a VPS as a self-hosted runner.** Rejected: Oracle's free Arm VMs are often out of capacity and their allowance was cut in 2026; Hetzner's cost about €5 a month and leave a server to maintain.
- **Private, on E2B or Daytona.** Rejected: they only sandbox the agent, so a runner still has to start each run, and their free credit is a one-time grant.

## Consequences

- A fork's pull request could otherwise run its own workflow on the Mac runner, so fork PR workflows need approval for every outside contributor, and the Mac runner serves `restart-local` only.
- The author email on the commits made before the repo went public stays in its history. Commits since use GitHub's no-reply address.
- Issues, PRs, their comments and Actions logs are public, and anyone can open an issue or comment. The agent reads only issues opened, and comments written, by the owner or a collaborator.
