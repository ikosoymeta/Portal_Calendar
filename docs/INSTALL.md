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

The exporter is scheduled with a macOS **LaunchAgent** (not cron — macOS sandboxes
`crontab`). It re-runs every `display.refreshMinutes` minutes:

```bash
scripts/schedule.sh install     # create + load the LaunchAgent
scripts/schedule.sh status      # check
scripts/schedule.sh remove      # unload + delete
```

Logs: `~/Library/Logs/portal-calendar.log`.

> If `install` prints "could not load from this shell", the plist is still
> written — it loads automatically at your next login, or load it now from a real
> Terminal:
> `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.ikosoy.portalcalendar.plist`

## Launching & navigating on the Portal

On a retail Portal **user build**, sideloaded apps do **not** appear in the
curated Apps grid (that list is privileged), so launch the app one of these ways:

- **From the Mac (reliable):** `scripts/open.sh` (or
  `adb -s <SERIAL> shell am start -n com.ikosoy.portalcalendar/.MainActivity`).
- **On-device (if debug settings are enabled):** Portal Settings →
  debug settings → **Android Launcher** → Portal Calendar (requires the
  `aloha_debug_settings` GateKeeper).

Inside the app:

- **⌂ Home button** (top-left) — returns to the Portal home screen. (Back does too.)
- **Tap any event** — opens a detail card (time, location, organizer, attendees,
  notes, and a **Join** button for video calls). Tap × or outside to close.

### Always-on display (optional)

The app sets `FLAG_KEEP_SCREEN_ON`, so it won't sleep while showing. To make the
scheduled sync also re-foreground the app each run (kiosk style), set
`"keepForeground": true` in `exporter/config.json`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `adb` doesn't list the Portal | Reconnect USB; `adb kill-server && adb start-server` |
| App stuck on "Waiting…" | Run the exporter; confirm files exist: `adb -s <SERIAL> shell ls -l /sdcard/Android/data/com.ikosoy.portalcalendar/files/` |
| `meta` returns no data | Run `meta calendar.meeting list --days=1` directly to check access |
| `scripts/build.sh` says no peer | `ek connect <devserver>` in a real terminal, then retry |
| Install fails: signature mismatch | `adb -s <SERIAL> uninstall com.ikosoy.portalcalendar` then reinstall |
| Schedule won't load from shell | Expected — loads at next login, or run the `launchctl bootstrap` line above in a real Terminal |
| App not in the Portal Apps grid | Expected on a user build; launch via `scripts/open.sh` (see Launching above) |
