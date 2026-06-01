# Portal Calendar — Configuration

All per-user settings live in **`exporter/config.json`** (copy from
`config.example.json`). The exporter reads it, fetches your calendar, and pushes
two files to the device: `events.json` (data) and `config.json` (the `display`
subset below).

## `exporter/config.json`

```json
{
  "account": "you@meta.com",
  "serial": "REPLACE_WITH_ADB_SERIAL",
  "package": "com.ikosoy.portalcalendar",
  "daysAhead": 7,
  "includeDeclined": false,
  "adb": "adb",
  "meta": "meta",
  "display": {
    "title": "you@meta.com",
    "timeFormat": "12h",
    "maxEvents": 50,
    "refreshMinutes": 15
  }
}
```

### Exporter settings

| Key | Default | Meaning |
|---|---|---|
| `account` | — | Your calendar account, shown in logs/header (the `meta` CLI uses the logged-in user). |
| `serial` | — | **Required.** Portal adb serial (`adb devices -l`). |
| `package` | `com.ikosoy.portalcalendar` | App package id; the push target dir derives from it. |
| `daysAhead` | `7` | How many days of events to fetch. |
| `includeDeclined` | `false` | Include meetings you've declined. |
| `keepForeground` | `false` | After each sync, re-launch the app to the foreground (kiosk/always-on). Off by default so it won't steal focus during calls. |
| `adb` | `adb` | Path to the `adb` binary. |
| `meta` | `meta` | Path to the `meta` CLI. |

### Display settings (pushed to the device as `config.json`)

| Key | Default | Meaning |
|---|---|---|
| `title` | account | Text shown top-right on the Portal. |
| `timeFormat` | `12h` | `12h` or `24h`. |
| `maxEvents` | `50` | Max events rendered. |
| `refreshMinutes` | `5` | LaunchAgent `StartInterval` used by `scripts/schedule.sh` (minutes between syncs). |
| `autoScroll` | `true` | Gently auto-scrolls the agenda so a passive viewer sees all events; pauses 15s after any touch. The list is also manually scrollable. |

## On-device refresh

The app re-reads the pushed files every **30s** (constant `REFRESH_MS` in
`app/java/com/ikosoy/portalcalendar/MainActivity.java`) and the clock ticks every
second. Data freshness is driven by how often the exporter runs (`refreshMinutes`).

## Changing the look

The UI is plain web in `app/assets/` — edit and rebuild (`scripts/build.sh`):

- `app.css` — colors (`--bg`, `--accent`, `--now`…), font sizes (in `vh`/`vw`), layout.
- `app.js` — `renderCalendar(events, config)` builds the agenda; `eventHtml()`
  controls each row (icons, fields). Open `app/assets/index.html` directly in a
  browser to preview using `events.sample.json`.
- `index.html` — page structure.

## Changing what data is exported

Edit `exporter/calendar_sync.py`:

- `META_COLUMNS` — columns requested from `meta calendar.meeting list`.
- `normalize()` — maps meta rows → the event objects the UI consumes
  (`title, start, end, allDay, location, isVideoCall, attendeeCount, status`).

## Testing without a device

```bash
python3 exporter/calendar_sync.py --no-push   # writes exporter/out/*.json only
open app/assets/index.html                     # browser preview (sample data)
```
