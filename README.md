# Forecaster

Forecasts when a milestone will finish, from your team's measured pace and growth. Runs locally: no installer, no hosted server.

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

To see a forecast, enter your team's pace (a low–high range of tickets per week) on the Inputs screen, `http://127.0.0.1:5180/inputs`. The Inputs screen is also where you define the milestone (its name, committed date and epics) and add, remove or reorder its epics after a scope change.

To use another port: `PORT=5181 npm start`. `PORT=0` picks a free port.

## Data

Everything is kept in one local SQLite file, `data/forecaster.db` (git-ignored). On first launch, with no data yet, it is filled with canned sample data, so you can see how the Forecaster works before connecting Jira. To keep the file elsewhere: `FORECASTER_DATA_FILE=/path/to/forecaster.db npm start`. Delete the file to start again from the sample data.

## Development

- `npm test` runs the tests. The launch smoke test builds the app and runs it with `FORECASTER_NO_BROWSER=1`, which stops it opening a browser, and its data in a temporary `FORECASTER_DATA_FILE`.
- `npm run typecheck` checks types.
