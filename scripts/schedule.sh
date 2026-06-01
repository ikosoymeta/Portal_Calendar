#!/usr/bin/env bash
# Install (or remove) a Mac crontab entry that runs the exporter on a schedule,
# keeping the Portal's calendar fresh. Runs on the Mac because the Portal is
# USB-attached here (local adb) and `meta` calendar access works here.
#
# Usage:
#   scripts/schedule.sh install     # add cron entry (every <refreshMinutes>)
#   scripts/schedule.sh remove      # remove it
#   scripts/schedule.sh status      # show current entry
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CFG="$REPO/exporter/config.json"
SYNC="$REPO/exporter/calendar_sync.py"
LOG="$HOME/Library/Logs/portal-calendar.log"
PY="$(command -v python3)"
TAG="# portal-calendar-exporter"

action="${1:-status}"
mins="$(jq -r '.display.refreshMinutes // 15' "$CFG" 2>/dev/null || echo 15)"
line="*/$mins * * * * cd $REPO/exporter && $PY $SYNC >> $LOG 2>&1 $TAG"

current="$(crontab -l 2>/dev/null || true)"
without="$(echo "$current" | grep -vF "$TAG" || true)"

case "$action" in
  install)
    printf '%s\n%s\n' "$without" "$line" | sed '/^$/d' | crontab -
    echo "installed (every $mins min). Logs: $LOG"
    crontab -l | grep -F "$TAG"
    ;;
  remove)
    printf '%s\n' "$without" | sed '/^$/d' | crontab -
    echo "removed."
    ;;
  status)
    echo "$current" | grep -F "$TAG" || echo "not installed"
    ;;
  *)
    echo "usage: $0 {install|remove|status}"; exit 1 ;;
esac
