# Contributing

Issues and comments are welcome: bug reports, questions and ideas. Only the owner or a collaborator moves an issue on, as [ADR 0005](docs/adr/) sets out.

Collaborators: an issue you send from the app's Send feedback arrives labelled `needs-triage`, which starts the factory's triage. Triage labels it `ready-for-agent` and starts the build when the change is clear, or `ready-for-human` or `needs-info` when it needs a person. Until factory triage is live (#359), label a clear issue `ready-for-agent` yourself. Either way, leave the issue open: the PR closes it when it merges.

Collaborators can also ask about an issue or a PR in a comment that mentions `@claude`, such as "@claude is this finished?": the factory answers in a reply there, from the issue, its PRs and their checks, and the repo. A question builds nothing and changes nothing; building stays with the `ready-for-agent` label. A mention from anyone else gets no reply.

Pull requests from outside aren't accepted. The code is all rights reserved (see [LICENSE](LICENSE)), and taking in someone else's code would need a contributor agreement this project doesn't have. If you'd like a change, open an issue describing it instead.
