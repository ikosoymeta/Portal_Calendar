#!/usr/bin/env bash
# Install/remove a macOS LaunchAgent that runs the exporter on a schedule,
# keeping the Portal's calendar fresh. Runs on the Mac (Portal is USB here;
# `meta` calendar + local adb both work here). launchd is used because macOS
# sandboxes `crontab`.
#
# Usage:
#   scripts/schedule.sh install   # create + load the LaunchAgent
#   scripts/schedule.sh remove    # unload + delete it
#   scripts/schedule.sh status    # show load state
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CFG="$REPO/exporter/config.json"
SYNC="$REPO/exporter/calendar_sync.py"
LABEL="com.ikosoy.portalcalendar"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/portal-calendar.log"
PY="$(command -v python3)"

mins="$(jq -r '.display.refreshMinutes // 5' "$CFG" 2>/dev/null || echo 5)"
secs=$(( mins * 60 ))

action="${1:-status}"
case "$action" in
  install)
    mkdir -p "$HOME/Library/LaunchAgents"
    cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$PY</string>
    <string>$SYNC</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO/exporter</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/opt/facebook/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StartInterval</key><integer>$secs</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST
    domain="gui/$(id -u)"
    launchctl bootout "$domain/$LABEL" 2>/dev/null || true
    if launchctl bootstrap "$domain" "$PLIST" 2>/dev/null; then
      launchctl enable "$domain/$LABEL" 2>/dev/null || true
      echo "installed + loaded: $PLIST (every $mins min). Logs: $LOG"
    else
      echo "installed: $PLIST (every $mins min). Logs: $LOG"
      echo "NOTE: could not load from this shell (needs your GUI session)."
      echo "Load it from a real Terminal with:"
      echo "  launchctl bootstrap gui/\$(id -u) $PLIST"
      echo "(It will also load automatically at your next login.)"
    fi
    ;;
  remove)
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || launchctl unload -w "$PLIST" 2>/dev/null || true
    rm -f "$PLIST"
    echo "removed: $PLIST"
    ;;
  status)
    if launchctl list 2>/dev/null | grep -q "$LABEL"; then
      echo "loaded: $LABEL"; launchctl list | grep "$LABEL"
    else
      echo "not loaded ($PLIST)"
    fi
    ;;
  *)
    echo "usage: $0 {install|remove|status}"; exit 1 ;;
esac
