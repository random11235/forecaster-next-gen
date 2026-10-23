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

To use another port: `PORT=5181 npm start`. `PORT=0` picks a free port.

## Development

- `npm test` runs the tests. The launch smoke test builds the app and runs it with `FORECASTER_NO_BROWSER=1`, which stops it opening a browser.
- `npm run typecheck` checks types.
