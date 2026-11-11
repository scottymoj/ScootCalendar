/* Scoot Calendar views: Home and Calendar (+ shared pieces). School, Weather, Surf, Fitness are in tabs.js */
"use strict";

const WAVE_SVG = `<svg viewBox="0 0 24 24"><path d="M2 13c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2"/><path d="M2 18c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2"/></svg>`;
const ACT_SVG = {
  Run:`<svg viewBox="0 0 24 24"><circle cx="14" cy="4.5" r="2"/><path d="M8 21l3-6 3 2v4M6 11l3-3 4 1 3 3h3M11 15l-2-4"/></svg>`,
  Lift:`<svg viewBox="0 0 24 24"><path d="M3 9v6M6 7v10M18 7v10M21 9v6M6 12h12"/></svg>`,
  Surf:`<svg viewBox="0 0 24 24"><path d="M2 16c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2"/><path d="M2 20c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2"/><path d="M5 12c0-5 4-8 9-8 2 0 3.5 1 3.5 2.5S16 9 14 8c-1.5 2-1 4 1 4"/></svg>`,
  Rest:`<svg viewBox="0 0 24 24"><path d="M15 4a7 7 0 1 0 5 11A6 6 0 0 1 15 4z"/></svg>`,
  Other:`<svg viewBox="0 0 24 24"><path d="M3 12h4l2-5 4 10 2-5h6"/></svg>`,
};

function evTime(e) {
  if (e.allDay) return isDue(e) ? (e.kind === "test" ? "Test" : "Due") : "All day";
  return fmtTime(e.start);
}
function evRow(e, opts = {}) {
  const c = e.classId ? U.classes.find(x => x.id === e.classId) : null;
  const calName = e.cal && e.cal.toLowerCase() !== "calendar" && !c ? e.cal : "";
  const sub = [c ? c.code || c.name : (e.course || ""), calName, e.location].filter(Boolean).join(" · ");
  const tm = opts.showDay
    ? `${relDay(e.start)}${e.allDay ? "" : `<small>${fmtTime(e.start)}</small>`}`
    : `${evTime(e)}${!e.allDay && e.end ? `<small>${fmtTime(e.end)}</small>` : ""}`;
  return `<button class="ev ${srcClass(e)}${e.done ? " done" : ""}" data-ev="${esc(e.id)}"${c && c.color ? ` style="--cc:${esc(c.color)}"` : ""}>
    <div class="tm">${tm}</div>
    <div class="ti">${e.kind === "test" ? `<span class="tag2" style="color:var(--live)">Test</span>` : ""}${esc(e.title)}${sub ? `<small>${esc(sub)}</small>` : ""}</div>
    <div class="rt">${opts.right || ""}</div></button>`;
}
function bindEvents(root, evs, W) {
  $$("[data-ev]", root).forEach(b => b.onclick = () => {
    const e = evs.find(x => x.id === b.dataset.ev);
    if (e) openEvent(e, W);
  });
}
function openEvent(e, W) {
  const c = e.classId ? U.classes.find(x => x.id === e.classId) : null;
  const when = e.allDay
    ? `${fmtLong(e.start)}${e.end && dkey(e.end) !== dkey(e.start) ? ` to ${fmtLong(e.end)}` : ""}`
    : `${fmtLong(e.start)}<br>${fmtTime(e.start)}${e.end ? ` – ${fmtTime(e.end)}` : ""}`;
  let wx = "";
  if (W) {
    if (!e.allDay) {
      const a = wxAt(W, e.start);
      if (a) wx = `${a.t}°, ${wmoText(a.code).toLowerCase()}${a.rain >= 20 ? `, ${a.rain}% chance of rain` : ""}`;
    }
    if (!wx) { const d = wxDays(W)[dkey(e.start)]; if (d) wx = `High ${d.hi}°, low ${d.lo}°, ${wmoText(d.code).toLowerCase()}${d.rain >= 20 ? `, ${d.rain}% rain` : ""}`; }
    if (wx && HERE) wx += ` <span class="muted">(${esc(HERE.name)})</span>`;
  }
  const canDone = e.src === "brightspace" || e.src === "school" || (e.src === "outlook" && !!e.kind);
  sheet(e.title, `
    <div class="kv"><span>When</span><div>${when}</div></div>
    ${e.location ? `<div class="kv"><span>Where</span><div>${esc(e.location)}</div></div>` : ""}
    ${c || e.course ? `<div class="kv"><span>Class</span><div>${esc(c ? `${c.code} ${c.name}` : e.course)}</div></div>` : ""}
    ${wx ? `<div class="kv"><span>Weather</span><div>${wx}</div></div>` : ""}
    ${e.notes ? `<div class="kv"><span>Notes</span><div class="pre">${esc(e.notes)}</div></div>` : ""}
    <div class="kv"><span>From</span><div>${srcName[e.src] || e.src}${e.cal ? ` · ${esc(e.cal)}` : ""}</div></div>
    <div class="btns">
      ${canDone ? `<button class="btn pri" data-done>${e.done ? "Mark not done" : "Mark done"}</button>` : ""}
      ${e.src === "school" ? `<button class="btn" data-edit>Edit</button>` : ""}
    </div>`,
  el => {
    const d = $("[data-done]", el);
    if (d) d.onclick = () => {
      if (e.src !== "school") { if (e.done) delete U.doneIds[e.id]; else U.doneIds[e.id] = true; }
      else { const it = U.items.find(x => x.id === e.mid); if (it) it.done = !it.done; }
      touch(); closeSheet(); route();
    };
    const ed = $("[data-edit]", el);
    if (ed) ed.onclick = () => editItem(U.items.find(x => x.id === e.mid));
  });
}

/* quick pick when the written overview isn't in */
function quickActivity(evs, W, S) {
  const t = today0(), k = dkey(t);
  const todays = eventsOn(evs, t).filter(e => !e.allDay);
  const busy = todays.length >= 4;
  const d = wxDays(W)[k];
  const wet = d && d.rain >= 60;
  const surf = S ? surfDaySummary(S, k) : null;
  const atShore = HERE && /stone harbor|avalon|wildwood|ocean city|sea isle/i.test(HERE.name);
  const acts = (D.garmin && D.garmin.activities) || [];
  const last = acts[0];
  const lastType = last ? (/run/.test(last.type) ? "Run" : /strength|fitness_equipment|hiit/.test(last.type) ? "Lift" : /surf/.test(last.type) ? "Surf" : "Other") : null;
  const lastDays = last && last.start ? daysBetween(new Date(last.start.replace(" ", "T")), t) : null;
  if (surf && surf.r.s >= 3 && atShore && !wet) return { pick:"Surf", title:`Surf ${surf.r.label.toLowerCase()} waves around ${fmtTime(new Date(surf.best.t))}`, why:`${surf.best.h.toFixed(1)} ft with ${windKind(surf.best.deg, surf.best.mph)} wind.` };
  if (lastDays === 0) return { pick:"Rest", title:"You already got a workout in today", why:"Stretch, eat well, and sleep." };
  if (wet) return { pick:"Lift", title:"Lift indoors", why:`${d.rain}% chance of rain today.` };
  if (busy) return { pick: lastType === "Lift" ? "Run" : "Lift", title: lastType === "Lift" ? "Short easy run, 20 to 30 minutes" : "Quick 30 to 40 minute lift", why:`Packed day with ${todays.length} things on the calendar.` };
  if (lastType === "Run") return { pick:"Lift", title:"Full lift", why:"You ran last time, so switch it up." };
  return { pick:"Run", title: d && d.hi >= 45 && d.hi <= 75 ? "Longer run, nice weather for it" : "Run, 30 to 45 minutes", why: d ? `High of ${d.hi}°, ${wmoText(d.code).toLowerCase()}.` : "Good day to get outside." };
}
function actCard(a, note) {
  const p = ACT_SVG[a.pick] ? a.pick : "Other";
  return `<div class="act"><div class="ic">${ACT_SVG[p]}</div><div><div class="kicker">${esc(a.pick || "Activity")}${note ? ` · ${note}` : ""}</div><h3>${esc(a.title || a.pick)}</h3>${a.why ? `<p>${esc(a.why)}</p>` : ""}</div></div>`;
}
const listSec = (title, items, cls = "") => items && items.length ? `<div class="h-sec"><h2>${esc(title)}</h2></div><ul class="blist ${cls}">${items.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : "";

/* ================= HOME ================= */
VIEWS.home = async app => {
  if (!app.innerHTML.includes("brief-hero")) app.innerHTML = `<span class="spin"></span>`;
  const place = await resolvePlace();
  const [W, S, AL] = await Promise.all([getWx(place).catch(() => null), getSurf().catch(() => null), getAlerts(place)]);
  if (CUR !== "home") return;
  const evs = allEvents(), t = today0(), k = dkey(t);
  const B = D.brief && D.brief.date === k ? D.brief : null;
  const hr = new Date().getHours();
  const hello = hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening";

  // now strip
  let wxCell = `<div class="k">${esc(place.name)}</div><div class="s">Weather unavailable</div>`;
  if (W && W.current) {
    const d = wxDays(W)[k];
    const rt = rainTiming(W);
    wxCell = `<div class="k"><span>${esc(place.name)}</span></div><div class="t">${Math.round(W.current.temperature_2m)}°<small>${d ? `${d.hi}° / ${d.lo}°` : ""}</small></div><div class="s">${esc(rt || wmoText(W.current.weather_code))}. ${esc(whatToWear(W))}</div>`;
  }
  let sfCell = `<div class="k">Stone Harbor surf</div><div class="s">Surf data unavailable</div>`;
  if (S) {
    const nowK = `${k}T${pad(hr)}:00`;
    const h = S.hours.find(x => x.t === nowK) || S.hours[0];
    sfCell = `<div class="k"><span>Stone Harbor surf</span></div><div class="t">${h.h < 1 ? "Flat" : `${h.h.toFixed(1)}<small>ft · ${esc(h.r.label)}</small>`}</div><div class="s">${Math.round(h.per || 0)} sec · ${Math.round(h.mph || 0)} mph ${windKind(h.deg, h.mph)} wind${h.sst ? ` · ${Math.round(h.sst)}° water` : ""}</div>`;
  }

  // alerts
  let alerts = "";
  for (const a of (AL || []).slice(0, 2)) alerts += `<a class="alert red" href="#/weather"><span class="tag">Alert</span><div><b>${esc(a.event)}</b>${esc(a.headline || "")}</div></a>`;
  if (S) for (const s of swellAlerts(S)) alerts += `<a class="alert" href="#/surf"><span class="tag" style="background:var(--c-surf)">Swell</span><div><b>${esc(s.sm.r.label)} waves ${relDay(s.d)}</b>${s.sm.best.h.toFixed(1)} ft around ${fmtTime(new Date(s.sm.best.t))}, ${windKind(s.sm.best.deg, s.sm.best.mph)} wind.</div></a>`;

  // calendar today + due soon + tests
  const todays = eventsOn(evs, t);
  const dueSoon = evs.filter(e => isDue(e) && !e.done && e.start >= t && e.start < addDays(t, 8) && !(e.kind === "test")).slice(0, 8);
  const tests = evs.filter(e => e.kind === "test" && !e.done && e.start >= t && e.start < addDays(t, 22)).slice(0, 4);

  const hero = B
    ? `<div class="brief-hero"><div class="kicker">Your day · written ${esc(fmtTime(new Date(B.written_at)))}</div><h1>${esc(B.headline)}</h1>${B.summary ? `<p>${esc(B.summary)}</p>` : ""}</div>`
    : `<div class="brief-hero"><div class="kicker">${esc(fmtLong(t))}</div><h1>${hello}, Scott</h1><p>${D.brief ? `Today's overview isn't in yet. It's written each morning around 6:15. Here's a live look at your day.` : `Your written overview will show up here each morning once it's set up. Here's a live look at your day.`}</p></div>`;

  app.innerHTML = `${hero}
    <div class="now"><a href="#/weather">${wxCell}</a><a href="#/surf">${sfCell}</a></div>
    ${alerts}
    <div class="h-sec"><h2>Activity</h2></div>
    ${B && B.activity ? actCard(B.activity) : actCard(quickActivity(evs, W, S), "quick pick")}
    ${B ? listSec("Today", B.today) + listSec("Heads up", B.heads_up, "warn") + listSec("Coming up", B.upcoming) + listSec("What to do", B.recommendations, "num") : ""}
    <div class="h-sec"><h2>On the calendar</h2><a href="#/calendar">Calendar ›</a></div>
    ${todays.length ? todays.map(e => evRow(e)).join("") : `<div class="empty">Nothing on the calendar today</div>`}
    ${tests.length ? `<div class="h-sec"><h2>Tests</h2><a href="#/school">School ›</a></div><div class="cd">${tests.map(e => { const n = daysBetween(t, e.start); return `<button class="${n <= 3 ? "soon" : ""}" data-ev="${esc(e.id)}"><div class="d">${n === 0 ? "Today" : n}${n ? `<small>${n === 1 ? "day" : "days"}</small>` : ""}</div><div class="w">${esc(e.title)}<small>${esc(fmtDay(e.start))}</small></div></button>`; }).join("")}</div>` : ""}
    <div class="h-sec"><h2>Due this week</h2><a href="#/school">School ›</a></div>
    ${dueSoon.length ? dueSoon.map(e => evRow(e, { showDay:true })).join("") : `<div class="empty">Nothing due in the next week</div>`}
    <div class="updated">${B ? "Overview written by Claude from your calendar, classes, Garmin and the forecast." : ""}${D.cal && D.cal.updated ? `<br>Calendar synced ${ago(D.cal.updated)}` : ""}</div>`;
  bindEvents(app, evs, W);
};

/* ================= CALENDAR ================= */
const CS = { view: lsGet("sp_calview", "week"), cur: today0(), sel: null };
function periodLabel() {
  const c = CS.cur;
  if (CS.view === "day") return `${fmtDay(c)}<small>${relDay(c) === `${MON[c.getMonth()]} ${c.getDate()}` ? c.getFullYear() : relDay(c)}</small>`;
  if (CS.view === "week") {
    const s = addDays(c, -c.getDay()), e = addDays(s, 6);
    return `${MON[s.getMonth()]} ${s.getDate()} – ${s.getMonth() === e.getMonth() ? "" : MON[e.getMonth()] + " "}${e.getDate()}<small>Week</small>`;
  }
  return `${c.toLocaleDateString("en-US", { month:"long" })}<small>${c.getFullYear()}</small>`;
}
function shift(n) {
  const c = new Date(CS.cur);
  if (CS.view === "day") c.setDate(c.getDate() + n);
  else if (CS.view === "week") c.setDate(c.getDate() + 7 * n);
  else { c.setDate(1); c.setMonth(c.getMonth() + n); }
  CS.cur = c; CS.sel = null;
}
VIEWS.calendar = async app => {
  if (!app.querySelector(".seg")) app.innerHTML = `<span class="spin"></span>`;
  const place = await resolvePlace();
  const W = await getWx(place).catch(() => null); // only used for the weather line when you tap an event
  if (CUR !== "calendar") return;
  const evs = allEvents(), t = today0();
  const isNow = CS.view === "day" ? dkey(CS.cur) === dkey(t) : CS.view === "week" ? dkey(addDays(CS.cur, -CS.cur.getDay())) === dkey(addDays(t, -t.getDay())) : CS.cur.getMonth() === t.getMonth() && CS.cur.getFullYear() === t.getFullYear();

  let body = "";
  if (CS.view === "day") {
    const list = eventsOn(evs, CS.cur);
    body = `<div style="height:6px"></div>
      ${list.length ? list.map(e => evRow(e)).join("") : `<div class="empty">Nothing scheduled</div>`}`;
  } else if (CS.view === "week") {
    const s0 = addDays(CS.cur, -CS.cur.getDay());
    for (let i = 0; i < 7; i++) {
      const d = addDays(s0, i), k = dkey(d), list = eventsOn(evs, d);
      body += `<div class="dayhead${k === dkey(t) ? " today" : ""}"><h3>${fmtDay(d)}</h3></div>
        ${list.length ? list.map(e => evRow(e)).join("") : `<div class="muted" style="font-size:13px;padding:8px 0 2px">Nothing scheduled</div>`}`;
    }
  } else {
    const first = new Date(CS.cur.getFullYear(), CS.cur.getMonth(), 1), start = addDays(first, -first.getDay());
    const weeks = Math.ceil((first.getDay() + new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()) / 7);
    let cells = DOW.map(x => `<div class="dow">${x[0]}</div>`).join("");
    for (let i = 0; i < weeks * 7; i++) {
      const d = addDays(start, i), k = dkey(d), list = eventsOn(evs, d);
      const dots = list.slice(0, 5).map(e => { const c = e.classId && U.classes.find(x => x.id === e.classId); return `<i class="${srcClass(e)}"${c && c.color ? ` style="--cc:${esc(c.color)}"` : ""}></i>`; }).join("") + (list.length > 5 ? `<em>+${list.length - 5}</em>` : "");
      cells += `<button class="c${d.getMonth() !== first.getMonth() ? " out" : ""}${k === dkey(t) ? " today" : ""}${CS.sel === k ? " sel" : ""}" data-day="${k}">
        <span class="n"><span>${d.getDate()}</span></span><span class="dots">${dots}</span></button>`;
    }
    const selD = CS.sel ? fromKey(CS.sel) : null;
    body = `<div class="month">${cells}</div>
      <div class="legend"><span class="c-outlook"><i></i>Outlook</span><span class="c-school"><i></i>School</span></div>
      ${selD ? `<div class="dayhead${CS.sel === dkey(t) ? " today" : ""}"><h3>${fmtDay(selD)}</h3></div>${eventsOn(evs, selD).map(e => evRow(e)).join("") || `<div class="empty">Nothing scheduled</div>`}` : `<p class="hint" style="text-align:center">Tap a day to see what's on it.</p>`}`;
  }

  app.innerHTML = `
    <div class="seg">${["day", "week", "month"].map(v => `<button data-v="${v}" class="${CS.view === v ? "on" : ""}">${v[0].toUpperCase() + v.slice(1)}</button>`).join("")}</div>
    <div class="datebar"><button data-sh="-1" aria-label="Back">‹</button><div class="d">${periodLabel()}</div><button data-sh="1" aria-label="Next">›</button></div>
    ${isNow ? "" : `<div style="text-align:center"><button class="chip" data-today style="margin:4px 0 0">Jump to today</button></div>`}
    ${body}
    <div class="updated">${D.cal && D.cal.updated ? `Outlook and Brightspace synced ${ago(D.cal.updated)}` : `Outlook and Brightspace aren't connected yet`}</div>`;

  $$("[data-v]", app).forEach(b => b.onclick = () => { CS.view = b.dataset.v; lsSet("sp_calview", CS.view); CS.sel = null; route(); });
  $$("[data-sh]", app).forEach(b => b.onclick = () => { shift(+b.dataset.sh); route(); });
  const td = $("[data-today]", app); if (td) td.onclick = () => { CS.cur = today0(); CS.sel = CS.view === "month" ? dkey(today0()) : null; route(); };
  $$("[data-day]", app).forEach(b => b.onclick = () => { CS.sel = CS.sel === b.dataset.day ? null : b.dataset.day; route(); });
  bindEvents(app, evs, W);
  if (CS.view === "week" && isNow && window.scrollY < 10) {
    const th = $(".dayhead.today", app);
    if (th && th.previousElementSibling) window.scrollTo(0, th.getBoundingClientRect().top + window.scrollY - 70);
  }
  // swipe left/right to move between days, weeks or months
  let x0 = null;
  app.ontouchstart = e => { x0 = e.touches[0].clientX; };
  app.ontouchend = e => {
    if (x0 == null || CUR !== "calendar") return;
    const dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (Math.abs(dx) > 70) { shift(dx < 0 ? 1 : -1); route(); }
  };
};
