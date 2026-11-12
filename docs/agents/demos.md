# Demos

A ticket with a **visible change** ships a **demo**: a screenshot of each screen state it adds or changes, shown in its PR. A visible change is anything the EM sees in the browser: a new screen, a new state of a screen (empty, forecast, warning), or changed wording or layout. When a ticket changes an existing screen, show it before and after. Tickets with no visible change (engine, refactors, docs) show test output as their evidence instead.

## Writing a ticket

Give a ticket with a visible change the acceptance criterion `- [ ] Demo: screenshots of <screen states>`, naming each state to show. Older tickets without that line still ship a demo when their change is visible.

## Capturing

1. Build the app and start it on a new, empty data file, without opening a browser:
   `npm run build && PORT=5199 FORECASTER_NO_BROWSER=1 FORECASTER_DATA_FILE="$(mktemp -d)/demo.db" node dist/app/main.js &`
   For a screen that reads tickets from a tracker, add `FORECASTER_DEMO=1`: demo mode reads them from the canned connector's synthetic fixture (`src/connectors/canned/demoFixture.json`), so no token is needed. Any connection connects, with any token, but for two cues that show the Connect step's refusals: the token `refused` is refused as a tracker refuses a bad token, and a repo or Jira project named `unknown` (like `shop-team/unknown`) isn't found. For example, `curl -d tracker=github -d repo=shop-team/shop -d token=refused http://127.0.0.1:5199/inputs/connect` answers with the Inputs screen saying GitHub refused the token. The Milestone step's flags have cues too: the query `closed:>2026-13-45` is rejected with GitHub's message, `repo:someone/else` reaches outside the repo, `is:open` reads incomplete, and any query the fixture doesn't hold matches nothing.
2. Bring the screen into the state to show by entering its inputs as the EM would: the app starts empty, with no sample data. Post the Inputs screen's forms (for example `curl -d name=Launch -d startDate=2026-11-02 -d ticketsRemaining=30 http://127.0.0.1:5199/inputs/milestone`, then `curl -d low=5 -d high=10 http://127.0.0.1:5199/inputs/pace`), or type them in a browser.
3. Screenshot it with headless Chrome, giving the Geist web fonts time to load (without `--virtual-time-budget`, Chrome can shoot the page in the narrower system font):
   `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --hide-scrollbars --window-size=1280,800 --virtual-time-budget=5000 --screenshot=docs/demos/<issue>-<screen>-<state>.png <url>`
   A state that a URL alone can't reach (it needs clicks or typing) is captured with a browser automation tool instead.
4. Open the image and check it shows the state, then stop the app.
5. Commit the image to the ticket branch under `docs/demos/`.

## Showing

The repo is private, so embed each image by commit SHA, which renders for anyone signed in to GitHub:
`![<state>](https://github.com/random11235/forecaster-next-gen/blob/<sha>/docs/demos/<file>.png?raw=true)`

Put the images under the PR's **Evidence**, as [`pull-requests.md`](pull-requests.md) sets out, including proposed screens from a prototype before they're built. Under `/implement-spec`, the implementer captures the demo and reports its paths. The orchestrator then embeds it in the integration PR and in the ticket's `merged` comment.
