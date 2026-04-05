#!/bin/bash
#
# EkyBot Connector — Update Script
#
# Updates the connector to the latest version:
# 1. Pulls latest code from GitHub
# 2. Installs/updates dependencies
# 3. Restarts the companion daemon (if running)
#
# Usage:
#   ./update.sh                     # standard update
#   ./update.sh --no-restart        # update without restarting daemon
#

set -e

CONNECTOR_DIR="${EKYBOT_CONNECTOR_DIR:-$HOME/.openclaw/ekybot-connector}"
NO_RESTART=false

for arg in "$@"; do
  case "$arg" in
    --no-restart) NO_RESTART=true ;;
  esac
done

echo ""
echo "🔄 EkyBot Connector — Update"
echo "=============================="
echo ""

# ── Step 0: Check connector directory exists ─────────────────────────
if [ ! -d "$CONNECTOR_DIR" ]; then
  echo "❌ Connector not found at: $CONNECTOR_DIR"
  echo ""
  echo "   Run setup.sh first to install the connector."
  exit 1
fi

cd "$CONNECTOR_DIR"

if [ ! -d ".git" ]; then
  echo "❌ Not a git repository: $CONNECTOR_DIR"
  echo "   Cannot update — was the connector installed manually?"
  exit 1
fi

# ── Step 1: Save current version ─────────────────────────────────────
OLD_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
echo "📦 Current version: $OLD_COMMIT"

# ── Step 2: Pull latest ──────────────────────────────────────────────
echo "⬇️  Pulling latest changes..."
if ! git pull --ff-only origin main 2>&1; then
  echo ""
  echo "⚠️  Fast-forward pull failed. Trying force reset..."
  git fetch origin main
  git reset --hard origin/main
  echo "✅ Reset to latest origin/main"
fi

NEW_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
if [ "$OLD_COMMIT" = "$NEW_COMMIT" ]; then
  echo "✅ Already up to date ($NEW_COMMIT)"
else
  echo "✅ Updated: $OLD_COMMIT → $NEW_COMMIT"
  echo ""
  echo "📋 Changes:"
  git log --oneline "${OLD_COMMIT}..${NEW_COMMIT}" 2>/dev/null | head -10
fi

# ── Step 3: Install dependencies ─────────────────────────────────────
echo ""
echo "📦 Installing dependencies..."
npm install --production 2>&1 | tail -3

# ── Step 4: Restart daemon ────────────────────────────────────────────
if [ "$NO_RESTART" = true ]; then
  echo ""
  echo "⏭️  Skipping daemon restart (--no-restart)"
else
  echo ""
  echo "🔁 Restarting companion daemon..."

  RESTARTED=false

  # macOS LaunchAgent
  if command -v launchctl &>/dev/null; then
    PLIST_LABEL="com.ekybot.companion"
    if launchctl list 2>/dev/null | grep -q "$PLIST_LABEL"; then
      launchctl kickstart -k "gui/$(id -u)/$PLIST_LABEL" 2>/dev/null && RESTARTED=true
    fi
  fi

  # systemd (Linux)
  if [ "$RESTARTED" = false ] && command -v systemctl &>/dev/null; then
    if systemctl --user is-active ekybot-companion &>/dev/null; then
      systemctl --user restart ekybot-companion && RESTARTED=true
    elif sudo systemctl is-active ekybot-companion &>/dev/null 2>&1; then
      sudo systemctl restart ekybot-companion && RESTARTED=true
    fi
  fi

  # Fallback: kill & restart manually
  if [ "$RESTARTED" = false ]; then
    DAEMON_PID=$(pgrep -f "companion-daemon" 2>/dev/null || true)
    if [ -n "$DAEMON_PID" ]; then
      echo "   Stopping daemon (PID $DAEMON_PID)..."
      kill "$DAEMON_PID" 2>/dev/null || true
      sleep 2
      # Try to restart with nohup
      DAEMON_SCRIPT="$CONNECTOR_DIR/scripts/companion-daemon.js"
      if [ -f "$DAEMON_SCRIPT" ]; then
        ENV_FILE="${EKYBOT_COMPANION_ENV_FILE:-$CONNECTOR_DIR/.env.ekybot_companion}"
        if [ -f "$ENV_FILE" ]; then
          EKYBOT_COMPANION_ENV_FILE="$ENV_FILE" nohup node "$DAEMON_SCRIPT" >> "${HOME}/.openclaw/logs/ekybot-companion.log" 2>&1 &
          RESTARTED=true
          echo "   ✅ Daemon restarted (PID $!)"
        fi
      fi
    fi
  fi

  if [ "$RESTARTED" = true ]; then
    echo "   ✅ Companion daemon restarted"
  else
    echo "   ⚠️  No running daemon found — start it manually if needed"
  fi
fi

# ── Done ──────────────────────────────────────────────────────────────
echo ""
echo "✅ Update complete! ($NEW_COMMIT)"
echo ""
