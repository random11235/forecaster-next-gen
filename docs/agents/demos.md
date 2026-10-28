# Demos

A ticket with a **visible change** ships a **demo**: a screenshot of each screen state it adds or changes, shown in its PR. A visible change is anything the EM sees in the browser: a new screen, a new state of a screen (empty, forecast, warning), or changed wording or layout. When a ticket changes an existing screen, show it before and after. Tickets with no visible change (engine, refactors, docs) show test output as their evidence instead.

## Writing a ticket

Give a ticket with a visible change the acceptance criterion `- [ ] Demo: screenshots of <screen states>`, naming each state to show. Older tickets without that line still ship a demo when their change is visible.

## Capturing

1. Build the app and start it without opening a browser:
   `npm run build && PORT=5199 FORECASTER_NO_BROWSER=1 node dist/app/main.js &`
2. Bring the screen into the state to show, using the canned sample data.
3. Screenshot it with headless Chrome, giving the Geist web fonts time to load (without `--virtual-time-budget`, Chrome can shoot the page in the narrower system font):
   `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --hide-scrollbars --window-size=1280,800 --virtual-time-budget=5000 --screenshot=docs/demos/<issue>-<screen>-<state>.png <url>`
   A state that a URL alone can't reach (it needs clicks or typing) is captured with a browser automation tool instead.
4. Open the image and check it shows the state, then stop the app.
5. Commit the image to the ticket branch under `docs/demos/`.

## Showing

The repo is private, so embed each image by commit SHA, which renders for anyone signed in to GitHub:
`![<state>](https://github.com/random11235/forecaster-next-gen/blob/<sha>/docs/demos/<file>.png?raw=true)`

Put the images under the PR's **Evidence**. Under `/implement-spec`, the implementer captures the demo and reports its paths. The orchestrator then embeds it in the integration PR and in the ticket's `merged` comment.
