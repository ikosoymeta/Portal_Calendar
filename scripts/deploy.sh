#!/usr/bin/env bash
# Install dist/PortalCalendar.apk to the Portal (local adb) and launch it.
# Reads the adb serial + package from exporter/config.json.
#
# Usage: scripts/deploy.sh
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CFG="$REPO/exporter/config.json"
APK="$REPO/dist/PortalCalendar.apk"

[ -f "$APK" ] || { echo "ERROR: $APK not found. Run scripts/build.sh first."; exit 1; }
[ -f "$CFG" ] || { echo "ERROR: $CFG not found. Copy exporter/config.example.json -> config.json."; exit 1; }

SERIAL="$(jq -r '.serial' "$CFG")"
PKG="$(jq -r '.package' "$CFG")"
ADB="$(jq -r '.adb // "adb"' "$CFG")"

echo "installing $APK -> $SERIAL"
"$ADB" -s "$SERIAL" install -r "$APK"
echo "launching $PKG/.MainActivity"
"$ADB" -s "$SERIAL" shell am start -n "$PKG/.MainActivity"
echo "done. Run the exporter to push calendar data: python3 exporter/calendar_sync.py"
