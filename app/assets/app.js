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

  if (list.length === 0) {
    $("placeholder").textContent = "No upcoming events 🎉";
    $("placeholder").style.display = "block";
    $("events").innerHTML = "";
    return;
  }
  $("placeholder").style.display = "none";

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

  return '<div class="' + cls + '">' +
    '<div class="when">' + when + "</div>" +
    '<div class="body"><div class="title">' + esc(raw.title || "(no title)") + "</div>" + meta + "</div>" +
    "</div>";
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

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
