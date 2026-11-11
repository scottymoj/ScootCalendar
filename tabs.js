/* Scoot Calendar tabs: School, Weather, Surf, Fitness */
"use strict";

/* ================= SCHOOL ================= */
const LETTERS = [["A", 93], ["A-", 90], ["B+", 87], ["B", 83], ["B-", 80], ["C+", 77], ["C", 73], ["C-", 70], ["D", 60]];
const letterFor = p => (LETTERS.find(([, m]) => p >= m) || ["F"])[0];
const pct = n => `${(Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, "")}%`;

function catAvg(cat) {
  const sc = cat.scores || [];
  const max = sc.reduce((a, s) => a + (+s.max || 0), 0);
  return max > 0 ? sc.reduce((a, s) => a + (+s.pts || 0), 0) / max * 100 : null;
}
/* current grade + what's needed on the final for each letter */
function gradeMath(c) {
  const cats = c.cats || [];
  const fin = cats.find(x => x.id === c.finalId);
  const graded = cats.filter(x => x !== fin && catAvg(x) != null && +x.weight > 0);
  const gw = graded.reduce((a, x) => a + +x.weight, 0);
  if (!gw) return { cur:null, fin, need:[] };
  const cur = graded.reduce((a, x) => a + +x.weight * catAvg(x), 0) / gw;
  if (!fin || !(+fin.weight > 0)) return { cur, fin:null, need:[] };
  const other = cats.filter(x => x !== fin && !graded.includes(x)).reduce((a, x) => a + (+x.weight || 0), 0);
  const total = gw + other + +fin.weight;
  const banked = graded.reduce((a, x) => a + +x.weight * catAvg(x), 0) + other * cur; // ungraded categories assumed at your current average
  const need = LETTERS.map(([l, m]) => ({ l, m, n:(m * total - banked) / +fin.weight }));
  const best = (banked + 100 * +fin.weight) / total;
  return { cur, fin, need, best, other };
}
function riskNote(c, g) {
  if (!g.fin || !g.need.length) return "";
  const i = LETTERS.findIndex(([l]) => l === (c.target || "B+"));
  const t = g.need[i < 0 ? 2 : i], lower = g.need[(i < 0 ? 2 : i) + 1];
  const n = Math.ceil(t.n);
  if (t.n <= 0) return `<div class="risk ok">A <b>${t.l}</b> is locked in even with a 0 on the final.</div>`;
  if (t.n <= 75) return `<div class="risk ok">Very doable. You need <b>${n}%</b> on the final for a <b>${t.l}</b>.</div>`;
  if (t.n <= 88) return `<div class="risk warn">Doable, but it needs real prep. You need <b>${n}%</b> on the final for a <b>${t.l}</b>.</div>`;
  if (t.n <= 100) return `<div class="risk red">That's a stretch. You need <b>${n}%</b> on the final for a <b>${t.l}</b>.${lower ? ` A ${lower.l} needs ${Math.max(0, Math.ceil(lower.n))}%.` : ""}</div>`;
  return `<div class="risk red">A <b>${t.l}</b> isn't reachable anymore. With 100% on the final, the best you can finish with is about <b>${pct(g.best)} (${letterFor(g.best)})</b>.</div>`;
}

function editItem(it, classId) {
  const isNew = !it;
  it = it || { id:uid(), classId: classId || (U.classes[0] && U.classes[0].id), title:"", kind:"due", date:dkey(addDays(today0(), 1)), time:"", notes:"", done:false };
  sheet(isNew ? "Add due date or test" : "Edit", `
    ${fld("What", "title", it.title, "text", 'placeholder="e.g. Homework 9"')}
    ${sel("Class", "classId", [...U.classes.map(c => [c.id, `${c.code} ${c.name}`]), ["", "Other / personal"]], it.classId || "")}
    ${sel("Type", "kind", [["due", "Assignment / due"], ["test", "Test or quiz"]], it.kind)}
    <div class="row2">${fld("Date", "date", it.date, "date")}${fld("Time (optional)", "time", it.time, "time")}</div>
    ${area("Notes", "notes", it.notes)}
    <div class="btns">${isNew ? "" : `<button class="btn del" data-del>Delete</button>`}<button class="btn pri" data-save>Save</button></div>`,
  el => {
    $("[data-save]", el).onclick = () => {
      const v = formVals(el);
      if (!v.title || !v.date) return alertSheet("Missing info", "Add what it is and the date.");
      Object.assign(it, v);
      if (isNew) U.items.push(it);
      touch(); closeSheet(); route();
    };
    const d = $("[data-del]", el);
    if (d) d.onclick = () => { U.items = U.items.filter(x => x.id !== it.id); touch(); closeSheet(); route(); };
  });
}

VIEWS.school = async (app, parts) => {
  if (parts[0]) return classPage(app, parts[0]);
  const evs = allEvents().filter(e => isDue(e));
  const t = today0();
  const tests = evs.filter(e => e.kind === "test" && !e.done && e.start >= t && e.start < addDays(t, 45));
  const due = evs.filter(e => e.kind !== "test" && e.start >= addDays(t, -3) && e.start < addDays(t, 15) && (!e.done || e.start >= t));
  const overdue = due.filter(e => !e.done && e.start < t);
  const W = HERE ? await getWx(HERE).catch(() => null) : null;
  app.innerHTML = `
    <div class="h-sec"><h2>Tests coming up</h2><button class="add" data-add>+ Add</button></div>
    ${tests.length ? `<div class="cd">${tests.map(e => { const n = daysBetween(t, e.start); const c = U.classes.find(x => x.id === e.classId); return `<button class="${n <= 3 ? "soon" : ""}" data-ev="${esc(e.id)}"><div class="d">${n === 0 ? "Today" : n}${n ? `<small>${n === 1 ? "day" : "days"}</small>` : ""}</div><div class="w">${esc(e.title)}<small>${esc([c ? c.code : e.course, fmtDay(e.start)].filter(Boolean).join(" · "))}</small></div></button>`; }).join("")}</div>`
      : `<div class="empty">No tests in the next 6 weeks. Brightspace quizzes and exams show up here automatically.</div>`}
    <div class="h-sec"><h2>Due next 2 weeks</h2><span>${overdue.length ? `<b class="red">${overdue.length} overdue</b>` : ""}</span></div>
    ${due.length ? due.map(e => evRow(e, { showDay:true, right:`<input type="checkbox" data-chk="${esc(e.id)}" ${e.done ? "checked" : ""} aria-label="Done" style="width:20px;height:20px;accent-color:#121212">` })).join("") : `<div class="empty">Nothing due. Tap + Add for anything Brightspace doesn't have.</div>`}
    <div class="h-sec"><h2>Classes</h2><button class="add" data-addc>+ Class</button></div>
    ${U.classes.map(c => {
      const g = gradeMath(c);
      const next = evs.find(e => e.classId === c.id && !e.done && e.start >= t);
      return `<div class="cls"><a class="cls-h" href="#/school/${c.id}"><div class="nm"><span style="display:inline-block;width:10px;height:10px;background:${esc(c.color || "#121212")};margin-right:8px;vertical-align:2px"></span>${esc(c.name)}<small>${esc([c.code, c.when, next ? `Next: ${next.title}, ${relDay(next.start)}` : ""].filter(Boolean).join(" · "))}</small></div>
        <div class="gr">${g.cur != null ? `${letterFor(g.cur)}<small>${pct(g.cur)}</small>` : `<small>Add grades ›</small>`}</div></a></div>`;
    }).join("")}
    <div class="updated">Due dates from Brightspace sync about once an hour. Check off items here; it doesn't change Brightspace.</div>`;
  $("[data-add]", app).onclick = () => editItem();
  $("[data-addc]", app).onclick = () => editClass();
  $$("[data-chk]", app).forEach(b => { b.onclick = ev => ev.stopPropagation(); b.onchange = () => toggleDone(b.dataset.chk); });
  bindEvents(app, evs, W);
};
function toggleDone(id) {
  if (id.startsWith("m")) { const it = U.items.find(x => "m" + x.id === id); if (it) it.done = !it.done; }
  else if (U.doneIds[id]) delete U.doneIds[id]; else U.doneIds[id] = true;
  touch(); route();
}
function editClass(c) {
  const isNew = !c;
  c = c || { id:uid(), code:"", name:"", prof:"", room:"", when:"", color:"#1f4e9c", target:"B+", cats:[], guides:[] };
  sheet(isNew ? "Add class" : "Edit class", `
    <div class="row2">${fld("Code", "code", c.code, "text", 'placeholder="ECO 2101"')}${fld("Name", "name", c.name)}</div>
    <p class="hint" style="margin-top:4px">The code is how Brightspace due dates get matched to this class, so use the code Brightspace shows (like PHY 1100).</p>
    <div class="row2">${fld("Professor", "prof", c.prof)}${fld("Room", "room", c.room)}</div>
    ${fld("Meets", "when", c.when, "text", 'placeholder="TR 10:00–11:15"')}
    <div class="row2">${sel("Target grade", "target", LETTERS.map(l => l[0]), c.target)}${sel("Color", "color", [["#1f4e9c", "Blue"], ["#0f7c8c", "Teal"], ["#7a3db8", "Purple"], ["#b06a00", "Orange"], ["#1a7f45", "Green"], ["#c22a2a", "Red"], ["#121212", "Black"]], c.color)}</div>
    <div class="btns">${isNew ? "" : `<button class="btn del" data-del>Delete</button>`}<button class="btn pri" data-save>Save</button></div>`,
  el => {
    $("[data-save]", el).onclick = () => {
      const v = formVals(el);
      if (!v.name) return alertSheet("Missing name", "Give the class a name.");
      Object.assign(c, v);
      if (isNew) U.classes.push(c);
      touch(); closeSheet(); route();
    };
    const d = $("[data-del]", el);
    if (d) d.onclick = () => { U.classes = U.classes.filter(x => x.id !== c.id); touch(); closeSheet(); location.hash = "#/school"; };
  });
}
function editCat(c, cat) {
  const isNew = !cat;
  cat = cat || { id:uid(), name:"", weight:"", scores:[] };
  const rows = () => (cat.scores || []).map((s, i) => `<div class="row2" style="grid-template-columns:1fr 70px 70px 34px;align-items:end">
      ${fld(i ? "" : "Item", `sn${i}`, s.name)}${fld(i ? "" : "Score", `sp${i}`, s.pts, "number", 'inputmode="decimal" step="any"')}${fld(i ? "" : "Out of", `sm${i}`, s.max, "number", 'inputmode="decimal" step="any"')}
      <button class="btn del" data-rm="${i}" style="padding:10px 0;margin-bottom:0">×</button></div>`).join("");
  const read = el => {
    const v = formVals(el);
    cat.name = v.name; cat.weight = v.weight;
    cat.scores = (cat.scores || []).map((s, i) => ({ name:v[`sn${i}`] || "", pts:v[`sp${i}`], max:v[`sm${i}`] }));
    return v;
  };
  const draw = () => sheet(isNew ? "Add grade category" : cat.name || "Category", `
    <div class="row2">${fld("Category", "name", cat.name, "text", 'placeholder="Exams"')}${fld("Weight %", "weight", cat.weight, "number", 'inputmode="decimal" placeholder="40"')}</div>
    <label class="fld" style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="isFinal" ${c.finalId === cat.id ? "checked" : ""} style="width:20px;height:20px;accent-color:#121212"><span style="margin:0">This is the final exam</span></label>
    <div class="h-sec" style="margin-top:18px"><h2>Scores</h2><button class="add" data-more>+ Score</button></div>
    <div id="rows">${rows() || `<p class="hint">No scores yet.</p>`}</div>
    <div class="btns">${isNew ? "" : `<button class="btn del" data-del>Delete</button>`}<button class="btn pri" data-save>Save</button></div>`,
  el => {
    $("[data-more]", el).onclick = () => { read(el); cat.scores.push({ name:`#${cat.scores.length + 1}`, pts:"", max:"100" }); draw(); };
    $$("[data-rm]", el).forEach(b => b.onclick = () => { read(el); cat.scores.splice(+b.dataset.rm, 1); draw(); });
    $("[data-save]", el).onclick = () => {
      const v = read(el);
      cat.scores = cat.scores.filter(s => s.pts !== "" && s.max !== "");
      if (!cat.name) return alertSheet("Missing name", "Name the category, like Exams or Homework.");
      if (isNew) c.cats.push(cat);
      if (v.isFinal) c.finalId = cat.id; else if (c.finalId === cat.id) c.finalId = null;
      touch(); closeSheet(); route();
    };
    const d = $("[data-del]", el);
    if (d) d.onclick = () => { c.cats = c.cats.filter(x => x.id !== cat.id); touch(); closeSheet(); route(); };
  });
  draw();
}
function editGuide(c, g) {
  const isNew = !g;
  g = g || { id:uid(), title:"", body:"" };
  sheet(isNew ? "New study guide" : "Edit guide", `${fld("Title", "title", g.title, "text", 'placeholder="Test 2: Ch 5–8"')}${area("Guide", "body", g.body, "Paste or write your study guide")}
    <div class="btns">${isNew ? "" : `<button class="btn del" data-del>Delete</button>`}<button class="btn pri" data-save>Save</button></div>`, el => {
    $("textarea", el).style.minHeight = "50vh";
    $("[data-save]", el).onclick = () => { Object.assign(g, formVals(el)); if (isNew) c.guides.push(g); touch(); closeSheet(); route(); };
    const d = $("[data-del]", el);
    if (d) d.onclick = () => { c.guides = c.guides.filter(x => x.id !== g.id); touch(); closeSheet(); route(); };
  });
}
async function classPage(app, id) {
  const c = U.classes.find(x => x.id === id);
  if (!c) { location.hash = "#/school"; return; }
  c.cats = c.cats || []; c.guides = c.guides || [];
  const g = gradeMath(c), t = today0();
  const evs = allEvents().filter(e => e.classId === c.id);
  const upcoming = evs.filter(e => e.start >= addDays(t, -7)).slice(0, 12);
  const wsum = c.cats.reduce((a, x) => a + (+x.weight || 0), 0);
  const tgt = c.target || "B+";
  app.innerHTML = `
    <div style="padding-top:14px"><a href="#/school" class="kicker">‹ School</a></div>
    <div class="cls-h" style="padding:10px 0 14px;border-bottom:4px solid ${esc(c.color || "#121212")}"><div class="nm" style="font-size:28px">${esc(c.name)}<small>${esc([c.code, c.prof, c.room, c.when].filter(Boolean).join(" · "))}</small></div>
      <div class="gr" style="font-size:30px">${g.cur != null ? `${letterFor(g.cur)}<small>${pct(g.cur)} now</small>` : ""}</div></div>
    <div class="btns" style="margin-top:10px"><button class="btn sm" data-edit>Edit class</button></div>

    <div class="h-sec"><h2>Grade</h2><button class="add" data-cat>+ Category</button></div>
    ${c.cats.length ? c.cats.map(x => { const a = catAvg(x); return `<button class="catrow" data-c="${x.id}"><div><b>${esc(x.name)}</b>${x.id === c.finalId ? ` <span class="st on">Final</span>` : ""}<br><small>${(x.scores || []).length} ${(x.scores || []).length === 1 ? "score" : "scores"}</small></div><div class="r" style="font-weight:600;color:var(--muted)">${esc(x.weight || 0)}%</div><div class="r">${a != null ? pct(a) : "—"}</div></button>`; }).join("")
      : `<div class="empty">Add the grade categories from the syllabus (like Homework 20%, Exams 50%, Final 30%), then your scores.</div>`}
    ${c.cats.length && Math.abs(wsum - 100) > 0.5 ? `<p class="hint">Weights add up to ${wsum}%, not 100%. Check the syllabus.</p>` : ""}
    ${g.cur != null && !g.fin && c.cats.length ? `<p class="hint">Mark which category is the final exam to see what you need on it.</p>` : ""}
    ${g.need.length ? `<div class="card"><h4><span>What you need on the final</span><span>${esc(g.fin.name)}, ${esc(g.fin.weight)}%</span></h4>
      <table class="need"><tr><th>Grade</th><th>Needed on final</th></tr>${g.need.filter(r => r.n > -30).slice(0, 7).map(r => `<tr class="${r.l === tgt ? "tgt" : ""}"><td>${r.l}${r.l === tgt ? " (target)" : ""}</td><td>${r.n <= 0 ? "Locked in" : r.n > 100 ? `<span class="red">${Math.ceil(r.n)}% · not possible</span>` : `${Math.ceil(r.n)}%`}</td></tr>`).join("")}</table>
      <p class="hint">Assumes each category's average stays where it is now${g.other ? `, and categories with no scores yet (${g.other}% of the grade) match your current average` : ""}. Update scores as they come in.</p>
      ${riskNote(c, g)}</div>` : ""}

    <div class="h-sec"><h2>Due & tests</h2><button class="add" data-add>+ Add</button></div>
    ${upcoming.length ? upcoming.map(e => evRow(e, { showDay:true })).join("") : `<div class="empty">Nothing coming up for this class.</div>`}

    <div class="h-sec"><h2>Study guides</h2><button class="add" data-guide>+ Guide</button></div>
    ${c.guides.length ? c.guides.map(x => `<button class="li" data-g="${x.id}"><div class="nm">${esc(x.title || "Untitled")}<small>${esc((x.body || "").slice(0, 80))}${(x.body || "").length > 80 ? "…" : ""}</small></div><div class="rt">Open ›</div></button>`).join("") : `<div class="empty">Save study guides here so they're on your phone before tests.</div>`}`;
  $("[data-edit]", app).onclick = () => editClass(c);
  $("[data-cat]", app).onclick = () => editCat(c);
  $("[data-add]", app).onclick = () => editItem(null, c.id);
  $("[data-guide]", app).onclick = () => editGuide(c);
  $$("[data-c]", app).forEach(b => b.onclick = () => editCat(c, c.cats.find(x => x.id === b.dataset.c)));
  $$("[data-g]", app).forEach(b => b.onclick = () => {
    const gd = c.guides.find(x => x.id === b.dataset.g);
    sheet(gd.title || "Study guide", `<div class="guide">${esc(gd.body)}</div><div class="btns"><button class="btn" data-e>Edit</button></div>`, el => { $("[data-e]", el).onclick = () => editGuide(c, gd); });
  });
  bindEvents(app, evs, null);
}

/* ================= WEATHER ================= */
const aqiLabel = a => a == null ? "" : a <= 50 ? "Good" : a <= 100 ? "Moderate" : a <= 150 ? "Unhealthy for some" : a <= 200 ? "Unhealthy" : "Very unhealthy";
VIEWS.weather = async app => {
  if (!app.querySelector(".wx-hero")) app.innerHTML = `<span class="spin"></span>`;
  const place = await resolvePlace();
  const [W, AL] = await Promise.all([getWx(place).catch(() => null), getAlerts(place)]);
  if (CUR !== "weather") return;
  const chips = `<div class="chips">${[["auto", "📍 My location"], ...allPlaces().map(p => [p.id, p.name])].map(([id, n]) => `<button class="chip ${U.place === id ? "on" : ""}" data-p="${id}">${esc(n)}</button>`).join("")}<button class="chip" data-addp>+ Add</button></div>`;
  if (!W || !W.current) { app.innerHTML = chips + `<div class="err"><b>Weather isn't loading.</b> Check your connection and try again.</div>`; bindWx(app); return; }
  const c = W.current, dd = W.daily, k = dkey(new Date());
  const di = Math.max(0, dd.time.indexOf(k));
  const nowK = `${k}T${pad(new Date().getHours())}:00`;
  const i0 = Math.max(0, W.hourly.time.indexOf(nowK));
  const hrs = [...Array(24).keys()].map(n => i0 + n).filter(i => i < W.hourly.time.length);
  const rt = rainTiming(W);
  const sr = new Date(dd.sunrise[di]), ss = new Date(dd.sunset[di]);
  app.innerHTML = chips + `
    ${place.stale ? `<p class="hint">Using your last known location.</p>` : place.fallback ? `<p class="hint">Location is off, so this is Villanova. Turn on location or pick a place.</p>` : ""}
    <div class="wx-hero"><div><div class="kicker">${esc(place.name)} · now</div><div class="big">${Math.round(c.temperature_2m)}°</div><div class="cond">${esc(wmoText(c.weather_code))}</div><div class="sub">Feels like ${Math.round(c.apparent_temperature)}°</div></div>
      <div class="hl">${wIcon(c.weather_code, !c.is_day)}High <b>${Math.round(dd.temperature_2m_max[di])}°</b><br>Low <b>${Math.round(dd.temperature_2m_min[di])}°</b></div></div>
    <div class="wear"><b>Wear</b><span>${esc(whatToWear(W))}</span></div>
    ${(AL || []).map(a => `<details class="alert red" style="display:block"><summary style="list-style:none;display:flex;gap:10px"><span class="tag">Alert</span><div><b>${esc(a.event)}</b>${esc(a.headline || "")}</div></summary><p class="hint" style="white-space:pre-wrap">${esc(a.desc || "")}</p></details>`).join("")}
    <div class="h-sec"><h2>Next 24 hours</h2><span>${esc(rt || "No rain expected")}</span></div>
    <div class="hours">${hrs.map((i, n) => { const d = new Date(W.hourly.time[i]); const p = W.hourly.precipitation_probability[i]; return `<div class="h"><small>${n ? fmtHour(d.getHours()) : "Now"}</small>${wIcon(W.hourly.weather_code[i], !W.hourly.is_day[i])}<b>${Math.round(W.hourly.temperature_2m[i])}°</b><i>${p >= 20 ? p + "%" : ""}</i></div>`; }).join("")}</div>
    <div class="h-sec"><h2>10 days</h2></div>
    ${dd.time.slice(di, di + 10).map((t, n) => { const i = di + n, d = fromKey(t); return `<div class="dly"><div class="dn">${n === 0 ? "Today" : DOW[d.getDay()]}<small>${MON[d.getMonth()]} ${d.getDate()}</small></div>${wIcon(dd.weather_code[i])}<div class="cn">${esc(wmoText(dd.weather_code[i]))}</div><div class="rn">${dd.precipitation_probability_max[i] >= 20 ? dd.precipitation_probability_max[i] + "%" : ""}</div><div class="tr"><span>${Math.round(dd.temperature_2m_min[i])}°</span><b>${Math.round(dd.temperature_2m_max[i])}°</b></div></div>`; }).join("")}
    <div class="h-sec"><h2>Details</h2></div>
    <div class="grid2">
      <div><div class="k">Wind</div><div class="v">${Math.round(c.wind_speed_10m)}<small>mph ${compass(c.wind_direction_10m)}</small></div><div class="s">Gusts to ${Math.round(c.wind_gusts_10m)} mph</div></div>
      <div><div class="k">Humidity</div><div class="v">${Math.round(c.relative_humidity_2m)}<small>%</small></div></div>
      <div><div class="k">UV index</div><div class="v">${Math.round(dd.uv_index_max[di] || 0)}<small>max today</small></div><div class="s">${(dd.uv_index_max[di] || 0) >= 6 ? "Wear sunscreen" : (dd.uv_index_max[di] || 0) >= 3 ? "Moderate" : "Low"}</div></div>
      <div><div class="k">Air quality</div><div class="v">${W.aqi != null ? Math.round(W.aqi) : "—"}<small>AQI</small></div><div class="s">${aqiLabel(W.aqi)}</div></div>
      <div><div class="k">Sunrise</div><div class="v" style="font-size:19px">${fmtTime(sr)}</div></div>
      <div><div class="k">Sunset</div><div class="v" style="font-size:19px">${fmtTime(ss)}</div></div>
      <div><div class="k">Rain today</div><div class="v">${(dd.precipitation_sum[di] || 0).toFixed(2)}<small>in</small></div><div class="s">${dd.precipitation_probability_max[di]}% chance</div></div>
      <div><div class="k">Snow today</div><div class="v">${((dd.snowfall_sum[di] || 0) / 2.54).toFixed(1)}<small>in</small></div></div>
    </div>
    <div class="updated">Forecast from Open-Meteo (NOAA and other models). Alerts from the National Weather Service.</div>`;
  bindWx(app);
};
function bindWx(app) {
  $$("[data-p]", app).forEach(b => b.onclick = () => { U.place = b.dataset.p; HERE = null; touch(); route(); });
  const a = $("[data-addp]", app); if (a) a.onclick = () => addPlace();
}

/* ================= SURF ================= */
function tideSVG(S) {
  const t0 = today0(), t1 = addDays(t0, 1);
  const pts = S.tides.map(p => ({ t:new Date(p.t), ft:p.ft }));
  if (pts.length < 2) return "";
  // pad one extreme before the first so the curve starts at midnight
  const gap = pts[1].t - pts[0].t;
  pts.unshift({ t:new Date(pts[0].t - gap), ft:pts[1].ft });
  const at = d => {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (d >= a.t && d <= b.t) { const f = (d - a.t) / (b.t - a.t); return a.ft + (b.ft - a.ft) * (1 - Math.cos(Math.PI * f)) / 2; }
    }
    return null;
  };
  const xs = [], W = 300, H = 80;
  for (let m = 0; m <= 24 * 60; m += 15) { const v = at(new Date(+t0 + m * 6e4)); if (v != null) xs.push([m / 1440 * W, v]); }
  if (xs.length < 3) return "";
  const lo = Math.min(...xs.map(p => p[1])) - .3, hi = Math.max(...xs.map(p => p[1])) + .3;
  const y = v => H - (v - lo) / (hi - lo) * H;
  const path = xs.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${y(p[1]).toFixed(1)}`).join("");
  const nx = (new Date() - t0) / 864e5 * W;
  return `<svg class="tide" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path class="fl" d="${path}L${W},${H}L0,${H}Z"/><path class="ln" d="${path}"/>${nx > 0 && nx < W ? `<line class="nw" x1="${nx}" x2="${nx}" y1="0" y2="${H}"/>` : ""}</svg>
    <div class="tlist">${S.tides.filter(p => new Date(p.t) >= t0 && new Date(p.t) < t1).map(p => `<div><span>${p.type === "H" ? "High" : "Low"}</span><b>${fmtTime(new Date(p.t))}</b>${p.ft} ft</div>`).join("")}</div>`;
}
VIEWS.surf = async app => {
  if (!app.querySelector(".rate")) app.innerHTML = `<span class="spin"></span>`;
  let S;
  try { S = await getSurf(); } catch (e) { app.innerHTML = `<div class="err"><b>Surf data isn't loading.</b> Check your connection and try again.</div>`; return; }
  if (CUR !== "surf") return;
  const t = today0(), k = dkey(t), hr = new Date().getHours();
  const h = S.hours.find(x => x.t === `${k}T${pad(hr)}:00`) || S.hours[0];
  const r = h.r, go = r.s >= 3;
  const cls = r.big ? "big" : go ? "go" : "no";
  const sun = S.sun[k];
  const dark = sun && (new Date() > new Date(sun.set) || new Date() < new Date(sun.rise));
  let win = bestWindow(S, k), winDay = t;
  if (!win || dark) { winDay = addDays(t, 1); win = bestWindow(S, dkey(winDay)); }
  const now = new Date();
  const nextTide = S.tides.find(p => new Date(p.t) > now);
  const rising = nextTide ? nextTide.type === "H" : null;
  const sentence = r.big ? "Bigger than you want right now. Watch from the beach or find a sheltered spot."
    : r.s === 0 ? "Too small to ride right now."
    : go ? `${dark ? "Conditions look surfable." : "Worth paddling out."} ${windKind(h.deg, h.mph) === "offshore" ? "Offshore wind is keeping it clean." : windKind(h.deg, h.mph) === "light" ? "Light wind, so it should be fairly clean." : ""}`
    : windKind(h.deg, h.mph) === "onshore" ? "Onshore wind is making it choppy." : "Small and weak right now.";
  const darkNote = dark ? "It's dark right now. " : "";
  const alerts = swellAlerts(S);
  const days = [...Array(8).keys()].map(n => addDays(t, n)).map(d => ({ d, sm:surfDaySummary(S, dkey(d)) })).filter(x => x.sm);
  app.innerHTML = `
    <div class="rate ${cls}"><div class="badge"><div><b>${esc(r.label)}</b><small>${r.big ? "Too big" : go ? "Go" : "No go"}</small></div></div>
      <div><div class="kicker">Stone Harbor · now</div><h1>${h.h < 1 ? "Flat" : `${h.h.toFixed(1)} ft at ${Math.round(h.per || 0)} sec`}</h1><p>${esc(darkNote + sentence)}</p></div></div>
    ${alerts.map(a => `<div class="alert"><span class="tag" style="background:var(--c-surf)">Swell</span><div><b>${esc(a.sm.r.label)} waves ${relDay(a.d)}</b>${a.sm.best.h.toFixed(1)} ft at ${Math.round(a.sm.best.per)} sec around ${fmtTime(new Date(a.sm.best.t))}, ${windKind(a.sm.best.deg, a.sm.best.mph)} wind.</div></div>`).join("")}
    <div class="h-sec"><h2>Best window ${winDay === t ? "today" : "tomorrow"}</h2></div>
    ${win ? `<div class="dayline" style="margin-top:0"><b>${fmtTime(new Date(win.from.t))} – ${fmtTime(new Date(+new Date(win.to.t) + 36e5))}</b><span class="pill ${pillCls(win.from.r)}">${esc(win.from.r.label)}</span><span>${win.from.h.toFixed(1)} ft · ${Math.round(win.from.per)} sec · ${Math.round(win.from.mph)} mph ${windKind(win.from.deg, win.from.mph)}</span></div>` : `<div class="empty">No daylight forecast</div>`}
    <div class="h-sec"><h2>Right now</h2></div>
    <div class="grid2">
      <div><div class="k">Waves</div><div class="v">${(h.h || 0).toFixed(1)}<small>ft · ${Math.round(h.per || 0)} sec</small></div><div class="s">${h.sh != null ? `Swell ${h.sh.toFixed(1)} ft at ${Math.round(h.sp || 0)} sec from the ${compass(h.dir)}` : ""}</div></div>
      <div><div class="k">Wind</div><div class="v">${Math.round(h.mph || 0)}<small>mph ${compass(h.deg)}</small></div><div class="s">${esc(windKind(h.deg, h.mph)[0].toUpperCase() + windKind(h.deg, h.mph).slice(1))}${h.gust ? `, gusts ${Math.round(h.gust)}` : ""}</div></div>
      <div><div class="k">Water</div><div class="v">${h.sst != null ? Math.round(h.sst) : "—"}<small>°F</small></div><div class="s">${esc(wetsuit(h.sst))}</div></div>
      <div><div class="k">Tide</div><div class="v" style="font-size:19px">${rising == null ? "—" : rising ? "Rising" : "Falling"}</div><div class="s">${nextTide ? `${nextTide.type === "H" ? "High" : "Low"} at ${fmtTime(new Date(nextTide.t))}` : ""}</div></div>
      <div><div class="k">Sunrise</div><div class="v" style="font-size:19px">${sun ? fmtTime(new Date(sun.rise)) : "—"}</div></div>
      <div><div class="k">Sunset</div><div class="v" style="font-size:19px">${sun ? fmtTime(new Date(sun.set)) : "—"}</div></div>
    </div>
    <div class="h-sec"><h2>Tide today</h2><span>${esc(TIDE_STATION.name)}</span></div>
    ${S.tides.length ? tideSVG(S) : `<div class="empty">Tide data unavailable</div>`}
    <div class="h-sec"><h2>Next 7 days</h2></div>
    ${days.map(({ d, sm }) => `<div class="sday"><div class="dn">${relDay(d) === "Today" ? "Today" : DOW[d.getDay()]}<small>${MON[d.getMonth()]} ${d.getDate()}</small></div><span class="pill ${pillCls(sm.r)}">${esc(sm.r.label)}</span>
      <div>${sm.max < 1 ? "Flat" : `${Math.max(0, sm.min).toFixed(1)}–${sm.max.toFixed(1)} ft`}<div class="bars">${surfDay(S, dkey(d)).filter((_, i) => i % 1 === 0).map(x => `<i style="height:${Math.min(100, (x.h || 0) / 5 * 100)}%;opacity:${x.r.s >= 3 ? 1 : .35}"></i>`).join("")}</div></div>
      <div class="rt">${sm.r.s >= 3 ? `Best ${fmtTime(new Date(sm.best.t))}` : ""}<br>${Math.round(sm.best.per || 0)} sec · ${esc(windKind(sm.best.deg, sm.best.mph))}</div></div>`).join("")}
    <div class="updated">Ratings are tuned for small-to-medium fun waves: Fun and up means go. Waves and wind from Open-Meteo, tides from NOAA (${esc(TIDE_STATION.name)}, the nearest ocean station). Free forecasts, so treat ratings as a solid estimate.</div>`;
};

/* ================= FITNESS ================= */
function actKind(type) {
  type = type || "";
  if (/run/.test(type)) return "Run";
  if (/strength|fitness_equipment|hiit|indoor_cardio/.test(type)) return "Lift";
  if (/surf/.test(type)) return "Surf";
  if (/cycl|bik/.test(type)) return "Bike";
  if (/walk|hik/.test(type)) return "Walk";
  return "Other";
}
const FIT_SVG = { ...ACT_SVG, Bike:`<svg viewBox="0 0 24 24"><circle cx="6" cy="16" r="3.5"/><circle cx="18" cy="16" r="3.5"/><path d="M6 16l4-7h5l3 7M10 9l2 7M14 5h2"/></svg>`, Walk:`<svg viewBox="0 0 24 24"><circle cx="12" cy="4.5" r="2"/><path d="M9 21l2-6 3 3v3M8 12l2-4h3l2 3h2M11 15l-1-4"/></svg>` };
const pace = (min, mi) => { if (!mi) return ""; const p = min / mi; return `${Math.floor(p)}:${pad(Math.round((p % 1) * 60) % 60)}/mi`; };
const parseG = s => new Date(String(s).replace(" ", "T"));
VIEWS.fitness = async app => {
  const G = D.garmin;
  if (!G || (!G.activities.length && !G.days.length)) {
    app.innerHTML = `<div class="brief-hero"><div class="kicker">Fitness</div><h1>Connect your Garmin</h1><p>Your runs, lifts, sleep and recovery show up here once your Garmin key is added. It also makes the Home activity pick smarter.</p></div>
      <ol class="blist num" style="margin-top:10px">
        <li>On a computer, sign in at connect.garmin.com and go to Settings, then Personal API Key (connect.garmin.com/app/settings/personalApiToken).</li>
        <li>Create a key, accept the terms, pick 1 year, and copy it. Garmin only shows it once.</li>
        <li>In GitHub, open ScootCalendar, then Settings, Secrets and variables, Actions. Add a new secret named GARMIN_API_KEY and paste the key.</li>
        <li>Go to Actions, open "Update calendar data", and tap Run workflow. Your data shows up here in a minute or two.</li></ol>
      ${G && G.errors && G.errors.length ? `<div class="err"><b>Garmin problem:</b> ${esc(G.errors.join(", "))}</div>` : ""}
      <p class="hint">Don't paste the key into a chat or anywhere else. Your activities are saved to the public repo without maps or GPS locations.</p>`;
    return;
  }
  const t = today0();
  const wk0 = addDays(t, -((t.getDay() + 6) % 7)); // Monday
  const acts = G.activities.map(a => ({ ...a, d:parseG(a.start), k:actKind(a.type) })).filter(a => !isNaN(a.d));
  const thisWk = acts.filter(a => a.d >= wk0);
  const miles = thisWk.filter(a => a.k === "Run").reduce((s, a) => s + (a.dist_mi || 0), 0);
  const mins = thisWk.reduce((s, a) => s + (a.dur_min || 0), 0);
  // last 8 weeks of running miles
  const weeks = [...Array(8).keys()].reverse().map(n => { const s = addDays(wk0, -7 * n), e = addDays(s, 7); return { s, mi:acts.filter(a => a.k === "Run" && a.d >= s && a.d < e).reduce((x, a) => x + (a.dist_mi || 0), 0), n:acts.filter(a => a.d >= s && a.d < e).length }; });
  const mx = Math.max(5, ...weeks.map(w => w.mi));
  const bw = 300 / 8;
  const chart = `<svg class="chart" viewBox="0 0 300 130">${weeks.map((w, i) => { const h = w.mi / mx * 95; return `<rect class="b${i === 7 ? " cur" : ""}" x="${i * bw + 6}" y="${108 - h}" width="${bw - 12}" height="${Math.max(1, h)}"/><text class="vl" x="${i * bw + bw / 2}" y="${102 - h}" text-anchor="middle">${w.mi ? w.mi.toFixed(1) : ""}</text><text x="${i * bw + bw / 2}" y="124" text-anchor="middle">${i === 7 ? "This wk" : `${MON[w.s.getMonth()]} ${w.s.getDate()}`}</text>`; }).join("")}</svg>`;
  const days = G.days || [];
  const last = [...days].reverse().find(d => d.sleep_h || d.rhr) || {};
  const lastRhr = [...days].reverse().find(d => d.rhr);
  const lastBB = [...days].reverse().find(d => d.bb_high);
  const lastHrv = [...days].reverse().find(d => d.hrv);
  const sleeps = days.slice(-7);
  const sm = Math.max(9, ...sleeps.map(d => d.sleep_h || 0));
  const sleepChart = sleeps.length ? `<svg class="chart" viewBox="0 0 300 110">${sleeps.map((d, i) => { const w = 300 / sleeps.length, h = (d.sleep_h || 0) / sm * 75; const dt = fromKey(d.date); return `<rect class="b${(d.sleep_h || 0) >= 7 ? " cur" : ""}" x="${i * w + 8}" y="${88 - h}" width="${w - 16}" height="${Math.max(1, h)}"/><text class="vl" x="${i * w + w / 2}" y="${82 - h}" text-anchor="middle">${d.sleep_h ? d.sleep_h.toFixed(1) : ""}</text><text x="${i * w + w / 2}" y="104" text-anchor="middle">${DOW[dt.getDay()]}</text>`; }).join("")}</svg>` : "";
  app.innerHTML = `
    <div class="h-sec" style="margin-top:16px"><h2>This week</h2><span>Since Monday</span></div>
    <div class="stats3"><div><b>${miles.toFixed(1)}</b><span>Miles run</span></div><div><b>${thisWk.length}</b><span>Workouts</span></div><div><b>${(mins / 60).toFixed(1)}</b><span>Hours</span></div></div>
    <div class="h-sec"><h2>Running miles</h2><span>Last 8 weeks</span></div>${chart}
    <div class="h-sec"><h2>Recovery</h2><span>${last.date ? relDay(fromKey(last.date)) : ""}</span></div>
    <div class="grid2">
      <div><div class="k">Sleep</div><div class="v">${last.sleep_h ? last.sleep_h.toFixed(1) : "—"}<small>hrs</small></div><div class="s">${last.sleep_score ? `Score ${last.sleep_score}` : ""}</div></div>
      <div><div class="k">Resting HR</div><div class="v">${lastRhr ? lastRhr.rhr : "—"}<small>bpm</small></div></div>
      <div><div class="k">HRV</div><div class="v">${lastHrv ? lastHrv.hrv : "—"}<small>ms</small></div><div class="s">${lastHrv && lastHrv.hrv_status ? esc(String(lastHrv.hrv_status).toLowerCase()) : ""}</div></div>
      <div><div class="k">Body Battery</div><div class="v">${lastBB ? lastBB.bb_high : "—"}<small>high</small></div><div class="s">${lastBB && lastBB.bb_low != null ? `Low ${lastBB.bb_low}` : ""}</div></div>
    </div>
    ${sleepChart ? `<div class="h-sec"><h2>Sleep</h2><span>Last 7 nights</span></div>${sleepChart}` : ""}
    <div class="h-sec"><h2>Recent activities</h2></div>
    ${acts.slice(0, 20).map(a => `<div class="acty"><div class="ic">${FIT_SVG[a.k] || FIT_SVG.Other}</div><div class="nm">${esc(a.name || a.k)}<small>${esc(relDay(a.d))} · ${fmtTime(a.d)}${a.avg_hr ? ` · ${a.avg_hr} bpm avg` : ""}</small></div>
      <div class="rt">${a.dist_mi >= 0.1 ? `<b>${a.dist_mi.toFixed(2)} mi</b>${a.k === "Run" ? pace(a.dur_min, a.dist_mi) : `${Math.round(a.dur_min)} min`}` : `<b>${Math.round(a.dur_min)} min</b>${a.sets ? `${a.sets} sets` : a.cal ? `${Math.round(a.cal)} cal` : ""}`}</div></div>`).join("") || `<div class="empty">No activities yet</div>`}
    <div class="updated">From Garmin Connect, updated ${ago(G.updated)}${G.errors && G.errors.length ? `<br>Some data didn't load: ${esc(G.errors.join(", "))}` : ""}</div>`;
};
