#!/usr/bin/env bash
# Restarts the local app from the checkout this script is in, which .github/workflows/restart-local.yml builds after
# each merge to main. Stops whatever listens on the port, starts the built app (dist/app/main.js) without opening a
# browser, and waits for it to say it's running. If it doesn't come up, prints its output and exits non-zero.
# PORT and FORECASTER_DATA_FILE pass through to the app, as `npm start` reads them.
set -euo pipefail

checkout="$(cd "$(dirname "$0")/.." && pwd)"
port="${PORT:-5180}"
log="${TMPDIR:-/tmp}/forecaster-local-$port.log"

listening() { lsof -tiTCP:"$port" -sTCP:LISTEN || true; }

# Stop whatever listens on the port, and wait for it to let go.
pids="$(listening)"
if [ -n "$pids" ]; then
  kill $pids 2>/dev/null || true
  for _ in $(seq 50); do
    [ -n "$(listening)" ] || break
    sleep 0.2
  done
  pids="$(listening)"
  [ -z "$pids" ] || kill -9 $pids 2>/dev/null || true
fi

# Start the app. It must outlive the workflow job and the runner: when a job ends, the runner kills every process
# carrying the job's RUNNER_TRACKING_ID, so the app is started without it; and when the runner's service stops or
# updates itself, launchd kills its process group, so the app starts in a session of its own (setsid, through perl,
# as macOS has no setsid command; exec keeps the pid).
cd "$checkout"
: >"$log" # emptied here, not in the background, so the wait below can't read the last run's "running"
env -u RUNNER_TRACKING_ID FORECASTER_NO_BROWSER=1 PORT="$port" \
  nohup perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV' node dist/app/main.js >"$log" 2>&1 </dev/null &
app=$!

# Wait for it to say it's running; if it exits or takes too long, show what it printed.
for _ in $(seq 150); do
  if grep -q 'Forecaster running at' "$log"; then
    cat "$log"
    # Open pages reconnect to /live by themselves, and reload if the version changed. If none has after a few
    # seconds, open one tab.
    sleep 3
    if ! lsof -nP -iTCP:"$port" -sTCP:ESTABLISHED >/dev/null; then
      open "http://127.0.0.1:$port/"
    fi
    exit 0
  fi
  kill -0 "$app" 2>/dev/null || break
  sleep 0.2
done
kill "$app" 2>/dev/null || true
echo "The app didn't start. Its output ($log):" >&2
cat "$log" >&2
exit 1
