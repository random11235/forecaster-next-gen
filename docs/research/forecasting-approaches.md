# Forecasting approaches for software project work

Research date: 2026-10-05. Scope: methods, tools and ticketing APIs that could support high-confidence, cheaply-updated forecasts for a software team, as input to a new forecasting tool.

Citation convention: bracketed numbers such as [12] refer to the **Sources** list at the end. Where a claim could not be checked against a primary source, the text says so explicitly ("**Unverified**"). Sections marked **Synthesis** are my own reasoning from the evidence, not claims made by any source.

---

## Executive summary

**Question:** Which forecasting method gives a software team high-confidence forecasts that adapt cheaply to pivots (scope change) and capacity change?

**Answer:** No single method in the literature does all of this on its own. The evidence supports a **hybrid**:

1. **Pace: throughput-based Monte Carlo on item counts.** Resample the team's own historical weekly throughput, pulled automatically from the ticketing tool. This is the core of Magennis's spreadsheets [4][5], Vacanti's ActionableAgile [10][11] and Nave [44]. It needs no estimation meetings, and re-forecasting after a pivot means re-running it on the new backlog count. Vacanti and Vallet's Siemens report describes moving from story-point velocity to this approach and finishing a release on schedule [12, pp. 10–12]. That report is an experience report, not a controlled calibration study.
2. **Size: a separate, data-driven model of scope growth ("split rate").** All the throughput methods agree that the backlog you count today is not the backlog you will finish. Magennis's tools take split/growth as explicit low/high inputs [5][6] and model "added scope" as events [9, ch. 6]. The user's current tool takes split-rate samples as manual input [1][3]. A ticketing integration can measure this directly from hierarchy history, per epic and per work type. Examples: Linear's per-project weekly `issueCountHistory` [39], Jira changelogs [42], and Azure DevOps revisions with `ParentWorkItemId` [57]. Measuring it removes the "it takes experience to pick split ratios" problem. This is a **reference-class forecast** in Flyvbjerg's sense [16, pp. 6–7], applied to scope growth instead of cost.
3. **Capacity: explicit scaling, plus re-baselining after team changes.** Commercial tools handle capacity change with a manual throughput scale factor (ActionableAgile "Scale throughput by" [10], Nave "Scale Factor" [44]). ProKanban's guidance is to re-baseline on at least four weeks of post-change data [15]. Evidence-Based Scheduling models per-developer calendars and vacations [23], at a much higher data-entry cost. None of the sources gives a validated model of how throughput scales with headcount, so a tool should treat that relationship as an explicit, visible assumption.
4. **Calibration as a first-class feature.** Jørgensen's studies show that expert "90% confident" ranges for software effort contain the actual outcome only about 60–70% of the time [25][26], and that experts barely change their ranges when asked for 80% versus 98% confidence [26]. Basing ranges on the empirical distribution of past outcomes is his proposed remedy [27]. None of the commercial tools reviewed documents any back-testing of its own forecasts against outcomes. A tool that records every forecast and reports its hit rate would be both differentiated and directly answer the "high confidence" requirement.

Story-point velocity forecasting (Scrum.org/Cohn) and per-task Evidence-Based Scheduling both work, but cost more to maintain and degrade faster under pivots. Story points also correlate poorly with actual effort in the one large open-source study found: strong correlation in only 7% of 37 projects [30]. ML approaches to issue-level estimation have not reliably beaten simple baselines in replication [29]. Treat them as research, not as a foundation.

**Recommendation (Synthesis):** Build on count-based throughput Monte Carlo, pulled from the ticketing tool. Add an empirically learned, per-reference-class model of scope growth, an explicit capacity calendar, and built-in calibration tracking. Details are in "Implications for a new tool".

---

## Comparison table

Ratings are my synthesis from the per-method sections below. "Calibration evidence" means published evidence that the method's stated probabilities match outcomes.

| Method | Data needed | Handles ambiguity | Handles capacity change | Handles pivots / scope change | Cost to maintain | Confidence & calibration evidence | Integration potential |
|---|---|---|---|---|---|---|---|
| **Throughput Monte Carlo (Magennis / Vacanti)** | Daily or weekly completed-item counts, plus remaining item count; optional split-rate range | Only via split/growth ranges and risk events [5][9]; Vacanti recommends right-sizing items before they start [14] | Manual scale factor [10][44]; re-baseline after change [15] | Good: re-count the backlog and re-run. Growth must be modelled separately [5] | Low once data is automated | Practitioner case reports [12]; no controlled calibration study found | High: needs only created/started/done timestamps |
| **Flow metrics / SLE (Kanban Guide)** | Start and finish timestamps per item; WIP | Work Item Age exposes "bigger than expected" items early [14] | Indirect: SLE is a property of the system | Single-item SLE is robust to backlog change; does not forecast a backlog by itself | Very low | SLE is itself a stated probability [13]; no published calibration study found | High |
| **Reference class forecasting (Flyvbjerg)** | Outcomes (e.g. overrun ratio) from a class of similar past projects | Designed for non-routine work, where its advantage is "most pronounced" [16, p. 9] | Not directly | Re-forecast by changing the reference class | Low per forecast; high to build the reference data | UK DfT uplift tables derived from distributions [16, pp. 11–13]; IT fat tails [17] | Medium: needs a history of completed epics or projects |
| **Velocity / story-point burn-up (Scrum, Cohn)** | Story-point estimates on the backlog; velocity per sprint | Points absorb ambiguity through estimation; no explicit model | Must re-derive velocity; Jira Plans can set capacity per iteration [40] | Every new item must be estimated first | Medium to high (estimation sessions) | Cohn's range calculator uses a prediction interval [20]; story points correlate weakly with effort [30] | High (points are a field in all tools) |
| **Evidence-Based Scheduling (Spolsky)** | Per-developer task estimates (≤16 h) and actual time | Forces up-front breakdown, which is costly when ambiguous [23] | Explicit: per-developer schedules and vacations [23] | Weak: assumes a detailed plan; new work comes from a buffer [23] | High (time tracking, fine-grained tasks) | Author's claim only; no independent validation found [23] | Low to medium (needs time tracking) |
| **Three-point / PERT** | Optimistic, most-likely and pessimistic estimates per task | Wider ranges in principle | No | Re-estimate new tasks | Medium | Expert ranges are badly overconfident in software: 90% intervals hit about 60–70% [25][26] | Low (custom fields) |
| **#NoEstimates (Duarte)** | Item counts; small slices | Relies on slicing; Killick's "slicing heuristics" [35] | Not specified | Good: progress is items delivered against items in the backlog [34] | Low | Author claims of high accuracy are **unverified** [34] | High |
| **Bayesian / ML (effort or story points)** | Large labelled history; issue text | Model-dependent | Model-dependent | Model-dependent | High (training and drift) | Deep-SE beat a median baseline in only 8 of 42 cases on replication [29] | Medium |
| **User's current tool (MC with split rate, triangular throughput)** | Manual throughput samples, lead-time samples, split-rate samples, risks, contributors | Via split-rate samples and risks [1][2] | S-curve of contributors, scaling throughput linearly [2] | Re-enter the task count | Medium (manual data entry) | None built in | None today [1] |

---

## 1. Monte Carlo throughput forecasting

### 1.1 The user's prior tool (random11235/forecaster)

What it is: a fork of Rodrigo Rosauro's MIT-licensed ProjectForecaster [1][3]. The README says the fork "uses triangular distribution in preference to uniform distribution" and that this "should make it more accurate" [1]. I found no evidence offered for the accuracy claim.

How the engine works (read from `monte_carlo.js` [2]):

- **Inputs** (from `ui.js`): throughput samples (`tpSamples`), lead-time samples (`ltSamples`), split-rate samples, risks, number of tasks, total/min/max contributors, S-curve size [2]. The UI rejects split rates above 10 or below 0.2 and expects a value like `1.1` for a 10% split [2].
- **Split rate per trial:** `randomSampleAverage(splitRateSamples, 1, splitRateSamples.length * 3)`. That is the mean of between 1 and 3n random draws from the split-rate samples. Total tasks = (numberOfTasks + risk-impact tasks) × split rate [2].
- **Risks:** each risk fires with its likelihood and adds a uniform-random number of tasks between its low and high impact [2].
- **Throughput per week:** the fork replaces upstream's bootstrap draw `randomElement(tpSamples)` [3-src] with `applyTriangularDistribution(min, max, median)` over the throughput samples [2]. The median is used as the triangle's mode.
- **Capacity:** weekly throughput is multiplied by `contributorsThisWeek / totalContributors`, where contributors follow a ramp-up/ramp-down "S-curve" over percent complete [2].
- **Lead time:** a random-sample average of lead times is converted to weeks and added to the duration [2].
- Upstream guidance is 7–24 weeks of throughput data, at least 10K simulations, and split rate defined as "actual tasks ÷ planned tasks" from finished projects [3].

Observations (**Synthesis**, from reading the code):

- *Averaging split-rate samples narrows the scope distribution.* Averaging k draws shrinks variance by about 1/k, so most trials use a split rate close to the sample mean. That understates the tail risk of scope blow-up, which is exactly the risk Flyvbjerg and Budzier say matters most in IT [17]. A single draw per trial, as in Magennis's Story Count Forecaster [6], preserves the tail.
- *Triangular(min, max, median) discards the empirical shape of throughput.* It is also sensitive to single outlier weeks: one holiday week of zero sets `min=0`. The upstream bootstrap keeps the shape. Neither handles autocorrelation.
- *Linear capacity scaling* assumes throughput is proportional to headcount. No source reviewed validates that assumption. Magennis's simulation book treats adding staff as something to model and analyse, not assume [9, ch. 9].
- The user's three pain points line up with the code. Split ratios are manual inputs. Ticket-size discipline matters because counts are treated as interchangeable. There is no ticketing integration.

### 1.2 Troy Magennis / Focused Objective

Primary artefacts: the FocusedObjective.Resources GitHub repo [4], its spreadsheets [5][6], the "Common Questions Answered" sheet [7], his Agile 2016 deck [8] and his book *Forecasting and Simulating Software Development Projects* (2011) [9].

- **Tool set.** The repo lists a Throughput Forecaster ("forecast how long a single feature may take"), a Multiple Feature Cut Line Forecaster, and a Story Count Forecaster. The Story Count Forecaster estimates "how many total stories are in a project by analyzing just a few sample features or epics" [4]. Before you have team data, use range estimates for size, growth and pace. After you have data, use actual delivery-rate data combined with size and growth ranges through Monte Carlo [7].
- **Split rate.** The Throughput Forecaster asks for split-rate low and high bounds: "Stories are often split before and whilst being worked on" [5]. It warns that backlogs are typically counted pre-split while throughput is measured post-split, which makes forecasts optimistic [5]. The Story Count Forecaster says "1 no change, 2 means every one item might be split into two" and "Most commn [sic] range I've seen is 1 to 3" [6]. It also records "Work often splits into smaller pieces when started by the team. Also, new work gets discovered through defets [sic] and learning" [6].
- **Ambiguity inputs.** The Throughput Forecaster has scope-certainty and "Team focus on THIS work" inputs, with a scale labelled "Very unclear or understood". Its changelog notes "Added scope certainty, team focus and triangle throughput distribution" [5]. The exact formula mapping certainty to growth was not extracted. **Unverified** beyond the labels.
- **Added-scope events.** In the simulation book, scope growth, blocking events and defects are modelled as events with occurrence rates. One example is scope creep "between 1 in 4 and 1 in 10 story cards being completed" [9, ch. 6, pp. 65–72 (book pagination)]. The book argues these events are "the major reason that traditional spreadsheet estimation and forecasting has proven to be erroneous" [9, p. 65].
- **Sample size.** The 2016 deck gives the probability that the next sample falls inside the range of the previous n samples as (n−1)/(n+1). For n = 11 that is 83%, rising to about 90% at n = 19–20 [8, slides 9–11]. The Story Count Forecaster warns that "with less than 7 samples, error is often 'unstable'". It shows the error between two random halves of the samples, with the bands "0-25% good, 25-75% fair, >75% then too unstable to forecast" [6]. The Throughput Forecaster has the same "Stability Between Two Random Groups" check ("Aim to keep this below 25%") [5]. The "Rule of Five" (93.75% chance that the population median lies between the min and max of 5 samples) is widely attributed to Hubbard's *How to Measure Anything*. **Unverified** at the primary source; I found it only in secondary summaries.
- **Capacity.** Before data exists, the spreadsheets take throughput ranges. Once data exists, they take historical samples [5][7]. The simulation book has staff-planning simulations ("What if we added staff now?", "Performing Add Staff Simulations") [9, table of contents, ch. 9]. Its Kanban model uses WIP limits and column cycle times rather than a headcount multiplier [9].

### 1.3 Daniel Vacanti: *When Will It Be Done?* and ActionableAgile

- **Book.** *When Will It Be Done? Lean-Agile Forecasting to Answer Your Customers' Most Important Question* (Leanpub, 2018). Chapters cover single-item forecasting with cycle time, multiple-item forecasting, process stability and Little's Law, and case studies including "Linear Projections vs. Monte Carlo" [11]. I could not access the book text, so its specific guidance on sample size and capacity is **unverified** here.
- **ActionableAgile "Monte Carlo: How Many".** Inputs are start date, end date, an optional "Scale throughput by" factor and number of trials. The docs' example is "two team members on vacation" giving a factor of 0.5. Throughput defaults to "all the historical data which has been loaded" and can be restricted to a date range or filtered by item type [10]. The docs note that "adding more trials doesn't often significantly change the range of outcomes" [10].
- **Siemens case study** (Vacanti and Vallet). Story-point velocity "never realized the transparency and predictability that those metrics promised". Moving to WIP, cycle time and throughput gave "a 42% reduction in Cycle Time". Historical cycle times were used for Monte Carlo release forecasts, and "the model proved extremely predictive". The first Kanban release "completed on schedule and below budget by over 10%" [12, pp. 1, 10–12]. Predictability is framed as "a systemic behavior" that depends on the assumptions of Little's Law [12, p. 13]. This is a single-organisation experience report. It does not report a hit rate across many forecasts.

### 1.4 How the method copes with the user's three concerns

- **Split rates.** In Magennis's approach these are explicit inputs or events [5][6][9]. ActionableAgile's "How Many/When" docs reviewed do not include a split-rate input [10]. Screenful's chart offers an optional projected scope line at the historical median rate of new work [47].
- **Sample size.** Roughly 7–11 samples is where Magennis's own guidance considers ranges usable [6][8]. ProKanban's page recommends 8–12 weeks, warns against fewer than 6 and more than 26, and says to use post-change data once there is "at least four weeks of it" [15]. That page carries no named author. LinearB requires at least 30 issues and 5 weeks [45].
- **Capacity changes.** These are handled by scale factors [10][44], by re-baselining [15], or (in the user's tool) by a contributor S-curve [2].

---

## 2. Flow metrics: cycle time, work item age, throughput, SLE

The Kanban Guide (v2025.5, May 2025) defines four mandatory flow measures [13]:

- **WIP:** "The number of work items started but not finished."
- **Throughput:** "The number of work items finished per unit of time … the exact count of work items."
- **Work Item Age:** "The elapsed time between when a work item started and the current date."
- **Cycle Time:** "The elapsed time between when a work item started and when a work item finished."

A **Service Level Expectation** is "a forecast of how long it should take a work item to flow from started to finished". It is expressed as a time and a probability, e.g. "85% of work items will be finished in eight days or less". It should be derived from historical cycle time [13].

Vacanti's Kanban Pocket Guide chapter on the SLE [14] adds:

- Right-sizing does not mean equal-sized items. The acceptable range is set by the SLE percentile.
- "it is impossible for us to know how big an item is *before* we start to work on it". Work Item Age is the signal that a sizing assumption was wrong.
- Once an item's age passes the 50th percentile cycle time, "this item is now larger than half the work items we have seen before". At the 70th percentile, the chance of missing the SLE is roughly a coin flip.

ActionableAgile's percentile lines reportedly read as "XX% of the time, our work items finish in X days or less", with age measured from first entering the workflow rather than time in the current state. **Unverified:** I saw this only in search snippets of 55 Degrees' Aging WIP docs and did not fetch the page.

Relevance (**Synthesis**): flow metrics are the cheapest way to detect ambiguity *during* delivery. An item ageing past the 50th–70th percentile is a measured signal that it was bigger or less understood than assumed. That signal can feed the split-rate model. The user's experience that Monte Carlo works best "when the team keeps ticket sizes disciplined" matches Vacanti's emphasis on right-sizing [14].

---

## 3. Reference class forecasting (Flyvbjerg)

- **Method.** Flyvbjerg (2006) defines three steps [16, p. 7]:
  1. "Identification of a relevant reference class of past, similar projects", broad enough to be statistically meaningful but narrow enough to be comparable.
  2. "Establishing a probability distribution for the selected reference class".
  3. "Comparing the specific project with the reference class distribution".
- **Rationale.** It takes the "outside view", which avoids optimism bias and strategic misrepresentation [16, pp. 2, 6]. Its advantage is "most pronounced for non-routine projects" [16, p. 9]. Flyvbjerg concedes it "may fail to predict extreme outcomes … outside all historical precedents" [16, p. 9].
- **First application.** UK Department for Transport optimism-bias uplifts. For a road project, accepting a 50% risk of overrun needs a 15% uplift and a 10% risk needs 45%. Rail needs 40% and 68% respectively. The DfT typically accepts the 80th percentile [16, pp. 12–13]. Lower uplifts are justified only with evidence that the forecasters are better than those in the reference class [16, p. 13].
- **IT projects.** Across 1,471 IT projects the average cost overrun was 27%. However "one in six of the projects … was a Black Swan, with a cost overrun of 200%, on average, and a schedule overrun of almost 70%" [17, p. 2/p. 4]. The authors recommend breaking big projects into smaller ones and using reference class forecasting [17, p. 6].
- **Applications to software.** Jørgensen and Sjøberg's prediction-interval method is effectively a reference class applied to *estimation error*. It derives effort intervals from the empirical distribution of past estimation accuracy, demonstrated on 145 tasks and compared with human judgment and regression on 15 tasks [27, abstract]. Jørgensen and Moløkken tested giving estimators information about previous estimation error on similar projects to reduce overconfidence [25]. Batselier and Vanhoucke (2016) and Servranckx et al. (2021) report empirical evaluations of RCF in project management, the latter on 52 projects. I saw these only in search abstracts (PMI, IDEAS/RePEc listings), so their details are **unverified**.

Relevance (**Synthesis**): RCF is the natural theory behind *learning split rates from past epics*. The reference class could be "epics of this type, this team, this initial understanding level". The output is a distribution of growth ratios, not a single ratio.

---

## 4. Velocity and story-point release burn-up (Scrum.org, Mike Cohn)

- **The Scrum Guide 2020** says only: "Various practices exist to forecast progress, like burn-downs, burn-ups, or cumulative flows. While proven useful, these do not replace the importance of empiricism." It does not mention velocity or story points in that context [19, "The Sprint"].
- **Cohn: story points** are "a unit of measure for expressing an estimate of the overall effort". They are relative, and "story points are a useful long-term measure. They are not useful in the short-term" [21].
- **Cohn: velocity ranges.** His Velocity Range Calculator uses "a prediction interval to forecast future velocity". It needs "at least 5 velocities" and argues that "a forecast of 18–23 is more likely to be right than 20". Longer forecasts give narrower per-sprint ranges because variations "have time to average out" [20]. The exact confidence level and formula are not stated on that page. Older Cohn slide decks describe a "Will have / Might have / Won't have" partitioning using a 90% interval, but the PDF was not retrievable, so this is **unverified**.
- **Tool support.** Jira Plans defines capacity as story points or hours per iteration, and velocity as "your team's average capacity per iteration over time based on past performance" [40]. The auto-scheduler assigns work to sprints by estimate, capacity and sprint length. For Kanban teams it schedules per day against weekly capacity [41] (Data Center docs). Linear's cycle capacity uses "the velocity of the previous three completed cycles" in issues or points. Without history, it is "roughly estimated from the number of members in the team" [37].
- **Known weaknesses (primary sources):**
  - Ron Jeffries: "I may have invented story points, and if I did, I'm sorry now". Using them "to predict 'when we'll be done' is at best a weak idea", and comparing teams on velocity "is harmful" [22].
  - Siemens: velocity burn-ups "could look in line with expectations" while features were not completing, because teams started too much work [12, p. 2].
  - Tawosi, Moussa and Sarro studied 37,440 stories in 37 open-source projects. The correlation between story points and approximate development time was strong for only 7% of projects [30].
  - Points require every new or split item to be estimated before it counts. That is a direct maintenance cost under pivots (**Synthesis**).

---

## 5. Evidence-Based Scheduling (Joel Spolsky / FogBugz)

From the original 2007 article [23]:

- **Steps:** "1) Break 'er down", "2) Track elapsed time", "3) Simulate the future", "4) Manage your projects actively".
- **Granularity:** tasks of "Nothing longer than 16 hours".
- **Velocity:** estimate ÷ actual, per developer. "Over time, for each developer, you'll collect a history of velocities".
- **Simulation:** about 100 simulated futures, each assigning random historical velocities to the remaining tasks. "Each of these possible futures has 1% probability".
- **Capacity:** "you have to take into account each developer's work schedule, vacations, holidays, etc.", and the team finishes when the last developer finishes.
- **Interruptions and debugging** are charged to the original task, so they show up in the velocity distribution.
- **Scope:** "Assuming you had everything planned down to the last detail when you started work, EBS works great". New features draw on a buffer: "slice off a piece of the appropriate buffer".
- **Accuracy:** the article asserts reliable schedules, based on Fog Creek's experience. I found no independent validation.

Assessment (**Synthesis**): EBS handles capacity change best of all the methods reviewed, through per-person calendars. It handles ambiguity and pivots worst, because it needs a detailed task breakdown up front and per-task time tracking. That is the opposite of the "cheap to adapt" requirement.

---

## 6. Three-point / PERT and probabilistic estimation with distributions

- **Origin.** PERT was developed for the Polaris programme and described by Malcolm, Roseboom, Clark and Fazar in *Operations Research* 7(5):646–669, 1959. It "characterizes the R and D program as a network of interrelated events" with probabilistic time estimates [24]. The standard formulas, mean = (a + 4m + b)/6 and SD ≈ (b − a)/6 under a beta distribution, are widely attributed to this paper. I did not verify them against the paper's full text, only the abstract [24].
- **Calibration evidence in software (Jørgensen):**
  - In one experiment, "90% confident" intervals contained the actual effort 64%, 70% and 81% of the time over three successive blocks of 10 tasks. Student projects' 90% intervals hit only 62% [25, p. 2].
  - Typically "the 90% … minimum-maximum effort intervals of software projects … include the actual effort only 60-70% of the time" [26, p. 1].
  - Interval widths were "almost the same" whether developers were asked for 98% or 80% confidence [26, p. 1]. This was shown on 42 projects and 443 user stories [26, p. 2].
  - Managers judged estimators with narrow intervals as more skilled, even after being told the intervals were overconfident [25, p. 9].
  - Remedy: base intervals on the empirical distribution of past estimation error [27]. If 10% of similar projects overran by more than 100%, a 90% maximum should be twice the most-likely estimate [25, p. 5].
- **Distribution-based tools.** Bitovi's open-source Statistical AutoScheduler takes a story-point estimate and a confidence (10–100%) per epic. It samples a log-normal work time, schedules along the critical path of blockers, and repeats 5,000 times [49].

Assessment (**Synthesis**): three-point inputs are easy to collect, but the probabilities they imply are not trustworthy without calibration against history. The evidence favours deriving ranges from data over asking people for them.

---

## 7. #NoEstimates and counting tickets instead of sizing them

- **Origin.** Duarte's book *NoEstimates: How to Measure Project Progress Without Estimating* (2015). Interviewed by InfoQ, he said: "I count the number of items delivered, and compare that to the number of items in the backlog". Teams can take stories into a sprint "without even sizing those stories" [34]. He projects "the rate of delivery (delivered items divided by the time it took to deliver) into the future" [34].
- **Accuracy claim.** In the same interview Duarte claims forecasting by counting "can give us accuracy levels near 100%" [34]. I found no study backing this figure, so it is **unverified**.
- **Later book.** A newer Leanpub title, *No Estimates – How to deliver software without guesswork*, is credited to Neil Killick, Vasco Duarte and Woody Zuill, and highlights Killick's "slicing heuristics" and "capability slicing" [35].
- **Supporting tools.** Counting items is also the default in Magennis's spreadsheets (throughput "or velocity") [5], ActionableAgile [10], Nave [44] and LinearB [45]. Screenful states that numbers can be "estimations, if available, or simply task counts" [47].
- **The claim that points and counts correlate closely** is attributed to Duarte in secondary summaries (e.g. Allan Kelly's blog). **Unverified** at Duarte's own data. The Story Point finding above [30] is consistent with points adding little information beyond counts, but it does not test that directly.

---

## 8. Bayesian and ML approaches; academic effort-estimation literature

- **Expert judgment vs models.** Jørgensen's 2007 review of 16 studies found expert judgment more accurate than models in 10 of the 16. Two indicators favoured experts: models "not calibrated to the organization", and context the experts had that the models lacked. Combining the two was about as accurate as the best single method [28, abstract]. The review notes software projects average 30–40% more effort than estimated [28, p. 1].
- **Calibration** (see §6): systematic overconfidence in expert ranges [25][26]. Empirical-distribution intervals are the proposed fix [27].
- **ISBSG.** The ISBSG "New Development & Enhancement" repository holds "thousands of completed projects". It is sized with ISO-standard functional size (Nesma, IFPUG, COSMIC function points). Its key metrics are delivery rate (hours per function point), cost, defects and delivery speed [33, p. 2]. ISBSG positions story points as unsuitable for cross-portfolio communication [33, p. 2]. Access is licensed [33]. **Synthesis:** useful as an outside-view benchmark for whole projects. It is a poor fit for issue-level forecasting from Jira or Linear data, because few teams measure function points.
- **Deep learning for story points.** Choetkiertikul et al. proposed Deep-SE (LSTM plus recurrent highway network) on 23,313 issues from 16 open-source projects and reported beating baselines [31]. Tawosi, Moussa and Sarro's replication (IEEE TSE 2022) added 31,960 issues. Deep-SE beat the Median baseline in only 8 of 42 cases and TF/IDF-SVM in 9 of 32, with statistical significance. More data and pre-training did not help [29].
- **Bayesian networks.** Hearty, Fenton, Marquez and Neil (IEEE TSE 35(1), 2009) built a learning dynamic Bayesian network for XP project velocity. The abstract reports predictions "in good agreement" with one industrial project [32]. Only the abstract was reviewed.
- **Issue-level ML generally** (resolution-time prediction etc.): no primary source was reviewed in depth here. That is a gap.

Assessment (**Synthesis**): the strongest academic results support simple, calibrated, organisation-specific empirical distributions, not complex models. A Bayesian *updating* layer (e.g. updating a split-rate prior per reference class as epics complete) fits that evidence. Text-based ML sizing of issues is not supported by the replication evidence.

---

## 9. Existing tools and products

| Tool | What it forecasts | How (per its own docs) | Scope / capacity handling |
|---|---|---|---|
| **ActionableAgile (55 Degrees)** | "How many by date" and "when" | Monte Carlo on historical throughput; selectable throughput date range and filters; configurable trials [10] | "Scale throughput by" factor for capacity [10]; no split-rate input on the reviewed page |
| **Nave** | Delivery date; number of tasks by date | Monte Carlo on past throughput; percentiles 30–98% [44] | "Scale Factor" input [44]; recommends higher percentiles for "complex or unfamiliar work" [44] |
| **Jira Plans (Premium; formerly Advanced Roadmaps)** | Sprint/iteration scheduling and release dates | Deterministic: estimates against capacity and velocity per iteration; capacity is split equally per team member [40]; auto-scheduler by estimate, capacity, rank, dependencies [41] | Capacity per iteration is editable [40]. Absence modelling was not found in the reviewed pages (**unverified**) |
| **Linear** | Project completion date; cycle capacity | Project graph: weekly velocity of completed points, recent weeks weighted more, in-progress counted as ¼, optimistic/pessimistic band of "about ±40%" [36]; cycle capacity from the last three cycles [37] | Scope line shows scope creep [36]; capacity from team size when there is no history [37] |
| **LinearB** | Project completion | Monte Carlo on historical data; needs ≥30 issues and ≥5 weeks; 6-week lookback; 50/75/85/95% outputs [45] | "optimized for fixed-scope projects"; inaccurate for ongoing streams [45]; no capacity input documented |
| **Jellyfish Scenario Planner** | Delivery scenarios | Models developer resources, developer attention (allocation) and scope [46]. A Monte Carlo engine is mentioned in search snippets but **unverified** in first-party docs fetched | Explicit what-ifs on engineers, allocation and scope [46] |
| **Screenful** | Milestone completion | Three scenarios from velocity percentiles (optimistic 80th, most likely median, pessimistic 20th), configurable; counts or estimates [47] | Optional projected scope growth at the historical median; shows ∞ if growth outpaces completion [47] |
| **Forecast (now part of Accelo)** | Task estimates, schedules, budgets | ML learns from time registrations, labels and history; Auto Schedule assigns people and dates [48] | Respects staff workload [48]. The blog now redirects to accelo.com; the acquisition is **not detailed** in the source |
| **rodrigozr/ProjectForecaster** (82★) | Duration and effort | Bootstrap throughput, split-rate samples, risks, S-curve contributors [3] | Contributor S-curve |
| **bitovi/jira-auto-scheduler** | Epic start and due dates | Log-normal per epic from points plus confidence; critical-path scheduling; 5,000 runs; writes dates back to Jira [49] | Team velocities as input [49] |
| **nbrown02/Capacity-Planning-Feature-Monte-Carlo** | Feature/epic completion; right-size; features per quarter | Power BI; Monte Carlo from child-item counts; Jira Cloud/Server and ADO [50] | Assumes thin slices and single-team ownership [50] |

The GitHub search also surfaced smaller projects: `jbrunton/team-flow-metrics`, `dvhthomas/flowmetrics` (flow metrics from GitHub PRs), `ProKanban/professional-kanban` and `bbak/mcs-mcp` (Monte Carlo for AI agents). These were found via the GitHub search API, and their READMEs were not reviewed.

Observation (**Synthesis**): every tool reviewed either uses throughput Monte Carlo with a manual capacity factor, or deterministic capacity scheduling. None documents (a) learning split or growth rates from hierarchy history, or (b) back-testing forecast calibration. Those are the clearest gaps.

---

## 10. Ticketing-tool APIs: data available to drive forecasts

### 10.1 Jira Cloud REST API v3

- **Search:** `GET/POST /rest/api/3/search/jql` (enhanced search) uses `nextPageToken` pagination. `expand=changelog` "Returns a list of recent updates to an issue" [42]. The word "recent" suggests the embedded changelog may be truncated; use the dedicated endpoints for full history (**Synthesis**).
- **Changelog:** `GET /rest/api/3/issue/{issueIdOrKey}/changelog` returns paginated changelogs, oldest first, `maxResults` default 100 [42]. `POST /rest/api/3/changelog/bulkfetch` fetches changelogs for "up to 1000 issues and can filter them by up to 10 field IDs" [42].
- **Changelog content:** each entry has `author`, `created` and `items`. Each item has `field`, `fieldId`, `from`, `fromString`, `to` and `toString` [42]. Status transitions (start and finish dates), parent changes, sprint changes and estimate changes are all derivable from this.
- **Links and hierarchy:** issue links via `/rest/api/3/issueLink` and the `issuelinks` field. Statuses carry a status category via `/rest/api/3/statuscategory`, which is useful for mapping custom workflows to started/done [42].
- **Estimates:** story points and similar estimates are custom fields (site-specific field IDs) (**Synthesis**, from the schema's field model; not a quoted doc statement).
- **Auth:** the OpenAPI spec declares `basicAuth` (email plus API token) and `OAuth2` [42].
- **Rate limits:** from 2 March 2026, a points-based hourly quota applies to Forge, Connect and OAuth 2.0 (3LO) apps. The global pool is 65,000 points/hour; per-tenant pools go up to 500,000. Burst limits are 100 RPS for GET/POST, and there are per-issue write limits. "API token-based traffic is not affected" and stays under burst limits only. Headers include `X-RateLimit-*`, `Retry-After` and `RateLimit-Reason` [43].

### 10.2 Linear GraphQL API

- **Issue fields:** `createdAt`, `startedAt`, `completedAt`, `canceledAt`, `addedToCycleAt`, `estimate`, `parent`, `children`, `relations`/`inverseRelations`, `project`, `projectMilestone`, `cycle`, `state` and `history` [39].
- **IssueHistory:** `fromState`/`toState`, `fromEstimate`/`toEstimate`, `fromParentId`/`toParentId`, `fromCycleId`/`toCycleId`, `fromProjectId`/`toProjectId`, `relationChanges` and `createdAt` [39]. That covers full status, estimate and hierarchy history.
- **Ready-made scope history:** `Project.issueCountHistory`, `completedIssueCountHistory`, `scopeHistory` and `completedScopeHistory`, each "at the end of each week since project creation". `Cycle` has the daily equivalents [39]. That gives direct weekly scope-growth series per project, ideal for measuring growth or split rates.
- **Auth and limits:** personal API key or OAuth app. Requests per hour: 2,500 (API key), 5,000 (OAuth), 600 (unauthenticated). Complexity per hour: 3,000,000 (API key) or 2,000,000 (OAuth). Each query is capped at 10,000 complexity points. Rate-limited responses return HTTP 400 with `RATELIMITED` [38].

### 10.3 GitHub Issues and Projects

- **Issue fields (GraphQL):** `createdAt`, `closedAt`, `stateReason`, `parent`, `subIssues`, `subIssuesSummary`, `projectItems` and `timelineItems` [56].
- **Sub-issues REST:** get parent, list sub-issues (paginated up to 100 per page), add, remove and reprioritise [53].
- **Timeline events:** closed/reopened, labeled, assigned, milestoned, sub-issue and parent added/removed, blocked-by/blocking added/removed. Project events exist only for *classic* projects (added to project, moved columns) [54]. The `IssueTimelineItemsItemType` enum in the public schema has no ProjectV2 status-change event [56].
- **ProjectV2 status history:** therefore not available from history queries. It can be captured going forward via the `projects_v2_item` webhook, which has `edited` and other actions. That webhook is organisation-projects only and "in public preview" [55]. **Implication:** "started" dates for GitHub Projects users must be captured live, or approximated (e.g. from assignment or first linked PR) (**Synthesis**).
- **Auth and limits:** PAT, OAuth app or GitHub App. REST allows 5,000 requests/hour for users and 5,000–12,500 for app installations (15,000 on Enterprise Cloud). Secondary limits apply: 100 concurrent requests and 900 points/minute per endpoint [51]. GraphQL allows 5,000 points/hour for users (10,000 on Enterprise Cloud apps) and at most 500,000 nodes per query [52].

### 10.4 Azure DevOps

- **Analytics (OData):** `WorkItems` holds current state. `WorkItemSnapshot` and `WorkItemBoardSnapshot` hold daily snapshots for trends and CFDs. `WorkItemRevisions` holds all revisions. `WorkItemLinks` holds parent/child and other links, but "only the latest revision of links, with no history" [57].
- **Computed fields:** `CycleTimeDays` (first In Progress/Resolved to Completed) and `LeadTimeDays` (created or Proposed to Completed). Also `InProgressDate`, `CompletedDateSK`, `StateCategory`, `StoryPoints`, `Effort`, `Size`, `OriginalEstimate`/`RemainingWork` and `ParentWorkItemId` on revisions [57]. Hierarchy history is therefore recoverable from `ParentWorkItemId` across `WorkItemRevisions`, even though `WorkItemLinks` lacks history (**Synthesis**).
- **REST:** `GET …/_apis/wit/workItems/{id}/updates?$top&$skip&api-version=7.1` returns per-revision deltas (`oldValue`/`newValue`, `revisedDate`) [60].
- **Auth:** Microsoft Entra ID OAuth, service principals or managed identities are recommended. Use PATs "sparingly, and only when Microsoft Entra ID isn't available" [59].
- **Rate limits:** a global limit of 200 TSTUs in any sliding 5-minute window, with headers `Retry-After`, `X-RateLimit-Limit`/`Remaining`/`Reset`/`Delay`/`Cost` [58].

### 10.5 Summary of forecasting-relevant data

| Need | Jira Cloud | Linear | GitHub | Azure DevOps |
|---|---|---|---|---|
| Created / done timestamps | fields + changelog [42] | `createdAt`, `completedAt` [39] | `createdAt`, `closedAt` [56] | `CreatedDate`, `CompletedDateSK` [57] |
| Started timestamp | from status changelog [42] | `startedAt` [39] | **not historical for Projects v2** [54][55] | `InProgressDate` [57] |
| Full status history | changelog [42] | `IssueHistory` [39] | classic projects only [54] | `WorkItemRevisions` [57] |
| Hierarchy history (for split rate) | changelog parent changes [42] | `fromParentId`/`toParentId` [39] | sub-issue added/removed events [54] | `ParentWorkItemId` per revision [57] |
| Scope-over-time series | derive | `Project.issueCountHistory` (weekly) [39] | derive | `WorkItemSnapshot` (daily) [57] |
| Estimates | custom field | `estimate` + history [39] | none native (Projects fields) | `StoryPoints`/`Effort`/`Size` [57] |

---

## 11. Handling uncertainty and ambiguity, across methods

| Concern | What the evidence offers |
|---|---|
| **Low-understanding work** | RCF's advantage is largest for non-routine work [16, p. 9]. Magennis has a "Very unclear or understood" scope-certainty input [5] and a 1–3 split range [6]. Nave recommends 95–98% percentiles for complex or unfamiliar work [44]. Vacanti says size is unknowable before starting, so watch Work Item Age [14]. |
| **Scope growth / discovery** | Split-rate ranges [5][6]; added-scope events at occurrence rates [9, ch. 6]; split-rate samples from finished projects [3]; Screenful's projected scope line [47]; Linear's scope line [36]. IT outcomes are fat-tailed, so model tails, not averages [17]. |
| **Capacity change** | Scale factors [10][44]; re-baseline after 4+ weeks of post-change data [15]; per-person calendars in EBS [23]; Jira Plans capacity per iteration [40]; Jellyfish allocation what-ifs [46]; the user's S-curve [2]. No reviewed source validates a headcount-to-throughput law. |
| **Overconfidence** | Expert intervals hit about 60–70% at "90%" [25][26]. Use empirical-error distributions [27]. Forecast-vs-actual tracking appears in Jørgensen's work but in no tool reviewed. |

---

## Implications for a new tool (Synthesis)

> Everything in this section is my synthesis of the evidence above, not a claim made by any single source.

### Recommended hybrid approach

1. **Pace model: bootstrap throughput Monte Carlo on item counts**, pulled automatically.
   - Resample actual daily or weekly throughput, as upstream ProjectForecaster [3], ActionableAgile [10] and Nave [44] do, rather than fitting a triangle (the user's fork [2]).
   - Use a rolling window, defaulting to roughly 8–12 weeks [15], with a stability check like Magennis's split-halves error (below 25% is "good") [5][6].
   - Count items by default. Story points are optional, given weak point-to-effort correlation [30] and the extra estimation cost.
2. **Size model: an empirically learned growth (split) distribution per reference class.** This replaces hand-picked split ratios.
   - For each completed epic or project, compute final child count ÷ child count at the moment it was "committed", using hierarchy history (Jira changelog [42], Linear `IssueHistory`/`issueCountHistory` [39], ADO revisions [57], GitHub sub-issue events [54]).
   - Group by reference class: team, work type, and a user-declared understanding level, echoing Magennis's "Very unclear or understood" [5] and Flyvbjerg's step 1 [16].
   - Draw **one** growth ratio per trial from that class, preserving the tail [17]. Do not average many draws.
   - For epics that are not yet broken down, use Magennis-style sampling: a few broken-down epics extrapolated to the rest [4][6].
   - Fall back to wide default ranges (e.g. Magennis's commonly seen 1–3 [6]) until at least about 7 samples exist [6][8].
3. **Capacity model: an explicit calendar.**
   - People, allocation % and absences per week produce a capacity fraction relative to the baseline window, applied to sampled throughput. This generalises the scale factor [10][44] and EBS-style calendars [23] without per-task time tracking.
   - Show the scaling assumption (linear by default) and let users override it, because no source validates it.
   - After a team change, flag that the baseline is stale and suggest re-baselining once there are 4+ weeks of new data [15].
4. **In-flight signals: flow metrics.**
   - Show Work Item Age against cycle-time percentiles and flag items past the 50th/70th percentile [14].
   - Feed flagged items back as "likely to split", which raises their growth draw. This step is a hypothesis to test.
5. **Calibration loop.**
   - Persist every forecast (date, scope, percentile dates). When work completes, record where the actual fell.
   - Report the hit rate per percentile ("our 85% dates were met 78% of the time") and optionally widen intervals to correct for it, following Jørgensen's empirical-distribution approach [27].
   - No reviewed tool documents this.
6. **Pivot handling.**
   - Forecasts are recomputed from live backlog queries, so a pivot means editing the backlog or changing the epic set; nothing else needs maintaining.
   - Offer Magennis-style "cut line" views for multiple features in priority order [4], answering "what drops if we add X?".

### Features to build (prioritised)

1. Connectors: Linear (richest history plus scope series [39]), then Jira Cloud (changelog bulk fetch [42]), Azure DevOps (Analytics OData [57]), and GitHub (with live webhook capture for Projects v2 status [55]).
2. Workflow mapping: map each tool's states to *not started / started / done* using status categories ([42], [57] `StateCategory`, Linear `startedAt`/`completedAt` [39]).
3. Throughput Monte Carlo ("when" and "how many") with percentile outputs and a stability indicator.
4. A learned split/growth model per reference class, with a manual override and visible sample counts.
5. A capacity calendar with an editable scaling assumption.
6. A multi-epic cut-line forecast.
7. Ageing-WIP view against SLE percentiles.
8. A forecast ledger with calibration reporting.
9. Scenario comparison ("what if we drop epic B / lose a developer in March").
10. Rate-limit-aware incremental sync. Limits vary widely, from Linear's 2,500 req/h on API keys [38] to Jira's points model for apps [43] to ADO's TSTU windows [58].

### Open questions

- **Definition of "committed" scope** for measuring growth. Is it when the epic enters "in progress", when it is first broken down, or a user-marked baseline? The choice changes the measured split rate materially.
- **How to treat bugs and unplanned work.** Model them as a separate added-scope stream (Magennis's defect and added-scope events [9]) or as part of throughput?
- **How capacity actually scales with headcount** for a given team. Can the tool learn it from the team's own history of staffing changes, and how many such changes are needed?
- **Minimum reference-class size** before a learned growth distribution beats a wide default. Magennis's 7-sample guidance [6] is a starting point and should be tested by back-testing.
- **GitHub Projects v2** lacks historical status change data via the public API [54][56]. Is webhook capture from install time acceptable?
- **Multi-team dependencies:** Bitovi [49] and nbrown02's Multi-Team Forecaster model these. Is that in scope for v1?
- **Validation:** the literature has strong evidence that *experts* are miscalibrated [25][26], but I found no published, multi-team calibration study of throughput Monte Carlo itself. The tool's own ledger could produce that evidence.
- **Items not verified here:** the contents of Vacanti's *When Will It Be Done?* [11]; Hubbard's Rule of Five; the PERT formula in the 1959 paper's full text [24]; Jellyfish's Monte Carlo engine; Jira Plans absence handling; Batselier and Vanhoucke and Servranckx et al. RCF evaluations; Duarte's point/count correlation data.

---

## Sources

1. random11235/forecaster README (private fork of rodrigozr/ProjectForecaster), read via `gh repo view`. https://github.com/random11235/forecaster
2. random11235/forecaster source: `monte_carlo.js` (functions `simulateBurnDown`, `applyTriangularDistribution`, `randomSampleAverage`, `calculateContributorsDistribution`) and `ui.js` (input parsing, split-rate validation). https://github.com/random11235/forecaster/blob/master/monte_carlo.js
3. Rosauro, R. ProjectForecaster wiki (user manual: inputs, split-rate definition, 7–24 weeks guidance). https://github.com/rodrigozr/ProjectForecaster/wiki. [3-src] Upstream `monte_carlo.js` line 152, `randomElement(tpSamples)`: https://github.com/rodrigozr/ProjectForecaster/blob/master/monte_carlo.js
4. Focused Objective (Magennis). FocusedObjective.Resources README. https://github.com/FocusedObjective/FocusedObjective.Resources
5. Magennis, T. *Throughput Forecaster.xlsx* (cell text: split-rate inputs, scope certainty, team focus, stability check). https://github.com/FocusedObjective/FocusedObjective.Resources/raw/master/Spreadsheets/Throughput%20Forecaster.xlsx
6. Magennis, T. *Story Count Forecaster.xlsx* (split-rate guidance, "less than 7 samples", error bands). https://github.com/FocusedObjective/FocusedObjective.Resources/blob/master/Spreadsheets/Story%20Count%20Forecaster.xlsx?raw=true
7. Magennis, T. *Common Questions Answered* (PDF). https://github.com/FocusedObjective/FocusedObjective.Resources/blob/master/Common%20Questions%20Anwered.pdf
8. Magennis, T. "Forecasting Using Data", Agile 2016 slides 7–15 (copy hosted by H. Samios). https://www.hanssamios.com/dokuwiki/_media/forecasting_using_data_-_troy_magennis_agile_2016_.pdf
9. Magennis, T. *Forecasting and Simulating Software Development Projects: Effective Modeling of Kanban & Scrum Projects using Monte-carlo Simulation* (2011), ch. 6 "Modeling Development Events", pp. 65–72; ch. 9 staff analysis. https://github.com/FocusedObjective/FocusedObjective.Resources/blob/master/Books%20and%20Articles/Modeling%20and%20Simulating%20Software%20Projects%20-%20Troy%20Magennis.pdf
10. 55 Degrees. ActionableAgile docs, "Monte Carlo: How Many". https://55degrees.atlassian.net/wiki/spaces/ActionableAgile/pages/2407399482/Monte+Carlo+How+Many
11. Vacanti, D. *When Will It Be Done?* (Leanpub, 2018), book page and table of contents. https://leanpub.com/whenwillitbedone
12. Vacanti, D. & Vallet, B. "Actionable Metrics at Siemens Health Services", Agile Alliance experience report (2014). https://www.agilealliance.org/wp-content/uploads/2016/11/ActionableMetricsAtSiemensHealthServices.pdf
13. Vacanti, D. & Coleman, J. *The Kanban Guide*, v2025.5 (May 2025), "Flow Metrics" and "Defining and Visualizing the Workflow". https://kanbanguides.org/english/
14. Vacanti, D. "The Kanban Pocket Guide: Chapter 2 – The Service Level Expectation", ProKanban.org. https://prokanban.org/blog/the-kanban-pocket-guide-chapter-2-the-service-level-expectation
15. ProKanban.org. "Forecasting · Monte Carlo" pocket guide page (no named author). https://prokanban.org/forecasting-pocket-guide
16. Flyvbjerg, B. "From Nobel Prize to Project Management: Getting Risks Right", *Project Management Journal* 37(3), 2006, pp. 5–15. arXiv:1302.3642. Page refs are arXiv PDF pages. https://arxiv.org/abs/1302.3642
17. Flyvbjerg, B. & Budzier, A. "Why Your IT Project May Be Riskier Than You Think", *Harvard Business Review*, Sept 2011. arXiv:1304.0265. https://arxiv.org/abs/1304.0265
18. *(intentionally unused; RCF evaluation papers by Batselier & Vanhoucke and Servranckx et al. were seen only in search abstracts: https://www.pmi.org/learning/library/practical-application-empirical-evaluation-rcf-10277 , https://ideas.repec.org/a/eee/ejores/v295y2021i3p1161-1179.html)*
19. Schwaber, K. & Sutherland, J. *The Scrum Guide* (2020), "The Sprint". https://scrumguides.org/scrum-guide.html
20. Cohn, M. Velocity Range Calculator, Mountain Goat Software. https://www.mountaingoatsoftware.com/tools/velocity-range-calculator
21. Cohn, M. "What Are Story Points?", Mountain Goat Software. https://www.mountaingoatsoftware.com/blog/what-are-story-points
22. Jeffries, R. "Story Points Revisited" (2019). https://ronjeffries.com/articles/019-01ff/story-points/Index.html
23. Spolsky, J. "Evidence Based Scheduling", Joel on Software, 26 Oct 2007. https://www.joelonsoftware.com/2007/10/26/evidence-based-scheduling/
24. Malcolm, D. G., Roseboom, J. H., Clark, C. E. & Fazar, W. "Application of a Technique for Research and Development Program Evaluation", *Operations Research* 7(5):646–669, 1959 (abstract via RePEc). https://ideas.repec.org/a/inm/oropre/v7y1959i5p646-669.html
25. Jørgensen, M. & Moløkken, K. "Eliminating Over-Confidence in Software Development Effort Estimates" (2004), Simula. https://web-backend.simula.no/sites/default/files/publications/SE.5.Joergensen.2004.b.pdf
26. Jørgensen, M. "The Ignorance of Confidence Levels in Minimum-Maximum Software Development Effort Intervals" (manuscript, 2014), Simula. https://web-backend.simula.no/sites/default/files/publications/Simula.simula.2500.pdf
27. Jørgensen, M. & Sjøberg, D. I. K. "An Effort Prediction Interval Approach Based on the Empirical Distribution of Previous Estimation Accuracy" (2003), Simula. https://web-backend.simula.no/sites/default/files/publications/SE.4.Joergensen.2003.b.pdf
28. Jørgensen, M. "Forecasting of Software Development Work Effort: Evidence on Expert Judgment and Formal Models", *International Journal of Forecasting* (2007 version), Simula. https://web-backend.simula.no/sites/default/files/publications/Jorgensen.2007.2.pdf
29. Tawosi, V., Moussa, R. & Sarro, F. "Agile Effort Estimation: Have We Solved the Problem Yet? Insights From A Replication Study", *IEEE TSE* 2022. arXiv:2201.05401. https://arxiv.org/abs/2201.05401
30. Tawosi, V., Moussa, R. & Sarro, F. "On the Relationship Between Story Points and Development Effort in Agile Open-Source Software", ESEM 2022. https://conf.researchr.org/details/esem-2022/esem-2022-technical-track/6/On-the-Relationship-Between-Story-Points-and-Development-Effort-in-Agile-Open-Source-
31. Choetkiertikul, M. et al. "A deep learning model for estimating story points", arXiv:1609.00489. https://arxiv.org/abs/1609.00489
32. Hearty, P., Fenton, N., Marquez, D. & Neil, M. "Predicting Project Velocity in XP Using a Learning Dynamic Bayesian Network Model", *IEEE TSE* 35(1):124–137, 2009 (abstract only). https://www.academia.edu/23492891/Predicting_Project_Velocity_in_XP_Using_a_Learning_Dynamic_Bayesian_Network_Model
33. ISBSG. "Short Paper 2026-02: Product Owner's Guide to Predictability via Functional Size and ISBSG Data". https://www.isbsg.org/wp-content/uploads/2026/02/Short-Paper-2026-02-Product-Owners-Guide-to-Predictability-via-Functional-Size-and-ISBSG-Data.pdf
34. InfoQ. "Book Review and Q&A: NoEstimates" (interview with Vasco Duarte), 7 Dec 2015. https://www.infoq.com/articles/book-review-noestimates
35. Killick, N., Duarte, V. & Zuill, W. *No Estimates – How to deliver software without guesswork*, Leanpub. https://leanpub.com/noestimates
36. Linear Docs. "Project graph". https://linear.app/docs/project-graph
37. Linear Docs. "Cycles" (capacity). https://linear.app/docs/use-cycles
38. Linear Developers. "Rate limiting". https://linear.app/developers/rate-limiting
39. Linear GraphQL schema (`Issue`, `IssueHistory`, `Project`, `Cycle` types). https://github.com/linear/linear/blob/master/packages/sdk/src/schema.graphql
40. Atlassian Support. "What are capacity and velocity in your plan?" (Jira Cloud). https://support.atlassian.com/jira-software-cloud/docs/what-are-capacity-and-velocity-in-advanced-roadmaps/
41. Atlassian. "Auto-schedule issues in Advanced Roadmaps" (Jira Data Center docs). https://confluence.atlassian.com/jirasoftwareserver/auto-schedule-issues-in-advanced-roadmaps-1044784172.html
42. Atlassian. Jira Cloud Platform REST API v3 OpenAPI spec (endpoints `/rest/api/3/search/jql`, `/issue/{id}/changelog`, `/changelog/bulkfetch`, `/issueLink`, `/statuscategory`; schemas `Changelog`, `ChangeDetails`; security schemes). https://developer.atlassian.com/cloud/jira/platform/swagger-v3.v3.json (rendered: https://developer.atlassian.com/cloud/jira/platform/rest/v3/)
43. Atlassian. "Rate limiting" (Jira Cloud platform). https://developer.atlassian.com/cloud/jira/platform/rate-limiting/
44. Nave. "Monte Carlo: Delivery Date Simulation". https://getnave.com/monte-carlo-delivery-date
45. LinearB Help. "Project Forecast". https://linearb.helpdocs.io/article/fi3vb3llqd-project-forecast
46. Jellyfish. "Scenario Planning" (product blog). https://jellyfish.co/blog/jellyfish-scenario-planning/
47. Screenful Guide. "How to read the Forecasting chart?" https://screenful.com/guide/how-to-read-the-forecasting-chart
48. Forecast (now Accelo). "How Forecast uses AI to predict your future" (forecast.app URL redirects to accelo.com). https://www.accelo.com/blog/how-forecast-uses-ai-to-predict-your-future
49. Bitovi. jira-auto-scheduler README. https://github.com/bitovi/jira-auto-scheduler
50. Brown, N. Capacity-Planning-Feature-Monte-Carlo README. https://github.com/nbrown02/Capacity-Planning-Feature-Monte-Carlo
51. GitHub Docs. "Rate limits for the REST API". https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
52. GitHub Docs. "Rate limits and query limits for the GraphQL API". https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api
53. GitHub Docs. "REST API endpoints for sub-issues". https://docs.github.com/en/rest/issues/sub-issues
54. GitHub Docs. "REST API endpoints for timeline events". https://docs.github.com/en/rest/issues/timeline
55. GitHub Docs. "Webhook events and payloads: projects_v2_item". https://docs.github.com/en/webhooks/webhook-events-and-payloads#projects_v2_item
56. GitHub public GraphQL schema (octokit/graphql-schema snapshot, pushed 2026-10-05): `Issue` fields; `IssueTimelineItemsItemType` enum. https://github.com/octokit/graphql-schema/blob/main/schema.graphql
57. Microsoft Learn. "Azure Boards Analytics metadata reference". https://learn.microsoft.com/en-us/azure/devops/report/analytics/entity-reference-boards
58. Microsoft Learn. "Rate and usage limits – Azure DevOps". https://learn.microsoft.com/en-us/azure/devops/integrate/concepts/rate-limits
59. Microsoft Learn. "Authentication methods for Azure DevOps integrations". https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/authentication-guidance
60. Microsoft Learn. "Updates – List" (Work Item Tracking REST API 7.1). https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/updates/list
