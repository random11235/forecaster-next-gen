# Architecture: v1 assumptions

Part of the architecture design; the index is [`architecture.md`](architecture.md).

- **Single team, run locally.** v1 ships two builds of the same app. The local server is a web app started with one command, holding its data in a local SQLite file. The browser build is one self-contained file with no server, shared with testers by sending them the file, holding each viewer's data in their own browser. There is no aggregator and no access control in v1: neither build shares data between people.
- **No risks or added-scope events** are modelled.
- **One reference class per team.** Growth and epic-size samples are pooled per team. The EM expresses how well each epic is understood through its ambiguity level (see [Settings](forecast-model.md#layer-3-settings)), not through separate reference classes.
- **Counts, not story points.** Throughput and scope are measured in tickets.
- **Pace counts comparable work, else the milestone's own.** Once the EM adds a comparable-work query, pace comes from its finished tickets alone, work picked to be like the milestone's; the milestone's own count only if the EM picks the milestone in it. With none, or one matching nothing finished, pace is the milestone's own finished tickets since its start date. KTLO and bugs count only if a query picks them out, so time spent on them shows up as slower pace, which is what the forecast needs.
- **Pace is earned, not assumed.** Nothing from before installation is used automatically. Pace starts as a manual range; see [Pace](forecast-model.md#pace) for when measured pace is offered.
- **Committing an epic is manual.** See [Committing](forecast-model.md#committing).

The data model is designed so that each of these can be relaxed later without re-ingesting data (see [Deferred](architecture-deferred.md)).
