# Portal Calendar — Installation

Two install paths: **A) sideload the prebuilt APK** (fastest), or
**B) build from source** with buck2 on a devserver. Both end with the same
exporter setup.

## Prerequisites

- A **Portal** device connected by USB to your Mac.
- `adb` on the Mac (`adb devices` should list the Portal). On Meta Macs:
  `/opt/homebrew/bin/adb`.
- `meta` CLI on the Mac (pre-installed) for calendar access.
- `jq` and `python3` on the Mac.
- For building from source (path B): an `ek` bridge to a devserver with
  `fbsource` + `buck2`. See the repo's parent `CLAUDE.md` for the bridge setup
  (`ek connect <devserver>` in a real terminal; verify with `ek status -p`).

Find your Portal's adb serial:

```bash
adb devices -l        # e.g. 821LCM04Z1105A24  device ... model:Portal
```

## A) Sideload the prebuilt APK (fastest)

```bash
adb -s <SERIAL> install -r dist/PortalCalendar.apk
adb -s <SERIAL> shell am start -n com.ikosoy.portalcalendar/.MainActivity
```

The app opens showing "Waiting for first calendar sync…". Continue to
**Configure the exporter** below.

## B) Build from source

```bash
# 1. Ensure the devserver bridge is up (run in a REAL terminal, complete 2FA):
ek connect <your-devserver>          # e.g. devvm423.maz0.facebook.com
ek status -p                          # should list the peer

# 2. Build (syncs app/ into fbsource, runs buck2, pulls the APK to dist/):
scripts/build.sh

# 3. Install + launch on the Portal:
scripts/deploy.sh
```

## Configure the exporter

```bash
cp exporter/config.example.json exporter/config.json
# edit exporter/config.json: set "account", "serial", and "display.title"
```

Run it once to fetch + push your calendar:

```bash
python3 exporter/calendar_sync.py --verbose
```

Within ~30s the Portal shows your agenda. (Re-open the app to refresh instantly.)

## Keep it fresh (schedule)

Install a cron entry on the Mac that re-runs the exporter every
`display.refreshMinutes` minutes:

```bash
scripts/schedule.sh install     # add
scripts/schedule.sh status      # check
scripts/schedule.sh remove      # remove
```

Logs: `~/Library/Logs/portal-calendar.log`.

## Make it the default screen (optional)

Keep the app foreground; it sets `FLAG_KEEP_SCREEN_ON` so the Portal won't sleep
while it's showing. To return to it after other use, just relaunch:

```bash
adb -s <SERIAL> shell am start -n com.ikosoy.portalcalendar/.MainActivity
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `adb` doesn't list the Portal | Reconnect USB; `adb kill-server && adb start-server` |
| App stuck on "Waiting…" | Run the exporter; confirm files exist: `adb -s <SERIAL> shell ls -l /sdcard/Android/data/com.ikosoy.portalcalendar/files/` |
| `meta` returns no data | Run `meta calendar.meeting list --days=1` directly to check access |
| `scripts/build.sh` says no peer | `ek connect <devserver>` in a real terminal, then retry |
| Install fails: signature mismatch | `adb -s <SERIAL> uninstall com.ikosoy.portalcalendar` then reinstall |
