# Driving the app in a browser

To check that a change works in the real app, or to reproduce a bug a person reported, **ask the page**: drive it with [agent-browser](https://github.com/vercel-labs/agent-browser) and read the answer from the DOM. A screenshot is pixels you have to interpret. Text, a count or a URL gives you a yes or a no. A change you haven't asked the page about is a change you're reporting on trust.

`curl` and a search of the returned HTML already answer questions about a single server-rendered screen, and more cheaply. Use the browser when the question needs a page script to run: an Inputs save, the candidate and query finders, the web build, an error in the page's own script, or a flow across screens. When the browser finds a bug, the fix still starts with a failing test at a seam (see `docs/design/architecture-test-seams.md`).

## Once per machine

```bash
npm install -g agent-browser@0.41.2
agent-browser install
```

`agent-browser install` downloads its own Chrome for Testing. npm warns that it skipped the package's postinstall script. The CLI works without it.

## The loop

Start the app as in step 1 of [`demos.md`](demos.md), on a new data file with `FORECASTER_NO_BROWSER=1`, and add `FORECASTER_DEMO=1` for tracker screens. Then:

```bash
agent-browser open http://127.0.0.1:5199/inputs
agent-browser snapshot -i                 # the controls, each with a ref (e26) to act on
agent-browser fill e26 "Launch"           # or: find label "Tickets remaining" fill 30
agent-browser press Tab                   # the save fires on change and focus-out
agent-browser wait --load networkidle     # and finishes here
agent-browser errors --clear
agent-browser open http://127.0.0.1:5199/
agent-browser get text main               # the answer: "Launch · 30 tickets remaining …"
agent-browser errors --json               # did the page's script throw?
agent-browser close
```

`agent-browser --help` lists the rest (`click`, `is visible`, `get count`, `eval`, `screenshot`, `set viewport`).

## What bites

- **Navigating straight after a `fill` loses the edit.** Inputs saves with a `fetch` on `change` or focus-out, so `open` straight after `fill` leaves before the save is sent. `press Tab`, then `wait --load networkidle`, before you move on.
- **Plain `errors` hides the message.** In 0.41.2 it prints a bare `✗` for each error. `errors --json` gives each one's text and stack. Errors pile up across pages, so `errors --clear` before the step you're checking.
- **A command can fail without saying whether it ran.** Something like `Resource temporarily unavailable (os error 35) … it may or may not have run` means re-read the state before assuming either way. When a later command reports `page_wedged`, `agent-browser close` and open the page again.
- **A rebuilt app reloads open pages.** Each page reloads itself when `/live` reports a version other than the one it was served with (`src/app/launch.ts`). Restart the app between checks, not in the middle of one.

## The web build

`npm run build:web` writes `dist/web/forecaster.html`. Open it as `file://$PWD/dist/web/forecaster.html`. Screens live in the URL fragment (`#/inputs`), and the data lives in the browser's `localStorage` under `forecaster`. Start from empty with `agent-browser eval 'localStorage.clear()'`, then open the page again. `curl` can't run the web build, so the browser is the only way to check it.

## Screenshots

A demo's screenshots still follow [`demos.md`](demos.md). `agent-browser set viewport 1280 800` and then `agent-browser screenshot <path>` captures a state that needs clicks or typing to reach. Before shooting, check the fonts have loaded: `agent-browser eval 'document.fonts.status'` answers `loaded`.
