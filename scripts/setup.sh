#!/usr/bin/env bash
# Configure Portal Calendar for YOUR account.
#
# Calendar data is read via the `meta` CLI, which uses whoever is logged in on
# THIS Mac -- so each user just runs this on their own machine (logged in as
# themselves) to "sign up" with their own @meta.com account. No app sign-in.
#
# Usage: scripts/setup.sh [you@meta.com]
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CFG="$REPO/exporter/config.json"
EX="$REPO/exporter/config.example.json"

SERIAL="$(adb devices 2>/dev/null | awk 'NR>1 && $2=="device"{print $1; exit}')"
[ -n "${SERIAL:-}" ] || { echo "No Portal detected on adb. Connect it (adb devices -l) and retry."; exit 1; }

ACCOUNT="${1:-}"
if [ -z "$ACCOUNT" ]; then
  read -rp "Your work email (the calendar to show, e.g. you@meta.com): " ACCOUNT
fi
[ -n "$ACCOUNT" ] || { echo "An email is required."; exit 1; }

[ -f "$CFG" ] || cp "$EX" "$CFG"
python3 - "$CFG" "$ACCOUNT" "$SERIAL" <<'PY'
import json, sys
path, account, serial = sys.argv[1:4]
c = json.load(open(path))
c["account"] = account
c["serial"] = serial
c.setdefault("display", {})["title"] = account
json.dump(c, open(path, "w"), indent=2)
print(f"Configured {path}\n  account = {account}\n  serial  = {serial}")
PY

echo ""
echo "Make sure you're logged into the meta CLI as yourself:  meta calendar.meeting list --days=1"
echo "Then sync:  python3 exporter/calendar_sync.py --verbose"
echo "(Optional) add Google/Yahoo/Outlook calendars: paste their ICS URLs into exporter/config.json -> calendars[]"
echo "(Optional) auto-refresh:  scripts/schedule.sh install"
