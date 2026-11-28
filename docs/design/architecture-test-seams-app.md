# Architecture: App tests

Part of the test seams; see [`architecture-test-seams.md`](architecture-test-seams.md), whose index is [`architecture.md`](architecture.md).

None of `test/app/` is a forecasting seam: it tests `app/`, the routes, pages and scripts over the views Seam B gives.

## Launch

The launch smoke test builds the app and runs the built `npm start` entry point (`dist/app/main.js`) with `FORECASTER_NO_BROWSER=1`, so no browser opens, and a temporary `FORECASTER_DATA_FILE`; again in demo mode (`FORECASTER_DEMO=1`), on the canned connector built from the synthetic fixture, so no token is needed. `test/app/launch.test.ts` starts the server in-process, on port 0, and sends a foreign `Host` through `node:http`, because `fetch` sets its own.

## Web build

The web build has no seam of its own. `webApp.test.ts` asks its app for screens as its page does. The web build smoke test (`webBuild.test.ts`) runs `npm run build:web` and runs the page's script, as bundled, in Node on a stub of the browser parts it opens with, answering its `fetch` for the Inputs screen's saves, so what the bundling breaks fails a test (#280). It builds the page for a given repo and for none (`webPage` in `scripts/buildWeb.ts`), for what the page links to only with a repo.

The page script (`webMain.ts`) is tested in happy-dom by `webMain.test.ts` (#237): `test/app/webPage.ts` imports it in Vitest's own process, on a happy-dom window put in place of the browser's globals, so coverage counts it, with its storage, history and own `fetch` arranged per test. The globals it stubs are listed on `webPages`.

How either build looks in a real browser is checked by the browser check (`npm run check:browser`, a CI job of its own), which drives the local app and the web build in Chrome from empty to a forecast, and by the ticket's demo.

## Browser scripts

The Inputs screen's scripts are tested in [happy-dom](https://github.com/capricorn86/happy-dom), so no browser is installed, locally or in CI (#275): `inputsScript.test.ts` (`INPUTS_SCRIPT`), `candidatesScript.test.ts` (the Comparable work step's candidates), and `setupStepScripts.test.ts` (`queryStepScript` and `CHECK_SCRIPT`). The scripts run as the browser runs them; the harness answers their requests.

- **The page.** `test/app/browserPage.ts` opens a page of the app at an address nothing serves, with JavaScript on in that helper alone, as it opens only the app's own pages. `pagesOnTracker.ts` opens each test's page and closes it, and its app, after.
- **The app, in-process** (#237). `appInProcess.ts` answers each request the page sends, its scripts' `fetch` and the forms it submits, with the server build's routes on the canned connector and storage in memory (`cannedTrackerApp.ts`, which `appOnTracker.ts` serves the same parts from; `inputsSection.ts` cuts the Inputs screen to a section for either). No server starts and nothing else is faked. A redirect is followed as a browser follows one. Once stopped (`stopApp`), a request fails as one to a stopped server does: a script's `fetch` rejects, a form posted opens a stand-in for the browser's can't-reach page (`CANT_BE_REACHED`), as happy-dom shows none, and any other navigation fails. Each request is kept with the routes' own reply (`requests`), so a test reads what the routes answered, not only what the page shows.
- **happy-dom's gaps.** What its public interface can't do or doesn't say (a failed request, a page at the address its answer came from, a navigation's request told from a script's `fetch`) is done in one adapter, `happyDomAnswers.ts`, which `browserPage.test.ts` pins. happy-dom submits a form as multipart where a browser sends it urlencoded; `browserPage.ts` reads either for the routes.
- **Waiting.** A test fires a field's events (`fieldEvents.ts`), waits for the page to settle (`settled`, which waits out each request and timer, debounces among them), then checks the page and what storage holds. To make answers arrive out of order it holds one back (`holdAnswer`) and waits on what the page shows meanwhile (`until`, which fails saying what it waited for). `settled` fails at once while an answer is held, rather than wait on it.
- **Errors.** `settled`, `until` and opening the page fail on an error the page's scripts left uncaught, as happy-dom reports it on the window (`pageWatch.ts`, shared with `webPage.ts`). A promise rejection left unhandled fails the run through Vitest. `browserPage.test.ts` tests that the page fails these tests fast and says why.

## Components

Each screen's rendering is tested as a component, in `test/app/components/`, with no server started (#236). The component tests aren't a fourth seam: the render functions' files are listed for `app` in `TEST_SEAMS` as the component layer's entry points.

- **What a component test owns.** It calls a render function (`renderInputsScreen`, `renderMilestoneForecastScreen`, `renderHowItWorksScreen`, `queryStepSection`, `candidatesHtml`, setup's `setupStepHtml`, `checkStepHtml`, `setupSummaryHtml` and `setupSkippedHtml`, `connectSection`, `renderPaceTrend`) with a view, and checks what the page offers the EM: regions, headings, fields, buttons and links by role and accessible name, the visible text, and where each form posts. What the view says, and when, is Seam B's, so a component test checks no forecast: a date or count it reads is one the view gave.
- **Arranging a view.** Built by hand or taken whole from Seam B, through `test/forecast/`'s own helpers (`forecastingForTest` and the scenarios beside it), not copies of them. A screen's arrangement shared by its tests is its `*Harness.ts` (`inputsScreenHarness.ts`, `milestoneForecastScreenHarness.ts`, `htmlPageHarness.ts`), as a `*Scenario.ts` is Seam B's.
- **Reading the page.** `test/app/dom.ts` parses the HTML in one happy-dom window with JavaScript off and queries it as a screen reader would: by role and name (`byRole`, `allByRole`, `hasRole`, `accessibleName`; `Role` is the part of ARIA the screens use), by visible text (`text`, which keeps block elements apart and leaves out what is `hidden` and all but the summary of a closed `<details>`), by what a form posts (`postsTo`, `hiddenFields`, `radios`), and by selector only where role and text say too little (`one`, `all`, `around`): a visual state, a block with no role, or what the page carries for its scripts. It also reads the Capacity section's state (`capacitySection`) for both builds' route tests, so `webApp.test.ts` needs no server harness. `screensHarness.ts`'s `text` strips tags from a page served over HTTP, for the tests that fetch one.
- **The page shell.** What every screen's page shares is `htmlPage.test.ts`'s, once for the three screens (`htmlPageHarness.ts`). `htmlPage.feedback.test.ts` gives the shell a repo, as `npm run build` records one (#370), by mocking `src/app/feedbackRepo.js`: the one module the tests mock, as the repo is the build's and no view's. `feedbackForm.test.ts` reads the Feedback form itself, `.github/ISSUE_TEMPLATE/feedback.yml`, which the footer's link fills in.
