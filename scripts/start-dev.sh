#!/usr/bin/env bash
# Dev launcher for hotshare-win (Linux).
#  1. Grants root access to the X session (resets when X restarts — without
#     this the dashboard window stays white: "Authorization required").
#  2. Kills any stale app instance (the app is single-instance, so a running
#     one would just focus the broken window instead of restarting).
#  3. Launches the app as root with dev env vars.
set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$REPO_ROOT/apps/hotshare-win"
ELECTRON="$REPO_ROOT/node_modules/.bin/electron"
DISPLAY_NUM="${DISPLAY:-:0.0}"

if [[ ! -x "$ELECTRON" ]]; then
  echo "ERROR: electron binary not found at $ELECTRON" >&2
  echo "Fix: cd $REPO_ROOT && node node_modules/electron/install.js" >&2
  exit 1
fi

echo "==> Granting root access to X session ($DISPLAY_NUM)"
if DISPLAY="$DISPLAY_NUM" xhost +SI:localuser:root; then
  echo "    root authorized (session-scoped; re-runs after X restarts)"
else
  echo "WARNING: could not grant X access — the window may be white. Run:" >&2
  echo "  DISPLAY=$DISPLAY_NUM xhost +SI:localuser:root" >&2
fi

echo "==> Killing stale app instances"
sudo pkill -9 -f "electron/dist/electron" || true
sudo pkill -f "node_modules/.bin/electron" || true
sleep 1

echo "==> Launching hotshare (ctrl-c to stop)"
cd "$APP_DIR" || exit 1
sudo \
  DISPLAY="$DISPLAY_NUM" \
  XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}" \
  HOTSHARE_SKIP_ENTITLEMENT=1 \
  ELECTRON_DISABLE_GPU=1 \
  "$ELECTRON" . --no-sandbox
