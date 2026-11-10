# Forecaster

Forecasts when a milestone will finish, from the tickets left, your team's pace and how much the work may grow. Runs locally: no installer, no hosted server.

## Launch

Needs Node.js 24 or later. Once, after cloning:

```sh
npm install
```

Then, to start the Forecaster:

```sh
npm start
```

This starts a local server on `http://127.0.0.1:5180/` (localhost only) and opens it in your browser on the Milestone forecast screen. If the browser doesn't open, open that address by hand. Stop it with Ctrl+C.

To see a forecast, open the Inputs screen, `http://127.0.0.1:5180/inputs`, and enter your milestone: its name, the date work on it starts and how many tickets are left. Then give the team's pace in tickets per period: a low–high range, or typed counts of tickets finished in past periods, and choose which the forecast uses. A period is a week until you set the cadence to your sprint's length in days. Choose how well the milestone's work is understood (low, medium or high ambiguity); the forecast grows the tickets by that level's range, which you can edit in the Growth section. Each simulation picks one growth from the range, every value in it equally likely, and multiplies the tickets remaining by it before working through them at the team's pace, so a wider range spreads the finish dates out.

The How it works screen, `http://127.0.0.1:5180/how-it-works`, explains in pictures why a date from the average pace misleads, how the forecast is worked out, and how to make it better.

To use another port: `PORT=5181 npm start`. `PORT=0` picks a free port.

## Data

Everything is kept in one local SQLite file, `data/forecaster.db` (git-ignored). On first launch, with no data yet, the Forecaster opens empty and asks for your milestone on the Inputs screen. To keep the file elsewhere: `FORECASTER_DATA_FILE=/path/to/forecaster.db npm start`. Delete the file to start again from empty.

## Sharing

`npm run build:web` writes the whole app as one self-contained file, `dist/web/forecaster.html` (about 210 KB). To share the Forecaster, send that file by email, chat or a shared drive: nothing is hosted. A tester opens it in their browser, with no clone or install. It runs with no server and loads nothing from outside, fonts included, so it works offline. Each person who opens it gets their own Forecaster, empty at first, with their inputs kept in their own browser. A browser that blocks site data, such as a private window, keeps them only until the page closes.

The file holds no private data: see the review on [#57](https://github.com/random11235/forecaster-next-gen/issues/57).

## Development

- `npm test` runs the tests. The launch smoke test builds the app and runs it with `FORECASTER_NO_BROWSER=1`, which stops it opening a browser, and its data in a temporary `FORECASTER_DATA_FILE`. It runs it again with `FORECASTER_DEMO=1`, demo mode, which reads tickets from a synthetic fixture instead of a tracker, so no token is needed.
- `npm run typecheck` checks types.
- `npm run record` refreshes the recorded tracker responses the connector tests replay (`npm run record:github` or `npm run record:jira` for one tracker). GitHub's come from the synthetic repo `random11235/forecaster-synthetic`, with a token from the macOS Keychain item `forecaster-github-recording`. Jira's come from the synthetic space `SYN` on `ralphhockley.atlassian.net`, with a token from the Keychain item `forecaster-jira-recording`. That token belongs to the shared test account `forecastertest3@gmail.com`: make it while signed in to Atlassian as that account, since a token works only with its own account's email. Set `FORECASTER_JIRA_EMAIL` only to record as a different account. The tests themselves need no token or network.
