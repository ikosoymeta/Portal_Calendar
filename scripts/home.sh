#!/usr/bin/env bash
# Send the Portal back to its Home screen from any app (sideloaded apps on the
# Portal hide the nav bar and have no on-screen Home button). Uses adb KEYCODE_HOME.
#
# Usage: scripts/home.sh            # auto-detects the connected Portal
set -euo pipefail
SERIAL="$(adb devices | awk 'NR>1 && $2=="device"{print $1; exit}')"
[ -n "${SERIAL:-}" ] || { echo "No adb device connected."; exit 1; }
adb -s "$SERIAL" shell input keyevent KEYCODE_HOME
echo "sent HOME to $SERIAL"
