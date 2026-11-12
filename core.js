/* Scoot Calendar core: data, sync, weather/surf, helpers, router.
   Live data: Open-Meteo (weather, marine), NOAA (tides), NWS (alerts). No keys.
   Repo data (data/*.json): calendar feeds + Garmin (GitHub Action, hourly), brief.json (Claude, daily). */
"use strict";

const REPO = "scottymoj/ScootCalendar";
const PRESETS = [
  { id:"villanova", name:"Villanova", lat:40.0376, lon:-75.3427 },
  { id:"chatham", name:"Chatham", lat:40.7409, lon:-74.3838 },
  { id:"stoneharbor", name:"Stone Harbor", lat:39.0515, lon:-74.7608 },
];
const SURF_SPOT = { name:"Stone Harbor", lat:39.04, lon:-74.73, wlat:39.0515, wlon:-74.7608 };
const TIDE_STATION = { id:"8535835", name:"Wildwood Crest ocean pier" };
const OFFSHORE_FROM = 300; // Stone Harbor faces SE: wind from the NW is offshore

/* ---------------- helpers ---------------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
const pad = n => String(n).padStart(2, "0");
const dkey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = k => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const today0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const daysBetween = (a, b) => Math.round((fromKey(dkey(b)) - fromKey(dkey(a))) / 864e5);
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDay = d => `${DOW[d.getDay()]}, ${MON[d.getMonth()]} ${d.getDate()}`;
const fmtLong = d => d.toLocaleDateString("en-US", { weekday:"long", month:"long", day:"numeric" });
function fmtTime(d) {
  let h = d.getHours(), m = d.getMinutes();
  const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12;
  return m ? `${h}:${pad(m)} ${ap}` : `${h} ${ap}`;
}
const fmtHour = h => `${h % 12 || 12}${h >= 12 ? "p" : "a"}`;
function relDay(d) {
  const n = daysBetween(today0(), d);
  if (n === 0) return "Today"; if (n === 1) return "Tomorrow"; if (n === -1) return "Yesterday";
  if (n > 1 && n < 7) return DOW[d.getDay()];
  return `${MON[d.getMonth()]} ${d.getDate()}`;
}
function ago(iso) {
  if (!iso) return "never";
  const m = Math.round((Date.now() - new Date(iso)) / 6e4);
  if (m < 1) return "just now"; if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 36) return `${h} hr ago`;
  return `${Math.round(h / 24)} days ago`;
}
const C2F = c => c * 9 / 5 + 32;
function compass(deg) {
  if (deg == null) return "";
  return ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"][Math.round(deg / 22.5) % 16];
}
async function getJSON(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}
const repoJSON = async name => {
  const tok = lsGet("sp_token", "");
  if (tok) {
    try {
      const r = await fetch(`https://api.github.com/repos/${REPO}/contents/data/${name}?t=${Date.now()}`, { headers:{ Authorization:`Bearer ${tok}`, Accept:"application/vnd.github.raw+json" }, cache:"no-store" });
      if (r.ok) return await r.json();
      if (r.status === 404) return null;
    } catch {}
  }
  return getJSON(`data/${name}?t=${Date.now()}`).catch(() => null);
};
function lsGet(k, def) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

/* ---------------- user data (synced to data/user.json) ---------------- */
function seedUser() {
  const cls = (code, name, color) => ({ id:uid(), code, name, prof:"", room:"", when:"", color, target:"B+", cats:[], guides:[] });
  return {
    v:1, updatedAt:0,
    place:"auto", places:[], here:null,
    classes:[
      cls("PHY", "Physics", "#1f4e9c"),
      cls("STAT 1430", "Business Statistics", "#0f7c8c"),
      cls("HIS 1165", "War and Society", "#7a3db8"),
      cls("ECO 2101", "Macroeconomic Theory", "#b06a00"),
    ],
    items:[], doneIds:{},
  };
}
let U = lsGet("sp_user", null) || seedUser();
const touch = () => { U.updatedAt = Date.now(); lsSet("sp_user", U); Sync.queue(); };

const Sync = {
  token: () => lsGet("sp_token", ""),
  sha: null, timer: null, status: "", busy: false,
  api: p => `https://api.github.com/repos/${REPO}/contents/${p}`,
  headers() { return { Authorization:`Bearer ${this.token()}`, Accept:"application/vnd.github+json" }; },
  async pull() {
    if (this.token()) {
      try {
        const r = await fetch(this.api("data/user.json") + `?t=${Date.now()}`, { headers:this.headers(), cache:"no-store" });
        if (r.status === 404) { this.sha = null; return false; }
        if (!r.ok) throw new Error(r.status);
        const j = await r.json(); this.sha = j.sha;
        const remote = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(j.content.replace(/\n/g, "")), c => c.charCodeAt(0))));
        this.status = "Synced";
        if ((remote.updatedAt || 0) > (U.updatedAt || 0)) { U = Object.assign(seedUser(), remote); lsSet("sp_user", U); return true; }
      } catch (e) { this.status = `Sync error (${e.message})`; }
      return false;
    }
    // no token: read-only copy from the site, used only if this phone has nothing yet
    if (U.updatedAt) return false;
    const remote = await repoJSON("user.json");
    if (remote && remote.updatedAt) { U = Object.assign(seedUser(), remote); lsSet("sp_user", U); return true; }
    return false;
  },
  queue() { if (!this.token()) return; clearTimeout(this.timer); this.timer = setTimeout(() => this.push(), 2500); },
  async push(retry = true) {
    if (!this.token() || this.busy) return;
    this.busy = true;
    try {
      const bytes = new TextEncoder().encode(JSON.stringify(U, null, 1));
      let bin = ""; bytes.forEach(b => bin += String.fromCharCode(b));
      const body = { message:"Update calendar (app)", content:btoa(bin) };
      if (this.sha) body.sha = this.sha;
      const r = await fetch(this.api("data/user.json"), { method:"PUT", headers:this.headers(), body:JSON.stringify(body) });
      if ((r.status === 409 || r.status === 422) && retry) {
        const g = await fetch(this.api("data/user.json") + `?t=${Date.now()}`, { headers:this.headers(), cache:"no-store" });
        this.sha = g.ok ? (await g.json()).sha : null;
        this.busy = false; return this.push(false);
      }
      if (!r.ok) throw new Error(r.status === 401 ? "token rejected" : r.status);
      this.sha = (await r.json()).content.sha;
      this.status = `Synced ${fmtTime(new Date())}`;
    } catch (e) { this.status = `Sync error (${e.message})`; }
    this.busy = false;
  },
};

/* ---------------- repo data ---------------- */
const D = { cal:null, garmin:null, brief:null };
/* GitHub's hourly schedule is unreliable on small repos, so the app starts the updater itself
   when the data is more than 30 minutes old (at most once every 15 minutes). Needs the token
   to have Actions: Read and write. */
const Refresh = { status:"", busy:false };
async function requestRefresh(force) {
  const tok = lsGet("sp_token", "");
  if (!tok || Refresh.busy) return false;
  const newest = Math.max(...[D.garmin && D.garmin.updated, D.cal && D.cal.updated].filter(Boolean).map(x => +new Date(x)), 0);
  if (!force && Date.now() - newest < 30 * 6e4) return false;
  if (!force && Date.now() - lsGet("sp_refresh", 0) < 15 * 6e4) return false;
  Refresh.busy = true;
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/update.yml/dispatches`, {
      method:"POST", headers:{ Authorization:`Bearer ${tok}`, Accept:"application/vnd.github+json", "Content-Type":"application/json" }, body:JSON.stringify({ ref:"main" }) });
    if (!r.ok) { Refresh.status = r.status === 403 || r.status === 404 ? "needs-permission" : `error ${r.status}`; Refresh.busy = false; return false; }
    lsSet("sp_refresh", Date.now());
    Refresh.status = "running";
    const before = newest;
    // the updater takes about a minute; check for new data a few times
    for (const wait of [60, 30, 30, 30, 60]) {
      await new Promise(res => setTimeout(res, wait * 1000));
      await loadRepoData();
      const now = Math.max(...[D.garmin && D.garmin.updated, D.cal && D.cal.updated].filter(Boolean).map(x => +new Date(x)), 0);
      if (now > before) { Refresh.status = "done"; break; }
    }
    if (Refresh.status === "running") Refresh.status = "";
    if (!$("#veil")) route();
  } catch { Refresh.status = ""; }
  Refresh.busy = false;
  return true;
}
async function loadRepoData() {
  const [cal, garmin, brief] = await Promise.all([repoJSON("calendar.json"), repoJSON("garmin.json"), repoJSON("brief.json")]);
  Object.assign(D, { cal, garmin, brief });
}

/* events from every source, normalized:
   { id, src: outlook|brightspace|school, title, start: Date, end: Date|null, allDay, location, notes, kind, course, classId, done } */
function parseStart(s) { return s.length === 10 ? fromKey(s) : new Date(s); }
function classFor(text) {
  const t = String(text || "").toUpperCase().replace(/\s+/g, "");
  return U.classes.find(c => c.code && t.includes(c.code.toUpperCase().replace(/\s+/g, "")));
}
/* an Outlook calendar named after a subject ("Physics", "Economics") belongs to that class */
const SUBJECT = { physics:"PHY", history:"HIS", economics:"ECO", econ:"ECO", macro:"ECO", statistics:"STAT", statitsics:"STAT", stats:"STAT", finance:"FIN", accounting:"ACC", marketing:"MKT", math:"MAT", calculus:"MAT" };
/* class meetings on the main calendar are titled by subject ("World History", "Macroeconomics") */
function classForTitle(title) {
  const t = String(title || "").toLowerCase();
  const key = Object.keys(SUBJECT).find(k => new RegExp(`\\b${k}`).test(t));
  return key ? U.classes.find(c => (c.code || "").toUpperCase().replace(/\s+/g, "").startsWith(SUBJECT[key])) || null : null;
}
function classForCal(name) {
  const n = String(name || "").toLowerCase().trim();
  if (!n || n === "calendar") return null;
  const code = SUBJECT[n];
  return U.classes.find(c => (code && (c.code || "").toUpperCase().replace(/\s+/g, "").startsWith(code)) || (c.name || "").toLowerCase() === n || (c.code || "").toLowerCase() === n) || null;
}
function allEvents() {
  const out = [];
  for (const e of (D.cal && D.cal.events) || []) {
    const start = parseStart(e.start);
    let end = e.end ? parseStart(e.end) : null;
    if (e.allDay && end) end = addDays(end, -1);
    const ev = { ...e, start, end };
    if (e.src === "outlook") {
      const fromCal = classForCal(e.cal);
      const c = fromCal || classFor(e.title) || classForTitle(e.title);
      if (c) ev.classId = c.id;
      // items on a class calendar (Physics, Economics...) are assignments and tests
      if (fromCal) {
        if (/\b(exam|test|quiz|midterm|final)\b/i.test(e.title)) ev.kind = "test";
        else if (e.allDay || /\b(homework|hw|problem set|assignment|essay|paper|due|reading|response|lab|project|worksheet|unit)\b/i.test(e.title)) ev.kind = "due";
        if (ev.kind) ev.done = !!U.doneIds[e.id];
      }
    }
    if (e.src === "brightspace") {
      const c = classFor(`${e.course || ""} ${e.title} ${e.notes || ""}`);
      if (c) ev.classId = c.id;
      ev.done = !!U.doneIds[e.id];
    }
    out.push(ev);
  }
  for (const it of U.items) {
    const start = it.time ? new Date(`${it.date}T${it.time}`) : fromKey(it.date);
    const c = U.classes.find(c => c.id === it.classId);
    out.push({ id:"m" + it.id, mid:it.id, src:"school", title:it.title, start, end:null, allDay:!it.time,
      kind:it.kind, classId:it.classId, course:c ? c.code : "", done:!!it.done, notes:it.notes || "" });
  }
  out.sort((a, b) => a.start - b.start || (b.allDay - a.allDay));
  return out;
}
function eventsOn(evs, day) {
  const k = dkey(day);
  return evs.filter(e => {
    if (dkey(e.start) === k) return true;
    if (e.allDay && e.end) return dkey(e.start) <= k && k <= dkey(e.end);
    return false;
  });
}
const isDue = e => e.src === "brightspace" || e.src === "school" || (e.src === "outlook" && !!e.kind);
const srcClass = e => `c-${e.src}`;
const srcName = { outlook:"Outlook", brightspace:"Brightspace", school:"Added by you" };

/* ---------------- places / location ---------------- */
const allPlaces = () => [...PRESETS, ...(U.places || [])];
let HERE = null; // resolved { id, name, lat, lon, auto }
function nearestPreset(lat, lon) {
  let best = null, bd = 1e9;
  for (const p of allPlaces()) {
    const d = Math.hypot((p.lat - lat) * 69, (p.lon - lon) * 53);
    if (d < bd) { bd = d; best = p; }
  }
  return bd < 15 ? best : null;
}
async function resolvePlace(force) {
  if (HERE && !force) return HERE;
  const fixed = allPlaces().find(p => p.id === U.place);
  if (fixed) { HERE = { ...fixed, auto:false }; }
  else {
    const last = lsGet("sp_geo", null);
    try {
      const pos = await new Promise((res, rej) => {
        if (!navigator.geolocation) return rej(new Error("no gps"));
        navigator.geolocation.getCurrentPosition(res, rej, { timeout:8000, maximumAge:30 * 6e4 });
      });
      const lat = +pos.coords.latitude.toFixed(3), lon = +pos.coords.longitude.toFixed(3);
      const near = nearestPreset(lat, lon);
      let name = near ? near.name : null;
      if (!name) {
        try {
          const g = await getJSON(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
          name = g.city || g.locality || null;
        } catch {}
      }
      HERE = { id:"auto", name:name || "Current location", lat, lon, auto:true };
      lsSet("sp_geo", HERE);
    } catch {
      HERE = last ? { ...last, auto:true, stale:true } : { ...PRESETS[0], id:"auto", auto:true, fallback:true };
    }
  }
  // share only the town name (never coordinates) so the daily overview knows where you are
  if (!U.here || U.here.name !== HERE.name) { U.here = { name:HERE.name, at:dkey(new Date()) }; touch(); }
  return HERE;
}

/* ---------------- weather ---------------- */
const WMO = {
  0:["Clear","sun"], 1:["Mostly clear","sun"], 2:["Partly cloudy","part"], 3:["Cloudy","cloud"], 45:["Fog","fog"], 48:["Fog","fog"],
  51:["Light drizzle","rain"], 53:["Drizzle","rain"], 55:["Heavy drizzle","rain"], 56:["Freezing drizzle","rain"], 57:["Freezing drizzle","rain"],
  61:["Light rain","rain"], 63:["Rain","rain"], 65:["Heavy rain","rain"], 66:["Freezing rain","rain"], 67:["Freezing rain","rain"],
  71:["Light snow","snow"], 73:["Snow","snow"], 75:["Heavy snow","snow"], 77:["Snow grains","snow"],
  80:["Showers","rain"], 81:["Showers","rain"], 82:["Heavy showers","rain"], 85:["Snow showers","snow"], 86:["Snow showers","snow"],
  95:["Thunderstorms","storm"], 96:["Thunderstorms","storm"], 99:["Thunderstorms","storm"],
};
const wmoText = c => (WMO[c] || ["—"])[0];
function wIcon(code, night) {
  const k = (WMO[code] || [, "cloud"])[1];
  const sun = night ? `<path d="M15 4a7 7 0 1 0 5 11A6 6 0 0 1 15 4z"/>` : `<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>`;
  const cl = `<path d="M7 19h10a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.6 1.7A3.2 3.2 0 0 0 7 19z"/>`;
  const svg = {
    sun, cloud:cl,
    part: night ? `<path d="M13 3a5 5 0 0 0 5 7"/>${cl}` : `<circle cx="8" cy="8" r="3"/><path d="M8 2v1.5M2 8h1.5M3.8 3.8l1 1M12.2 3.8l-1 1"/>${cl}`,
    rain:`<path d="M7 15h10a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.6 1.7A3.2 3.2 0 0 0 7 15z"/><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3"/>`,
    snow:`<path d="M7 15h10a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.6 1.7A3.2 3.2 0 0 0 7 15z"/><path d="M8 19h.01M12 21h.01M16 19h.01M10 21.5h.01M14 18.5h.01"/>`,
    fog:`<path d="M4 9h16M3 13h18M5 17h14"/>`,
    storm:`<path d="M7 15h10a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.6 1.7A3.2 3.2 0 0 0 7 15z"/><path d="m12 15-2 4h4l-2 4"/>`,
  }[k] || cl;
  return `<svg viewBox="0 0 24 24">${svg}</svg>`;
}
const MEM = {};
async function cached(key, ttlMin, fn) {
  const hit = MEM[key] || lsGet("sp_c_" + key, null);
  if (hit && Date.now() - hit.at < ttlMin * 6e4) { MEM[key] = hit; return hit.v; }
  try {
    const v = await fn(); MEM[key] = { at:Date.now(), v }; lsSet("sp_c_" + key, MEM[key]); return v;
  } catch (e) {
    if (hit) return hit.v; // offline: show the last copy
    throw e;
  }
}
function getWx(p) {
  return cached(`wx_${p.lat}_${p.lon}`, 15, async () => {
    const q = new URLSearchParams({
      latitude:p.lat, longitude:p.lon, timezone:"America/New_York", forecast_days:16, past_days:7,
      temperature_unit:"fahrenheit", wind_speed_unit:"mph", precipitation_unit:"inch",
      current:"temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,is_day,precipitation",
      hourly:"temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,wind_speed_10m,is_day,uv_index",
      daily:"weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,snowfall_sum,wind_speed_10m_max,wind_gusts_10m_max,uv_index_max,sunrise,sunset",
    });
    const w = await getJSON(`https://api.open-meteo.com/v1/forecast?${q}`);
    try {
      const a = await getJSON(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${p.lat}&longitude=${p.lon}&current=us_aqi&timezone=America/New_York`);
      w.aqi = a.current ? a.current.us_aqi : null;
    } catch { w.aqi = null; }
    return w;
  });
}
function getAlerts(p) {
  return cached(`al_${p.lat}_${p.lon}`, 10, async () => {
    const j = await getJSON(`https://api.weather.gov/alerts/active?point=${p.lat},${p.lon}`, { headers:{ Accept:"application/geo+json" } });
    return (j.features || []).map(f => ({ event:f.properties.event, headline:f.properties.headline, severity:f.properties.severity, ends:f.properties.ends || f.properties.expires, desc:f.properties.description }));
  }).catch(() => []);
}
/* daily lookup: { "YYYY-MM-DD": {hi, lo, code, rain} } */
function wxDays(w) {
  const m = {};
  if (!w || !w.daily) return m;
  w.daily.time.forEach((t, i) => w.daily.temperature_2m_max[i] != null && (m[t] = { hi:Math.round(w.daily.temperature_2m_max[i]), lo:Math.round(w.daily.temperature_2m_min[i]), code:w.daily.weather_code[i], rain:w.daily.precipitation_probability_max[i] }));
  return m;
}
function wxAt(w, date) {
  if (!w || !w.hourly) return null;
  const k = `${dkey(date)}T${pad(date.getHours())}:00`;
  const i = w.hourly.time.indexOf(k);
  if (i < 0) return null;
  return { t:Math.round(w.hourly.temperature_2m[i]), code:w.hourly.weather_code[i], rain:w.hourly.precipitation_probability[i], night:!w.hourly.is_day[i] };
}
/* "Rain likely from 3 PM to 7 PM" for the next 18 hours */
function rainTiming(w) {
  if (!w || !w.hourly) return "";
  const nowK = `${dkey(new Date())}T${pad(new Date().getHours())}:00`;
  const i0 = Math.max(0, w.hourly.time.indexOf(nowK));
  let s = -1, e = -1;
  for (let i = i0; i < i0 + 18 && i < w.hourly.time.length; i++) {
    const wet = (w.hourly.precipitation_probability[i] || 0) >= 50;
    if (wet && s < 0) s = i;
    if (s >= 0 && !wet) { e = i; break; }
  }
  if (s < 0) return "";
  const hs = new Date(w.hourly.time[s]), word = [71, 73, 75, 77, 85, 86].includes(w.hourly.weather_code[s]) ? "Snow" : "Rain";
  if (s === i0) return e > 0 ? `${word} until about ${fmtTime(new Date(w.hourly.time[e]))}` : `${word} through the evening`;
  return `${word} likely from ${fmtTime(hs)}${e > 0 ? ` to ${fmtTime(new Date(w.hourly.time[e]))}` : ""}`;
}
function whatToWear(w) {
  if (!w || !w.current) return "";
  const nowK = `${dkey(new Date())}T${pad(new Date().getHours())}:00`;
  const i0 = Math.max(0, w.hourly.time.indexOf(nowK));
  const span = [...Array(12).keys()].map(k => i0 + k).filter(i => i < w.hourly.time.length);
  const feels = Math.min(w.current.apparent_temperature, ...span.slice(0, 10).map(i => w.hourly.apparent_temperature[i]));
  const rain = Math.max(...span.map(i => w.hourly.precipitation_probability[i] || 0));
  const snow = span.some(i => [71, 73, 75, 77, 85, 86].includes(w.hourly.weather_code[i]));
  const wind = Math.max(...span.map(i => w.hourly.wind_speed_10m[i] || 0));
  let s = feels < 25 ? "Heavy coat, hat and gloves" : feels < 38 ? "Winter jacket" : feels < 50 ? "Jacket" : feels < 60 ? "Light jacket or hoodie" : feels < 72 ? "Long sleeves or a T-shirt" : "Shorts and a T-shirt";
  if (snow) s += ", boots";
  if (rain >= 40 && !snow) s += feels < 50 ? ", and bring an umbrella" : ". Bring an umbrella";
  if (wind >= 18) s += ". It'll be windy";
  return s + ".";
}

/* ---------------- surf ---------------- */
function windKind(deg, mph) {
  if (mph == null || deg == null) return "unknown";
  const diff = Math.abs(((deg - OFFSHORE_FROM) + 540) % 360 - 180);
  if (mph < 6) return "light";
  if (diff <= 60) return "offshore";
  if (diff >= 120) return "onshore";
  return "cross";
}
/* tuned for small-to-medium fun waves; matches surf_score() in scripts/build.py */
function surfScore(h, per, mph, deg) {
  if (h == null) return { s:0, label:"No data" };
  if (h < 1) return { s:0, label:"Flat" };
  if (h >= 5.5) return { s:1, label:"Too big", big:true };
  let s = 2;
  if (h >= 2 && h <= 4.5) s++;
  if (per != null) { if (per >= 8) s++; else if (per < 6) s--; }
  const k = windKind(deg, mph);
  if (k === "offshore" || k === "light") s++;
  else if (k === "onshore" && mph >= 12) s -= 2;
  else if (k === "onshore" && mph >= 8) s--;
  else if (k === "cross" && mph >= 15) s--;
  if (h < 1.5) s = Math.min(s, 2); else if (h < 2) s = Math.min(s, 3);
  s = Math.max(1, Math.min(5, s));
  return { s, label:{ 1:"Poor", 2:"Poor", 3:"Fun", 4:"Good", 5:"Great" }[s] };
}
const pillCls = r => r.big ? "big" : `s${r.s}`;
function wetsuit(f) {
  if (f == null) return "";
  if (f >= 72) return "Trunks"; if (f >= 65) return "Spring suit"; if (f >= 58) return "3/2 full suit";
  if (f >= 50) return "4/3 + booties"; return "5/4 hooded + booties and gloves";
}
function getSurf() {
  return cached("surf", 30, async () => {
    const mq = new URLSearchParams({ latitude:SURF_SPOT.lat, longitude:SURF_SPOT.lon, timezone:"America/New_York", length_unit:"imperial", forecast_days:10,
      hourly:"wave_height,wave_period,wave_direction,swell_wave_height,swell_wave_period,swell_wave_direction,sea_surface_temperature" });
    const wq = new URLSearchParams({ latitude:SURF_SPOT.wlat, longitude:SURF_SPOT.wlon, timezone:"America/New_York", wind_speed_unit:"mph", forecast_days:10,
      hourly:"wind_speed_10m,wind_direction_10m,wind_gusts_10m", daily:"sunrise,sunset" });
    const t = new Date(), b = `${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}`;
    const [m, w, tide] = await Promise.all([
      getJSON(`https://marine-api.open-meteo.com/v1/marine?${mq}`),
      getJSON(`https://api.open-meteo.com/v1/forecast?${wq}`),
      getJSON(`https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=predictions&station=${TIDE_STATION.id}&begin_date=${b}&range=192&datum=MLLW&interval=hilo&units=english&time_zone=lst_ldt&format=json&application=ScootCalendar`).catch(() => null),
    ]);
    const sun = {};
    w.daily.time.forEach((d, i) => sun[d] = { rise:w.daily.sunrise[i], set:w.daily.sunset[i] });
    const wi = {};
    w.hourly.time.forEach((t, i) => wi[t] = i);
    const hours = m.hourly.time.map((t, i) => {
      const j = wi[t];
      const h = m.hourly.wave_height[i], per = m.hourly.wave_period[i];
      const mph = j != null ? w.hourly.wind_speed_10m[j] : null, deg = j != null ? w.hourly.wind_direction_10m[j] : null;
      return { t, h, per, dir:m.hourly.wave_direction[i], sh:m.hourly.swell_wave_height[i], sp:m.hourly.swell_wave_period[i],
        sst:m.hourly.sea_surface_temperature[i] != null ? C2F(m.hourly.sea_surface_temperature[i]) : null,
        mph, deg, gust:j != null ? w.hourly.wind_gusts_10m[j] : null, r:surfScore(h, per, mph, deg) };
    });
    const tides = tide && tide.predictions ? tide.predictions.map(p => ({ t:p.t.replace(" ", "T"), ft:+(+p.v).toFixed(1), type:p.type })) : [];
    return { hours, sun, tides };
  });
}
/* daylight hours of a day */
function surfDay(S, key) {
  const sn = S.sun[key];
  const rise = sn ? +sn.rise.slice(11, 13) : 7, set = sn ? +sn.set.slice(11, 13) : 17;
  return S.hours.filter(h => h.t.startsWith(key) && +h.t.slice(11, 13) >= rise && +h.t.slice(11, 13) <= set);
}
function surfDaySummary(S, key) {
  const hs = surfDay(S, key);
  if (!hs.length) return null;
  const best = hs.reduce((a, b) => (b.r.s > a.r.s || (b.r.s === a.r.s && (b.h || 0) > (a.h || 0) && !b.r.big)) ? b : a);
  const max = Math.max(...hs.map(h => h.h || 0));
  return { best, max, min:Math.min(...hs.map(h => h.h || 0)), r:best.r };
}
/* best 3-hour window in daylight (from now on, for today) */
function bestWindow(S, key) {
  let hs = surfDay(S, key);
  if (key === dkey(new Date())) hs = hs.filter(h => new Date(h.t) >= new Date(Date.now() - 36e5));
  if (!hs.length) return null;
  let best = null;
  for (let i = 0; i < hs.length; i++) {
    const win = hs.slice(i, i + 3);
    const sc = win.reduce((a, h) => a + h.r.s, 0) / win.length;
    if (!best || sc > best.sc + 0.01) best = { sc, from:win[0], to:win[win.length - 1], r:surfScore(win[0].h, win[0].per, win[0].mph, win[0].deg) };
  }
  return best;
}
/* swell alerts: good days coming in the next 1 to 4 days */
function swellAlerts(S) {
  const out = [];
  for (let n = 1; n <= 4; n++) {
    const d = addDays(today0(), n), sm = surfDaySummary(S, dkey(d));
    if (!sm) continue;
    const wkend = d.getDay() === 0 || d.getDay() === 6;
    if (sm.r.s >= 4 || (wkend && sm.r.s >= 3)) out.push({ d, sm });
  }
  return out;
}
function surfByDay(S) {
  const m = {};
  if (!S) return m;
  for (let n = -1; n < 10; n++) { const k = dkey(addDays(today0(), n)); const s = surfDaySummary(S, k); if (s) m[k] = s; }
  return m;
}

/* ---------------- sheet (bottom modal) ---------------- */
function sheet(title, html, bind) {
  closeSheet();
  const v = document.createElement("div");
  v.className = "veil"; v.id = "veil";
  v.innerHTML = `<div class="sheet" role="dialog"><div class="sheet-h"><h2>${esc(title)}</h2><button aria-label="Close" data-x>×</button></div><div class="sheet-b">${html}</div></div>`;
  v.addEventListener("click", e => { if (e.target === v || e.target.closest("[data-x]")) closeSheet(); });
  document.body.appendChild(v);
  document.body.style.overflow = "hidden";
  if (bind) bind($(".sheet-b", v));
  return v;
}
function closeSheet() { const v = $("#veil"); if (v) v.remove(); document.body.style.overflow = ""; }
const formVals = el => Object.fromEntries($$("[name]", el).map(i => [i.name, i.type === "checkbox" ? i.checked : i.value.trim()]));
const fld = (label, name, val = "", type = "text", extra = "") =>
  `<label class="fld"><span>${label}</span><input name="${name}" type="${type}" value="${esc(val)}" ${extra}></label>`;
const sel = (label, name, opts, val) =>
  `<label class="fld"><span>${label}</span><select name="${name}">${opts.map(o => { const [v, t] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}"${String(v) === String(val) ? " selected" : ""}>${esc(t)}</option>`; }).join("")}</select></label>`;
const area = (label, name, val = "", ph = "") => `<label class="fld"><span>${label}</span><textarea name="${name}" placeholder="${esc(ph)}">${esc(val)}</textarea></label>`;

/* ---------------- settings ---------------- */
function openSettings() {
  const cal = D.cal && D.cal.sources ? D.cal.sources : {};
  const srcLine = (k, n) => { const s = cal[k]; return s ? `${n}: ${s.count || 0} events${s.feeds > 1 ? ` from ${s.feeds} calendars` : ""}, updated ${ago(s.at)}${s.note ? ` (${esc(s.note)})` : ""}` : `${n}: not connected yet`; };
  const g = D.garmin;
  sheet("Settings", `
    ${sel("Weather location", "place", [["auto", "Use my location"], ...allPlaces().map(p => [p.id, p.name])], U.place)}
    <div class="btns" style="margin-top:8px"><button class="btn sm" data-addplace>+ Add a town</button></div>
    <div class="h-sec" style="margin-top:22px"><h2>Sync</h2></div>
    ${fld("GitHub token (stays on this phone)", "token", Sync.token(), "password", 'autocomplete="off" placeholder="github_pat_..."')}
    <p class="hint">Saves your classes, grades and due dates to the repo so the daily overview can read them and your other devices get them. Make a fine-grained token with <b>Contents: Read and write</b> on ScootCalendar only. ${Sync.status ? `<br><b>${esc(Sync.status)}</b>` : ""}</p>
    <div class="h-sec" style="margin-top:22px"><h2>Connections</h2></div>
    <p class="hint" style="font-size:13px;color:var(--ink2)">${srcLine("outlook", "Outlook")}<br>Garmin: ${g ? (g.ok ? `updated ${ago(g.updated)}` : `problem: ${esc((g.errors || []).join(", "))}`) : "not connected yet"}<br>Daily overview: ${D.brief ? `last written ${esc(D.brief.date)}` : "not written yet"}</p>
    <p class="hint">Calendar feeds and Garmin update about once an hour. Set them up with the steps in the README.</p>
    <div class="h-sec" style="margin-top:22px"><h2>Backup</h2></div>
    <div class="btns" style="margin-top:0"><button class="btn sm" data-export>Copy backup</button><button class="btn sm" data-import>Restore backup</button></div>
    <div class="btns"><button class="btn pri" data-save>Save</button></div>`,
  el => {
    $("[data-save]", el).onclick = async () => {
      const v = formVals(el);
      const tokChanged = v.token !== Sync.token();
      lsSet("sp_token", v.token);
      if (v.place !== U.place) { U.place = v.place; HERE = null; touch(); }
      closeSheet();
      if (tokChanged && v.token) { const changed = await Sync.pull(); if (!changed) Sync.push(); }
      route();
    };
    $("[data-addplace]", el).onclick = () => addPlace();
    $("[data-export]", el).onclick = async () => {
      try { await navigator.clipboard.writeText(JSON.stringify(U)); alertSheet("Backup copied", "Paste it into a note to keep it safe."); }
      catch { alertSheet("Couldn't copy", "Your browser blocked the clipboard."); }
    };
    $("[data-import]", el).onclick = () => sheet("Restore backup", `${area("Paste backup", "json")}<div class="btns"><button class="btn pri" data-go>Restore</button></div>`, e2 => {
      $("[data-go]", e2).onclick = () => {
        try { const j = JSON.parse(formVals(e2).json); U = Object.assign(seedUser(), j); touch(); closeSheet(); route(); }
        catch { alertSheet("That didn't work", "The backup text isn't valid."); }
      };
    });
  });
}
function alertSheet(t, msg) { sheet(t, `<p style="padding:14px 0;font-size:15px">${esc(msg)}</p><div class="btns"><button class="btn pri" data-x>OK</button></div>`); }
function addPlace() {
  sheet("Add a town", `${fld("Town or city", "q", "", "text", 'placeholder="e.g. Brigantine NJ"')}<div id="res"></div>`, el => {
    let t;
    $("[name=q]", el).oninput = e => {
      clearTimeout(t);
      const q = e.target.value.trim();
      t = setTimeout(async () => {
        if (q.length < 3) return;
        try {
          const r = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q.replace(/,?\s+(NJ|PA|NY)$/i, ""))}&count=8&countryCode=US`);
          $("#res", el).innerHTML = (r.results || []).map((p, i) => `<button class="li" data-i="${i}"><div class="nm">${esc(p.name)}<small>${esc([p.admin1, p.admin2].filter(Boolean).join(", "))}</small></div><div class="rt">Add</div></button>`).join("") || `<div class="empty">No matches</div>`;
          $$("[data-i]", el).forEach(b => b.onclick = () => {
            const p = r.results[+b.dataset.i];
            const id = "p" + uid();
            U.places.push({ id, name:p.name, lat:+p.latitude.toFixed(3), lon:+p.longitude.toFixed(3) });
            U.place = id; HERE = null; touch(); closeSheet(); route();
          });
        } catch { $("#res", el).innerHTML = `<div class="empty">Search failed</div>`; }
      }, 350);
    };
  });
}

/* ---------------- router ---------------- */
const TABS = ["home", "calendar", "school", "weather", "surf", "fitness"];
const VIEWS = {};
let CUR = "";
function route() {
  const parts = (location.hash.replace(/^#\/?/, "") || "home").split("/");
  const tab = TABS.includes(parts[0]) ? parts[0] : "home";
  if (tab !== CUR) window.scrollTo(0, 0);
  CUR = tab;
  $$(".nav a").forEach(a => a.classList.toggle("on", a.dataset.tab === tab));
  const app = $("#app");
  Promise.resolve(VIEWS[tab](app, parts.slice(1))).catch(e => {
    console.error(e);
    app.innerHTML = `<div class="err"><b>Something went wrong.</b> ${esc(e.message || e)}</div>`;
  });
}
function mastDate() {
  const d = new Date();
  $("#mastDate").innerHTML = `<b>${d.toLocaleDateString("en-US", { weekday:"long" })}</b>${MON[d.getMonth()]} ${d.getDate()}`;
}

async function boot() {
  mastDate();
  $("#gear").onclick = openSettings;
  window.addEventListener("hashchange", route);
  await Promise.all([loadRepoData(), Sync.pull()]);
  route();
  requestRefresh(false);
  // refresh when the app comes back to the front
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState !== "visible") return;
    mastDate();
    await Promise.all([loadRepoData(), Sync.pull()]);
    if (!$("#veil")) route();
    requestRefresh(false);
  });
}
window.addEventListener("DOMContentLoaded", boot);
