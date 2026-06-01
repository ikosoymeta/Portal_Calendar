# Portal Calendar — Design

**Date:** 2026-06-01
**Repo:** https://github.com/ikosoymeta/Portal_Calendar
**Author:** ikosoy@meta.com (with Claude Code)
**Status:** Approved architecture; build scaffold pending research

## Goal

Display the `ikosoy@meta.com` work (Google) calendar as an always-on agenda on a
**Portal** device (codename `aloha`/`omni`, model `Portal`, Android 10 / API 29,
arm64-v8a, `user` build, adb serial `821LCM04Z1105A24`). The app must be:

- **Shareable** with other users (no account hard-coding).
- Shipped with **installation, configuration, and summary** user notes.

This is the first app in a reusable Portal-app pipeline; its layout and docs become
the template for future apps.

## Buy vs. build (decided: build)

A pre-built calendar app is **not viable** on this Portal (verified 2026-06-01 via adb):

- **No Google Play Services / Play Store** (`com.google.android.gms`, `com.android.vending` absent)
  → the official Google Calendar app depends on GMS for account sync and won't function.
- No Google account framework; device only has Facebook/`aloha` accounts
  (`com.facebook.aloha.sso`) → a corp `@meta.com` Google account cannot be added.
- Only `com.android.providers.calendar` (AOSP storage provider, no UI) is present.
- `com.facebook.portal.webview` **is** present → WebView is available for a custom app.

## Approach (decided: exporter-push, option C)

On-device OAuth/SSO to a corp Google account is blocked/fragile, so **no authentication
happens on the device**. Instead a scheduled job exports events from an already-authenticated
environment and pushes them to the Portal; the app is a pure display.

### Components

1. **Exporter + pusher** (`exporter/calendar_sync.py`, runs on the **Mac** via cron —
   see "Where things run"):
   - Fetches `ikosoy@meta.com` upcoming events via `meta calendar.meeting list
     --days=N --output=json --columns=...` (verified working 2026-06-01).
   - Normalizes to `events.json`: `{title, start, end, allDay, location, isVideoCall,
     attendeeCount, status}` for the next N days.
   - Pushes with **local adb** (Portal is USB-attached to the Mac):
     `adb -s 821LCM04Z1105A24 push events.json /sdcard/Android/data/<pkg>/files/`
   - Pushes `config.json` the same way (display options).

2. **Portal app** (`PortalCalendar.apk`): one Activity hosting a **full-screen WebView**
   that loads bundled `index.html` + JS/CSS from `assets/`. The Activity reads
   `events.json` + `config.json` from its external files dir and injects them into the
   page via `webView.evaluateJavascript("window.renderCalendar(<json>)")` on a refresh
   timer. (Injection avoids WebView `file://` CORS issues.) Renders a clean agenda +
   clock on black; auto-refreshes every `refreshMinutes`.

3. **Docs** (`docs/INSTALL.md`, `docs/CONFIG.md`, `docs/SUMMARY.md`) — see below.

### Data flow

```
cron (devserver) → fetch ikosoy@meta.com events → events.json
   → ek ar <serial> adb push → /sdcard/Android/data/<pkg>/files/events.json
   → app Activity reads file on timer → evaluateJavascript → WebView re-renders
```

No on-device auth. `adb push` to the app's *external files dir* works on a `user`
build without root.

### Where things run (refined 2026-06-01)

| Task | Host | Why |
|---|---|---|
| **Build APK** | devserver `devvm423` (buck2) | Only Android toolchain available; heavy/occasional |
| **Run exporter cron** | **Mac** (local `adb`) | Portal is USB-attached to Mac → no `ek` bridge needed; `ek connect` requires per-session 2FA, unsuitable for unattended cron. `meta` calendar verified on Mac; devserver has intermittent dCAT failures |
| Ad-hoc remote deploy | devserver via `ek ar … buck install` | Uses the bridge while connected |

## Build & deploy

The **only** Android build environment available is **buck2 + fbsource on the
devserver** (verified: Mac has no JDK/SDK; devserver has no standalone SDK and cannot
reach `dl.google.com`; but fbsource + `buck2` + `maui` + JDK 17 are present, and the
Android SDK is provided by the buck toolchain).

- Source of record lives in this GitHub repo (`app/`). A `scripts/build.sh` syncs the
  app sources + buck target files into a buck-cell location in `fbsource` on the
  devserver (`ek rsync`), runs `buck2 build`, and pulls the resulting APK back to the
  repo as the shareable artifact.
- Deploy: `ek ar 821LCM04Z1105A24 buck install //…:PortalCalendar -r` (or `adb install`
  the pulled APK), then launch via an `am start` intent.
- The APK is signed with a stable dev keystore (checked into `scripts/`) so re-installs
  don't conflict and others can install the same artifact.

**Build scaffold (resolved 2026-06-01 via fbsource research).** Template based on the
real minimal sample `fbandroid/apps/samples/simple`:

- App lives (on the devserver, synced from this repo's `app/`) at
  `fbsource//fbandroid/apps/samples/portal_calendar/` — `fbandroid/apps/samples/` is the
  conventional sample/throwaway area; uncommitted files build fine, **no diff needed**.
- Rules: `fb_android_binary(cpu_filters=["arm64"], keystore=..., manifest=..., deps=[lib])`
  + `fb_core_android_library` + `fb_native.android_resource(assets="assets")` to bundle
  `assets/` (HTML/JS/CSS) → reachable at `file:///android_asset/...`.
- Keystore: depend on the PUBLIC `//fbandroid/keystores:debug_aloha_1p_privapps`
  (aloha/Portal dev key — avoids signature-mismatch installs); `//fbandroid/keystores:debug`
  is the generic fallback.
- Build: `buck2 build fbsource//fbandroid/apps/samples/portal_calendar:portal_calendar_arm64 --show-output`
- Install: `ek ar 821LCM04Z1105A24 buck install fbsource//…:portal_calendar_arm64 -r`
- Keep it a plain `fb_android_binary` (single APK), **not** an AAB (AAB needs `install-multiple`).

## Sharing model

Shareable unit = **signed APK + exporter + docs**. Another user:
1. Sideloads the APK on their Portal (via `adb`/`ek`).
2. Runs their own exporter for their account and schedules it.
Nothing in the app is account-specific; all per-user data is in `config.json`/`events.json`.

## Repo layout (template for all future Portal apps)

```
Portal_Calendar/
  app/            # Android source: WebView shell, AndroidManifest, BUCK, assets/(index.html,js,css)
  exporter/       # calendar_sync.py, requirements.txt, .env.example
  scripts/        # build.sh, deploy.sh, schedule.sh, dev.keystore
  docs/
    INSTALL.md    # bridge setup + sideload + first run
    CONFIG.md     # config.json options + scheduling the exporter (cron)
    SUMMARY.md    # what it does, screenshots, end-user overview
    plans/        # design + implementation plan
```

## Risks / open questions

- ✅ **Calendar data access** — verified 2026-06-01 (`meta calendar.meeting list
  --days=3 --output=json` returns events on the Mac).
- ✅ **buck scaffold** — resolved (template above).
- **Portal launcher**: confirm a sideloaded app launches via `am start` and stays
  foreground on the `aloha` launcher (`user` build may restrict). Verify during build.
- **First buck build** on the devserver may be slow (cold cache) — de-risk with a
  trivial WebView build before wiring the full UI.
- **events.json freshness vs. push cadence**: default 15-min cron; tune later.
- **Build source sync**: `app/` is synced into the Eden checkout for buck builds; keep
  the BUCK/manifest in the repo so the synced tree is self-contained.
```
