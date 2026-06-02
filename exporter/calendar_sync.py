#!/usr/bin/env python3
"""Portal Calendar exporter — multi-calendar (Meta CLI + ICS feeds).

Fetches one or more calendars, merges them into events.json, and pushes it (plus
config.json) to the Portal over local adb. Two source types:

  - "meta": the user's Meta (Google) work calendar via the `meta` CLI.
  - "ics" : any Google / Yahoo / Outlook calendar via its private iCal/ICS URL
            (no sign-in needed). Get the URL from each provider:
              Google : Settings -> Integrate calendar -> "Secret address in iCal format"
              Outlook: Calendar -> Publish -> ICS link
              Yahoo  : Calendar -> (export/ICS feed)

Configure sources in exporter/config.json under "calendars" (see config.example.json).
Each event is tagged with its source name + color; the app shows a colored bar.

Stdlib only. Usage: python3 calendar_sync.py [--no-push] [--verbose] [--config PATH]
"""

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.request
from datetime import datetime, timedelta, date

try:
    from zoneinfo import ZoneInfo
except Exception:  # pragma: no cover
    ZoneInfo = None

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_CONFIG = os.path.join(HERE, "config.json")

META_COLUMNS = ",".join([
    "subject", "start", "end", "is_all_day", "locations",
    "meeting_link", "response_status", "attendees", "is_canceled",
    "organizer", "body_text",
])
MAX_ATTENDEES = 20
VIDEO_RE = re.compile(
    r'https?://[^\s<>"]*(?:zoom\.us|meet\.google\.com|teams\.microsoft\.com|webex\.com)[^\s<>"]*',
    re.I)
LOCAL_TZ = datetime.now().astimezone().tzinfo


def log(msg):
    print(f"[{datetime.now().isoformat(timespec='seconds')}] {msg}", flush=True)


def load_config(path):
    if not os.path.exists(path):
        sys.exit(f"Config not found: {path} (copy config.example.json to config.json)")
    with open(path) as f:
        return json.load(f)


def _is_none(v):
    return v in (None, "", "(none)", "none")


# --------------------------------------------------------------------------- #
# Meta CLI source
# --------------------------------------------------------------------------- #
def fetch_meta(days, meta_bin, verbose=False, limit=500):
    # NOTE: `meta calendar.meeting list` defaults to --limit=10, which silently
    # truncates the calendar. Pass a high limit so all events in the window return.
    cmd = [meta_bin, "calendar.meeting", "list",
           f"--days={days}", f"--limit={limit}", "--output=json", f"--columns={META_COLUMNS}"]
    if verbose:
        log("running: " + " ".join(cmd))
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    out = proc.stdout.strip()
    if not out:
        sys.exit(f"meta returned no data (exit {proc.returncode}):\n{proc.stderr[:500]}")
    s, e = out.find("["), out.rfind("]")
    if s == -1 or e == -1:
        sys.exit(f"could not find JSON array in meta output:\n{out[:500]}")
    return json.loads(out[s:e + 1])


def _clean_location(loc):
    if _is_none(loc):
        return ""
    parts = [p.strip() for p in str(loc).split(";")]
    cleaned = []
    for p in parts:
        if p.startswith("[") and "]" in p:
            after = p[p.index("]") + 1:].strip()
            cleaned.append(after or p)
        else:
            cleaned.append(p)
    return "; ".join([c for c in cleaned if c])


def _attendee_names(attendees):
    if not isinstance(attendees, list):
        return []
    names = []
    for a in attendees[:MAX_ATTENDEES]:
        email = a.get("email") if isinstance(a, dict) else str(a)
        if email:
            names.append(email.split("@")[0].replace(".", " ").title())
    return names


def _iso_local_meta(s, all_day):
    if not s:
        return None
    s = s.strip()
    if all_day or len(s) == 10:
        return s[:10]
    s = s.replace(" ", "T")
    if len(s) == 16:
        s += ":00"
    return s


def normalize_meta(rows, include_declined=False):
    events = []
    for r in rows:
        if str(r.get("is_canceled", "")).lower() == "yes":
            continue
        status = (r.get("response_status") or "").lower()
        if not include_declined and status == "declined":
            continue
        all_day = str(r.get("is_all_day", "")).lower() == "yes"
        attendees = r.get("attendees")
        link = r.get("meeting_link")
        notes = (r.get("body_text") or "")[:1000]
        events.append({
            "title": r.get("subject") or "(no title)",
            "start": _iso_local_meta(r.get("start"), all_day),
            "end": _iso_local_meta(r.get("end"), all_day),
            "allDay": all_day,
            "location": _clean_location(r.get("locations")),
            "isVideoCall": not _is_none(link),
            "joinUrl": "" if _is_none(link) else link,
            "organizer": "" if _is_none(r.get("organizer")) else r.get("organizer"),
            "attendees": _attendee_names(attendees),
            "attendeeCount": len(attendees) if isinstance(attendees, list) else 0,
            "notes": notes.strip(),
            "status": status,
        })
    return events


# --------------------------------------------------------------------------- #
# ICS source (Google / Yahoo / Outlook iCal feeds)
# --------------------------------------------------------------------------- #
def fetch_ics(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": "PortalCalendar/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
    return raw.decode("utf-8", "replace")


def _unfold(text):
    # RFC5545 line folding: a CRLF followed by space/tab continues the prev line.
    return text.replace("\r\n", "\n").replace("\r", "\n").replace("\n ", "").replace("\n\t", "")


def _unescape(v):
    return (v.replace("\\n", "\n").replace("\\N", "\n").replace("\\,", ",")
             .replace("\\;", ";").replace("\\\\", "\\"))


def _parse_vevents(text):
    events, cur = [], None
    for line in _unfold(text).split("\n"):
        if line == "BEGIN:VEVENT":
            cur = {}
        elif line == "END:VEVENT":
            if cur is not None:
                events.append(cur)
            cur = None
        elif cur is not None and ":" in line:
            name_part, value = line.split(":", 1)
            bits = name_part.split(";")
            name = bits[0].upper()
            params = {}
            for p in bits[1:]:
                if "=" in p:
                    k, val = p.split("=", 1)
                    params[k.upper()] = val
            # keep first occurrence except EXDATE which may repeat
            if name == "EXDATE":
                cur.setdefault("_EXDATE", []).append((value, params))
            elif name not in cur:
                cur[name] = (value, params)
    return events


def _parse_dt(value, params):
    """Return (datetime|date, all_day). Datetimes are tz-aware (local)."""
    value = value.strip()
    if params.get("VALUE") == "DATE" or (len(value) == 8 and "T" not in value):
        return date(int(value[0:4]), int(value[4:6]), int(value[6:8])), True
    z = value.endswith("Z")
    v = value[:-1] if z else value
    dt = datetime(int(v[0:4]), int(v[4:6]), int(v[6:8]),
                  int(v[9:11]), int(v[11:13]), int(v[13:15]) if len(v) >= 15 else 0)
    if z:
        from datetime import timezone
        dt = dt.replace(tzinfo=timezone.utc)
    elif params.get("TZID") and ZoneInfo:
        try:
            dt = dt.replace(tzinfo=ZoneInfo(params["TZID"]))
        except Exception:
            dt = dt.replace(tzinfo=LOCAL_TZ)
    else:
        dt = dt.replace(tzinfo=LOCAL_TZ)
    return dt.astimezone(LOCAL_TZ), False


def _iso_local_dt(dt, all_day):
    if all_day:
        return dt.strftime("%Y-%m-%d") if isinstance(dt, (date, datetime)) else str(dt)
    return dt.strftime("%Y-%m-%dT%H:%M:%S")


def _parse_rrule(s):
    d = {}
    for part in s.split(";"):
        if "=" in part:
            k, v = part.split("=", 1)
            d[k.upper()] = v
    return d


_WD = {"MO": 0, "TU": 1, "WE": 2, "TH": 3, "FR": 4, "SA": 5, "SU": 6}


def _expand(dtstart, rr, win_start, win_end, exset, all_day):
    """Yield occurrence start datetimes within [win_start, win_end]."""
    freq = rr.get("FREQ")
    if not freq:
        return [dtstart] if win_start <= dtstart <= win_end else []
    interval = max(1, int(rr.get("INTERVAL", 1) or 1))
    count = int(rr["COUNT"]) if rr.get("COUNT") else None
    until = None
    if rr.get("UNTIL"):
        try:
            until, _ = _parse_dt(rr["UNTIL"], {})
        except Exception:
            until = None
    out, emitted, it, MAXIT = [], 0, 0, 4000

    def emit(occ):
        nonlocal emitted
        if until and occ > until:
            return False
        if count is not None and emitted >= count:
            return False
        emitted += 1
        key = occ.strftime("%Y%m%dT%H%M%S")
        if win_start <= occ <= win_end and key not in exset and occ >= dtstart:
            out.append(occ)
        return True

    if freq == "WEEKLY":
        days = ([_WD[d[-2:]] for d in rr["BYDAY"].split(",")] if rr.get("BYDAY")
                else [dtstart.weekday()])
        anchor = dtstart - timedelta(days=dtstart.weekday())
        w = 0
        while it < MAXIT:
            it += 1
            base = anchor + timedelta(weeks=w * interval)
            w += 1
            if base > win_end + timedelta(days=7):
                break
            stop = False
            for wd in sorted(days):
                occ = (base + timedelta(days=wd)).replace(
                    hour=dtstart.hour, minute=dtstart.minute, second=dtstart.second)
                if occ < dtstart:
                    continue
                if not emit(occ):
                    stop = True
                    break
            if stop:
                break
    elif freq == "DAILY":
        occ = dtstart
        while it < MAXIT and occ <= win_end:
            it += 1
            if not emit(occ):
                break
            occ = occ + timedelta(days=interval)
    elif freq == "MONTHLY":
        k = 0
        while it < MAXIT:
            it += 1
            mm = (dtstart.month - 1) + k * interval
            k += 1
            yy, mo = dtstart.year + mm // 12, mm % 12 + 1
            try:
                occ = dtstart.replace(year=yy, month=mo)
            except ValueError:
                continue
            if occ > win_end:
                break
            if not emit(occ):
                break
    else:
        if win_start <= dtstart <= win_end:
            out.append(dtstart)
    return out


def ics_to_events(text, days, include_declined=False):
    now = datetime.now(LOCAL_TZ)
    win_start = now - timedelta(hours=2)
    win_end = now + timedelta(days=days)
    today = now.date()
    end_date = (now + timedelta(days=days)).date()
    events = []
    for ev in _parse_vevents(text):
        if "DTSTART" not in ev:
            continue
        if (ev.get("STATUS", ("", {}))[0] or "").upper() == "CANCELLED":
            continue
        dval, dpar = ev["DTSTART"]
        start, all_day = _parse_dt(dval, dpar)
        # duration
        if "DTEND" in ev:
            end, _ = _parse_dt(ev["DTEND"][0], ev["DTEND"][1])
        else:
            end = start + (timedelta(days=1) if all_day else timedelta(hours=1))
        dur = (end - start) if not all_day else None

        summary = _unescape(ev.get("SUMMARY", ("(no title)", {}))[0])
        loc = _unescape(ev.get("LOCATION", ("", {}))[0])
        desc = _unescape(ev.get("DESCRIPTION", ("", {}))[0])
        org = ev.get("ORGANIZER", ("", {}))[0].replace("mailto:", "")
        m = VIDEO_RE.search(desc) or VIDEO_RE.search(loc)
        join = m.group(0) if m else ""

        def make(s):
            if all_day:
                ds = s if isinstance(s, date) else s.date()
                if not (today <= ds <= end_date):
                    return None
                st, en = ds.strftime("%Y-%m-%d"), ds.strftime("%Y-%m-%d")
            else:
                en_dt = s + dur if dur else s + timedelta(hours=1)
                if en_dt < win_start or s > win_end:
                    return None
                st, en = _iso_local_dt(s, False), _iso_local_dt(en_dt, False)
            return {
                "title": summary or "(no title)", "start": st, "end": en,
                "allDay": all_day, "location": loc, "isVideoCall": bool(join),
                "joinUrl": join, "organizer": org, "attendees": [],
                "attendeeCount": 0, "notes": desc.strip()[:1000], "status": "",
            }

        if "RRULE" in ev and not all_day:
            exset = set()
            for exv, exp in ev.get("_EXDATE", []):
                for piece in exv.split(","):
                    try:
                        ed, _ = _parse_dt(piece, exp)
                        exset.add(ed.strftime("%Y%m%dT%H%M%S"))
                    except Exception:
                        pass
            for occ in _expand(start, _parse_rrule(ev["RRULE"][0]),
                               win_start, win_end, exset, all_day):
                e = make(occ)
                if e:
                    events.append(e)
        else:
            e = make(start)
            if e:
                events.append(e)
    return events


# --------------------------------------------------------------------------- #
def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f, indent=2)
    os.replace(tmp, path)


def adb_push(adb_bin, serial, package, local_path, remote_name, verbose=False):
    files_dir = f"/sdcard/Android/data/{package}/files"
    base = [adb_bin, "-s", serial]
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
    ap.add_argument("--no-push", action="store_true")
    ap.add_argument("--verbose", "-v", action="store_true")
    args = ap.parse_args()

    cfg = load_config(args.config)
    account = cfg.get("account", "")
    days = int(cfg.get("daysAhead", 7))
    serial = cfg.get("serial")
    package = cfg.get("package", "com.ikosoy.portalcalendar")
    adb_bin = cfg.get("adb", "adb")
    meta_bin = cfg.get("meta", "meta")
    include_declined = bool(cfg.get("includeDeclined", False))

    # Backward compatible: no "calendars" -> single Meta source.
    calendars = cfg.get("calendars") or [
        {"name": account or "Calendar", "type": "meta", "color": "#4f9dff"}]

    all_events, sources = [], []
    for cal in calendars:
        name = cal.get("name", cal.get("type", "cal"))
        color = cal.get("color", "#4f9dff")
        ctype = cal.get("type", "meta")
        sources.append({"name": name, "color": color})
        try:
            if ctype == "meta":
                rows = fetch_meta(days, meta_bin, verbose=args.verbose,
                                  limit=int(cfg.get("metaLimit", 500)))
                evs = normalize_meta(rows, include_declined)
            elif ctype == "ics":
                if not cal.get("url"):
                    log(f"skip '{name}': ics calendar has no url")
                    continue
                if args.verbose:
                    log(f"fetching ICS '{name}': {cal['url'][:60]}...")
                evs = ics_to_events(fetch_ics(cal["url"]), days, include_declined)
            else:
                log(f"skip '{name}': unknown type '{ctype}'")
                continue
        except Exception as e:
            log(f"WARNING: source '{name}' failed: {e}")
            continue
        for e in evs:
            e["source"] = name
            e["color"] = color
        log(f"  {name}: {len(evs)} events")
        all_events.extend(evs)

    all_events.sort(key=lambda e: e.get("start") or "")

    display = dict(cfg.get("display", {}))
    display.setdefault("title", account or "Portal Calendar")
    display["sources"] = sources

    out_dir = os.path.join(HERE, "out")
    events_path = os.path.join(out_dir, "events.json")
    config_path = os.path.join(out_dir, "config.json")
    write_json(events_path, {
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "account": account, "events": all_events, "sources": sources})
    write_json(config_path, display)
    log(f"total {len(all_events)} events -> {events_path}")

    if args.no_push:
        log("--no-push set; skipping device push")
        return
    if not serial:
        sys.exit("config.serial is required to push")
    adb_push(adb_bin, serial, package, config_path, "config.json", verbose=args.verbose)
    adb_push(adb_bin, serial, package, events_path, "events.json", verbose=args.verbose)
    log(f"pushed to {serial}:/sdcard/Android/data/{package}/files/")
    if cfg.get("keepForeground"):
        subprocess.run([adb_bin, "-s", serial, "shell", "am", "start", "-n",
                        f"{package}/.MainActivity"], capture_output=True, text=True)
        log("kept app in foreground (keepForeground=true)")


if __name__ == "__main__":
    main()
