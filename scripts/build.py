"""Scoot Calendar data builder.

Runs in GitHub Actions about every hour and writes:
  data/calendar.json    Outlook + Brightspace events (from their calendar feed links)
  data/garmin.json      Recent Garmin activities, sleep and daily stats (Garmin Personal API)
  data/conditions.json  Weather for Scott's places + Stone Harbor surf, for the daily AI overview

Secrets (GitHub repo -> Settings -> Secrets and variables -> Actions):
  OUTLOOK_ICS        Outlook "Publish a calendar" ICS links, one per line (as many calendars as you want)
  BRIGHTSPACE_ICS    Brightspace Calendar "Subscribe" link
  GARMIN_API_KEY     Garmin Connect personal API key
Any secret that is missing is skipped, and the old file is kept.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
UA = "ScootCalendar/1.0 (personal app; github.com/scottymoj/ScootCalendar)"

PLACES = {
    "villanova": {"name": "Villanova", "lat": 40.0376, "lon": -75.3427},
    "chatham": {"name": "Chatham", "lat": 40.7409, "lon": -74.3838},
    "stoneharbor": {"name": "Stone Harbor", "lat": 39.0515, "lon": -74.7608},
}
SURF = {"lat": 39.04, "lon": -74.73}  # just off the Stone Harbor beach
TIDE_STATION = "8535835"  # Wildwood Crest, ocean pier: nearest NOAA ocean-side station
OFFSHORE_FROM = 300  # Stone Harbor faces SE, so wind from the NW is offshore


def now_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def fetch(url: str, *, headers: dict | None = None, data: bytes | None = None, method: str | None = None, timeout: int = 40) -> bytes:
    h = {"User-Agent": UA}
    h.update(headers or {})
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def fetch_json(url: str, **kw):
    return json.loads(fetch(url, **kw).decode("utf-8"))


def save(name: str, obj) -> None:
    DATA.mkdir(exist_ok=True)
    (DATA / name).write_text(json.dumps(obj, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"saved data/{name}")


def load(name: str):
    try:
        return json.loads((DATA / name).read_text(encoding="utf-8"))
    except Exception:
        return None


# ---------------------------------------------------------------- calendars
def clean_text(s, limit=400) -> str:
    s = str(s or "")
    s = re.sub(r"<[^>]+>", " ", s)
    s = s.replace("\\n", "\n").replace("\\,", ",")
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n{3,}", "\n\n", s).strip()
    return s[:limit] + ("…" if len(s) > limit else "")


def to_et(v) -> tuple[str, bool]:
    """Return (ISO string, all_day)."""
    if isinstance(v, datetime):
        if v.tzinfo is None:
            v = v.replace(tzinfo=ET)
        return v.astimezone(ET).isoformat(timespec="minutes"), False
    return v.isoformat(), True


def read_ics(url: str, source: str) -> list[dict]:
    import icalendar
    import recurring_ical_events

    url = url.strip().replace("webcal://", "https://", 1)
    cal = icalendar.Calendar.from_ical(fetch(url, timeout=60))
    cal_name = clean_text(cal.get("X-WR-CALNAME"), 60)
    today = datetime.now(ET).date()
    start, end = today - timedelta(days=21), today + timedelta(days=150)
    out = []
    for ev in recurring_ical_events.of(cal).between(start, end):
        title = clean_text(ev.get("SUMMARY"), 160) or "(No title)"
        dtstart = ev.get("DTSTART")
        if dtstart is None:
            continue
        s, all_day = to_et(dtstart.dt)
        dtend = ev.get("DTEND")
        e = to_et(dtend.dt)[0] if dtend is not None else None
        if str(ev.get("TRANSP", "")).upper() == "TRANSPARENT" and source == "outlook" and title.lower() in ("free",):
            continue
        status = str(ev.get("STATUS", "")).upper()
        if status == "CANCELLED":
            continue
        uid = str(ev.get("UID", "")) + "|" + s
        item = {
            "id": source[0] + hashlib.md5(uid.encode()).hexdigest()[:10],
            "src": source,
            "title": title,
            "start": s,
            "end": e,
            "allDay": all_day,
            "location": clean_text(ev.get("LOCATION"), 160),
            "notes": clean_text(ev.get("DESCRIPTION"), 500),
        }
        if cal_name and source == "outlook":
            item["cal"] = cal_name
        cats = ev.get("CATEGORIES")
        if cats is not None:
            try:
                vals = cats.cats if hasattr(cats, "cats") else [c for cc in cats for c in cc.cats]
                item["cats"] = [str(c) for c in vals][:3]
            except Exception:
                pass
        if source == "brightspace":
            # Brightspace puts the course name in the description or the title suffix
            m = re.search(r"\b([A-Z]{2,4})\s?-?(\d{4})\b", title + " " + item["notes"])
            if m:
                item["course"] = f"{m.group(1)} {m.group(2)}"
            item["kind"] = "test" if re.search(r"\b(exam|test|quiz|midterm|final)\b", title, re.I) else "due"
        out.append(item)
    out.sort(key=lambda x: x["start"])
    return out


def build_calendar() -> None:
    old = load("calendar.json") or {}
    result = {"updated": now_utc(), "events": [], "sources": {}}
    for source, env in (("outlook", "OUTLOOK_ICS"), ("brightspace", "BRIGHTSPACE_ICS")):
        urls = [u for u in re.split(r"[\s,]+", os.environ.get(env, "")) if u.startswith(("http", "webcal", "file"))]
        if not urls:
            result["sources"][source] = {"ok": False, "note": f"{env} secret not set"}
            continue
        evs, failed, seen = [], 0, set()
        for i, url in enumerate(urls):
            try:
                for e in read_ics(url, source):
                    e["feed"] = f"{source}#{i}"
                    if e["id"] not in seen:
                        seen.add(e["id"]); evs.append(e)
            except Exception as e:  # keep the last good copy of this one calendar
                failed += 1
                print(f"{source} feed {i + 1} failed: {e}", file=sys.stderr)
                key = f"{source}#{i}"
                evs += [x for x in old.get("events", []) if x.get("feed") == key]
                continue
        result["events"] += evs
        prev = (old.get("sources") or {}).get(source, {})
        result["sources"][source] = {"ok": failed == 0, "count": len(evs), "feeds": len(urls), "at": now_utc() if failed < len(urls) else prev.get("at")}
        if failed:
            result["sources"][source]["note"] = f"{failed} of {len(urls)} calendars failed to load"
    result["events"].sort(key=lambda x: x["start"])
    save("calendar.json", result)


# ---------------------------------------------------------------- garmin
GARMIN = "https://personal.connectapi.garmin.com"
# never saved (public repo): identity fields and anything that can place him on a map
DROP_KEY = re.compile(r"(^lat$|^lon$|^lng$|latitude|longitude|polyline|geopoint|location|uuid|userprofile|ownerid|deviceid|"
                      r"displayname|fullname|email|birth|gender|ownerprofile|username|userid|profileimage|"
                      r"^pk$|unitid|serial|macaddress)", re.I)


def garmin_get(token: str, path: str, params: dict | None = None):
    url = GARMIN + path + ("?" + urllib.parse.urlencode(params) if params else "")
    raw = fetch(url, headers={"Authorization": f"Bearer {token}", "Accept": "application/json"})
    return json.loads(raw) if raw.strip() else None


def scrub(o, depth=0):
    """Copy of a Garmin response without identity/location fields and with long arrays cut short."""
    if isinstance(o, dict):
        return {k: scrub(v, depth + 1) for k, v in o.items() if not DROP_KEY.search(k)}
    if isinstance(o, list):
        return [scrub(v, depth + 1) for v in o[:3]] + ([f"... {len(o) - 3} more"] if len(o) > 3 else [])
    return o


def flat(o, prefix="", out=None, depth=0):
    """Flatten numbers/short strings into {"a.b.c": value}; skips arrays (time series) and identity fields."""
    out = {} if out is None else out
    if depth > 5:
        return out
    if isinstance(o, dict):
        for k, v in o.items():
            if DROP_KEY.search(k):
                continue
            flat(v, f"{prefix}.{k}" if prefix else k, out, depth + 1)
    elif isinstance(o, bool) or o is None:
        pass
    elif isinstance(o, (int, float)):
        out[prefix] = round(o, 2) if isinstance(o, float) else o
    elif isinstance(o, str) and len(o) <= 40:
        out[prefix] = o
    return out


def as_list(r, *keys):
    if isinstance(r, list):
        return r
    if isinstance(r, dict):
        for k in keys + ("data", "values", "summaries", "items"):
            if isinstance(r.get(k), list):
                return r[k]
        return [r]
    return []


def day_of(d):
    for k in ("calendarDate", "date", "summaryDate", "startDate"):
        v = d.get(k) if isinstance(d, dict) else None
        if v:
            return str(v)[:10]
    return ""


def first(d: dict, *keys):
    for k in keys:
        if d.get(k) is not None:
            return d[k]
    return None


def build_garmin() -> None:
    key = os.environ.get("GARMIN_API_KEY", "").strip()
    if not key:
        print("GARMIN_API_KEY not set, skipping Garmin")
        return
    old = load("garmin.json") or {}
    out = {"updated": now_utc(), "ok": True, "errors": [], "activities": old.get("activities", []), "days": old.get("days", []),
           "weight": old.get("weight", []), "profile": old.get("profile", {})}
    try:
        token = fetch(GARMIN + "/personalapitoken-service/personal-api/personal-api-key/token",
                      headers={"Authorization": f"ApiKey {key}"}, data=b"", method="POST").decode().strip()
        if token.startswith("{"):
            j = json.loads(token)
            token = j.get("access_token") or j.get("accessToken") or j.get("token") or token
    except Exception as e:
        out["ok"] = False
        out["errors"].append(f"token: {type(e).__name__} {getattr(e, 'code', '')}".strip())
        save("garmin.json", out)
        return

    today = datetime.now(ET).date()
    start = today - timedelta(days=29)
    raw = {}

    def call(name, path, params=None):
        try:
            r = garmin_get(token, path, params)
            raw[name] = scrub(r)
            return r
        except Exception as e:
            out["errors"].append(f"{name}: {type(e).__name__} {getattr(e, 'code', '')}".strip())
            raw[name] = f"error {getattr(e, 'code', type(e).__name__)}"
            return None

    days: dict[str, dict] = {}
    put = lambda dy, k, v: v is not None and days.setdefault(dy, {}).__setitem__(k, v)

    # ---- daily summaries: steps, calories, distance, floors, intensity minutes, stress, heart rate, body battery, SpO2, respiration...
    ds = call("daily_summaries", "/usersummary-service/v2/dailysummaries", {"startDate": start.isoformat(), "endDate": today.isoformat()})
    for d in as_list(ds, "dailySummaries"):
        dy = day_of(d)
        if dy:
            days.setdefault(dy, {})["all"] = flat(d)

    # ---- sleep: summaries for the range, full detail (stages, score) for each night
    sl = call("sleep_summaries", "/sleep-service/sleep/dailySleepSummariesByDate", {"startDate": start.isoformat(), "endDate": today.isoformat()})
    for d in as_list(sl, "dailySleepSummaries"):
        dto = d.get("dailySleepDTO", d) if isinstance(d, dict) else {}
        dy = day_of(dto) or day_of(d)
        if dy:
            days.setdefault(dy, {})["sleep"] = flat(d)
    for n in range(7):
        dy = (today - timedelta(days=n)).isoformat()
        r = call("sleep_detail" if n == 0 else f"_sleep_{n}", "/sleep-service/sleep/dailySleep", {"date": dy})
        if isinstance(r, dict):
            days.setdefault(dy, {})["sleep_detail"] = flat(r.get("dailySleepDTO", r))
            if r.get("dailySleepDTO") is not None:
                for k in ("avgOvernightHrv", "restingHeartRate", "bodyBatteryChange", "avgSleepStress"):
                    if r.get(k) is not None:
                        days[dy]["sleep_detail"][k] = r[k]
    for k in [k for k in raw if k.startswith("_sleep_")]:
        raw.pop(k)

    # ---- body battery, HRV
    bb = call("body_battery", "/wellness-service/wellness/bodyBattery/reports/daily", {"startDate": start.isoformat(), "endDate": today.isoformat()})
    for d in as_list(bb):
        dy = day_of(d)
        if dy:
            days.setdefault(dy, {})["bb"] = flat(d)
    hv = call("hrv", f"/hrv-service/hrv/daily/{start.isoformat()}/{today.isoformat()}")
    for d in as_list(hv, "hrvSummaries"):
        dy = day_of(d)
        if dy:
            days.setdefault(dy, {})["hrv_detail"] = flat(d)

    # ---- today only: heart rate, SpO2, fitness age
    hr = call("heart_rate_today", "/wellness-service/wellness/dailyHeartRate", {"date": today.isoformat()})
    if isinstance(hr, dict):
        days.setdefault(today.isoformat(), {})["hr"] = flat(hr)
    sp = call("spo2_today", f"/wellness-service/wellness/daily/spo2acclimation/{today.isoformat()}")
    if isinstance(sp, (dict, list)):
        days.setdefault(today.isoformat(), {})["spo2"] = flat(sp if isinstance(sp, dict) else (sp[0] if sp else {}))
    fa = call("fitness_age", f"/fitnessage-service/fitnessage/v2/{today.isoformat()}")
    zones = call("hr_zones", "/biometric-service/heartRateZones/v2")
    profile = {}
    if isinstance(fa, dict):
        comp = fa.get("components") or {}
        g = lambda k, f="value": (comp.get(k) or {}).get(f)
        profile["fitness_age"] = {k: v for k, v in {
            "fitness_age": fa.get("fitnessAge"), "age": fa.get("chronologicalAge"), "previous": fa.get("previousFitnessAge"),
            "vig_days": g("vigorousDaysAvg"), "vig_days_target": g("vigorousDaysAvg", "targetValue"),
            "vig_min": g("vigorousMinutesAvg"), "vig_min_target": g("vigorousMinutesAvg", "targetValue"),
            "rhr": g("rhr"), "bmi": g("bmi"), "bmi_target": g("bmi", "targetValue"),
        }.items() if v is not None}
    z = as_list(zones)
    if z and isinstance(z[0], dict):
        z0 = next((x for x in z if x.get("sport") == "DEFAULT"), z[0])
        profile["hr_zones"] = {"floors": [z0.get(f"zone{i}Floor") for i in range(1, 6)], "max": z0.get("maxHeartRateUsed"), "rest": z0.get("restingHeartRateUsed")}
    out["profile"] = profile or out["profile"]

    # ---- weight
    wt = call("weight", f"/weight-service/weight/range/{(today - timedelta(days=180)).isoformat()}/{today.isoformat()}", {"includeAll": "true"})
    ws = []
    for d in as_list(wt, "dailyWeightSummaries", "dateWeightList"):
        f = flat(d)
        dy = day_of(d) or str(f.get("summaryDate") or "")[:10]
        lbs = None
        for k, v in f.items():
            if re.search(r"(^|\.)weight$", k, re.I) and isinstance(v, (int, float)) and v > 1000:  # grams
                lbs = round(v / 453.592, 1)
                break
        if dy and lbs:
            ws.append({"date": dy, "lbs": lbs})
    if wt is not None:
        out["weight"] = sorted(ws, key=lambda x: x["date"])

    # ---- activities (no maps or GPS)
    acts = []
    for page in range(5):
        batch = call("activities" if page == 0 else "_acts", "/activitylist-service/activities/search/activities", {"start": page * 50, "limit": 50})
        batch = as_list(batch, "activityList", "activities")
        acts += [a for a in batch if isinstance(a, dict)]
        if len(batch) < 50:
            break
    raw.pop("_acts", None)
    if acts or not out["activities"]:
        out["activities"] = [{
            "id": a.get("activityId"),
            "name": a.get("activityName"),
            "type": ((a.get("activityType") or {}).get("typeKey")) or "other",
            "start": a.get("startTimeLocal"),
            "dist_mi": round((a.get("distance") or 0) / 1609.344, 2),
            "dur_min": round((a.get("duration") or a.get("movingDuration") or 0) / 60, 1),
            "avg_hr": a.get("averageHR"),
            "max_hr": a.get("maxHR"),
            "cal": a.get("calories"),
            "elev_ft": round((a.get("elevationGain") or 0) * 3.28084) if a.get("elevationGain") else None,
            "load": a.get("activityTrainingLoad"),
            "te": a.get("aerobicTrainingEffect"),
            "te_an": a.get("anaerobicTrainingEffect"),
            "sets": a.get("totalSets"),
            "reps": a.get("totalReps"),
            "steps": a.get("steps"),
            "cadence": a.get("averageRunningCadenceInStepsPerMinute"),
            "vo2": a.get("vO2MaxValue"),
            "elapsed_min": round((a.get("elapsedDuration") or 0) / 60, 1) or None,
            "speed_mph": round(a["averageSpeed"] * 2.23694, 2) if a.get("averageSpeed") else None,
            "max_speed_mph": round(a["maxSpeed"] * 2.23694, 2) if a.get("maxSpeed") else None,
            "elev_loss_ft": round(a["elevationLoss"] * 3.28084) if a.get("elevationLoss") else None,
            "max_cadence": a.get("maxRunningCadenceInStepsPerMinute"),
            "power": a.get("avgPower"), "max_power": a.get("maxPower"), "norm_power": a.get("normPower"),
            "stride_m": round(a["avgStrideLength"] / 100, 2) if a.get("avgStrideLength") else None,
            "gct_ms": round(a["avgGroundContactTime"]) if a.get("avgGroundContactTime") else None,
            "vert_osc_cm": round(a["avgVerticalOscillation"], 1) if a.get("avgVerticalOscillation") else None,
            "vert_ratio": round(a["avgVerticalRatio"], 1) if a.get("avgVerticalRatio") else None,
            "temp_f": round(a["maxTemperature"] * 9 / 5 + 32) if a.get("maxTemperature") is not None else None,
            "pr": a.get("isPR"),
            "bmr_cal": a.get("bmrCalories"),
        } for a in acts]

    # ---- one clean record per day (field names match what the Fitness tab and the morning brief read)
    def clock(ms):
        try:
            return datetime.fromtimestamp(ms / 1000, timezone.utc).strftime("%H:%M")  # Garmin "Local" stamps are local time stored as UTC
        except Exception:
            return None
    mins = lambda secs: round(secs / 60) if isinstance(secs, (int, float)) else None
    clean = {}
    for dy, d in days.items():
        a, sl, bb, hv, hr = d.get("all", {}), d.get("sleep_detail") or d.get("sleep") or {}, d.get("bb", {}), d.get("hrv_detail", {}), d.get("hr", {})
        g = lambda src, k: src.get(k)
        r = {
            "steps": g(a, "movement.steps.value"), "steps_goal": g(a, "movement.steps.goal"),
            "dist_mi": round(a["movement.steps.distanceInMeters"] / 1609.344, 2) if a.get("movement.steps.distanceInMeters") else None,
            "floors": g(a, "movement.floorsAscended.value"), "floors_goal": g(a, "movement.floorsAscended.goal"), "floors_down": g(a, "movement.floorsDescended.value"),
            "cal": g(a, "calories.burnedTotal"), "cal_active": g(a, "calories.burnedActive"), "cal_rest": g(a, "calories.burnedResting"),
            "hr_min": g(a, "heartRate.minValue") or g(hr, "minHeartRate"), "hr_max": g(a, "heartRate.maxValue") or g(hr, "maxHeartRate"),
            "rhr": g(a, "heartRate.restingValue") or g(hr, "restingHeartRate"), "rhr_7d": g(hr, "lastSevenDaysAvgRestingHeartRate"),
            "im_mod": g(a, "intensityMinutes.moderate"), "im_vig": g(a, "intensityMinutes.vigorous"), "im_goal": g(a, "intensityMinutes.goal"),
            "stress": g(a, "stress.avgLevel"), "stress_max": g(a, "stress.maxLevel"), "stress_q": g(a, "stress.qualifier"),
            "stress_rest_m": mins((a.get("stress.restDurationInMillis") or 0) / 1000) if a.get("stress.restDurationInMillis") else None,
            "stress_low_m": mins((a.get("stress.lowStressDurationInMillis") or 0) / 1000) if a.get("stress.lowStressDurationInMillis") else None,
            "stress_med_m": mins((a.get("stress.mediumStressDurationInMillis") or 0) / 1000) if a.get("stress.mediumStressDurationInMillis") else None,
            "stress_high_m": mins((a.get("stress.highStressDurationInMillis") or 0) / 1000) if a.get("stress.highStressDurationInMillis") else None,
            "stress_act_m": mins((a.get("stress.activityDurationInMillis") or 0) / 1000) if a.get("stress.activityDurationInMillis") else None,
            "bb_high": g(a, "bodyBattery.maxValue"), "bb_low": g(a, "bodyBattery.minValue"), "bb_now": g(a, "bodyBattery.latestValue"),
            "bb_charged": g(a, "bodyBattery.chargedValue") or g(bb, "charged"), "bb_drained": g(a, "bodyBattery.drainedValue") or g(bb, "drained"),
            "bb_feedback": g(a, "bodyBattery.endOfDayDynamicFeedbackEvent.feedbackShortType") or g(a, "bodyBattery.dynamicFeedbackEvent.feedbackShortType"),
            "resp": g(a, "respiration.avgValue"), "resp_min": g(a, "respiration.minValue"), "resp_max": g(a, "respiration.maxValue"),
            "spo2": g(d.get("spo2", {}), "averageSpO2"), "spo2_low": g(d.get("spo2", {}), "lowestSpO2"),
            "sleep_h": round(sl["sleepTimeSeconds"] / 3600, 1) if sl.get("sleepTimeSeconds") else None,
            "sleep_score": g(sl, "sleepScores.overall.value"), "sleep_q": g(sl, "sleepScores.overall.qualifierKey"),
            "deep_m": mins(sl.get("deepSleepSeconds")), "light_m": mins(sl.get("lightSleepSeconds")), "rem_m": mins(sl.get("remSleepSeconds")), "awake_m": mins(sl.get("awakeSleepSeconds")),
            "nap_m": mins(sl.get("napTimeSeconds")) or None, "awake_count": g(sl, "awakeCount"),
            "bed": clock(sl["sleepStartTimestampLocal"]) if sl.get("sleepStartTimestampLocal") else None,
            "wake": clock(sl["sleepEndTimestampLocal"]) if sl.get("sleepEndTimestampLocal") else None,
            "sleep_hr": g(sl, "avgHeartRate"), "sleep_resp": g(sl, "averageRespirationValue"), "sleep_stress": g(sl, "avgSleepStress"),
            "sleep_need_m": g(sl, "sleepNeed.actual"), "sleep_feedback": g(sl, "sleepScoreFeedback"),
            "rem_q": g(sl, "sleepScores.remPercentage.qualifierKey"), "deep_q": g(sl, "sleepScores.deepPercentage.qualifierKey"),
            "light_q": g(sl, "sleepScores.lightPercentage.qualifierKey"), "restless_q": g(sl, "sleepScores.restlessness.qualifierKey"),
            "hrv": g(hv, "lastNightAvg"), "hrv_week": g(hv, "weeklyAvg"), "hrv_high": g(hv, "lastNight5MinHigh"), "hrv_status": g(hv, "status"),
            "hrv_base_low": g(hv, "baseline.balancedLow"), "hrv_base_high": g(hv, "baseline.balancedUpper"),
        }
        r = {k: v for k, v in r.items() if v is not None}
        if r:
            clean[dy] = r
    out["days"] = [dict(date=k, **v) for k, v in sorted(clean.items()) if k] or out["days"]
    out["ok"] = not out["errors"]
    save("garmin.json", out)
    (DATA / "garmin_raw.json").unlink(missing_ok=True)


# ---------------------------------------------------------------- conditions (for the AI overview)
def wind_kind(deg: float, mph: float) -> str:
    if mph is None or deg is None:
        return "unknown"
    diff = abs(((deg - OFFSHORE_FROM) + 180) % 360 - 180)
    if mph < 6:
        return "light"
    if diff <= 60:
        return "offshore"
    if diff >= 120:
        return "onshore"
    return "cross"


def surf_score(h_ft, period, wind_mph, wind_deg) -> tuple[int, str]:
    """Score tuned for a still-learning surfer who likes small-to-medium fun waves.
    Must match surfScore() in app.js."""
    if h_ft is None:
        return 0, "No data"
    if h_ft < 1.0:
        return 0, "Flat"
    if h_ft >= 5.5:
        return 1, "Too big"
    s = 2
    if 2.0 <= h_ft <= 4.5:
        s += 1
    if period is not None:
        if period >= 8:
            s += 1
        elif period < 6:
            s -= 1
    k = wind_kind(wind_deg, wind_mph)
    if k in ("offshore", "light"):
        s += 1
    elif k == "onshore" and wind_mph >= 12:
        s -= 2
    elif k == "onshore" and wind_mph >= 8:
        s -= 1
    elif k == "cross" and wind_mph >= 15:
        s -= 1
    if h_ft < 1.5:
        s = min(s, 2)
    elif h_ft < 2.0:
        s = min(s, 3)
    s = max(1, min(5, s))
    return s, {1: "Poor", 2: "Poor", 3: "Fun", 4: "Good", 5: "Great"}[s]


def build_conditions() -> None:
    out = {"updated": now_utc(), "places": {}, "surf": None}
    for key, p in PLACES.items():
        try:
            w = fetch_json("https://api.open-meteo.com/v1/forecast?" + urllib.parse.urlencode({
                "latitude": p["lat"], "longitude": p["lon"], "timezone": "America/New_York",
                "temperature_unit": "fahrenheit", "wind_speed_unit": "mph", "precipitation_unit": "inch",
                "forecast_days": 7,
                "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,sunrise,sunset",
                "hourly": "temperature_2m,precipitation_probability,weather_code",
            }))
            d = w["daily"]
            hours = w["hourly"]
            days = []
            for i, day in enumerate(d["time"]):
                rainy = [hours["time"][j][11:16] for j in range(len(hours["time"]))
                         if hours["time"][j].startswith(day) and (hours["precipitation_probability"][j] or 0) >= 50]
                days.append({
                    "date": day, "hi": round(d["temperature_2m_max"][i]), "lo": round(d["temperature_2m_min"][i]),
                    "rain_pct": d["precipitation_probability_max"][i], "rain_in": d["precipitation_sum"][i],
                    "code": d["weather_code"][i], "wind_max_mph": round(d["wind_speed_10m_max"][i]),
                    "rain_hours": rainy[:24],
                })
            out["places"][key] = {"name": p["name"], "days": days}
        except Exception as e:
            print(f"weather {key} failed: {e}", file=sys.stderr)
    try:
        m = fetch_json("https://marine-api.open-meteo.com/v1/marine?" + urllib.parse.urlencode({
            "latitude": SURF["lat"], "longitude": SURF["lon"], "timezone": "America/New_York",
            "length_unit": "imperial", "forecast_days": 7,
            "hourly": "wave_height,wave_period,swell_wave_height,swell_wave_period,sea_surface_temperature",
        }))["hourly"]
        w = fetch_json("https://api.open-meteo.com/v1/forecast?" + urllib.parse.urlencode({
            "latitude": PLACES["stoneharbor"]["lat"], "longitude": PLACES["stoneharbor"]["lon"],
            "timezone": "America/New_York", "wind_speed_unit": "mph", "forecast_days": 7,
            "hourly": "wind_speed_10m,wind_direction_10m", "daily": "sunrise,sunset",
        }))
        wh = {t: (w["hourly"]["wind_speed_10m"][i], w["hourly"]["wind_direction_10m"][i]) for i, t in enumerate(w["hourly"]["time"])}
        sun = {d: (w["daily"]["sunrise"][i][11:16], w["daily"]["sunset"][i][11:16]) for i, d in enumerate(w["daily"]["time"])}
        days = {}
        for i, t in enumerate(m["time"]):
            day, hh = t[:10], int(t[11:13])
            sr, ss = sun.get(day, ("06:30", "17:00"))
            if not (int(sr[:2]) <= hh <= int(ss[:2])):
                continue
            ws, wd = wh.get(t, (None, None))
            sc, label = surf_score(m["wave_height"][i], m["wave_period"][i], ws, wd)
            dd = days.setdefault(day, {"date": day, "best": None, "max_ft": 0, "sst_c": None, "sunrise": sr, "sunset": ss})
            dd["max_ft"] = max(dd["max_ft"], round(m["wave_height"][i] or 0, 1))
            if m["sea_surface_temperature"][i] is not None:
                dd["sst_c"] = m["sea_surface_temperature"][i]
            if dd["best"] is None or sc > dd["best"]["score"]:
                dd["best"] = {"score": sc, "label": label, "hour": t[11:16], "ft": round(m["wave_height"][i] or 0, 1),
                              "period_s": round(m["wave_period"][i] or 0), "wind_mph": round(ws or 0), "wind": wind_kind(wd, ws)}
        for dd in days.values():
            if dd["sst_c"] is not None:
                dd["water_f"] = round(dd.pop("sst_c") * 9 / 5 + 32)
            else:
                dd.pop("sst_c")
        out["surf"] = {"spot": "Stone Harbor, NJ", "days": list(days.values())}
        try:
            tz = fetch_json("https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?" + urllib.parse.urlencode({
                "product": "predictions", "station": TIDE_STATION, "begin_date": datetime.now(ET).strftime("%Y%m%d"),
                "range": 168, "datum": "MLLW", "interval": "hilo", "units": "english", "time_zone": "lst_ldt", "format": "json",
            }))
            out["surf"]["tides"] = [{"t": p["t"], "ft": round(float(p["v"]), 1), "type": p["type"]} for p in tz.get("predictions", [])]
        except Exception as e:
            print(f"tides failed: {e}", file=sys.stderr)
    except Exception as e:
        print(f"surf failed: {e}", file=sys.stderr)
    save("conditions.json", out)


if __name__ == "__main__":
    for fn in (build_calendar, build_garmin, build_conditions):
        try:
            fn()
        except Exception as e:  # one broken piece never stops the others
            print(f"{fn.__name__} failed: {e}", file=sys.stderr)
