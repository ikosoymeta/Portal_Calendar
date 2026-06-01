"use strict";

/*
 * Portal Calendar web UI.
 *
 * The native Activity calls window.renderCalendar(events, config) on a timer.
 *   events: { generatedAt, account, events: [ {title,start,end,allDay,location,isVideoCall,attendeeCount,status} ] }
 *           (start/end are ISO-local strings, e.g. "2026-06-02T15:05:00")
 *   config: { title, daysAhead, timeFormat ("12h"|"24h"), maxEvents }
 * Either argument may be null (before the first sync).
 *
 * Open app/assets/index.html directly in a browser to preview — it falls back to
 * the bundled sample data below.
 */

var STATE = { events: null, config: null };

function $(id) { return document.getElementById(id); }

function pad(n) { return n < 10 ? "0" + n : "" + n; }

function parseLocal(s) {
  // Accepts "YYYY-MM-DDTHH:MM:SS" or "YYYY-MM-DD". Treated as device-local time.
  if (!s) return null;
  var d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function fmtTime(d, fmt) {
  if (!d) return "";
  var h = d.getHours(), m = d.getMinutes();
  if (fmt === "24h") return pad(h) + ":" + pad(m);
  var ap = h < 12 ? "AM" : "PM";
  var h12 = h % 12; if (h12 === 0) h12 = 12;
  return h12 + ":" + pad(m) + " " + ap;
}

var WEEKDAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
var MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function dayKey(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }

function dayLabel(d) {
  var today = new Date();
  var k = dayKey(d), kt = dayKey(today);
  var tomorrow = new Date(today.getTime() + 86400000);
  if (k === kt) return "Today";
  if (k === dayKey(tomorrow)) return "Tomorrow";
  return WEEKDAYS[d.getDay()] + ", " + MONTHS[d.getMonth()] + " " + d.getDate();
}

/* ---------- clock ---------- */
function tickClock() {
  var now = new Date();
  var fmt = (STATE.config && STATE.config.timeFormat) || "12h";
  $("time").textContent = fmtTime(now, fmt);
  $("date").textContent = WEEKDAYS[now.getDay()] + ", " + MONTHS[now.getMonth()] + " " + now.getDate() + ", " + now.getFullYear();
}

/* ---------- rendering ---------- */
function renderCalendar(events, config) {
  if (events) STATE.events = events;
  if (config) STATE.config = config;
  tickClock();

  var cfg = STATE.config || {};
  $("account").textContent = cfg.title || (STATE.events && STATE.events.account) || "Portal Calendar";

  var data = STATE.events;
  if (!data || !data.events) {
    $("placeholder").style.display = "block";
    $("events").innerHTML = "";
    $("synced").textContent = "";
    return;
  }

  if (data.generatedAt) {
    var g = parseLocal(data.generatedAt);
    $("synced").textContent = g ? "Synced " + fmtTime(g, cfg.timeFormat || "12h") : "";
  }

  var now = new Date();
  var maxEvents = cfg.maxEvents || 50;

  // Keep events that haven't ended yet; sort by start.
  var list = data.events
    .map(function (e) {
      return {
        raw: e,
        start: parseLocal(e.start),
        end: parseLocal(e.end) || parseLocal(e.start)
      };
    })
    .filter(function (e) { return e.start && (e.allDay || !e.end || e.end >= now || e.raw.allDay); })
    .filter(function (e) { return (e.end || e.start) >= now || (e.start && sameDay(e.start, now)); })
    .sort(function (a, b) { return a.start - b.start; })
    .slice(0, maxEvents);

  list.forEach(function (e, i) { e.idx = i; });
  STATE.flat = list;

  if (list.length === 0) {
    $("placeholder").textContent = "No upcoming events 🎉";
    $("placeholder").style.display = "block";
    $("events").innerHTML = "";
    return;
  }
  $("placeholder").style.display = "none";

  // Skip DOM rebuild when the events are unchanged — preserves scroll position
  // (and auto-scroll) across the periodic 30s data refresh.
  var sig = JSON.stringify(data.events);
  if (sig === STATE.lastSig && $("events").children.length) return;
  STATE.lastSig = sig;

  // Group by day.
  var groups = [];
  var byKey = {};
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

  var container = $("events");
  container.innerHTML = html;
  container.classList.remove("fade");
  void container.offsetWidth; // restart animation
  container.classList.add("fade");
}

function sameDay(a, b) { return dayKey(a) === dayKey(b); }

function eventHtml(e, now, cfg) {
  var raw = e.raw;
  var isNow = !raw.allDay && e.start <= now && e.end && e.end > now;
  var isPast = e.end && e.end < now;
  var cls = "event";
  if (raw.allDay) cls += " allday";
  if (isNow) cls += " now";
  else if (isPast) cls += " past";

  var when;
  if (raw.allDay) {
    when = "All day";
  } else {
    when = fmtTime(e.start, cfg.timeFormat || "12h");
    if (e.end) when += '<span class="end">' + fmtTime(e.end, cfg.timeFormat || "12h") + "</span>";
  }

  var tags = [];
  if (raw.isVideoCall) tags.push("📹");
  if (raw.location) tags.push("📍 " + esc(raw.location));
  else if (raw.isVideoCall) tags.push("Video call");
  if (raw.attendeeCount) tags.push("👥 " + raw.attendeeCount);
  if (raw.status === "tentative") tags.push("~ tentative");

  var meta = tags.length ? '<div class="meta">' + tags.join('<span class="tag"></span> ') + "</div>" : "";

  return '<div class="' + cls + '" data-idx="' + e.idx + '">' +
    '<div class="when">' + when + "</div>" +
    '<div class="body"><div class="title">' + esc(raw.title || "(no title)") + "</div>" + meta + "</div>" +
    "</div>";
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

/* ---------- detail overlay ---------- */
function goHome() {
  if (window.Android && window.Android.goHome) window.Android.goHome();
}

function openJoin(url) {
  if (window.Android && window.Android.openUrl) window.Android.openUrl(url);
  else window.open(url, "_blank");
}

function fmtRange(e, cfg) {
  var s = parseLocal(e.start), en = parseLocal(e.end);
  if (e.allDay) return "All day · " + dayLabel(s || new Date());
  var f = cfg.timeFormat || "12h";
  var day = s ? dayLabel(s) : "";
  return day + " · " + (s ? fmtTime(s, f) : "") + (en ? " – " + fmtTime(en, f) : "");
}

function openDetail(idx) {
  var item = STATE.flat && STATE.flat[idx];
  if (!item) return;
  var raw = item.raw;
  var cfg = STATE.config || {};
  var rows = "";
  rows += '<div class="ov-row"><span class="ico">🕑</span><span class="val">' + esc(fmtRange(item, cfg)) + "</span></div>";
  if (raw.location) rows += '<div class="ov-row"><span class="ico">📍</span><span class="val">' + esc(raw.location) + "</span></div>";
  if (raw.isVideoCall) rows += '<div class="ov-row"><span class="ico">📹</span><span class="val">Video call</span></div>';
  if (raw.organizer) rows += '<div class="ov-row"><span class="ico">📧</span><span class="val">' + esc(raw.organizer) + "</span></div>";
  if (raw.attendees && raw.attendees.length) {
    var more = raw.attendeeCount && raw.attendeeCount > raw.attendees.length
      ? " +" + (raw.attendeeCount - raw.attendees.length) + " more" : "";
    rows += '<div class="ov-row"><span class="ico">👥</span><span class="val ov-attendees">' +
      esc(raw.attendees.join(", ")) + esc(more) + "</span></div>";
  } else if (raw.attendeeCount) {
    rows += '<div class="ov-row"><span class="ico">👥</span><span class="val ov-attendees">' + raw.attendeeCount + " attendees</span></div>";
  }
  if (raw.status && raw.status !== "accepted" && raw.status !== "organizer") {
    rows += '<div class="ov-row"><span class="ico">↩︎</span><span class="val">' + esc(raw.status) + "</span></div>";
  }
  if (raw.notes) rows += '<div class="ov-notes">' + esc(raw.notes) + "</div>";
  if (raw.isVideoCall && raw.joinUrl) {
    rows += '<button class="ov-join" onclick="openJoin(' + JSON.stringify(raw.joinUrl).replace(/"/g, "&quot;") + ')">Join video call</button>';
  }

  $("overlay-body").innerHTML = '<div class="ov-title">' + esc(raw.title || "(no title)") + "</div>" + rows;
  $("overlay").classList.remove("hidden");
}

function closeDetail() { $("overlay").classList.add("hidden"); }
function isDetailOpen() { return !$("overlay").classList.contains("hidden"); }

// Back button (from native): close overlay if open; return true if handled.
window.__onBack = function () {
  if (isDetailOpen()) { closeDetail(); return true; }
  return false;
};

(function setupUi() {
  $("home-btn").addEventListener("click", goHome);
  $("overlay-close").addEventListener("click", closeDetail);
  $("overlay").addEventListener("click", function (ev) {
    if (ev.target === $("overlay")) closeDetail();  // click backdrop
  });
  $("events").addEventListener("click", function (ev) {
    var el = ev.target;
    while (el && el !== this && !el.hasAttribute("data-idx")) el = el.parentNode;
    if (el && el.hasAttribute("data-idx")) openDetail(parseInt(el.getAttribute("data-idx"), 10));
  });
})();

/* ---------- auto-scroll (passive viewing) ---------- */
var lastUserScroll = 0, scrollDir = 1, pauseUntil = 0;
(function setupAutoScroll() {
  var a = $("agenda");
  // Real user interaction pauses auto-scroll for 15s. (Not 'scroll' — that would
  // fire from our own auto-scroll and pause forever.)
  ["touchstart", "pointerdown", "wheel", "mousedown", "keydown"].forEach(function (ev) {
    a.addEventListener(ev, function () { lastUserScroll = Date.now(); }, { passive: true });
  });
  setInterval(function () {
    var cfg = STATE.config || {};
    if (cfg.autoScroll === false || isDetailOpen()) return;
    var now = Date.now();
    if (now < pauseUntil || now - lastUserScroll < 15000) return;
    var max = a.scrollHeight - a.clientHeight;
    if (max <= 4) return;  // everything fits; nothing to scroll
    a.scrollTop += scrollDir * 1.2;
    if (scrollDir > 0 && a.scrollTop >= max - 1) { scrollDir = -1; pauseUntil = now + 4000; }
    else if (scrollDir < 0 && a.scrollTop <= 1) { scrollDir = 1; pauseUntil = now + 4000; }
  }, 40);
})();

// Expose for the native Activity.
window.renderCalendar = renderCalendar;

// Clock ticks every second regardless of data refreshes.
setInterval(tickClock, 1000);
tickClock();

// Browser-preview fallback: if no native injection arrives shortly, load samples.
setTimeout(function () {
  if (!STATE.events) {
    fetch("events.sample.json").then(function (r) { return r.ok ? r.json() : null; })
      .then(function (ev) {
        return fetch("config.json").then(function (r) { return r.ok ? r.json() : null; })
          .then(function (cfg) { if (ev) renderCalendar(ev, cfg); });
      })
      .catch(function () {});
  }
}, 1200);
