# Portal Calendar

An always-on **agenda display** for a Meta **Portal** device — your upcoming work
calendar, full-screen on a black background with a live clock.

![Agenda](docs/img/agenda.png)

No sign-in happens on the Portal. A small exporter on your Mac fetches your
calendar via the `meta` CLI and pushes it to the device over `adb`; the app is a
thin WebView that renders it. See **[docs/SUMMARY.md](docs/SUMMARY.md)** for the
full picture.

## Quick start

```bash
# 1. Install the prebuilt, signed APK to your Portal (find serial: adb devices -l)
adb -s <SERIAL> install -r dist/PortalCalendar.apk
adb -s <SERIAL> shell am start -n com.ikosoy.portalcalendar/.MainActivity

# 2. Configure + run the exporter
cp exporter/config.example.json exporter/config.json   # edit account + serial
python3 exporter/calendar_sync.py --verbose

# 3. Keep it fresh (cron on the Mac)
scripts/schedule.sh install
```

Building from source instead? See **[docs/INSTALL.md](docs/INSTALL.md)** (path B,
buck2 on a devserver).

## Docs

- **[SUMMARY.md](docs/SUMMARY.md)** — what it is and how it works
- **[INSTALL.md](docs/INSTALL.md)** — install (prebuilt or from source) + scheduling
- **[CONFIG.md](docs/CONFIG.md)** — every setting + how to customize the look
- **[docs/plans/](docs/plans/)** — design doc

## Layout

```
app/                      Android app — WebView shell + assets/ web UI + BUCK
exporter/calendar_sync.py Fetch calendar (meta CLI) + push to device (adb)
scripts/                  build.sh · deploy.sh · schedule.sh
dist/PortalCalendar.apk   Prebuilt signed APK
```

## Requirements

Mac with `adb`, `meta` CLI, `python3`, `jq`. Portal on USB. Building from source
also needs an `ek` bridge to a devserver with `fbsource` + `buck2`.

---
Built with Claude Code. The exporter uses only the Python standard library.
