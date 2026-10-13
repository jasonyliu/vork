#!/bin/bash
# Installs wakery as a launchd user agent on macOS: renders the plist template
# with this checkout's path and the node location on PATH, installs it under
# ~/Library/LaunchAgents, and (re)loads it. Idempotent — re-run after a pull.
#
# Migrations are a separate act, performed as the owner role before the first
# start (`npm run migrate`); the process refuses to start on an unmigrated
# database rather than migrating at startup.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WAKERY_DIR="$(dirname "$SCRIPT_DIR")"
DATA_DIR="$(dirname "$WAKERY_DIR")/data"
PLIST_NAME="com.vork.wakery"
PLIST_SRC="$SCRIPT_DIR/$PLIST_NAME.plist"
PLIST_DST="$HOME/Library/LaunchAgents/$PLIST_NAME.plist"
DOMAIN="gui/$(id -u)"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "launchd deployment is macOS only; on another host run 'npm start' under your own supervisor." >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "node not found on PATH; install Node.js 22+ first." >&2
  exit 1
fi
NODE_BIN_DIR="$(dirname "$(command -v node)")"

echo "=== Wakery deployment ==="
echo "Checkout:  $WAKERY_DIR"
echo "Node:      $NODE_BIN_DIR"

# Runtime state directories (gitignored).
mkdir -p "$WAKERY_DIR/var/logs" "$WAKERY_DIR/var/events" "$WAKERY_DIR/var/openclaw-device"

# Dependencies: the app's own, and the data layer it links by path.
if [ ! -d "$DATA_DIR/node_modules" ]; then
  echo "Installing data-layer dependencies..."
  (cd "$DATA_DIR" && npm ci)
fi
if [ ! -d "$WAKERY_DIR/node_modules" ]; then
  echo "Installing dependencies..."
  (cd "$WAKERY_DIR" && npm ci)
fi

# Environment: every secret is read by path; see .env.example.
if [ ! -f "$WAKERY_DIR/.env" ]; then
  echo "No .env found. Copy .env.example and fill it in, then re-run:" >&2
  echo "  cp $WAKERY_DIR/.env.example $WAKERY_DIR/.env" >&2
  exit 1
fi

# Render the plist template.
mkdir -p "$HOME/Library/LaunchAgents"
sed -e "s|@WAKERY_DIR@|$WAKERY_DIR|g" -e "s|@NODE_BIN_DIR@|$NODE_BIN_DIR|g" "$PLIST_SRC" > "$PLIST_DST"
echo "Installed $PLIST_DST"

# (Re)load the agent.
if launchctl print "$DOMAIN/$PLIST_NAME" >/dev/null 2>&1; then
  echo "Stopping the running agent..."
  launchctl bootout "$DOMAIN/$PLIST_NAME"
fi
echo "Starting..."
launchctl bootstrap "$DOMAIN" "$PLIST_DST"

echo ""
echo "=== Wakery installed ==="
echo "Status:  launchctl print $DOMAIN/$PLIST_NAME"
echo "Logs:    tail -f $WAKERY_DIR/var/logs/wakery.stdout.log"
echo "Stop:    launchctl bootout $DOMAIN/$PLIST_NAME"
echo "Start:   launchctl bootstrap $DOMAIN $PLIST_DST"
echo "Migrate: npm run migrate   (as the owner role, before the first start)"
