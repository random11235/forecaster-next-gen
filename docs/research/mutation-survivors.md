# Mutation survivors: should every one be killed?

Research date: 2026-11-21. Scope: how to triage a mutant that survives on a source line a pull request changes, in this repo's setup: StrykerJS 10.1.1 with the Vitest runner, run in CI on the changed lines only ([`scripts/mutateDiff.ts`](../../scripts/mutateDiff.ts), [`stryker.config.mjs`](../../stryker.config.mjs)), against tests written at the seams in [`architecture-test-seams.md`](../design/architecture-test-seams.md). Today CI reports the score and uploads the HTML report; no threshold fails the build and nothing acts on survivors ([`ci.yml`](../../.github/workflows/ci.yml), the `mutation` job). It tests the view that killing every survivor is an anti-pattern. It covers Google's published experience, peer-reviewed work on equivalent mutants and on mutation score, and StrykerJS's own docs, plus the practice of one sibling project (section 2). It does not cover other tools (PIT, mutmut) or test generation.

Citation convention: bracketed numbers such as [4] refer to the **Sources** list at the end. Every source was read on 2026-11-21. Where a claim could not be checked against a primary source, the text says "**Unverified**". Sections marked **Synthesis** are my own reasoning from the evidence, not claims made by any source. Figures carry the year of the study they come from.

---

## 1. What the sources say

### 1.1 Google mutates changed, covered lines and shows survivors in code review

- Google runs mutation testing only on the lines a change adds or modifies, and only on lines that tests cover [1]. Lack of coverage is already reported by the coverage analysis, so uncovered lines are not mutated [3].
- It makes at most one mutant per line [1][2][3], and caps the mutants per change: "no more than seven mutants are reported per file" (2021) [3].
- Survivors appear as findings in the code review tool. Each has a "Please fix" link for reviewers and a "Not useful" link for anyone [1][4].
- Google does not compute or show a mutation score. It could not "find a good way to surface it to the engineers in an actionable way" (2018) [1]. The share of mutants killed (87.5% in 2021) "is not the same as the traditional mutation score", because only a sample is generated [4].
- Mutants on one line mostly share a fate: "In more than 90% of cases, either all mutants in a line are killed, or none are" (2021) [3].

### 1.2 Arid nodes: whole classes of mutants are suppressed before anyone sees them

- An arid node is code where a mutant is not worth a test. Examples: logging, `std::vector::reserve`, writes to stdout, flag defaults, sleeps and deadlines, memoisation, imports [1]. A compound node (an `if`, a loop) is arid when all its children are [1][4].
- The rules come from "Not useful" feedback. "If we decide a certain mutation is not useful and that the whole class of mutants should not be created, the rule is added." It is manual [1][4].
- Google calls this "the critical part of the system because, without it, users would become frustrated with non-actionable feedback and opt out of the system altogether" [1].
- By 2021 there were "more than one hundred rules", and name-matching rules for "more than 200 function families" [4]. A sample of 100 nodes the logging rule marked arid found 99 correct [4].
- Some rules are unsound: they "may suppress productive mutants". Google found the unsound rules gave "much more important improvements" than the sound ones [4].
- Google dropped one whole operator, ABS, because its mutants were "predominantly not useful" in its codebase, and says this may not apply elsewhere [1].
- For JavaScript, low usefulness was blamed on "mutants in nodes associated with type annotations and module imports" (2018) [1].

### 1.3 Developer feedback: most surfaced survivors are useful, but only after suppression

| Figure | Source and year |
|---|---|
| Usefulness rose "from 20% to 80%" with feedback-driven suppression | [1] 2018, [2] 2018 |
| 75% of findings with feedback were useful | [1] 2018 |
| "developers at Google initially classified 85% of reported mutants as unproductive" | [4] 2021 |
| Productivity went "from about 15% to 80%", then "to 89%"; 82% aggregate | [4] 2021 |

The two papers give different starting points (20% useful vs 15%). Both agree the early, unsuppressed rate was poor, and that suppression made it good. Only mutants with explicit feedback are counted [4].

### 1.4 Developers are not expected to kill every mutant

- "The author may choose to kill a mutant by adding a test case, to change the code, or to ignore that mutant. The reviewers can instruct the author to kill a mutant, unless the author can provide a satisfying counterargument for why it is not useful to do so" [2].
- "Lesson 1: Some mutants shouldn't be killed" [2]. "The results suggest that achieving mutation adequacy is neither practical nor desirable" [2]. "A rational goal for a developer is to just make a test suite better, but not mutation adequate" [2].
- "We count on code authors to push back on introducing tests to kill unproductive mutants, and we count on reviewers to push back on low quality tests, specifically written to kill mutants" [3].
- Tests written only to kill some mutants can harm: "their change-detector nature (specifically testing the current implementation rather than the specification) violates testing best practices and causes brittle tests and false alarms" [4].

### 1.5 Productive and unproductive mutants

- Definition: "A mutant is productive if 1) the mutant is killable and elicits an effective test, or 2) the mutant is equivalent but its analysis advances knowledge and code quality" [2]. The judgement "is inherently qualitative" [2].
- Unproductive killable examples: an exception or log message emptied; `>` to `>=` on a float; a collection's initial capacity; a sleep duration; deleting Python `del` [2][4].
- Productive equivalent examples: a mutant that reveals a result discarded and recomputed, a premature optimisation, or ambiguous code that can be refactored "so that the mutant becomes, in fact, killable" [2]. Developers "decided to remove code with an equivalent mutant because they deemed it a premature optimization" [2].
- "In our experience, redundant and equivalent mutants have been less problematic than unproductive non-redundant and non-equivalent mutants" [2]; "reporting equivalent mutants has been a vastly easier problem" [4].
- Cost study (2018, three Defects4J Lang subjects, ≥95% statement coverage): developer tests left 20.5% of mutants alive. Of the survivors, about half could still be killed [2]. Triage took 4.6 minutes per mutant on average, 32.8 hours in all [2]. 140 of 428 examined (32.7%) were unproductive. Killing an unproductive mutant took 5.2 minutes, more than judging one equivalent (3.5 minutes) [2].

### 1.6 Effect on test quality over time

- Six years and about 15 million mutants at Google (2021) [3]:
  - The more mutants a file was exposed to, the more test hunks changed (Spearman rs = 0.9); coverage alone showed no such trend (rs = −0.24) [3].
  - Survival of new mutants in a file fell with exposure (rs = −0.50) [3].
  - Reviewers asked for fewer fixes over time (rs = −0.34) [3].
  - Live mutants per change: median 1 at review start, 0 at submit [3].
  - "We did not find evidence that developers write minimal tests for reported mutants" [3].
- Fault coupling: for 70% of 1,502 high-priority bugs, a live mutant would have been reported on the change that introduced the bug [3]. Earlier, on 357 real faults in five Java programs, 73% were coupled to mutants, and mutant detection correlated with real-fault detection independently of coverage (2014) [7]. 17% of real faults were not coupled to any mutant [7].
- Limit: the 2021 study is "not a fully randomized controlled experiment"; it tests three alternative explanations and rejects them [3].

### 1.7 Equivalent mutants: how many survivors are they?

- Deciding equivalence is undecidable [5][6].
- In samples of 50 unkilled first-order mutants per program, 11 to 33 were equivalent, i.e. 22% to 66% (2014, Java) [5].
- Madeyski et al. cite Schuler and Zeller: 45% of 140 uncaught mutants in seven Java programs were equivalent, at about 15 minutes per mutant [5]. **Unverified** against Schuler and Zeller directly.
- The high share "comes from the fact that several non-equivalent mutants are already caught by the test suite" [5]. A stronger suite leaves a survivor pool richer in equivalents.

### 1.8 Mutation score and the 100% target

- Score treats all mutants as equal, which "is not true". Equivalent mutants pull the score down; redundant ones inflate it. "The accuracy of the score metric is questionable" [6].
- The survey reports a "threshold behaviour": score and fault revelation are strongly linked only at high scores; below that, the score is "completely disconnected from fault-revelation" [6]. This is the survey's summary of Chekam et al.; **Unverified** against that paper.
- StrykerJS's own page on equivalent mutants ends: "don't be scared of not 100% mutation score!" [12].
- Google: "aiming at mutation adequacy is hopeless" at its scale; 100% coverage "is neither the norm nor considered desirable in many cases" [2].

### 1.9 StrykerJS: what the states mean (docs for 10.1.1)

- **Survived**: "all tests passed while this mutant was active" [11].
- **No coverage**: "The mutant isn't covered by one of your tests and survived as a result" [11]. It counts as undetected, so it lowers the score [11]. Stryker tells it from Survived only with coverage analysis, whose default is `perTest` [9].
- **Ignored**: not tested; "will not count against your mutation score but will show up in reports" [11]. Disabled mutants get this status, with their reason [8].
- **Compile error**, **Runtime error**: not in the score [11].
- Score = detected / valid; a second score uses covered mutants only [11].
- "Equivalent" is not a state. The equivalent-mutants page (last changed 2020-10-23) says there is "no way yet to mark them to be ignored" [12]. That is out of date: disable comments arrived in Stryker 5.4 [8].

### 1.10 Where the sources disagree or are silent

- **High score vs no target.** The survey says the score means most near the top [6]. Google says adequacy is not worth pursuing and shows no score at all [1][2]. They measure different things: [6] is about suites judged by score in studies, [1][2] about developers acting on a few mutants per change.
- **Sound vs unsound suppression.** Google prefers unsound rules for usefulness [4], but warns that surfacing only developer-preferred mutants "may bias the resulting test set with respect to faults in developer blind spots" [2].
- **Silent:** no source tests a build-breaking threshold on a diff's score. No source studies tests written at seams rather than units. No source gives survivor rates for StrykerJS's mutator set, which differs from Google's five operators [1].

---

## 2. Prior practice in a sibling project

This section is **practice, not evidence**. It records what one other project does. Nobody has measured its outcomes. I read the files myself on 2026-11-21 [14].

- **Where it runs.** Locally only. Commit `fb484a7` ("Remove the CI workflow again") deleted `.github/workflows/check.yml`, and none of its remaining workflows mention mutation [14]. Mutation is step 4 of the project's local "Verification checks" before a change to `app/` counts as complete (`AGENTS.md`) [14]. ProjectForecaster, by contrast, runs it in CI on every PR ([`ci.yml`](../../.github/workflows/ci.yml)).
- **What it mutates.** `scripts/mutate-diff.ts` mutates only the lines the branch changed, and only under `TESTED_ROOTS`: `app/lib/`, `app/modules/` and `request-logger/` [14]. Route modules are left out because "no test imports one of them"; the script says that gap is closed by writing a test first, not by mutation testing [14]. This is an arid-code exclusion made by directory, a coarse form of Google's arid nodes [1][4]. It also skips the NoCoverage mutants Google never surfaces [3].
- **Config.** `stryker.conf.mjs` sets `incremental: true`, adds the `json` reporter, and sets no thresholds, ignorers or checkers [14]. It sets `coverageAnalysis: "off"` because Vitest's related-test search fails on its path aliases [14]. With coverage analysis off, Stryker cannot tell NoCoverage from Survived [9], so an uncovered mutant inside `TESTED_ROOTS` shows up as Survived.
- **Policy.** The skill `.agents/skills/mutation-testing/SKILL.md` says to act on every Survived and NoCoverage mutant. "A survivor is a review comment on the **test**, not on the implementation." For each one, "either tighten the test until it fails against `replacement`, or state why that behaviour is unspecified and the mutant is accepted." It is "Done when every `Survived` and `NoCoverage` mutant in the report is accounted for" [14].
- **What has been accepted.** One disable comment in the code, at `app/lib/watch-history.server.ts:104`: `` // Stryker disable next-line OptionalChaining: max() with no GROUP BY always returns one row, so `furthest` is never undefined. `` [14]. It names the mutator and gives an invariant as the reason, which is the form [8] describes. It is an equivalent mutant.
- **The peer's suggested process:** (a) equivalent or unobservable: disable with a reason; (b) behaviour specified or relied on: add or tighten a test; (c) arid: accept and record why, or add an ignorer; (d) NoCoverage in an untested file: write the test first, don't chase the mutant.
- **The peer's own caveat.** Nothing enforces "every survivor accounted for". The peer suggests that on diff-scoped runs a `break` threshold of even 100 is cheap, with the disable-with-reason comment as the escape hatch. Nothing in the project sets it today [14].

---

## 3. Synthesis: a decision process for one survivor on a changed line

**The user's view, tested.** The sources back "killing every survivor is an anti-pattern" [2][3][4]. They do not back treating survivors as noise. Once the unproductive classes were suppressed, 80–89% of surfaced survivors were judged useful [4], and in a strong suite about two-thirds of examined survivors were productive [2]. Before suppression, most were not [1][4]. So the default for a survivor is to act on it. Triage exists to catch the minority, and to turn each repeated "no" into a rule so it stops recurring.

**Triage the line, not each mutant.** StrykerJS makes many mutants per line; Google makes one. On a line, mutants mostly share a fate [3], so several survivors on one line usually share one cause. Answer the questions once per line, then check the leftovers.

### The questions, in order

| # | Question | If yes | Support |
|---|---|---|---|
| 0 | Is it **No coverage**? | No test runs this changed line. Write a seam test that reaches it, or remove the code. Not a mutant question. | Google never mutates uncovered lines; coverage reports them [1][3]. |
| 1 | Does the mutant change behaviour a **seam** can observe (a view, an outcome, a stored fact, a forecast), and does that behaviour matter? | **Kill it with a seam test.** Assert the behaviour, not the mutant. This is the expected outcome. | 80–89% useful after suppression [4]; coupling to real bugs [3][7]; tests got stronger, not minimal [3]. |
| 2 | Is no seam able to see it because the **code makes no difference** (dead branch, redundant guard, recomputed value, premature cache)? | **Remove or simplify the code.** Rewriting so the mutant cannot occur is also StrykerJS's advice. | Productive equivalent mutants [2]; [12]. |
| 3 | Is it **equivalent**, with the code still needed (for clarity or a type)? | **Mark it equivalent**: a disable comment naming the mutator, with the reason. | Equivalence is undecidable, so a human records it [5][6]; ignored mutants leave the score [11]. |
| 4 | Is it **killable only by a change-detector test**: log or error text, timing, capacity, a value only internals see? | **Accept it with a reason**: a disable comment saying why no test is wanted. | Unproductive killable mutants [2][4]; change-detector tests are harmful [4]. |
| 5 | Has the **same pattern** been accepted or marked before (here, or in a past PR)? | **Suppress the pattern in config**: an ignorer plugin for a code shape, or exclude a mutator. Note the decision where the config is. | Google's arid rules from "Not useful" feedback [1][4]; ABS dropped [1]. |

Notes on each step:

- **Step 1 is the seam test, not a unit test.** The sources never study seam-style tests; they are silent. But [4]'s change-detector warning fits this repo's seam rule exactly. If killing a mutant needs a test against `forecast/lib/`, the honest outcomes are 2, 3 or 4, not a test that breaks the seam.
- **Step 2 before 3.** An equivalent mutant is often a sign of removable code [2]. Ask whether the code is needed before writing "equivalent" on it.
- **Who decides.** At Google the author decides and a reviewer may insist, "unless the author can provide a satisfying counterargument" [2]. Here that maps to: the PR author answers each survivor, and the reviewer can overrule. A reason in a disable comment is the counterargument, written down.
- **Step 5 has a cost.** Unsound rules can hide productive mutants [4] and build blind spots [2]. A rule should be narrow, named and justified, and sampled now and then, as Google sampled its logging rule [4].
- **Removing code is missing from the sibling's process.** Its steps (a)–(d) map onto steps 0, 1, 3 and 4–5 above, and its skill frames every survivor as a fault in the test [14]. Google and Stryker both name a third answer: change or delete the code [2][12]. Keep step 2.

### Weighing "every survivor accounted for, with `break: 100`" against "not every survivor needs killing"

These two do not conflict. `break: 100` does not demand a kill. Ignored mutants leave the score [8][11], so a survivor with a disable comment and a reason passes. It demands only that every survivor gets an *outcome*, written down. That is Google's rule, "kill it unless the author can provide a satisfying counterargument" [2], with the counterargument stored in the code instead of a review thread.

For it:

- It closes the gap the peer names: today, in both projects, a survivor can be ignored silently.
- On a diff-scoped run the score covers only the PR's lines, so 100 is reachable, and here [`mutateDiff.ts`](../../scripts/mutateDiff.ts) already exits 1 when Stryker does, so the gate needs one config line [9].
- The reason in each comment is reviewable and countable (section 4, measure 7).

Against it:

- No source tested a score gate [1][2][3][4], and Google chose not to show a score at all [1]. The gate is untested here.
- Without arid rules, Google's developers rated 80–85% of mutants unproductive [1][4]. If this repo is near that, a hard gate turns most survivors into disable comments. Google warned that such noise makes people "opt out of the system altogether" [1]. Here, opting out looks like `// Stryker disable all` with a thin reason.
- A gate pushes toward whatever clears it fastest. Where a disable comment is harder to justify than a test, that is a change-detector test, which [4] calls harmful. Where it is easier, it is a rubber-stamp comment. Review has to catch both [3].
- **Unverified:** how Stryker scores a run with no valid mutants (a diff of only arid or type-only lines). Check that it does not fail before turning the gate on.

On balance (my inference): the sibling's rule, "every survivor accounted for", is the right rule and fits the evidence. Making it a `break: 100` gate is reasonable once step 5 has absorbed the common noise: name the mutator, never `all`, and watch measures 2 and 7. If the disable rate stays high, the gate is costing more than it gives. Until then, enforce it in review, as Google does [2][3].

---

## 4. Synthesis: what to measure

These follow Google's own measures [1][3][4], scaled to one repo. None of the thresholds below come from a source.

1. **Survivors per PR, and per changed line.** Record each PR's survivor count, and divide it by the source lines the run mutated (the lines `scripts/mutationTargets.ts` passes to Stryker, not the PR's whole diff). The raw count is the triage load a PR brings. The per-line rate compares PRs of different sizes: a run of rising rates says new code is landing less well tested, whatever the PR's size. Google reports survivors per change only after its suppression [1][4], so there is no outside benchmark for an unsuppressed rate. The first few PRs set the baseline.
2. **Outcome mix per PR.** Count survivors by outcome: killed by a seam test, code removed, equivalent, accepted, suppressed. The useful share is (killed + removed) / all. This is the local form of Google's "Please fix" rate [4]. Google's early rate was 15–20% and its mature rate 80–89% [1][4].
3. **Trend in that share.** It should rise as step 5 adds rules, as it did at Google [1][4]. If it stays low after a few rules, mutation testing is costing more than it gives.
4. **Survival on files touched again.** For files changed in several PRs, track the share of new mutants that survive. It should fall, as Google's did (rs = −0.50) [3].
5. **Bugs it would have caught.** For each bug fix, check whether a mutant on the change that introduced the bug survived then. Google found this for 70% of high-priority bugs [3]. A small sample here is still evidence.
6. **Cost.** CI minutes for the `mutation` job, and the time to triage a survivor. Google's benchmark is about 4.6 minutes each [2]. Watch whether PRs with survivors take longer to merge; Google found a small effect only for the smallest changes [2].
7. **Suppression health.** Count disable comments and ignorer rules. Sample them now and then and check each still holds [4]. A growing count of "accepted" with no rule means step 5 is being skipped.

---

## 5. StrykerJS mechanics for each outcome

All from the StrykerJS docs at v10.1.1 (released 2026-10-23) [8][9][10], unless marked.

- **Kill with a seam test.** Add the test under `test/<folder>/`, then rerun `npm run test:mutation`. To rerun only some lines, Stryker takes a mutation range on `--mutate`, e.g. `src/app.js:5-7` [9], which is what `mutateDiff.ts` already passes.
- **Remove the code.** Nothing to configure. The line leaves the diff.
- **Mark equivalent, or accept with a reason.** A comment on the line above, naming the mutator and giving the reason after a colon [8]:

  ```ts
  // Stryker disable next-line EqualityOperator: equivalent; max and min are equal when the branch is taken
  ```

  Syntax: `// Stryker [disable|restore] [next-line] mutatorList[: custom reason]` [8]. Name the mutator rather than `all`, which hides every mutant on the line [8]. The mutant stays in the report as Ignored, with the reason, and leaves the score [8][11]. Mutator names are in the clear-text and HTML reports [8]. Use different wording for the two outcomes (e.g. start with "equivalent:" or "no test wanted:") so they can be counted. This prefix is my convention, not Stryker's.
- **Suppress a pattern.** Two tools [8][9]:
  - An **ignorer plugin**: a module that declares `PluginKind.Ignore` with `shouldIgnore(path)` over the Babel AST, returning a reason string to ignore that node and its children. Turn it on with `ignorers: ['name']` and add the file to `plugins` [8]. This is the closest match to Google's arid-node rules [1][4]. Type `path` as `babel.NodePath` from `@stryker-mutator/core` [8].
  - **Exclude a mutator**: `mutator: { excludedMutations: ['StringLiteral'] }` [9]. The docs call this "a shotgun approach" [8]. Keep it for a mutator that is unproductive across this codebase, as Google did with ABS [1].
  - `ignoreStatic: true` drops mutants that run only when a module loads; it needs `coverageAnalysis: 'perTest'`, the default [9]. It is a speed setting, not a productivity one.
- **No coverage.** Shown as NoCoverage when coverage analysis is on, which it is by default [9][11].
- **Thresholds.** `thresholds: { high: 80, low: 60, break: null }` is the default; `break` exits with code 1 below the given score [9]. This repo sets none, so the default applies and nothing breaks. To make "every survivor has an outcome" a gate, set `thresholds: { break: 100 }`; disable comments are the escape hatch because Ignored mutants leave the score [8][11]. See the weighing in section 3.
- **Incremental mode.** `--incremental` keeps results in `reports/stryker-incremental.json` and reuses a result when the mutant and its tests are unchanged [10]. Vitest gets full test-change detection [10]. It does not see changes outside mutated and test files, such as dependencies [10]. It could speed up local reruns while triaging; it is not needed for CI's diff runs.
- **Type-error mutants.** Stryker adds `// @ts-nocheck` so mutants run even when they break types [9]. The TypeScript checker plugin marks such mutants as CompileError instead [13]. This repo's config notes that Stryker's use of TypeScript's JS API no longer works with TypeScript 7 ([`stryker.config.mjs`](../../stryker.config.mjs)); whether the checker works here is **Unverified**. Until it does, a survivor whose mutated code would not type-check needs no test. Treat it as step 4, or as a step 5 pattern if it recurs. Google likewise suppresses mutants that would not compile [4].

---

## Sources

- [1] G. Petrović, M. Ivanković, "State of Mutation Testing at Google", ICSE-SEIP 2018, pp. 163–171, DOI 10.1145/3183519.3183521. Google-hosted PDF: https://storage.googleapis.com/gweb-research2023-media/pubtools/4203.pdf (listing: https://research.google/pubs/state-of-mutation-testing-at-google/). Read 2026-11-21.
- [2] G. Petrović, M. Ivanković, B. Kurtz, P. Ammann, R. Just, "An Industrial Application of Mutation Testing: Lessons, Challenges, and Research Directions", Mutation 2018 workshop at ICST (ICSTW 2018). Author PDF: https://homes.cs.washington.edu/~rjust/publ/industrial_mutation_icst_2018.pdf. Read 2026-11-21.
- [3] G. Petrović, M. Ivanković, G. Fraser, R. Just, "Does mutation testing improve testing practices?", ICSE 2021, pp. 910–921. arXiv:2103.07189v1 (2021-03-12): https://arxiv.org/pdf/2103.07189. Read 2026-11-21.
- [4] G. Petrović, M. Ivanković, G. Fraser, R. Just, "Practical Mutation Testing at Scale: A view from Google", IEEE TSE 2021, DOI 10.1109/TSE.2021.3107634 (accepted version). Author PDF: https://homes.cs.washington.edu/~rjust/publ/practical_mutation_testing_tse_2021.pdf. Read 2026-11-21.
- [5] L. Madeyski, W. Orzeszyna, R. Torkar, M. Józala, "Overcoming the Equivalent Mutant Problem: A Systematic Literature Review and a Comparative Experiment of Second Order Mutation", IEEE TSE 40(1), 2014, DOI 10.1109/TSE.2013.44. Preprint v.2: https://madeyski.e-informatyka.pl/download/Madeyski14TSE.pdf. Read 2026-11-21.
- [6] M. Papadakis, M. Kintis, J. Zhang, Y. Jia, Y. Le Traon, M. Harman, "Mutation Testing Advances: An Analysis and Survey", Advances in Computers 112, 2019. Preprint dated 2017-12-14: https://mutationtesting.uni.lu/survey.pdf. Read 2026-11-21.
- [7] R. Just, D. Jalali, L. Inozemtseva, M. D. Ernst, R. Holmes, G. Fraser, "Are Mutants a Valid Substitute for Real Faults in Software Testing?", FSE 2014, pp. 654–665. Author PDF: https://homes.cs.washington.edu/~mernst/pubs/mutation-effectiveness-fse2014.pdf. Read 2026-11-21.
- [8] StrykerJS docs, "Disable mutants", `docs/disable-mutants.md` at tag v10.1.1 (released 2026-10-23). https://github.com/stryker-mutator/stryker-js/blob/v10.1.1/docs/disable-mutants.md ; site: https://stryker-mutator.io/docs/stryker-js/disable-mutants/. Read 2026-11-21.
- [9] StrykerJS docs, "Configuration", `docs/configuration.md` at tag v10.1.1: `coverageAnalysis`, `disableTypeChecks`, `ignorers`, `ignoreStatic`, `incremental`, `mutate`, `mutator`, `thresholds`. https://github.com/stryker-mutator/stryker-js/blob/v10.1.1/docs/configuration.md. Read 2026-11-21.
- [10] StrykerJS docs, "Incremental", `docs/incremental.md` at tag v10.1.1. https://github.com/stryker-mutator/stryker-js/blob/v10.1.1/docs/incremental.md. Read 2026-11-21.
- [11] Stryker, "Mutant states and metrics", `mutation-testing-elements/docs/mutant-states-and-metrics.md`, last changed 2023-04-14. https://stryker-mutator.io/docs/mutation-testing-elements/mutant-states-and-metrics/. Read 2026-11-21.
- [12] Stryker, "Equivalent mutants", `mutation-testing-elements/docs/equivalent-mutants.md`, last changed 2020-10-23 (predates disable comments). https://stryker-mutator.io/docs/mutation-testing-elements/equivalent-mutants/. Read 2026-11-21.
- [13] StrykerJS docs, "TypeScript Checker", `docs/typescript-checker.md` at tag v10.1.1. https://github.com/stryker-mutator/stryker-js/blob/v10.1.1/docs/typescript-checker.md. Read 2026-11-21.
- [14] A sibling project of the owner's, not public: `scripts/mutate-diff.ts`, `stryker.conf.mjs`, `.agents/skills/mutation-testing/SKILL.md`, `app/lib/watch-history.server.ts` (line 104), `AGENTS.md` ("Verification checks"), and commit `fb484a7` (2026-10-15, removes `.github/workflows/check.yml`). Practice, not evidence. Read 2026-11-21.
