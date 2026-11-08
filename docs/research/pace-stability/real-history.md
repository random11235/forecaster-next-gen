# Pace patterns on real history

Research date: 2026-11-08. Ticket: [Do the pace patterns show up in real history](https://github.com/random11235/forecaster-next-gen/issues/135).

**Question:** run the pace-pattern classifier from [`classify.mjs`](classify.mjs) on the owner's real issue history. Which patterns does it name? How stable is the call as periods are added? What can one person's history show?

**Answer:** it names **Lumpy** most often. It also names One odd week, Steady, Good and bad spells and Speeding up (here, slowing down) at points on the way. Weekly data is too short to say anything. One repo has 3 whole weeks and the classifier answers `thin` (too few periods). The other has 6 whole weeks, just enough, and it says Lumpy. Daily data has enough periods, but the call changes as days are added. For one repo it moved Lumpy, Steady, One odd week, Lumpy, Speeding up, Lumpy over 21 days. That much movement matches the synthetic Lumpy and changing teams, not the synthetic Steady. These counts come from one person working with AI-assisted bursts of tickets. They show the classifier copes with real counts and finds them very bursty. They say nothing about how often each pattern occurs in teams.

Three findings matter for the spec more than the pattern names:

1. **Zero periods before the tracker was used make up a pattern.** The product proposes the 8 most recent whole periods and fills quiet periods with 0. On a repo only 3 weeks old, that is `0,0,0,0,0,0,13,28`, and the classifier calls it **Team change**.
2. **An all-zero window is called Steady.** One repo's last 8 days have no finished tickets, and the classifier says Steady.
3. **Daily calls depend on where the day boundary falls.** Counting days in UTC instead of Melbourne time moved finishes across midnight and changed the call on several prefixes.

## Data and counting

Data came from two local snapshots made by `export.py` (read-only `gh api graphql`). The first is from 2026-11-02. The second was made fresh on 2026-11-08 for this ticket. Each covers two repos: `forecaster-next-gen` and `revision`. Only the per-period counts and classifier outputs below come from them. The snapshots stay outside the repo.

Counting follows [When a ticket counts as finished](https://github.com/random11235/forecaster-next-gen/issues/133#issuecomment-6569772780):

- A ticket is finished when it is closed, for any reason (completed or not planned).
- Leaf tickets only. An issue with sub-issues isn't counted.
- A reopened ticket counts once, in the period of its last close.
- Quiet periods count as 0.

Periods are calendar periods in the owner's time zone (Australia/Melbourne), as the product would read them. Weeks start on Monday. Periods start with the one holding the repo's first issue and end at the export. The period holding the export time is partial. It is reported but left out of every classifier run, as the product leaves out the current period.

The ticket's earlier counts (16, 28, 6 and 7, 5, 30, 7, 2) included parent issues and used different week boundaries. The leaf-only counts below are lower.

[`real-history.mjs`](real-history.mjs) does the counting. It takes the snapshot file as an argument and prints only aggregates. It reads the classifier straight from `classify.mjs` so the rules can't drift, and it changes neither `classify.mjs` nor `lib.mjs`.

```
node real-history.mjs <snapshot>/random11235__forecaster-next-gen.json [--tz Area/City]
node real-history.mjs --synthetic     # the synthetic baseline below; seeded, reads no snapshot
```

### Periods per repo (snapshot of 2026-11-08)

| Repo | Cadence | Whole periods | Counts per whole period | Partial period at the end |
|---|---|---|---|---|
| forecaster-next-gen | weekly | 3 (from the week of 2026-10-12) | 0, 13, 28 | 30 (week not over at export) |
| forecaster-next-gen | daily | 21 (from 2026-10-18) | 0,0,3,1,1,5,2,1,3,2,3,1,16,0,3,18,2,5,1,1,2 | 1 |
| forecaster-next-gen | weekdays only | 14 | 0,3,1,1,5,3,2,3,1,16,18,2,5,1 | 1; 9 of 71 finishes fell on a weekend and are dropped |
| revision | weekly | 6 (from the week of 2026-09-21) | 7, 5, 27, 7, 2, 0 | 9 |
| revision | daily | 43 (from 2026-09-26) | 1,6,4,0,0,0,0,0,1,3,0,9,0,8,7,0,0,0,0,3,0,1,3,0,1,0,0,0,1, then 13 zeros, then 9 | 0 |
| revision | weekdays only | 29 | 4,0,0,0,0,3,0,9,0,8,0,0,0,3,0,0,1, then 12 zeros | 0; 29 of 57 finishes fell on a weekend and are dropped |

Both repos' first week is partial at the start. forecaster-next-gen's first issue came on the Sunday that ends its first week, so that week's 0 is one day of history, not a quiet week. revision's last whole week is a real quiet week (0).

The 2026-11-02 snapshot gives the same counts for every period both snapshots cover as whole. No reopen moved a past count. Its partial weeks were 6 (forecaster-next-gen) and 0 (revision; the export fell on a Monday).

## What the classifier names

The classifier needs 6 periods. Below that it returns `thin` whatever the counts, which is the "No pattern yet" case. Its labels map to the team types in the [README](README.md): `steady` Steady, `lumpy` Lumpy, `trending` Speeding up, `step` Team change, `regimes` Good and bad spells, `outlier` One odd week. `trending` and `step` don't know which way pace moved. Here they fire on slowing down.

### Weekly

| Repo | Whole weeks | Call on each growing prefix |
|---|---|---|
| forecaster-next-gen | 3 | thin, thin, thin |
| revision | 6 | thin ×5, then **lumpy** at 6 (variance/mean 11.8) |

The weekly call can't be checked for stability. revision gets one call, at the first prefix long enough to have one. Laid out the way the product would, as the 8 most recent whole weeks with quiet weeks as 0:

| Repo | 8 most recent whole weeks | Call |
|---|---|---|
| forecaster-next-gen | 0,0,0,0,0,0,13,28 (five weeks before the repo existed) | **step** |
| revision | 0,0,7,5,27,7,2,0 (two weeks before the repo existed) | lumpy |

The forecaster-next-gen "Team change" is made up by the zero padding. It is the tracker starting, not pace changing.

### Daily, weekends kept

Prefixes 1–5 are `thin` throughout.

| Repo | Days | Call as days are added (prefix length: call) |
|---|---|---|
| forecaster-next-gen | 21 | 6 lumpy · 7–12 steady · 13–15 outlier · 16–17 lumpy · 18 trending · 19–21 lumpy |
| revision | 43 | 6 lumpy · 7–10 regimes · 11–35 lumpy · 36–43 trending |

The signals behind the calls (variance/mean ratio, Mann–Kendall p, lag-1):

- **forecaster-next-gen.** Steady holds for days 7–12 while every day is 0–5. The first 16-ticket day (day 13) makes it One odd week. The second 18-ticket day (day 16) turns it into Lumpy, with variance/mean around 7. On day 18 Mann–Kendall p dips to 0.04 for that one prefix and the call is Speeding up. Then it goes back to Lumpy.
- **revision.** Good and bad spells (lag-1 0.33–0.39) holds while the history is one busy run followed by a quiet run. It becomes Lumpy (variance/mean about 4.5) and stays Lumpy for 25 days. Then the long run of zero days at the end pushes Mann–Kendall below 0.05 on day 36: Speeding up, which here means slowing to a stop. A 9-ticket day at the very end doesn't undo it.

The product would use the 8 most recent days at a daily cadence:

| Repo | Last 8 whole days | Call |
|---|---|---|
| forecaster-next-gen | 0,3,18,2,5,1,1,2 | outlier |
| revision | 0,0,0,0,0,0,0,9 | outlier |
| revision, on the 2026-11-02 snapshot | 0,0,0,0,0,0,0,0 | **steady** |

The classifier calls a window with no finished tickets Steady. Its lumpy test guards against a zero mean but nothing returns "no pace".

### Daily, weekends dropped

| Repo | Weekdays | Call as days are added |
|---|---|---|
| forecaster-next-gen | 14 | 6–9 steady · 10 outlier · 11 regimes · 12–14 lumpy |
| revision | 29 | 6–29 lumpy |

Dropping weekends throws away 13% of forecaster-next-gen's finishes and 51% of revision's. For revision the weekend days are where much of the work is, so dropping them leaves a different history, not a cleaner one. The call does get steadier: revision is Lumpy from day 6 to day 29, and it loses the "trending" call because the closing 9-ticket day is a Saturday.

### Day boundary

Rerun with days counted in UTC (`--tz UTC`), the weekly counts barely change (forecaster-next-gen 0, 15, 26). The daily calls do. forecaster-next-gen's run of Steady at days 7–12 becomes One odd week from day 7. A busy evening in Melbourne is the next morning in UTC, so a day's count moves to its neighbour.

## Against the synthetic results

The README's synthetic results classify a history of exactly 10 or 20 weeks. To see how the call moves as periods are added, `real-history.mjs --synthetic` makes 400 histories of 20 periods per team type (seed 20261108). It classifies every prefix from 6 to 20 periods.

| Team type | Named correctly at 6 / 8 / 10 / 20 periods | Changes of call, 6→20 | Same call from 8 to 20 |
|---|---|---|---|
| Steady (mean 6) | 87 / 87 / 89 / 91% | 1.0 | 69% |
| Steady, mean 2 | 87 / 89 / 89 / 88% | 1.2 | 65% |
| Steady, mean 1 | 86 / 89 / 88 / 89% | 1.0 | 68% |
| Lumpy | 62 / 68 / 73 / 89% | 1.8 | 48% |
| One odd week | 29 / 39 / 49 / 99% | 1.2 | 39% |
| Good and bad spells | 11 / 12 / 16 / 24% | 3.3 | 15% |
| Speeding up | 4 / 6 / 11 / 65% | 3.3 | 8% |
| Team change | 2 / 2 / 2 / 35% | 2.9 | 4% |
| Steady weekday team, daily, weekends kept as 0 (mean 2) | 79 / 59 / 70 / 71% | 2.3 | 38% |

A short prefix of a 20-period Speeding up, Team change or One odd week history often hasn't reached the change yet. Team change steps up at period 10, so its 6–10 period prefixes are steady and are called Steady (85–87%). That is the realistic case: a pattern appears partway through and the call has to catch up.

Read against that:

- **Low counts don't by themselves look lumpy.** A steady team averaging 1–2 a period is still called Steady about 88% of the time. So the real daily Lumpy calls (variance/mean 4–8 against about 1 for Poisson) mean real bunching. They aren't an artefact of small numbers.
- **The real calls move like the synthetic changing types, not like Steady.** forecaster-next-gen changed its daily call 5 times in 16 prefixes; revision 3 times in 38. Synthetic Steady changes about once in 15. Synthetic Lumpy changes 1.8 times, and the changing types about 3 times.
- **Weekends kept turn a steady weekday team's daily call unstable.** Weekend zeros add bunching and runs. Its Steady call falls to 59–71%, mostly to Good and bad spells and Lumpy. Real teams that don't work weekends would see the same at a daily cadence.
- **The real histories are much burstier than synthetic Lumpy.** revision's weekly variance/mean is 11.8. The synthetic Lumpy (CV ≈ 1 at mean 6) has a ratio of about 6. Single days of 16 and 18 finished tickets come from closing many small sub-issues in one session.

## What the real data can and can't show

**Can show:**

- The classifier runs on real counts, and the counting rules from #133 produce sensible period series from a snapshot.
- Real counts can be far burstier than any synthetic type, and Lumpy is the stable long-run call for both repos.
- The traps in the product's rules, all real and not hypothetical: zero periods before the tracker existed, an all-zero window, the day boundary, and weekends.
- With few periods the call moves a lot. At the 6–8 periods the product would actually have, a named pattern is often not the one a longer history gives.

**Can't show:**

- How often each pattern occurs in teams. This is one person, two repos and 3–6 weeks. There is no Team change, no Good and bad spells over weeks, and no team at all.
- Whether a named pattern predicts forecast error. There is no held-out future long enough to forecast against.
- Weekly stability. One weekly call exists in total (revision, Lumpy, at exactly 6 weeks).
- Whether the patterns mean the same thing for a team. Here issues are created in bursts by an AI-assisted workflow: a grill splits into many sub-issues at once, and they are closed in batches in a session. 75 of 89 issues in forecaster-next-gen and 75 of 85 in revision have a parent. "Lumpy" here is session-level batching and ticket granularity, not release batches or blocked work. The revision "slowing" is one person moving their attention to the other repo, not a team change. The classifier's rules can't tell these causes apart, so wording that explains a pattern ("batch releases") could be wrong for a user like this.

## What this means for the spec

1. **Minimum periods.** The classifier gives no pattern below 6 periods, and the synthetic runs show calls stay unreliable up to 10 for every type except Steady. With the product's 8-period window, a pattern would be suggested from 6 whole periods, when synthetic Lumpy is named right 62% of the time, and a Steady team's call still changes about once as periods are added. The README's 10-week runs name a changing team right only about 40% of the time. Either show patterns only from more history than the 8-period proposal window, or word every pattern below about 10–12 periods as tentative. "No pattern yet" should cover fewer than 6 whole periods at the least.
2. **Don't count periods before the first ticket.** Leading quiet periods from before the tracker had any work should be left out of the pattern call, and probably out of the proposal too, rather than proposed as 0. Otherwise a new project shows "Team change". This touches #133's "quiet periods are proposed as 0".
3. **An all-zero window is not Steady.** It needs its own message, such as "no tickets finished in these periods", not a pattern.
4. **Daily cadence needs the team's time zone, and a weekend rule.** Day boundaries move counts and calls. Keeping weekends makes a weekday team look lumpy or spelled. Dropping them discards real work for anyone who works weekends (half of revision's finishes). If a 1-day cadence is offered, the EM should pick working days. For the pattern call, 5-day or 7-day periods are safer.
5. **"Pace changing" has no direction.** `trending` and `step` fired here on slowing down. Wording like "Speeding up" would be wrong, so keep the neutral "pace changing" from the README's implication 4.
6. **Pattern explanations should be hedged.** The same Lumpy shape comes from batch releases in a team and from AI-assisted batch closing for one person. Advice tied to one cause shouldn't be stated as fact.
