"use strict";

/*
 * Portal Calendar web UI.
 *
 * Sources merged into one agenda:
 *   - "Meta" work calendar: pushed by the Mac exporter as events.json (injected by
 *     the native Activity via window.renderCalendar). Can't be fetched on-device
 *     (needs the meta CLI), so it stays Mac-pushed.
 *   - ICS calendars (Google / Yahoo / Outlook / any iCal URL): added ON THE DEVICE
 *     in the Settings panel, stored in localStorage, fetched + parsed here in JS.
 *
 * Preview in a browser: open index.html (uses events.sample.json + config.json).
 */

var STATE = { meta: null, config: null, calendars: [], ics: {}, status: {}, lastSig: null, sources: [] };

function $(id) { return document.getElementById(id); }
function pad(n) { return n < 10 ? "0" + n : "" + n; }
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}
function parseLocal(s) {
  if (!s) return null;
  var d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
function fmtTime(d, fmt) {
  if (!d) return "";
  var h = d.getHours(), m = d.getMinutes();
  if (fmt === "24h") return pad(h) + ":" + pad(m);
  var ap = h < 12 ? "AM" : "PM", h12 = h % 12 || 12;
  return h12 + ":" + pad(m) + " " + ap;
}
var WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function dayKey(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
function dayLabel(d) {
  var t = new Date(), k = dayKey(d), tomorrow = new Date(t.getTime() + 86400000);
  if (k === dayKey(t)) return "Today";
  if (k === dayKey(tomorrow)) return "Tomorrow";
  return WEEKDAYS[d.getDay()] + ", " + MONTHS[d.getMonth()] + " " + d.getDate();
}
function sameDay(a, b) { return dayKey(a) === dayKey(b); }

function tickClock() {
  var now = new Date(), fmt = (STATE.config && STATE.config.timeFormat) || "12h";
  $("time").textContent = fmtTime(now, fmt);
  $("date").textContent = WEEKDAYS[now.getDay()] + ", " + MONTHS[now.getMonth()] + " " + now.getDate() + ", " + now.getFullYear();
}

/* ---------------- on-device calendar store ---------------- */
function loadCals() {
  try { return JSON.parse(localStorage.getItem("pc_calendars") || "[]"); } catch (e) { return []; }
}
function saveCals(c) {
  STATE.calendars = c;
  try { localStorage.setItem("pc_calendars", JSON.stringify(c)); } catch (e) {}
}

/* ---------------- ICS engine (fetch + parse + recurrence) ---------------- */
var VIDEO_RE = /https?:\/\/[^\s<>"]*(?:zoom\.us|meet\.google\.com|teams\.microsoft\.com|webex\.com)[^\s<>"]*/i;
function unfold(t) { return t.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n[ \t]/g, ""); }
function unescICS(v) {
  return v.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}
function parseVevents(text) {
  var evs = [], cur = null;
  unfold(text).split("\n").forEach(function (line) {
    if (line === "BEGIN:VEVENT") cur = { _EX: [] };
    else if (line === "END:VEVENT") { if (cur) evs.push(cur); cur = null; }
    else if (cur && line.indexOf(":") > -1) {
      var i = line.indexOf(":"), namePart = line.slice(0, i), value = line.slice(i + 1);
      var bits = namePart.split(";"), name = bits[0].toUpperCase(), params = {};
      for (var k = 1; k < bits.length; k++) {
        var p = bits[k].split("="); if (p.length === 2) params[p[0].toUpperCase()] = p[1];
      }
      if (name === "EXDATE") cur._EX.push([value, params]);
      else if (!(name in cur)) cur[name] = [value, params];
    }
  });
  return evs;
}
// Returns { d: Date, allDay: bool }. UTC(Z) -> instant (local getters give local time);
// floating / TZID -> treated as device-local wall time.
function parseDt(value, params) {
  value = (value || "").trim();
  if ((params && params.VALUE === "DATE") || (value.length === 8 && value.indexOf("T") === -1)) {
    return { d: new Date(+value.slice(0, 4), +value.slice(4, 6) - 1, +value.slice(6, 8)), allDay: true };
  }
  var z = value.charAt(value.length - 1) === "Z", v = z ? value.slice(0, -1) : value;
  var y = +v.slice(0, 4), mo = +v.slice(4, 6), da = +v.slice(6, 8),
      h = +v.slice(9, 11) || 0, mi = +v.slice(11, 13) || 0, s = +v.slice(13, 15) || 0;
  return { d: z ? new Date(Date.UTC(y, mo - 1, da, h, mi, s)) : new Date(y, mo - 1, da, h, mi, s), allDay: false };
}
function isoLocal(d, allDay) {
  if (allDay) return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" +
    pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
}
function parseRRule(s) {
  var d = {};
  s.split(";").forEach(function (p) { var kv = p.split("="); if (kv.length === 2) d[kv[0].toUpperCase()] = kv[1]; });
  return d;
}
var WD = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 0 };
function exKey(d) {
  return "" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}
function expand(start, rr, winStart, winEnd, exset) {
  var freq = rr.FREQ;
  if (!freq) return (start >= winStart && start <= winEnd) ? [start] : [];
  var interval = Math.max(1, parseInt(rr.INTERVAL || "1", 10) || 1);
  var count = rr.COUNT ? parseInt(rr.COUNT, 10) : null;
  var until = rr.UNTIL ? parseDt(rr.UNTIL, {}).d : null;
  var out = [], emitted = 0, it = 0, MAX = 1500;
  function emit(occ) {
    if (until && occ > until) return false;
    if (count != null && emitted >= count) return false;
    emitted++;
    if (occ >= start && occ >= winStart && occ <= winEnd && exset.indexOf(exKey(occ)) === -1) out.push(new Date(occ.getTime()));
    return true;
  }
  if (freq === "WEEKLY") {
    var days = rr.BYDAY ? rr.BYDAY.split(",").map(function (x) { return WD[x.slice(-2)]; }) : [start.getDay()];
    var anchor = new Date(start.getTime()); anchor.setDate(anchor.getDate() - ((anchor.getDay() + 6) % 7)); // Monday
    var w = 0;
    while (it++ < MAX) {
      var base = new Date(anchor.getTime()); base.setDate(base.getDate() + w * interval * 7); w++;
      if (base > new Date(winEnd.getTime() + 7 * 86400000)) break;
      var stop = false;
      days.slice().sort().forEach(function (wd) {
        if (stop) return;
        var occ = new Date(base.getTime());
        occ.setDate(occ.getDate() + ((wd + 6) % 7));   // Monday-anchored offset
        occ.setHours(start.getHours(), start.getMinutes(), start.getSeconds(), 0);
        if (occ < start) return;
        if (!emit(occ)) stop = true;
      });
      if (stop) break;
    }
  } else if (freq === "DAILY") {
    var occ = new Date(start.getTime());
    while (it++ < MAX && occ <= winEnd) { if (!emit(occ)) break; occ = new Date(occ.getTime()); occ.setDate(occ.getDate() + interval); }
  } else if (freq === "MONTHLY") {
    var k = 0;
    while (it++ < MAX) {
      var o = new Date(start.getTime()); o.setMonth(o.getMonth() + k * interval); k++;
      if (o > winEnd) break;
      if (!emit(o)) break;
    }
  } else if (start >= winStart && start <= winEnd) out.push(start);
  return out;
}
function icsToEvents(text, days) {
  var now = new Date(), winStart = new Date(now.getTime() - 2 * 3600000), winEnd = new Date(now.getTime() + days * 86400000);
  var out = [];
  parseVevents(text).forEach(function (ev) {
    if (!ev.DTSTART) return;
    if (ev.STATUS && (ev.STATUS[0] || "").toUpperCase() === "CANCELLED") return;
    var ds = parseDt(ev.DTSTART[0], ev.DTSTART[1]), start = ds.d, allDay = ds.allDay;
    var end = ev.DTEND ? parseDt(ev.DTEND[0], ev.DTEND[1]).d : new Date(start.getTime() + (allDay ? 86400000 : 3600000));
    var dur = end.getTime() - start.getTime();
    var title = unescICS(ev.SUMMARY ? ev.SUMMARY[0] : "(no title)");
    var loc = unescICS(ev.LOCATION ? ev.LOCATION[0] : "");
    var desc = unescICS(ev.DESCRIPTION ? ev.DESCRIPTION[0] : "");
    var org = (ev.ORGANIZER ? ev.ORGANIZER[0] : "").replace(/^mailto:/i, "");
    var vm = VIDEO_RE.exec(desc) || VIDEO_RE.exec(loc), join = vm ? vm[0] : "";
    function make(s) {
      if (allDay) {
        var ds2 = dayKey(s);
        if (s < new Date(now.getFullYear(), now.getMonth(), now.getDate()) || s > winEnd) return null;
        return { title: title, start: ds2, end: ds2, allDay: true, location: loc, isVideoCall: !!join, joinUrl: join, organizer: org, attendees: [], attendeeCount: 0, notes: desc.slice(0, 1000), status: "" };
      }
      var en = new Date(s.getTime() + dur);
      if (en < winStart || s > winEnd) return null;
      return { title: title, start: isoLocal(s, false), end: isoLocal(en, false), allDay: false, location: loc, isVideoCall: !!join, joinUrl: join, organizer: org, attendees: [], attendeeCount: 0, notes: desc.slice(0, 1000), status: "" };
    }
    if (ev.RRULE && !allDay) {
      var exset = [];
      ev._EX.forEach(function (ex) { ex[0].split(",").forEach(function (pc) { try { exset.push(exKey(parseDt(pc, ex[1]).d)); } catch (e) {} }); });
      expand(start, parseRRule(ev.RRULE[0]), winStart, winEnd, exset).forEach(function (occ) { var e = make(occ); if (e) out.push(e); });
    } else { var e = make(start); if (e) out.push(e); }
  });
  return out;
}
function fetchICS(url) {
  var ctrl = new AbortController(), to = setTimeout(function () { ctrl.abort(); }, 20000);
  return fetch(url, { signal: ctrl.signal }).then(function (r) {
    clearTimeout(to);
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.text();
  });
}
function refreshAll(cb) {
  var days = (STATE.config && STATE.config.daysAhead) || 14, cals = STATE.calendars, pending = cals.length;
  if (!pending) { if (cb) cb(); return; }
  cals.forEach(function (c) {
    fetchICS(c.url).then(function (txt) {
      try { STATE.ics[c.name] = icsToEvents(txt, days); STATE.status[c.name] = STATE.ics[c.name].length + " events"; }
      catch (e) { STATE.status[c.name] = "parse error"; }
    }).catch(function (e) {
      STATE.ics[c.name] = []; STATE.status[c.name] = "error: " + (e && e.message ? e.message : "fetch failed");
    }).then(function () { if (--pending === 0) { rebuildAndRender(); if (cb) cb(); } });
  });
}

/* ---------------- merge + render ---------------- */
function buildMerged() {
  var list = [];
  if (STATE.meta && STATE.meta.events) STATE.meta.events.forEach(function (e) { list.push(e); });
  STATE.calendars.forEach(function (c) {
    (STATE.ics[c.name] || []).forEach(function (e) { e.source = c.name; e.color = c.color; list.push(e); });
  });
  return list;
}
function rebuildAndRender() { renderAgenda(buildMerged()); }

function renderAgenda(data) {
  var cfg = STATE.config || {};
  $("account").textContent = cfg.title || (STATE.meta && STATE.meta.account) || "Portal Calendar";
  if (STATE.meta && STATE.meta.generatedAt) {
    var g = parseLocal(STATE.meta.generatedAt), f = cfg.timeFormat || "12h", rm = cfg.refreshMinutes || 5;
    if (g) {
      var nx = new Date(g.getTime() + rm * 60000);
      $("synced").textContent = "Synced " + fmtTime(g, f) + " · next " + fmtTime(nx, f);
    } else $("synced").textContent = "";
  }
  var now = new Date(), maxEvents = cfg.maxEvents || 100;
  var list = data.map(function (e) {
    return { raw: e, start: parseLocal(e.start), end: parseLocal(e.end) || parseLocal(e.start) };
  }).filter(function (e) { return e.start && ((e.end || e.start) >= now || (e.start && sameDay(e.start, now))); })
    .sort(function (a, b) { return a.start - b.start; }).slice(0, maxEvents);

  list.forEach(function (e, i) { e.idx = i; });
  STATE.flat = list;

  if (list.length === 0) {
    $("placeholder").textContent = (STATE.meta || STATE.calendars.length) ? "No upcoming events 🎉" : "Waiting for first calendar sync…";
    $("placeholder").style.display = "block"; $("events").innerHTML = ""; STATE.lastSig = null; return;
  }
  $("placeholder").style.display = "none";
  var sig = JSON.stringify(list.map(function (e) { return [e.raw.start, e.raw.title, e.raw.color]; }));
  if (sig === STATE.lastSig && $("events").children.length) return;
  STATE.lastSig = sig;

  var groups = [], byKey = {};
  list.forEach(function (e) {
    var k = dayKey(e.start);
    if (!byKey[k]) { byKey[k] = { label: dayLabel(e.start), items: [] }; groups.push(byKey[k]); }
    byKey[k].items.push(e);
  });
  var html = "";
  groups.forEach(function (g) {
    html += '<div class="day-group"><div class="day-header">' + esc(g.label) + "</div>";
    g.items.forEach(function (e) { html += eventHtml(e, now, cfg); });
    html += "</div>";
  });
  var c = $("events"); c.innerHTML = html; c.classList.remove("fade"); void c.offsetWidth; c.classList.add("fade");
}

function eventHtml(e, now, cfg) {
  var raw = e.raw, isNow = !raw.allDay && e.start <= now && e.end && e.end > now, isPast = e.end && e.end < now;
  var cls = "event" + (raw.allDay ? " allday" : "") + (isNow ? " now" : (isPast ? " past" : ""));
  var when = raw.allDay ? "All day" : fmtTime(e.start, cfg.timeFormat || "12h") + (e.end ? '<span class="end">' + fmtTime(e.end, cfg.timeFormat || "12h") + "</span>" : "");
  var tags = [];
  if (raw.isVideoCall) tags.push("📹");
  if (raw.location) tags.push("📍 " + esc(raw.location));
  if (raw.attendeeCount) tags.push("👥 " + raw.attendeeCount);
  if (raw.status === "tentative") tags.push("~ tentative");
  var meta = tags.length ? '<div class="meta">' + tags.join('<span class="tag"></span> ') + "</div>" : "";
  var color = raw.color || "#4f9dff";
  return '<div class="' + cls + '" data-idx="' + e.idx + '" style="border-left:6px solid ' + esc(color) + '">' +
    '<div class="when">' + when + "</div>" +
    '<div class="body"><div class="title">' + esc(raw.title || "(no title)") + "</div>" + meta + "</div></div>";
}

/* native entry point */
function renderCalendar(events, config) {
  if (events) STATE.meta = events;
  if (config) STATE.config = config;
  tickClock();
  rebuildAndRender();
}

/* ---------------- detail overlay ---------------- */
function goHome() { if (window.Android && window.Android.goHome) window.Android.goHome(); }
function openJoin(url) { if (window.Android && window.Android.openUrl) window.Android.openUrl(url); else window.open(url, "_blank"); }
function fmtRange(e, cfg) {
  var s = parseLocal(e.start), en = parseLocal(e.end), f = cfg.timeFormat || "12h";
  if (e.allDay) return "All day · " + dayLabel(s || new Date());
  return (s ? dayLabel(s) : "") + " · " + (s ? fmtTime(s, f) : "") + (en ? " – " + fmtTime(en, f) : "");
}
function openDetail(idx) {
  var item = STATE.flat && STATE.flat[idx]; if (!item) return;
  var raw = item.raw, cfg = STATE.config || {}, rows = "";
  if (raw.source) rows += '<div class="ov-row"><span class="ico" style="color:' + esc(raw.color || "#4f9dff") + '">●</span><span class="val">' + esc(raw.source) + "</span></div>";
  rows += '<div class="ov-row"><span class="ico">🕑</span><span class="val">' + esc(fmtRange(item, cfg)) + "</span></div>";
  if (raw.location) rows += '<div class="ov-row"><span class="ico">📍</span><span class="val">' + esc(raw.location) + "</span></div>";
  if (raw.isVideoCall) rows += '<div class="ov-row"><span class="ico">📹</span><span class="val">Video call</span></div>';
  if (raw.organizer) rows += '<div class="ov-row"><span class="ico">📧</span><span class="val">' + esc(raw.organizer) + "</span></div>";
  if (raw.attendees && raw.attendees.length) rows += '<div class="ov-row"><span class="ico">👥</span><span class="val ov-attendees">' + esc(raw.attendees.join(", ")) + "</span></div>";
  if (raw.notes) rows += '<div class="ov-notes">' + esc(raw.notes) + "</div>";
  if (raw.isVideoCall && raw.joinUrl) rows += '<button class="ov-join" onclick="openJoin(' + JSON.stringify(raw.joinUrl).replace(/"/g, "&quot;") + ')">Join video call</button>';
  $("overlay-body").innerHTML = '<div class="ov-title">' + esc(raw.title || "(no title)") + "</div>" + rows;
  $("overlay").classList.remove("hidden");
}
function closeDetail() { $("overlay").classList.add("hidden"); }
function isDetailOpen() { return !$("overlay").classList.contains("hidden"); }

/* ---------------- settings / calendars (editable on-device) ---------------- */
var SWATCHES = ["#34a853", "#0078d4", "#7b1fa2", "#e8923b", "#e53935", "#00897b"];
var pickColor = SWATCHES[0];
// Calendar services the user can sign in to directly on the Portal (in-app browser).
var SERVICES = [
  { id: "google",  name: "Google Calendar",  color: "#1a73e8", glyph: "31", url: "https://calendar.google.com/calendar/u/0/r" },
  { id: "outlook", name: "Outlook Calendar", color: "#0078d4", glyph: "O",  url: "https://outlook.office.com/calendar/" },
  { id: "yahoo",   name: "Yahoo Calendar",   color: "#6001d2", glyph: "Y!", url: "https://calendar.yahoo.com/" }
];
function openSettings() {
  var cfg = STATE.config || {}, ev = STATE.meta || {};
  var html = '<div class="set-title">Calendars</div>';
  var f = cfg.timeFormat || "12h", rm = cfg.refreshMinutes || 5, syncline = "";
  if (ev.generatedAt) {
    var g = parseLocal(ev.generatedAt);
    if (g) { var nx = new Date(g.getTime() + rm * 60000); syncline = "Meta synced " + fmtTime(g, f) + " · next ~" + fmtTime(nx, f) + " · auto every " + rm + " min from your Mac"; }
  }
  html += '<div class="set-sub">' + esc(ev.account || cfg.title || "") + "</div>";
  if (syncline) html += '<div class="set-sub">' + esc(syncline) + "</div>";
  // built-in Meta source (Mac-pushed)
  html += '<div class="set-row"><span class="set-dot" style="background:#4f9dff"></span><span>Work (Meta)</span><span class="set-dim set-tag">pushed from Mac</span></div>';
  // ---- sign in to a calendar service, directly on the Portal ----
  var hasBridge = !!(window.Android && window.Android.openCalendar);
  if (hasBridge) {
    html += '<div class="set-add"><div class="set-addt">Sign in to a calendar service</div>' +
      '<div class="set-help" style="margin-top:0;margin-bottom:1.4vh">Open and log in on the Portal. Your session is remembered.</div>' +
      '<div class="svc-tiles">';
    SERVICES.forEach(function (s) {
      html += '<button class="svc-tile" data-svc="' + esc(s.id) + '">' +
        '<span class="svc-ic" style="background:' + s.color + '">' + s.glyph + '</span>' +
        '<span class="svc-name">' + esc(s.name) + '</span></button>';
    });
    html += '</div></div>';
  }
  // on-device ICS calendars
  STATE.calendars.forEach(function (c, i) {
    html += '<div class="set-row"><span class="set-dot" style="background:' + esc(c.color) + '"></span>' +
      '<span>' + esc(c.name) + '</span><span class="set-dim set-tag">' + esc(STATE.status[c.name] || "") + "</span>" +
      '<button class="set-del" data-del="' + i + '">Remove</button></div>';
  });
  // add form (advanced: merge a calendar into the unified agenda via its ICS feed)
  html += '<div class="set-add"><div class="set-addt">Advanced: merge a calendar into this agenda (iCal/ICS)</div>' +
    '<input id="cal-name" class="set-in" placeholder="Name (e.g. Personal)"/>' +
    '<input id="cal-url" class="set-in" placeholder="Paste the calendar\'s iCal/ICS URL"/>' +
    '<div class="set-sw">';
  SWATCHES.forEach(function (col) { html += '<span class="sw' + (col === pickColor ? " sel" : "") + '" data-col="' + col + '" style="background:' + col + '"></span>'; });
  html += '</div><div class="set-actions"><button id="cal-add" class="set-btn">Add &amp; sync</button>' +
    '<button id="cal-refresh" class="set-btn ghost">Refresh now</button></div>' +
    '<div class="set-help">Get the URL: Google → Settings → Integrate calendar → "Secret address in iCal format"; Outlook → Publish calendar (ICS); Yahoo → calendar ICS feed. The Work (Meta) calendar is managed on your Mac.</div></div>';
  $("settings-body").innerHTML = html;
  // wire
  Array.prototype.forEach.call(document.querySelectorAll(".svc-tile"), function (el) {
    el.addEventListener("click", function () {
      var s = SERVICES.filter(function (x) { return x.id === el.getAttribute("data-svc"); })[0];
      if (s && window.Android && window.Android.openCalendar) window.Android.openCalendar(s.url, s.name);
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll(".sw"), function (el) {
    el.addEventListener("click", function () { pickColor = el.getAttribute("data-col"); Array.prototype.forEach.call(document.querySelectorAll(".sw"), function (x) { x.classList.remove("sel"); }); el.classList.add("sel"); });
  });
  Array.prototype.forEach.call(document.querySelectorAll(".set-del"), function (el) {
    el.addEventListener("click", function () {
      var i = +el.getAttribute("data-del"), c = STATE.calendars[i];
      if (c) { delete STATE.ics[c.name]; delete STATE.status[c.name]; var arr = STATE.calendars.slice(); arr.splice(i, 1); saveCals(arr); rebuildAndRender(); openSettings(); }
    });
  });
  $("cal-add").addEventListener("click", function () {
    var name = ($("cal-name").value || "").trim(), url = ($("cal-url").value || "").trim();
    if (!name || !/^https?:\/\//i.test(url)) { $("cal-url").style.borderColor = "#e53935"; return; }
    var arr = STATE.calendars.slice(); arr.push({ name: name, url: url, color: pickColor }); saveCals(arr);
    STATE.status[name] = "syncing…"; openSettings(); refreshAll(function () { openSettings(); });
  });
  $("cal-refresh").addEventListener("click", function () { STATE.calendars.forEach(function (c) { STATE.status[c.name] = "syncing…"; }); openSettings(); refreshAll(function () { openSettings(); }); });
  $("settings").classList.remove("hidden");
}
function closeSettings() { $("settings").classList.add("hidden"); }
function isSettingsOpen() { return !$("settings").classList.contains("hidden"); }

window.__onBack = function () {
  if (isSettingsOpen()) { closeSettings(); return true; }
  if (isDetailOpen()) { closeDetail(); return true; }
  return false;
};

(function setupUi() {
  $("home-btn").addEventListener("click", goHome);
  $("settings-btn").addEventListener("click", openSettings);
  $("settings-close").addEventListener("click", closeSettings);
  $("settings").addEventListener("click", function (e) { if (e.target === $("settings")) closeSettings(); });
  $("overlay-close").addEventListener("click", closeDetail);
  $("overlay").addEventListener("click", function (e) { if (e.target === $("overlay")) closeDetail(); });
  $("events").addEventListener("click", function (e) {
    var el = e.target; while (el && el !== this && !el.hasAttribute("data-idx")) el = el.parentNode;
    if (el && el.hasAttribute("data-idx")) openDetail(parseInt(el.getAttribute("data-idx"), 10));
  });
})();

/* ---------------- auto-scroll (passive viewing) ---------------- */
var lastUserScroll = 0, scrollDir = 1, pauseUntil = 0;
(function setupAutoScroll() {
  var a = $("agenda");
  ["touchstart", "pointerdown", "wheel", "mousedown", "keydown"].forEach(function (ev) {
    a.addEventListener(ev, function () { lastUserScroll = Date.now(); }, { passive: true });
  });
  setInterval(function () {
    var cfg = STATE.config || {};
    if (cfg.autoScroll === false || isDetailOpen() || isSettingsOpen()) return;
    var now = Date.now();
    if (now < pauseUntil || now - lastUserScroll < 15000) return;
    var max = a.scrollHeight - a.clientHeight; if (max <= 4) return;
    a.scrollTop += scrollDir * 1.2;
    if (scrollDir > 0 && a.scrollTop >= max - 1) { scrollDir = -1; pauseUntil = now + 4000; }
    else if (scrollDir < 0 && a.scrollTop <= 1) { scrollDir = 1; pauseUntil = now + 4000; }
  }, 40);
})();

/* ---------------- boot ---------------- */
window.renderCalendar = renderCalendar;
STATE.calendars = loadCals();
setInterval(tickClock, 1000); tickClock();
refreshAll();                                  // fetch on-device ICS calendars now
setInterval(function () { refreshAll(); }, ((/* min */ (STATE.config && STATE.config.refreshMinutes) || 15) * 60000)); // and periodically

// Browser-preview fallback (no native injection).
setTimeout(function () {
  if (!STATE.meta) {
    fetch("events.sample.json").then(function (r) { return r.ok ? r.json() : null; }).then(function (ev) {
      return fetch("config.json").then(function (r) { return r.ok ? r.json() : null; }).then(function (cfg) { if (ev) renderCalendar(ev, cfg); });
    }).catch(function () {});
  }
}, 1200);
