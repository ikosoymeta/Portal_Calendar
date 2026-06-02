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
| `calendars` | (Meta only) | List of calendar sources to merge — see below. |

## Multiple calendars (Google / Yahoo / Outlook)

Add extra calendars via the `calendars` array. Each entry is either your Meta
work calendar (`type: "meta"`) or any calendar's private **iCal/ICS URL**
(`type: "ics"`). No on-device sign-in is needed — the exporter fetches each feed
on the Mac, merges them, and the app shows each source in its own color.

```json
"calendars": [
  { "name": "Work (Meta)", "type": "meta", "color": "#4f9dff" },
  { "name": "Google",  "type": "ics", "url": "<google-ics-url>",  "color": "#34a853" },
  { "name": "Outlook", "type": "ics", "url": "<outlook-ics-url>", "color": "#0078d4" },
  { "name": "Yahoo",   "type": "ics", "url": "<yahoo-ics-url>",   "color": "#7b1fa2" }
]
```

An `ics` entry with an empty `url` is skipped, so fill in only the ones you use.

### Where to get each provider's ICS URL

| Provider | How to get the private iCal/ICS link |
|---|---|
| **Google** | calendar.google.com → Settings → *Settings for my calendars* → pick the calendar → **Integrate calendar** → **Secret address in iCal format** |
| **Outlook / M365** | Outlook → Settings → Calendar → **Shared calendars** → *Publish a calendar* → publish → copy the **ICS** link |
| **Yahoo** | Yahoo Calendar → the calendar's **Actions/Export** → copy the ICS feed URL |

Notes: recurring events (daily/weekly/monthly) are expanded; UTC/`TZID` times are
converted to your Mac's local timezone. Keep these URLs private — anyone with the
link can read that calendar.

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
