#!/usr/bin/env python3
"""Portal Calendar exporter.

Fetches the configured user's Meta (Google) calendar via the `meta` CLI,
normalizes it to events.json, and pushes events.json + config.json to the
Portal device over local adb (the Portal is USB-attached to this Mac).

No authentication happens on the device. Run this on the Mac (where `meta`
calendar access and a local adb connection to the Portal both work), typically
from cron (see scripts/schedule.sh).

Usage:
    python3 calendar_sync.py                 # fetch, write, and push
    python3 calendar_sync.py --no-push       # fetch + write locally only
    python3 calendar_sync.py --config PATH   # use a specific config file
    python3 calendar_sync.py --verbose

Config: exporter/config.json (see config.example.json).
"""

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_CONFIG = os.path.join(HERE, "config.json")

# Columns we ask the meta CLI for. Keep in sync with normalize().
META_COLUMNS = ",".join([
    "subject", "start", "end", "is_all_day", "locations",
    "meeting_link", "response_status", "attendees", "is_canceled",
    "organizer", "body_text",
])

MAX_ATTENDEES = 20


def log(msg):
    print(f"[{datetime.now().isoformat(timespec='seconds')}] {msg}", flush=True)


def load_config(path):
    if not os.path.exists(path):
        sys.exit(f"Config not found: {path} (copy config.example.json to config.json)")
    with open(path) as f:
        return json.load(f)


def fetch_meta(days, meta_bin, verbose=False):
    """Return the parsed JSON array from `meta calendar.meeting list`."""
    cmd = [meta_bin, "calendar.meeting", "list",
           f"--days={days}", "--output=json", f"--columns={META_COLUMNS}"]
    if verbose:
        log("running: " + " ".join(cmd))
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    # meta prints harmless ODS telemetry warnings to stderr; ignore unless empty stdout.
    out = proc.stdout.strip()
    if not out:
        sys.exit(f"meta returned no data (exit {proc.returncode}):\n{proc.stderr[:500]}")
    # stdout may contain trailing non-JSON telemetry lines; grab the JSON array.
    start = out.find("[")
    end = out.rfind("]")
    if start == -1 or end == -1:
        sys.exit(f"could not find JSON array in meta output:\n{out[:500]}")
    return json.loads(out[start:end + 1])


def _is_none(v):
    return v in (None, "", "(none)", "none")


def _to_iso_local(s, all_day):
    """meta gives 'YYYY-MM-DD HH:MM' or 'YYYY-MM-DD'. Return an ISO-local string."""
    if not s:
        return None
    s = s.strip()
    if all_day or len(s) == 10:  # date only
        return s[:10]
    s = s.replace(" ", "T")
    if len(s) == 16:  # 'YYYY-MM-DDTHH:MM'
        s += ":00"
    return s


def _clean_location(loc):
    """Strip leading building/room codes like '[LAX2126.02] ' -> friendly name."""
    if _is_none(loc):
        return ""
    parts = [p.strip() for p in str(loc).split(";")]
    cleaned = []
    for p in parts:
        # drop a leading "[CODE] " prefix if a name follows it
        if p.startswith("[") and "]" in p:
            after = p[p.index("]") + 1:].strip()
            cleaned.append(after or p)
        else:
            cleaned.append(p)
    return "; ".join([c for c in cleaned if c])


def _attendee_names(attendees):
    """meta attendees -> list of short display names (email local-part)."""
    if not isinstance(attendees, list):
        return []
    names = []
    for a in attendees[:MAX_ATTENDEES]:
        email = a.get("email") if isinstance(a, dict) else str(a)
        if not email:
            continue
        names.append(email.split("@")[0].replace(".", " ").title())
    return names


def normalize(rows, include_declined=False):
    events = []
    for r in rows:
        if str(r.get("is_canceled", "")).lower() == "yes":
            continue
        status = (r.get("response_status") or "").lower()
        if not include_declined and status == "declined":
            continue
        all_day = str(r.get("is_all_day", "")).lower() == "yes"
        attendees = r.get("attendees")
        attendee_count = len(attendees) if isinstance(attendees, list) else 0
        meeting_link = r.get("meeting_link")
        organizer = r.get("organizer")
        notes = r.get("body_text") or ""
        if len(notes) > 1000:
            notes = notes[:1000].rstrip() + "…"
        events.append({
            "title": r.get("subject") or "(no title)",
            "start": _to_iso_local(r.get("start"), all_day),
            "end": _to_iso_local(r.get("end"), all_day),
            "allDay": all_day,
            "location": _clean_location(r.get("locations")),
            "isVideoCall": not _is_none(meeting_link),
            "joinUrl": "" if _is_none(meeting_link) else meeting_link,
            "organizer": "" if _is_none(organizer) else organizer,
            "attendees": _attendee_names(attendees),
            "attendeeCount": attendee_count,
            "notes": notes.strip(),
            "status": status,
        })
    events.sort(key=lambda e: e["start"] or "")
    return events


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f, indent=2)
    os.replace(tmp, path)


def adb_push(adb_bin, serial, package, local_path, remote_name, verbose=False):
    files_dir = f"/sdcard/Android/data/{package}/files"
    base = [adb_bin, "-s", serial]
    # Ensure the app's external files dir exists (may not before first launch).
    subprocess.run(base + ["shell", "mkdir", "-p", files_dir],
                   capture_output=True, text=True)
    cmd = base + ["push", local_path, f"{files_dir}/{remote_name}"]
    if verbose:
        log("running: " + " ".join(cmd))
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise RuntimeError(f"adb push failed: {proc.stderr.strip() or proc.stdout.strip()}")


def main():
    ap = argparse.ArgumentParser(description="Portal Calendar exporter")
    ap.add_argument("--config", default=DEFAULT_CONFIG)
    ap.add_argument("--no-push", action="store_true", help="write local files only")
    ap.add_argument("--verbose", "-v", action="store_true")
    args = ap.parse_args()

    cfg = load_config(args.config)
    account = cfg.get("account", "")
    days = int(cfg.get("daysAhead", 7))
    serial = cfg.get("serial")
    package = cfg.get("package", "com.ikosoy.portalcalendar")
    adb_bin = cfg.get("adb", "adb")
    meta_bin = cfg.get("meta", "meta")
    display = dict(cfg.get("display", {}))
    display.setdefault("title", account or "Portal Calendar")
    out_dir = os.path.join(HERE, "out")

    log(f"fetching {days}d of calendar for {account or '(default account)'}")
    rows = fetch_meta(days, meta_bin, verbose=args.verbose)
    events = normalize(rows, include_declined=bool(cfg.get("includeDeclined", False)))
    log(f"normalized {len(events)} events (from {len(rows)} rows)")

    events_obj = {
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "account": account,
        "events": events,
    }
    events_path = os.path.join(out_dir, "events.json")
    config_path = os.path.join(out_dir, "config.json")
    write_json(events_path, events_obj)
    write_json(config_path, display)
    log(f"wrote {events_path} and {config_path}")

    if args.no_push:
        log("--no-push set; skipping device push")
        return

    if not serial:
        sys.exit("config.serial is required to push (set the Portal adb serial)")
    adb_push(adb_bin, serial, package, config_path, "config.json", verbose=args.verbose)
    adb_push(adb_bin, serial, package, events_path, "events.json", verbose=args.verbose)
    log(f"pushed to {serial}:/sdcard/Android/data/{package}/files/")

    # Optional kiosk behavior: bring the app to the foreground so the display
    # stays up and current. Off by default (don't steal focus during calls).
    if cfg.get("keepForeground"):
        subprocess.run([adb_bin, "-s", serial, "shell", "am", "start", "-n",
                        f"{package}/.MainActivity"], capture_output=True, text=True)
        log("kept app in foreground (keepForeground=true)")


if __name__ == "__main__":
    main()
