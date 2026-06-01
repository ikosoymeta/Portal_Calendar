#!/usr/bin/env bash
# Launch (foreground) Portal Calendar on the device from the Mac.
# On a retail Portal user build, sideloaded apps don't appear in the curated
# Apps grid, so this adb launch is the reliable way to open it on demand.
#
# Usage: scripts/open.sh
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CFG="$REPO/exporter/config.json"
SERIAL="$(jq -r '.serial' "$CFG")"
PKG="$(jq -r '.package' "$CFG")"
ADB="$(jq -r '.adb // "adb"' "$CFG")"

"$ADB" -s "$SERIAL" shell am start -n "$PKG/.MainActivity"
echo "launched $PKG on $SERIAL"
