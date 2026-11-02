# What actions fit each pace pattern

Research date: 2026-11-02. Ticket: "What actions fit each pace pattern" (#128), under the map "Connected forecasting" (#124).

**Question:** For each pace pattern in [`pace-stability/`](pace-stability/README.md) (steady, lumpy, speeding up, team change, good and bad spells, one odd week), what do primary sources recommend an EM do, both to the forecast and to the team's work? Which of those actions could the tool suggest from tracker data alone, and which need the EM's judgement?

**Answer:** The sources agree on one rule that sorts every pattern: **first tell signal from noise, then act on the forecast only for signals, and only once the cause is known** [W1][V1][F1]. Applied per pattern:

| Pattern | Action on the forecast | Action on the team's work | Tool alone, or EM? |
|---|---|---|---|
| Steady | None. Keep forecasting from all recent periods; re-run as periods arrive | None for predictability. To go faster, change the system (WIP, focus), not chase single weeks [W1] | Tool: say "no pattern detected yet" and nothing else |
| Lumpy | Keep every period, zeros included; accept the wide range; use a longer window | Release smaller and more often; limit WIP, finish before starting; right-size items [K1][P2][M3] | Tool can name it and show the range. The cause (release batching vs big items) is the EM's |
| Speeding up | Don't extrapolate the trend. Forecast from the recent periods only, or keep the range and warn [F3][P1] | Ask whether it will last: new people, easier work, a cleared blocker, overdrive? [M3] | Tool can flag "pace changing" and propose a shorter window. Whether it lasts is the EM's |
| Team change | Restart the window at the change; until 4 periods exist, scale the old pace or widen [P1][A1] | Plan for ramp-up; record the change date | Tool can propose the change date (a step, or assignees joining or leaving). The date and the scale factor are the EM's |
| Good and bad spells | Widen the range: plain resampling treats each week as independent and is too narrow when weeks cluster [F2] | Find what drives the bad spells (interruptions, unplanned work, dependencies) and remove it [W1][V2] | Tool can warn on runs. Naming the cause, and whether the next spell is good or bad, is the EM's |
| One odd week | Find out why first. Exclude it only if it was an error or won't recur (bulk close, data clean-up); keep it if it was real delivery [F1] | Usually none. If real (a batch release), see Lumpy | Tool can name the week and often spot a bulk close. Excluding it is the EM's call |

So the tool can **detect and propose** for every pattern, but it should never **apply** a change to the forecast on its own: each forecast action rests on a cause that tracker data hints at but doesn't establish. This matches architecture principle 5 (measured data suggests, the EM decides).

Citation convention: bracketed codes refer to **Sources** at the end. **Synthesis** marks my own reasoning from the evidence. Where I read only a chapter title, not the text, the text says so.

---

## What the sources say across all patterns

1. **Monte Carlo assumes the future looks like the sampled past.** So the main lever on the forecast is *which periods to sample*. ActionableAgile lets the user narrow the throughput basis to a date range, for when "some of your data was generated in conditions unlike that for which your future work will be completed in" [A1]. ProKanban: use the last 8–12 weeks; "Less than six and the sample is jittery", and "more than twenty-six and you risk forecasting your old team's pace instead of your current one" [P1].
2. **Re-baseline after a change.** "If your team changed composition or process recently, restart the window." After a team size change, "Use throughput data from after the change once you have at least four weeks of it" [P1].
3. **Scale for known capacity changes.** ActionableAgile's "Scale throughput by" field accounts "for both an increase and decrease in throughput output", e.g. 0.5 for half capacity [A1]. Magennis's Throughput Forecaster has a "Team focus on THIS work" adjustment [M1]. (Nave has a similar Scale Factor, [forecasting-approaches.md](forecasting-approaches.md) source 44.)
4. **Separate signal from noise before acting.** Wheeler: "when your process is predictable, it will be a waste of time to look for assignable causes of excessive variation", and "the only way to improve it will be to change it in some fundamental manner"; when it is unpredictable, look for the assignable causes [W1]. Vacanti's *Actionable Agile Metrics Volume II* brings this to flow metrics, with chapters on XmR charts for throughput, detecting signals, "When to Update Limits", "The Trend is Not Your Friend", and "Three Types of Action" [V1] (I read the table of contents, not the chapters).
5. **Detection rules for signals.** A point outside the natural process limits (a large change); 2 of 3 beyond 2-sigma; 4 of 5 beyond 1-sigma; "A run of at least 8 successive values within the process limits on the same side of the average line" (small, sustained shifts) [V2][N1]. NIST adds "6 in a row trending up or down" [N1]. Adding the run rules raises false alarms from about 1 in 371 points to about 1 in 92 [N1].
6. **Don't drop outliers without a reason.** "Simply replacing outliers without thinking about why they have occurred is a dangerous practice", because they "may provide useful information about the process". Replacing them is fine "if we are willing to assume that the outliers are genuinely errors, or that they won't occur in the forecasting period" [F1].
7. **Autocorrelated data needs block resampling.** When observations may be autocorrelated, "we cannot simply use the re-draw procedure"; a "blocked bootstrap" draws "contiguous sections of the time series" instead [F2].
8. **Don't extrapolate trends far.** Higher-order trends "extrapolated" give forecasts that "are often unrealistic"; picking where a trend bends is "somewhat arbitrary" and "can lead to over-fitting" [F3].
9. **Predictability is a property of the system, improved by managing flow.** The Kanban Guide: controlling WIP "helps flow and often improves the Kanban system members' collective focus", and the team should "continuously improve their workflow to achieve a better balance of effectiveness, efficiency, and predictability" [K1]. Vacanti's SLE chapter: when an item ages past the 50th or 70th percentile, ask "Do we need to swarm on it? Do we need to break it up? Do we need to escalate the removal of a blocker?" [P2].

What the tool already does, for context: the forecast resamples periods with the Bayesian bootstrap ([ADR-0001](../adr/0001-bayesian-bootstrap-pace-sampler.md)), which widens short-history ranges but "doesn't fix forecasts for teams whose pace is changing". The pace-stability research found the trend-or-runs test is the only signal more likely to fire before a miss, and that naming "pace changing" works for about 40% of cases from 10 weeks and 70% from 20, spells only 20–27% ([pace-stability](pace-stability/README.md#naming-the-pattern)).

---

## Per pattern

### Steady

*Poisson around a stable mean. Pace-stability miss rate 25% at 10 weeks, mostly from short history.*

- **Forecast:** nothing to change. Use the recent window [P1], keep re-forecasting as periods arrive. The range is still too narrow from short history ([ADR-0001](../adr/0001-bayesian-bootstrap-pace-sampler.md)); more periods are the only fix (12% miss at 80 weeks vs 28% at 10, [pace-stability](pace-stability/README.md#short-history-makes-every-range-too-narrow)).
- **Team's work:** a predictable process is the goal state [K1]. Hunting for the cause of a single slow week is "a waste of time" [W1]. To deliver faster, change the system: WIP, focus, item size [W1][K1].
- **Tool or EM:** the tool alone. **Synthesis:** from short history, say "no pattern detected yet", not "steady", since about 40% of changing teams look steady at 10 weeks ([pace-stability](pace-stability/README.md#naming-the-pattern)).

### Lumpy

*Same mean, high variance, zero weeks: batch releases or a few big items.*

- **Forecast:** keep all periods, zeros included; the zeros are real pace, and the wide range is honest (the Bayesian bootstrap's wider lumpy ranges cut misses from 38% to 25%, [pace-stability](pace-stability/README.md#short-history-makes-every-range-too-narrow)). Use a longer window rather than a shorter one, since "Less than six and the sample is jittery" [P1]. **Synthesis:** a longer cadence (a 14-day period instead of 7) smooths batch effects without dropping data; the milestone's cadence already allows this.
- **Team's work:** Magennis's dashboard asks "How consistent is our completion pace?" with the goal "Complete something in preference to starting" [M3]. Limit WIP [K1]. Break up items that age past their SLE percentile [P2]. If the lumps are release batches, closing tickets when they are done (not at release) changes the measurement, not the delivery. **Synthesis.**
- **Tool or EM:** the tool can name lumpy (74% at 10 weeks, 89% at 20) and show the RSE as information ([pace-stability](pace-stability/README.md#implications)). From tracker data it can also see whether the lumps are many tickets closed on one day (release or bulk-close batching) or a few long-running tickets (big items), using each ticket's close time and age. **Synthesis.** Which one it is, and whether to change it, is the EM's.

### Speeding up

*A trend: pace rising over the history. Miss rate 78%; the forecast is too late, P50 about 3 weeks after the actual.*

- **Forecast:** don't fit and extrapolate the trend [F3]; Vacanti titles a chapter "The Trend is Not Your Friend" [V1] (text not read). Instead choose the periods that reflect the future [A1]: if the rise has levelled off, forecast from the recent periods only. Too long a window forecasts "your old team's pace" [P1]. **Synthesis:** a shorter window means fewer periods, so the range should still widen (ADR-0001 does this); if the EM can't say whether the rise will hold, keep all periods and show the warning.
- **Team's work:** ask why. Magennis's dashboard: "Sustainability – How Likely Are These Trends to Continue", "Is the team working at a sustainable pace, or are they exhausted?", "Watch quality & predictability if you overdrive!" [M3]. A rise from easier work, a cleared blocker or new people is likely to hold; one from overtime or skipped quality isn't.
- **Tool or EM:** the tool can flag "pace changing" with the trend-or-runs test and propose a window starting where the rise levelled. **Synthesis:** whether the rise will last is a judgement about people and work that the tracker doesn't record, so the EM decides. Speeding up and team change are hard to tell apart from 10 weeks, so present them as one "pace changing" suggestion ([pace-stability](pace-stability/README.md#implications)).

### Team change

*A step: pace jumps (or drops) at one point, e.g. someone joins or leaves. Miss rate 57%.*

- **Forecast:** restart the window at the change; once 4 periods exist after it, forecast from those [P1]. Before that, scale the old pace by the expected change [A1][M1] or widen the range and "commit the band, not the point" [P1]. For a known future change (someone leaving next month), scale only the affected periods. **Synthesis:** none of the sources gives a validated model of how pace scales with headcount ([forecasting-approaches.md](forecasting-approaches.md), Executive summary item 3), so the scale factor is an explicit EM assumption.
- **Team's work:** expect a ramp-up for new members; Magennis's dashboard asks "Are you about to take on challenges that are new to this team and will take time to learn?" [M3].
- **Tool or EM:** the tool can propose a change date two ways from tracker data alone: a sustained shift in pace (the run-of-8 rule [V2][N1], or a change-point fit), and a change in who closes tickets (GitHub issues carry `assignees` [G1]). **Synthesis:** the assignee signal is cheaper and earlier than a pace shift, which needs several periods to confirm. The EM confirms the date (people move between teams for reasons the tracker can't see) and owns any scale factor.

### Good and bad spells

*Regimes: runs of fast weeks and slow weeks (positive autocorrelation). Miss rate 54%.*

- **Forecast:** plain and Bayesian bootstrap resample weeks independently, which is wrong when weeks cluster [F2]; the range comes out too narrow. Options: widen (a blocked bootstrap that resamples runs of consecutive periods [F2]), or warn. **Synthesis:** a blocked sampler would be an engine change and needs its own back-test (Ledger) before replacing ADR-0001; for connected forecasting, the warning plus the ADR-0001 width is the practical step. Don't shorten the window to "the current spell": the next spell may differ.
- **Team's work:** this is the unpredictable case where Wheeler's advice applies directly: find and remove the assignable causes [W1], investigating "each out-of-limits point in search of a cause" [V2]. Typical causes in software (**Synthesis**, not from a source): on-call or support rotations, unplanned work, waiting on another team, holidays.
- **Tool or EM:** the tool can warn on runs (lag-1 autocorrelation, the runs rule). It can't reliably name the pattern (20–27% correct, [pace-stability](pace-stability/README.md#naming-the-pattern)), so the wording should be neutral: "pace comes in runs; treat the range with care". **Synthesis:** from tracker data it could show the share of unplanned work (by label or type) in slow periods as a hint. The cause, and whether a bad spell is starting, are the EM's.

### One odd week

*One period far outside the rest (here, 30 against a mean of 6). Miss rate 26%; the forecast is too early.*

- **Forecast:** find out why before touching it. Exclude it only if it is "genuinely" an error or "won't occur in the forecasting period" [F1]: a backlog clean-up closing stale tickets, a migration, a mis-mapped status. Keep it if it was real delivery, e.g. a release that closed a batch (then the team is lumpy, not odd). A point outside the limits is the strongest signal [V2][N1], but a signal means "investigate", not "delete" [V2][W1].
- **Team's work:** usually none. If it was a bulk close of work that wasn't done, the fix is in how tickets are closed. **Synthesis.**
- **Tool or EM:** the tool can name the week (leave-one-out influence; 96% correct at 10 weeks, [pace-stability](pace-stability/README.md#naming-the-pattern)) and show its effect on the forecast. From tracker data it can often say more: GitHub records why an issue closed (`state_reason`: `completed`, `not_planned`, `duplicate`) [G1], so tickets closed as not planned shouldn't count as pace at all, and many tickets closed within minutes is a likely clean-up. **Synthesis.** Excluding the week remains the EM's call; the tool proposes, shows the forecast both ways, and marks the exclusion as the EM's edit.

---

## Which actions the tool could suggest from tracker data alone

**Synthesis** from the sections above.

| Action | Patterns | From tracker data alone? |
|---|---|---|
| Name the pattern, show the signal | All | Yes: steady ("no pattern yet"), lumpy, odd week reliably; "pace changing" fairly; spells only as a runs warning |
| Widen the range / warn | Spells, pace changing, short history | Yes: already done by ADR-0001; warning wording is fixed |
| Propose a window start (drop older periods) | Team change, speeding up | Proposes a date from a pace shift or assignee change; the EM confirms the date |
| Exclude a period | Odd week | Proposes the week, with hints (not planned, bulk close); the EM decides |
| Count only completed closes | Odd week, lumpy | Yes, as a data rule: `not_planned` and `duplicate` closes aren't pace [G1] |
| Scale pace for capacity | Team change (known future change) | No: the EM states the change and the factor |
| Lengthen cadence | Lumpy | Can suggest; the EM decides how the team counts periods |
| Change the team's work (WIP, slicing, release more often, remove causes of bad spells) | Lumpy, spells, speeding up | No: the tool can show the evidence (ages, batch closes, unplanned share), the action is the EM's |

## Implications for connected forecasting

**Synthesis.**

1. Each pattern suggestion should carry **one forecast action the EM can apply with a click** (start the window at a date, exclude a week) and show the forecast both ways. The applied action is stored as the EM's edit, like any measured value overridden by hand.
2. Team's-work actions are **questions, not instructions**: the tool shows the evidence the sources point to (ticket ages, same-day batch closes, assignee changes) and asks the EM; it doesn't prescribe.
3. Tracker data adds two cheap cause hints that typed counts can't: **close reason** (odd week, lumpy) and **who closes tickets** (team change). Both are worth carrying into the connector shape.
4. A blocked or regime-aware sampler for spells is out of scope until the Ledger can back-test it; ADR-0001's width and the runs warning stand.
5. The glossary has no term yet for a pace pattern or a pace-pattern suggestion; a grilling ticket should name them.

---

## Sources

- [A1] 55 Degrees. ActionableAgile docs, "Monte Carlo: How Many" (throughput basis date range, "Scale throughput by"). https://55degrees.atlassian.net/wiki/spaces/ActionableAgile/pages/2407399482/Monte+Carlo+How+Many
- [F1] Hyndman, R. J. & Athanasopoulos, G. *Forecasting: Principles and Practice*, 3rd ed., §13.9 "Dealing with outliers and missing values". https://otexts.com/fpp3/missing-outliers.html
- [F2] Hyndman & Athanasopoulos, *FPP3*, §12.5 "Bootstrapping and bagging" (blocked bootstrap for autocorrelated series). https://otexts.com/fpp3/bootstrap.html
- [F3] Hyndman & Athanasopoulos, *FPP3*, §7.7 "Nonlinear regression" (piecewise trends, knots, extrapolating trends). https://otexts.com/fpp3/nonlinear-regression.html
- [G1] GitHub Docs. "REST API endpoints for issues" (`state_reason`, `closed_at`, `assignees`). https://docs.github.com/en/rest/issues/issues
- [K1] Vacanti, D. & Coleman, J. *The Kanban Guide* (May 2025): controlling WIP, throughput, predictability. https://kanbanguides.org/english/
- [M1] Magennis, T. *Throughput Forecaster.xlsx* (cell text: "Team focus on THIS work", "Stability Between Two Random Groups of the Samples… Aim to keep this below 25%"). https://github.com/FocusedObjective/FocusedObjective.Resources/raw/master/Spreadsheets/Throughput%20Forecaster.xlsx
- [M3] Magennis, T. *Team Dashboard.xlsx* (cell text: completion-pace consistency, "Sustainability – How Likely Are These Trends to Continue", sustainable pace, new challenges). https://github.com/FocusedObjective/FocusedObjective.Resources/raw/master/Spreadsheets/Team%20Dashboard.xlsx
- [N1] NIST/SEMATECH *e-Handbook of Statistical Methods*, §6.3.2 "What are Variables Control Charts?" (Western Electric rules, false-alarm rates). https://www.itl.nist.gov/div898/handbook/pmc/section3/pmc32.htm
- [P1] ProKanban.org. "Forecasting · Monte Carlo" pocket guide page (window length, restart the window, four weeks after a change). https://prokanban.org/forecasting-pocket-guide
- [P2] Vacanti, D. "The Kanban Pocket Guide: Chapter 2 – The Service Level Expectation", ProKanban.org (right-sizing, ageing checkpoints). https://prokanban.org/blog/the-kanban-pocket-guide-chapter-2-the-service-level-expectation
- [V1] Vacanti, D. *Actionable Agile Metrics Volume II*, Leanpub, table of contents (chapters cited by title only; text not read). https://leanpub.com/actionableagilemetricsii
- [V2] Wester, J. "Process Behavior Chart", ActionableAgile docs, 55 Degrees (detection rules, "investigate each out-of-limits point in search of a cause"). https://55degrees.atlassian.net/wiki/spaces/AAS/pages/699236831/Process+Behavior+Chart
- [W1] Wheeler, D. J. "Three Types of Action", *Quality Digest*, 1997. https://www.qualitydigest.com/aug97/html/spctool.html

Repo sources: [`pace-stability/`](pace-stability/README.md) (patterns, signals, miss rates, classifier), [`forecasting-approaches.md`](forecasting-approaches.md), [ADR-0001](../adr/0001-bayesian-bootstrap-pace-sampler.md).

Not used: Magennis's Agile 2016 slides (13 MB PDF; no text extraction available here) and his Medium book (403). Vacanti's Volume II chapters "Different Sampling Methods" and "What Happened To Our Team?" likely bear on window choice after a change, but only their titles were seen.
