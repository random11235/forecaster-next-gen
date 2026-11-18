#!/usr/bin/env bash
# Restarts the local app from the checkout this script is in, which .github/workflows/restart-local.yml builds after
# each merge to main. Stops whatever listens on the port, has launchd start the built app (dist/app/main.js) without
# opening a browser, and waits for it to say it's running. If it doesn't come up, prints its output and exits non-zero.
# PORT and FORECASTER_DATA_FILE pass through to the app, as `npm start` reads them. macOS only, as the runner is.
#
# launchd runs the app as a launch agent, forecaster.local-app.<port>, in the user's login session. Started from the
# job instead, the app would be in the runner's session (its launch agent sets SessionCreate), where the login keychain
# is locked and macOS can't ask, so every read of the tracker token is refused (#290). launchd owning the app also
# keeps it running after the job ends and when the runner restarts. The agent is written to ~/Library/LaunchAgents
# (LAUNCH_AGENTS_DIR, which the tests set), so the app also starts at login.
set -euo pipefail

checkout="$(cd "$(dirname "$0")/.." && pwd)"
port="${PORT:-5180}"
log="${TMPDIR:-/tmp}/forecaster-local-$port.log"
label="forecaster.local-app.$port"
agent="gui/$(id -u)/$label"
plist="${LAUNCH_AGENTS_DIR:-$HOME/Library/LaunchAgents}/$label.plist"

listening() { lsof -tiTCP:"$port" -sTCP:LISTEN || true; }

# Stop the app this script started last, then whatever else listens on the port, and wait for it to let go.
launchctl bootout "$agent" 2>/dev/null || true
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

# Start the app: launchd runs it from the agent, with only the environment the agent names.
mkdir -p "$(dirname "$plist")"
rm -f "$plist"
plutil -create xml1 "$plist"
plutil -insert Label -string "$label" "$plist"
plutil -insert ProgramArguments -array "$plist"
plutil -insert ProgramArguments.0 -string "$(command -v node)" "$plist"
plutil -insert ProgramArguments.1 -string "$checkout/dist/app/main.js" "$plist"
plutil -insert WorkingDirectory -string "$checkout" "$plist"
plutil -insert EnvironmentVariables -dictionary "$plist"
plutil -insert EnvironmentVariables.FORECASTER_NO_BROWSER -string 1 "$plist"
plutil -insert EnvironmentVariables.PORT -string "$port" "$plist"
if [ -n "${FORECASTER_DATA_FILE:-}" ]; then
  plutil -insert EnvironmentVariables.FORECASTER_DATA_FILE -string "$FORECASTER_DATA_FILE" "$plist"
fi
plutil -insert StandardOutPath -string "$log" "$plist"
plutil -insert StandardErrorPath -string "$log" "$plist"
plutil -insert RunAtLoad -bool true "$plist"
: >"$log" # emptied here, so the wait below can't read the last run's "running"
launchctl bootstrap "gui/$(id -u)" "$plist"

# Until the app has exited, launchd reports its last exit code as "(never exited)".
alive() { launchctl print "$agent" 2>/dev/null | grep -q 'last exit code = (never exited)'; }

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
  alive || break
  sleep 0.2
done
launchctl bootout "$agent" 2>/dev/null || true
echo "The app didn't start. Its output ($log):" >&2
cat "$log" >&2
exit 1
