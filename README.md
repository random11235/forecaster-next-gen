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

`npm run build:web` writes the whole app as one self-contained page, `dist/web/forecaster.html`, to publish as a claude.ai artifact or on any static host. It runs with no server: each person who opens it gets their own Forecaster, empty at first, with their inputs kept in their own browser. A browser that blocks site data, such as a private window, keeps them only until the page closes.

## Development

- `npm test` runs the tests. The launch smoke test builds the app and runs it with `FORECASTER_NO_BROWSER=1`, which stops it opening a browser, and its data in a temporary `FORECASTER_DATA_FILE`.
- `npm run typecheck` checks types.
