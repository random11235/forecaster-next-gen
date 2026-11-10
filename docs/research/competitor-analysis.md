# Competitor analysis: who else answers "when will this be done?"

Research date: 2026-11-07. Scope: products that forecast when a piece of software work will finish, or how much will be finished by a date, compared with Project Forecaster v1 as described in the [v1 PRD](../design/prd-v1.md). It covers what each product does, what it needs, what it outputs, where it runs, what it costs and who it is for. It does not re-explain the methods: for Monte Carlo throughput forecasting, velocity burn-up, split rates and calibration, see [forecasting-approaches.md](forecasting-approaches.md), and its [§9 Existing tools and products](forecasting-approaches.md#9-existing-tools-and-products) for the earlier, shorter survey this note extends.

Citation convention: bracketed numbers such as [12] refer to the **Sources** list at the end. Every source was read on 2026-11-07. Where a claim could not be checked against a primary source, the text says "**Unverified**". Sections marked **Synthesis** are my own reasoning from the evidence, not claims made by any source. Prices are as shown on the date checked, in USD, excluding tax unless stated.

**Staleness.** Most vendor pricing and product pages carry no date. Each section notes whether its page is dated. Help pages that are dated are noted with their date; anything over about six months old may describe an older version.

---

## How products were found

1. The products named in the brief.
2. The Atlassian Marketplace REST API, searched for "monte carlo" (`/rest/2/addons?text=monte%20carlo`) [22], then each listing's details, latest version and live Cloud pricing read from the same API. This found Broken Build, Clearlane, Empirical Forecasting, AgileLens and a long tail of small apps.
3. A web search for "Monte Carlo delivery forecast", which found one new open-source tool (Monte Carlo Delivery Forecast, by aswinguruswamy) [33].
4. Vendors' own sites, help centres and changelogs, following links from each product to the page that owns each claim.

I did not search the Azure DevOps Marketplace or GitHub Marketplace systematically, so competitors that live only there may be missing.

---

## Project Forecaster v1, for reference

From the PRD [P1]: the EM types a start date (past or future), tickets remaining, an ambiguity level that grows the work by 1–1.5×, 1–2× or 1.5–3×, a cadence in days, and pace as a low–high range or typed counts (at least 4). It runs 10,000 trials with the Bayesian bootstrap, gives the same forecast for the same inputs, and reports 50/70/85/95% finish dates with a histogram and a pace trend. It ships as a local server (SQLite) or one ~210 KB HTML file that loads nothing from outside. Its calibration test on synthetic steady teams gives a P10–P90 miss rate of 17.6% (plain bootstrap 27.7%). Non-goals for v1 include connectors, capacity and absences, "how many by date", scenarios, risks and more than one team.

---

## 1. ActionableAgile Analytics (55 Degrees)

The flow-metrics product built around Daniel Vacanti's method; the Jira Cloud app is the most installed dedicated forecasting app found.

- **Method.** Monte Carlo resampling of historical **daily throughput**, "the number of items finished on a particular calendar day" [1]. By default all loaded history is used; a date range or item-type filter narrows it [1]. The sampling scheme beyond "daily throughput" is not described; I assume a plain bootstrap but that is **Unverified**.
- **Inputs.** A start date (defaults to today; past or future allowed) and a number of items [1]. A connector is required in the Jira and Azure DevOps apps; the standalone SaaS takes Jira or Trello import wizards or "any external app via file upload" [3].
- **Scope growth.** The number of items can be a range such as "100-150". The doc tells users to turn split rate into that range by hand: "If you know that an item can do anything from stay the same or break down into up to 3 smaller items, you know that your workload could grow up to 30%... put a range of '100-130'" [1]. No growth is learned.
- **Capacity change.** "Scale throughput by X": 1.1 for a 10% improvement, 0.5 when two of four team members are on vacation [1].
- **Uncertainty.** Trials run until the user stops them ("More" keeps adding trials); the doc says "adding more trials doesn't often significantly change the range of outcomes" [1]. Workflow stages can redefine what counts as done [1].
- **Outputs.** Percentile lines on a histogram and a calendar view [1]. A separate *Monte Carlo: How Many* chart answers "how many by date": "There's an 85% chance that we can finish 27 items or more by March 12th, 2024" [2]. That page is marked archived (updated 2025-12-11), so the chart may have moved or changed.
- **Calibration claims.** None found [1][2].
- **Deployment.** Jira Cloud (Forge/Connect app), Jira Data Center, Azure DevOps Cloud, and standalone SaaS [3]. Jira Cloud app version 9.0.0 released 2026-10-28, 1,413 installs, Cloud Fortified [5].
- **Data residency and privacy.** "We do not export any of your work data from where it lives"; "Only configurations are stored" [3]. For Jira Cloud, data is pulled through the REST API and "a subset data is stored in the local browser using DOM localStorage"; configuration is kept on AWS, "never any of your Jira issue data" [6]. Data Center: "All actions happen on your local instance and the user's browser" [6]. Standalone stores OAuth tokens encrypted on AWS [6]. No hosting region is named. Telemetry vendors listed are Sentry, Datadog and Mixpanel [6]. ISO 27001, SOC 2 Type II and GDPR are claimed [7]. The Marketplace listing says it does not store personal data, but its scopes include write access to Jira and acting as the user "from outside of Atlassian" [5]. The privacy statement is undated.
- **Pricing (checked 2026-11-07).** Jira Cloud, from the Marketplace: 10 users $14/month or $140/year; 100 users $1,400/year; 300 users $3,270/year [5]. 55 Degrees' own pricing page (undated, © 2026) shows Jira Cloud figures that disagree with each other, so I used the Marketplace figures. The same page gives standalone at $22/user/month or $220/user/year (30-day trial, up to 3 users, no card), Azure DevOps at $23/user/month or $230/user/year, and Jira Data Center from $5,500/year (500 users) to $16,500/year (5,000 users) [4]. `actionableagile.com/pricing` redirected to a 404 [4].
- **Target user.** Delivery teams, Scrum Masters, agile coaches, delivery managers and leaders [3].

## 2. Portfolio Forecaster (55 Degrees)

55 Degrees' multi-team product.

- **Method.** Not documented on the pages I read. A search snippet said it uses historical throughput, the number of epics in progress, and weekly scheduling (Confluence page "Forecast Scheduling" [9], not fetched): **Unverified**.
- **Inputs and connector.** Jira Cloud only [4][8].
- **Scope and capacity.** Scenarios: "When team capacity changes... test different scenarios"; "adjust scope or team size" [8][10].
- **Outputs.** Due-date likelihood; several teams combined; embeddable in Confluence [8].
- **Calibration claims.** None found.
- **Deployment.** Jira Cloud app, version 11.1.0 released 2026-10-14, 134 installs [8].
- **Privacy.** Scopes include reading the issue changelog and writing to Jira [8]. A separate privacy statement exists [6] but I did not read the Portfolio Forecaster one.
- **Pricing (checked 2026-11-07).** 10 users $11/month or $110/year; 100 users $1,100/year; minimum 10 users [4][8].
- **Target user.** Not stated on the pages read; from the features (several teams, Confluence embedding), my inference is portfolio and programme leads.

## 3. Nave

A flow-metrics SaaS for Kanban teams.

- **Method.** Monte Carlo from past throughput, taken from Nave's Daily Throughput chart [11]. The resampling scheme is not named: **Unverified** beyond "daily throughput".
- **Inputs.** Start date, items to complete (including new and in-progress items), number of trials, and a scale factor [11]. A connector or file is required: Jira, Azure DevOps, Trello, Asana, or CSV/JSON, which "works with just item IDs and timestamps" [12][13].
- **Scope growth.** No modelling; the user enters a total [11].
- **Capacity change.** A scale factor (default 0, meaning no adjustment) for holidays or new hires [11].
- **Uncertainty.** Recommends higher percentiles for "complex or unfamiliar work" (cited in the earlier note [P2]).
- **Outputs.** Percentiles at 30/50/70/85/95, with 98% in the guidance; CSV export [11]. A separate "Monte Carlo: Number of Tasks" chart answers "how many by date" [15].
- **Calibration claims.** None found [11].
- **Deployment.** Hosted SaaS, plus a Jira Marketplace app ("Kanban Analytics: Improve Your Delivery Process", version 2.0.0 released 2026-03-19, 975 installs, listing modified 2026-11-04) [15]. The integrations page links an August 2026 MCP Server release [13].
- **Data residency and privacy.** Nave copies data to its servers: board ID, name and columns; issue key, summary, priority, created and due dates, link; status history; flagged times; assignee name and avatar (can be hidden); selected custom fields; and the account email [13]. "Data hosted in the EU" [13]; the DPA says processing "takes place in the EU (Google Cloud Platform, europe-west region)", backups are kept 30 days, and data is kept "up to 3 (three) months after the termination" [14]. SOC 2 Type II and GDPR are claimed [13]. The DPA is undated.
- **Pricing (checked 2026-11-07).** Hosted: custom quote, per board, unlimited users, annual; 14-day trial with no card [12]. Jira app: 10 users $15/month or $150/year; 100 users $1,500/year [15]. The pricing page is undated.
- **Target user.** Not stated as a persona on the pages read; the product is built around Kanban flow metrics [11][13], so my inference is Kanban teams and their coaches.

## 4. Focused Objective (Troy Magennis) free tools

Free spreadsheets and web tools from the author whose methods most Monte Carlo products follow.

- **Method.** In the *Throughput Forecaster* spreadsheet, a plain bootstrap: each period draws `INDEX(Samples, RANDBETWEEN(1, TotalCount), 0) * FocusPercentage` from up to 24 historical samples. With no samples it draws `RANDBETWEEN(low, high)`, or a triangular distribution if a most-likely value is given [16]. 500 trials (rows 3–503 of the "Monte Carlo" sheet) [16]. Uses `RAND()`, so results change on every recalculation [16].
- **Inputs.** Story count low–high, split rate low–high, a complexity level, throughput as samples or an estimate, team focus, and up to 10 risks [16][18]. No connector: everything is typed or pasted.
- **Scope growth.** Per trial: `CEILING(RANDBETWEEN(StoryCountLow, High) * (RAND()*(SplitHigh-SplitLow)+SplitLow), 1)`, plus each risk row `IF(RAND()<=likelihood, RANDBETWEEN(impactLow, impactHigh), 0)` [16].
- **Ambiguity.** Complexity multipliers on the story count: "Clear and understood" 1–1, "Somewhat understood" 1–1.5, "Not really understood yet" 1.5–2, "Very unclear or understood" 1.75–3 [16]. These are close to v1's ambiguity levels (1–1.5, 1–2, 1.5–3) [P1].
- **Capacity change.** Team focus of 100/75/50/25% [16].
- **Outputs.** Percentiles from 0 to 95% in 5% steps; a "how many stories in N periods" table at 95/85/5%; a 52-period horizon; a stability check ("< 10% Great, < 25% Good") [16]. The web version has the same inputs, a numTrials URL parameter from 1 to 1,000, and 1–52 weeks to forecast [18].
- **Calibration claims.** None.
- **Deployment.** Excel spreadsheets from a GitHub repo (last pushed 2022-04-26, 739 stars, no license file found via the API) [15b]; and browser tools at focusedobjective.com, including Throughput Forecaster, Multi-Feature Cut Line and Story Count [17].
- **Privacy.** The site says the simulations run in the browser and "Your data never leaves your machine" [17]. "The current inputs are stored in the URL for sharing" [18]. No account. I did not inspect the page's network traffic, so the claim that nothing is sent is **Unverified** by me.
- **Pricing (checked 2026-11-07).** Free. Paid training such as "Using the Monte Carlo Forecasting Spreadsheets" costs $75 [17]. No license terms are stated for the tools.
- **Target user.** Not stated; my inference is coaches and delivery leads comfortable adjusting a model by hand.

## 5. Broken Build: Monte Carlo Simulations and Capacity Planning for Jira

A Jira Marketplace app (Cloud and Data Center).

- **Method.** "repeatedly sampl[es] your team's past velocities", "typically 100,000" simulations [20]. Periods can be daily, weekly, two-weekly, monthly or quarterly; estimates can be story points, time or counts [20]. The sampling scheme is not named: **Unverified**.
- **Inputs.** Board, project, release, epic, SAFe or JQL data sources; an alternative throughput source; remaining work from an estimate field, what-if numbers or JQL [19]. Requires Jira.
- **Scope growth.** None documented [20].
- **Capacity change.** A capacity allocation coefficient [20].
- **Outputs.** "When" and "How Many" charts; P50/P70/P85/P95 with red/amber/green status; a Jira dashboard gadget [19][20].
- **Calibration claims.** None. A Kanban example page recommends at least 6 periods and about 50 items (seen in a search snippet only): **Unverified**.
- **Deployment.** Jira Cloud and Data Center; version 2.10.0 released 2026-10-26, 1,141 installs, SOC 2 Type 2 [19].
- **Data residency.** Not stated on the pages I read. The privacy policy [21] was not fetched.
- **Pricing (checked 2026-11-07).** Free up to 10 users; 15 users $82.50/year; 100 users $550/year [19]. 30-day trial [20].
- **Target user.** Scrum and Kanban teams in Jira (from the app's name and examples [19][20]).

## 6. Clearlane: Burndown and Monte Carlo Forecast for Jira

A free Jira app, updated the day before this research.

- **Method.** "reads your team's real throughput and runs 10,000 Monte Carlo simulations to give three delivery dates with honest odds"; "reads the last 12 weeks of finished work" [23]. Sampling scheme not named.
- **Inputs.** Jira; what-if sliders [23].
- **Outputs.** 50/85/95% dates; the chance of meeting a deadline; a Rovo agent [23]. English, French and German.
- **Scope, capacity, calibration.** What-if sliders are the only adjustment described; no calibration claims [23].
- **Deployment and privacy.** "Read-only. Runs on Atlassian: your data stays in your Atlassian site" [23]. Version 2.17.0 released 2026-11-06 [23].
- **Pricing (checked 2026-11-07).** Free (Marketplace payment model "free"; the pricing API returns 404) [23].
- **Target user.** Jira teams (my inference from the listing).

## 7. Long-tail Jira Marketplace apps

Found through the Marketplace search [22]; each is small. Only the listing was read.

- **Empirical Forecasting** [24]: a cycle-time Monte Carlo per developer and per estimate, over the backlog in rank order. Claims to be "highly accurate" with no evidence offered: **Unverified**. Version 3.3.0 released 2025-04-13 (no update in over 18 months). 10 users $10/month; 15 users $645/year.
- **AgileLens** [25]: Monte Carlo with "scope volatility"; free up to 10 users; 3 installs.
- Also listed, not examined: Task Flow Simulator (1 install), Nine by Night Flow Metrics, Stattora, FlowPaths, Smart Metrics Ai, Flow Analytics Pro (wiveez), `com.agilemontecarlo.addon` [22].

"Kanban University / Nave-style Jira apps" in the brief: I found no Kanban University-branded forecasting app in the Marketplace search. The Nave-style flow-metrics apps that exist are ActionableAgile, Nave's own app, Broken Build and the long tail above.

## 8. Monte Carlo Delivery Forecast (open source, aswinguruswamy)

Found by web search; created 2026-10-27, v1.0.0 released 2026-11-03, 0 stars, Apache-2.0 [33].

- **Method.** Daily completion counts from the last 84 days, 10,000 runs, fixed seed 20261028, so results repeat [33].
- **Inputs.** A CSV; a Jira CSV export is accepted [33]. No connector.
- **Outputs.** 50/85/95% dates [33]. A Streamlit demo runs at mcf-forecast.streamlit.app (not checked).
- **Calibration claims.** The only real-data back-test found among all products: 29 open-source projects from the TAWOS dataset, 7,692 cases. **The 85% date was right only 69.0% of the time, which the repo itself marks FAIL against a 75–95% target.** Median error was 34 days, against 36 days for a velocity forecast [33].
- **Deployment.** Python/Streamlit, self-run.
- **Target user.** Developers comfortable running Python.

Also seen in the same search but not verified: a Monte Carlo delivery forecasting pull request in destacey/Wayd (#889), and an Azure DevOps analytics extension blog at ado-analytics.baytekdev.com. Both **Unverified**.

## 9. LinearB

An engineering-metrics platform.

- **Method.** Monte Carlo, "thousands of simulations" [26]. The resampled unit is not stated: **Unverified**.
- **Inputs.** Jira projects, initiatives and epics, or Azure Boards epics, features and tags [26]. Needs at least 30 issues and at least 5 weeks of history; the error message refers to the "past 6 weeks" [26]. Requires a connector.
- **Scope growth.** "optimized for fixed-scope projects"; no growth model [26].
- **Capacity change.** No input [26].
- **Outputs.** 50/75/85/95% markers, weekly probability and calendar views, refreshed daily at 04:30 UTC; "Forecasting Unavailable" when there is under a 3% chance of finishing within 15 weeks [26].
- **Calibration claims.** None [26].
- **Deployment and privacy.** Hosted SaaS. Residency not checked.
- **Pricing (checked 2026-11-07, page undated).** Billed annually per contributor per month: Essentials $29 (no Monte Carlo forecasting); Enterprise $59 includes "Monte Carlo project forecasting"; 45-day trial [27].
- **Help page date.** "Updated 10 months ago", so about January 2026; may be stale.
- **Target user.** Engineering leaders buying a metrics platform; forecasting is one feature of the top tier.

## 10. Swarmia

An engineering-effectiveness platform.

- **Method.** "a Monte Carlo simulation of your team's past effort" that "recombines those real outcomes"; 6 months of history by default [28]. The June 2026 changelog says it "paces the work by your team's recent monthly pace", replacing a 2024 forecast that used issue count, average cycle time and WIP [29].
- **Inputs.** Remaining open leaf subtasks (can be overridden); the authors (people or teams) invested; focus from past activity or a custom percentage [28]. Requires connectors (Git host plus issue tracker).
- **Scope growth.** Not modelled; scope is what is open [28].
- **Capacity change.** The focus percentage and the choice of authors [28].
- **Outputs.** An FTE range, and dates at Optimistic 50%, Likely 80% and Conservative 90%; "10+ years" when effort can't keep up; assumes no weekend work [28].
- **Calibration claims.** None [28].
- **Deployment and privacy.** Hosted SaaS; SOC 2 Type 2 [30]. Residency not stated on the pages read.
- **Pricing (checked 2026-11-07, page undated).** Free up to 9 developers; Standard $45 and Enterprise $55 per developer per month, annual; the $18 software-capitalisation module includes Initiatives [30]. Which tier includes the forecast is not stated on the pricing page: **Unverified**.
- **Help page date.** Undated; the changelog is dated 2026-06-30.
- **Target user.** Engineering leaders reporting on initiatives.

## 11. Jellyfish

An engineering-management platform.

- **What it offers.** A Scenario Planner that models "developer resources, developer attention, and delivery scope" (blog, 2023-08-15) [31]; no Monte Carlo or probabilities are mentioned. A Delivery Predictability score from 0 to 100 (blog, 2024-07-10), which reports that "only 24% of deliverables with a due date were delivered 'on time'" across 25K+ deliverables from 3,600 teams [32].
- **Connectors.** Jira, Azure DevOps Boards, Linear, and Git hosts [31b].
- **Pricing.** Quote only, by seats and modules [31c].
- **Not verified.** Jellyfish has no public help centre that I could find; only marketing pages and blog posts. Whether it gives a probabilistic finish date is **Unverified**. On the evidence, it is not a direct competitor for "when will this be done?" as a confidence and a date.
- **Target user.** Engineering leadership and PMO, judging by its solutions pages [31b] (my inference).

## 12. Built-in tools

### Jira (Plans / Advanced Roadmaps, version report, release burndown)

- **Plans.** Capacity per iteration in story points or hours; velocity is an average; scheduling is deterministic (page undated) [34].
- **Version report.** A predicted date "based on your average daily velocity and the amount of estimated work remaining"; the "optimistic" date adds 10% to the average daily velocity and the pessimistic date subtracts 10%; scrum boards only (page undated) [35].
- **Release burndown.** Velocity from the last 3 sprints; added scope is shown and counted; unreliable when over 30% of work is unestimated (page undated) [36].
- **Calibration.** None. The ±10% is a fixed band, not a measured probability [35].
- **Pricing (price data stamped 2026-10-13 on the page).** Free for 10 users; Standard $8.48 and Premium $15.56 per user per month. "Advanced planning (Plans)" is on Premium and Enterprise. Data residency is on Standard, Premium and Enterprise [37].

### Azure DevOps forecast tool

- **Method.** Deterministic. The user types "your team's predicted velocity"; Microsoft suggests "your average velocity over the last 3-6 sprints" [38]. The backlog is cut into sprints by that velocity, with unused velocity carried over [38].
- **Inputs.** Estimated backlog items (Effort, Story Points or Size); same-length sprints [38]. Velocity charts can count items or sum estimates, over up to 15 sprints [39].
- **Scope, capacity, uncertainty.** "Forecasts don't automatically adjust for team composition changes"; for team changes it says to "adjust velocity proportionally" by hand [38]. No probabilities.
- **Outputs.** Forecast lines on the backlog showing which items fit in which sprint [38]. In effect, a deterministic "how many by date" by sprint.
- **Deployment.** Azure DevOps Services and Server (2022 and later) [38]. Page dated 2026-02-28 (ms.date) [38].
- **Pricing (checked 2026-11-07, page undated).** Basic: first 5 users free, then $6/user/month; Stakeholder free [40]. The forecast tool needs Basic access [38].

### Linear

- **Method.** Deterministic. Velocity is "calculated based on weekly historical data: how many completed issue points per week", with "more recent weeks... weighted more heavily"; at least one week of data [41]. Remaining work is the points of incomplete issues, in-progress issues counted at 1/4 [41].
- **Uncertainty.** "an optimistic and pessimistic completion date" with a buffer of about ±40% [41]. Teams without estimates count each issue as 1 point [41].
- **Scope.** Scope is drawn as a line on the project graph; no growth is forecast [41].
- **Pricing (checked 2026-11-07, page undated).** Free; Basic $10 and Business $16 per user per month billed yearly; Enterprise custom [42]. The pricing page does not say which plan has the project graph; "Linear Insights" is Business and Enterprise only [42]. Which plans show project predictions is **Unverified**. The project-graph page is undated.

---

## Comparison table

"—" means not offered or not documented on the pages read. "Unverif." means the vendor's pages did not say.

| | **Forecaster v1** [P1] | ActionableAgile [1–7] | Portfolio Forecaster [8] | Nave [11–15] | Focused Objective [16–18] | Broken Build [19–20] | Clearlane [23] | MC Delivery Forecast [33] | LinearB [26–27] | Swarmia [28–30] | Jira built-in [34–37] | Azure DevOps [38–40] | Linear [41–42] |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Method | Monte Carlo, Bayesian bootstrap of per-period counts | Monte Carlo, daily throughput | Unverif. | Monte Carlo, daily throughput | Monte Carlo, plain bootstrap of per-period samples, or range | Monte Carlo of past velocities | Monte Carlo, last 12 weeks | Monte Carlo, last 84 days, daily | Monte Carlo, unit unverif. | Monte Carlo of past effort | Average velocity, ±10% | Typed velocity | Weighted weekly velocity, ±40% |
| Trials | 10,000 | Until stopped | Unverif. | User-set | 500 (sheet), ≤1,000 (web) | ~100,000 | 10,000 | 10,000 | "Thousands" | Unverif. | — | — | — |
| Same inputs, same answer | Yes | Unverif. | Unverif. | Unverif. | No (`RAND()`) | Unverif. | Unverif. | Yes (fixed seed) | Unverif. | Unverif. | Yes | Yes | Yes |
| Connector required | No | Yes, or file upload | Yes (Jira Cloud) | Yes, or CSV/JSON | No | Yes (Jira) | Yes (Jira) | No (CSV) | Yes | Yes | Is the tracker | Is the tracker | Is the tracker |
| Works with no history | Yes (low–high range) | — | — | — | Yes (range or 3-point) | What-if numbers | — | — | — (30 issues, 5 weeks) | — | — | Yes (typed velocity) | — (1 week) |
| Past or future start date | Both | Both | Unverif. | Yes | Optional start | Unverif. | Unverif. | Unverif. | Today | Today | Today | Current sprint | Today |
| Scope growth | Ambiguity level, 1–3× range | Typed item range | Scenarios | — | Split rate, complexity, risks | — | — | — | — | — | Shows added scope | — | Shows scope line |
| Capacity change | — | Throughput scale | Scenarios | Scale factor | Team focus % | Capacity coefficient | What-if sliders | — | — | Focus %, authors | Capacity per iteration | Edit velocity | — |
| Confidence dates | 50/70/85/95 | Percentile lines | Likelihood | 30–95 (98) | 0–95 in 5s | 50/70/85/95 | 50/85/95 | 50/85/95 | 50/75/85/95 | 50/80/90 | Fixed ±10% | — | Fixed ±40% |
| How many by date | — | Yes | Unverif. | Yes | Yes | Yes | — | — | — | — | — | Yes (deterministic) | — |
| Several teams | — | — | Yes | — | Cut-line tool | Cross-team | — | — | Unverif. | Yes | Plans | Manual | — |
| Calibration evidence | Synthetic test, P10–P90 misses 17.6% | — | — | — | — | — | — | Real data, 85% date right 69% (fails) | — | — | — | — | — |
| Deployment | Local server or one HTML file | Jira Cloud/DC, ADO, SaaS | Jira Cloud | SaaS, Jira app | Spreadsheet, web | Jira Cloud/DC | Jira Cloud | Python/Streamlit | SaaS | SaaS | Jira | ADO Services/Server | Linear |
| Where data goes | Stays on the machine | Browser storage; config on AWS | Unverif. | Copied to GCP europe-west | Browser (vendor claim) | Unverif. | Stays in Atlassian | Local | Vendor cloud | Vendor cloud | Atlassian | Microsoft | Linear |
| Price (2026-11-07) | Free (no pricing set) | $14/mo for 10 users (Jira Cloud); $22/user/mo standalone | $11/mo for 10 users | Quote per board; $15/mo for 10 users (Jira) | Free | Free ≤10 users; $550/yr for 100 | Free | Free (Apache-2.0) | $59/contributor/mo (Enterprise) | From $45/dev/mo; free ≤9 devs | Plans needs Premium, $15.56/user/mo | $6/user/mo after 5 free | Free–$16/user/mo |
| Target user | EM of one team | Teams, coaches, delivery managers | Portfolio leaders | Kanban teams, coaches | Coaches, delivery leads | Jira teams | Jira teams | Developers | Engineering leaders | Engineering leaders | Jira teams and planners | ADO teams | Linear teams |

Jellyfish is left out of the table because no probabilistic finish-date forecast could be verified (see §11).

---

## Synthesis

This section is my own reasoning from the evidence above, not a claim made by any source.

### Where v1 is differentiated

1. **Nothing to connect, install or sign up for, and nothing leaves the machine.** Every commercial forecaster found needs Jira, Azure DevOps or a hosted account. Only Focused Objective's tools and the MC Delivery Forecast repo also run without a connector, and v1 is the only one shipped as a single file that loads nothing from outside, with its privacy claim checked by a review [P1]. For EMs who can't install Marketplace apps, or whose data can't go to a vendor such as Nave (which copies issue summaries and assignee names to GCP [13]), this is a real gap v1 fills.
2. **Forecasts from no history.** v1 accepts a low–high pace range. Of the products found, only Focused Objective (range or three-point estimate) and the Azure DevOps tool (a typed velocity) do the same; every connected product needs weeks of history first (LinearB needs 30 issues and 5 weeks [26]).
3. **Short-history ranges widened on purpose.** v1 is the only product found that uses the Bayesian bootstrap, and the only one that claims its ranges have been checked for being too narrow, even if only on synthetic teams [P1]. Everyone else either does a plain bootstrap or doesn't say.
4. **Ambiguity as a first-class input.** v1's ambiguity levels match Magennis's complexity multipliers almost exactly [16], but no commercial product has them. ActionableAgile leaves growth to a typed range with a worked example in its docs [1]; LinearB says it is "optimized for fixed-scope projects" [26].
5. **Same answer every time.** Only v1 and the MC Delivery Forecast repo state that results repeat. Focused Objective's spreadsheet changes on every recalculation [16]. For an EM who has to explain a number they gave last week, this matters.
6. **Any start date, past or future.** ActionableAgile also allows this [1]; the platforms all forecast from today.

### Where v1 is behind

1. **No measured pace.** Every Jira, Azure DevOps and SaaS competitor reads throughput directly. v1 makes the EM type counts. This is the biggest functional gap, and it is the post-v1 plan (#133) [P1].
2. **No "how many by date".** ActionableAgile, Nave, Broken Build and Focused Objective all have it [2][15][19][16]; it is the second question stakeholders ask.
3. **No capacity adjustment.** Almost every competitor has a scale factor or focus percentage for holidays and team changes [1][11][16][20][28]. v1 has none, so an EM with half the team away must fudge the pace range.
4. **No risks, scenarios or several teams.** Focused Objective has risk rows [16]; Portfolio Forecaster has scenarios and team roll-up [8].
5. **No real-data track record.** v1's 17.6% is from synthetic steady teams. The only real-data back-test found (MC Delivery Forecast, 85% date right 69% of the time on 29 open-source projects [33]) suggests real teams miss more than simulations predict, which is the PRD's own stated risk [P1].
6. **Distribution and trust.** Incumbents have Marketplace distribution (ActionableAgile 1,413 installs, Broken Build 1,141, Nave 975 [5][19][15]) and security certifications (SOC 2, ISO 27001). A single HTML file has neither, though it also needs neither for a security review, since it sends nothing.

### Gaps no competitor fills

1. **A published calibration track record from real forecasts.** No vendor publishes how often its 85% date was met on customers' real work. Jellyfish's figure that only 24% of dated deliverables were on time [32] shows the problem is large, but it measures due dates, not forecasts. The one open-source back-test failed its own target [33]. A product that published its hit rate would be the first.
2. **Learned growth.** No product measures how much a milestone actually grew in the team's own history and feeds that back in; growth is always typed (ActionableAgile, Focused Objective, v1) or ignored. This matches the earlier note's finding [P2].
3. **Warning when the pace is changing.** v1's pace trend shows a speeding-up or slowing team. No competitor documents a check that the history it resamples is stable, apart from Focused Objective's stability score [16]. Turning v1's trend into a warning that the forecast is likely too confident would be unique.
4. **A forecast that is explainable after the fact.** Combining repeatable results with stated inputs ("which pace the forecast used" [P1]) is something none of the connected tools offer, since their history window moves daily.

---

## Could not verify

- **Jellyfish**: whether any probabilistic finish-date forecast exists; no public docs found.
- **Portfolio Forecaster**: its method (epics in progress, weekly scheduling).
- **ActionableAgile, Nave, Broken Build, Clearlane, LinearB, Swarmia**: the exact resampling scheme (plain bootstrap or otherwise), and whether results repeat.
- **Broken Build**: data residency (privacy policy not fetched); the minimum-history guidance.
- **Empirical Forecasting**: its "highly accurate" claim.
- **Swarmia**: which tier includes the forecast; residency.
- **LinearB**: residency.
- **Linear**: which plans show project predictions.
- **Focused Objective**: that the web tools truly send nothing (vendor claim only); license terms.
- **Wayd PR #889** and the **baytekdev Azure DevOps extension**: not examined.

## Fetch problems

- `actionableagile.com/pricing` redirected (301) to `55degrees.se/products/actionableagile/pricing`, which returned 404; the general pricing page [4] was used instead.
- 55 Degrees' Confluence help pages rendered empty through a normal fetch; their content was read through the Confluence REST API (`/wiki/rest/api/content/{id}?expand=body.view,version`).
- The Jira pricing page was truncated by the fetch tool; prices were read from its schema.org markup.
- Clearlane's pricing API returned 404 because the app is free.

---

## Sources

All accessed 2026-11-07.

- [P1] Project Forecaster, PRD v1, 5 Nov 2026. [../design/prd-v1.md](../design/prd-v1.md)
- [P2] Forecasting approaches for software project work, 2026-10-05. [forecasting-approaches.md](forecasting-approaches.md)
- [1] 55 Degrees, "Monte Carlo: When" (ActionableAgile help), updated 2025-12-11. https://55degrees.atlassian.net/wiki/spaces/AAS/pages/2405826697/Monte+Carlo+When (legacy version, updated 2024-04-22: https://support.55degrees.se/space/AAS/704970977/Monte+Carlo)
- [2] 55 Degrees, "Monte Carlo: How Many", updated 2025-12-11, marked archived. https://55degrees.atlassian.net/wiki/spaces/ActionableAgile/pages/2407399482/Monte+Carlo+How+Many
- [3] 55 Degrees, ActionableAgile Analytics product page, undated. https://www.55degrees.se/products/actionableagileanalytics
- [4] 55 Degrees, Pricing, undated (© 2026). https://www.55degrees.se/pricing
- [5] Atlassian Marketplace, ActionableAgile Analytics (key `aa.analytics`): listing, latest Cloud version and live pricing. https://marketplace.atlassian.com/rest/2/addons/aa.analytics ; `/versions/latest?hosting=cloud` ; `/pricing/cloud/live`
- [6] 55 Degrees, Data Security & Privacy Statement, undated. https://support.55degrees.se/space/SP/4138074121/Data+Security+&+Privacy+Statement
- [7] 55 Degrees, Trust. https://www.55degrees.se/trust
- [8] Atlassian Marketplace, Portfolio Forecaster (key `portfolio-forecaster`). https://marketplace.atlassian.com/rest/2/addons/portfolio-forecaster
- [9] 55 Degrees, "Forecast Scheduling" (not fetched; seen in search only). https://55degrees.atlassian.net/wiki/spaces/FORECASTER/pages/3333914625/Forecast+Scheduling
- [10] 55 Degrees, Portfolio Forecaster product page, undated. https://www.55degrees.se/products/portfolioforecaster
- [11] Nave, Monte Carlo Delivery Date, undated. https://getnave.com/monte-carlo-delivery-date
- [12] Nave, Pricing, undated. https://getnave.com/pricing
- [13] Nave, Integrations, undated. https://getnave.com/integrations
- [14] Nave, Data Processing Agreement, undated. https://getnave.com/data-processing-agreement
- [15] Atlassian Marketplace, Nave Kanban Analytics (key `com.getnave.jira`). https://marketplace.atlassian.com/rest/2/addons/com.getnave.jira
- [15b] Focused Objective, FocusedObjective.Resources repository. https://github.com/FocusedObjective/FocusedObjective.Resources
- [16] Focused Objective, Throughput Forecaster.xlsx (formulas read from the file). https://github.com/FocusedObjective/FocusedObjective.Resources/raw/master/Spreadsheets/Throughput%20Forecaster.xlsx
- [17] Focused Objective, home page and tools. https://www.focusedobjective.com
- [18] Focused Objective, web Throughput Forecaster (© 2026). https://www.focusedobjective.com/throughput
- [19] Atlassian Marketplace, Broken Build Monte Carlo Simulations & Capacity Planning (key `net.brokenbuild.monte-carlo-chart`). https://marketplace.atlassian.com/rest/2/addons/net.brokenbuild.monte-carlo-chart
- [20] Broken Build, Agile Monte Carlo Charts product page, undated. https://www.brokenbuild.net/apps/agile-monte-carlo-charts
- [21] Broken Build, Privacy Policy (not fetched). https://wiki.brokenbuild.net/space/TRUST/38404106/Privacy+Policy
- [22] Atlassian Marketplace REST API, search for "monte carlo". https://marketplace.atlassian.com/rest/2/addons?text=monte%20carlo
- [23] Atlassian Marketplace, Clearlane Burndown & Monte Carlo Forecast for Jira (key `com.clearlaneapps.forecast`). https://marketplace.atlassian.com/rest/2/addons/com.clearlaneapps.forecast
- [24] Atlassian Marketplace, Empirical Forecasting (key `empirical.forecasting`). https://marketplace.atlassian.com/rest/2/addons/empirical.forecasting
- [25] Atlassian Marketplace, AgileLens (key `uk.co.agilelens.app.jira`). https://marketplace.atlassian.com/rest/2/addons/uk.co.agilelens.app.jira
- [26] LinearB, Project Forecast (help), "Updated 10 months ago". https://linearb.helpdocs.io/article/fi3vb3llqd-project-forecast
- [27] LinearB, Pricing, undated. https://linearb.io/pricing
- [28] Swarmia, Forecast (help), undated. https://help.swarmia.com/features/forecast
- [29] Swarmia, changelog, "Initiative forecast", 2026-06-30. https://www.swarmia.com/changelog/2026-06-30-initiative-forecast/
- [30] Swarmia, Pricing, undated. https://www.swarmia.com/pricing/
- [31] Jellyfish, "Jellyfish scenario planning" (blog), 2023-08-15. https://jellyfish.co/blog/jellyfish-scenario-planning/
- [31b] Jellyfish, Software delivery management; Scenario planner. https://jellyfish.co/solutions/software-delivery-management/ ; https://jellyfish.co/solutions/scenario-planner/
- [31c] Jellyfish, Pricing. https://jellyfish.co/pricing/
- [32] Jellyfish, "When is it going to ship? How we engineered a delivery predictability scoring model" (blog), 2024-07-10. https://jellyfish.co/blog/when-is-it-going-to-ship-how-we-engineered-a-delivery-predictability-scoring-model/
- [33] aswinguruswamy, monte-carlo-delivery-forecast (README and back-test results), v1.0.0, 2026-11-03. https://github.com/aswinguruswamy/monte-carlo-delivery-forecast
- [34] Atlassian, "What are capacity and velocity in Advanced Roadmaps?", undated. https://support.atlassian.com/jira-software-cloud/docs/what-are-capacity-and-velocity-in-advanced-roadmaps/
- [35] Atlassian, "View and understand the version report", undated. https://support.atlassian.com/jira-software-cloud/docs/view-and-understand-the-version-report/
- [36] Atlassian, "What is the release burndown report?", undated. https://support.atlassian.com/jira-software-cloud/docs/what-is-the-release-burndown-report/
- [37] Atlassian, Jira pricing (price data stamped 2026-10-13). https://www.atlassian.com/software/jira/pricing
- [38] Microsoft Learn, "Forecast your product backlog in Azure Boards", ms.date 2026-02-28. https://learn.microsoft.com/en-us/azure/devops/boards/sprints/forecast
- [39] Microsoft Learn, "View and configure team velocity", ms.date 2025-12-01. https://learn.microsoft.com/en-us/azure/devops/report/dashboards/team-velocity
- [40] Microsoft, Azure DevOps Services pricing, undated. https://azure.microsoft.com/en-us/pricing/details/devops/azure-devops-services/
- [41] Linear, Project graph (docs), undated. https://linear.app/docs/project-graph
- [42] Linear, Pricing, undated. https://linear.app/pricing
