"""Scoot Calendar data builder.

Runs in GitHub Actions about every hour and writes:
  data/calendar.json    Outlook + Brightspace events (from their calendar feed links)
  data/garmin.json      Recent Garmin activities, sleep and daily stats (Garmin Personal API)
  data/conditions.json  Weather for Scott's places + Stone Harbor surf, for the daily AI overview

Secrets (GitHub repo -> Settings -> Secrets and variables -> Actions):
  OUTLOOK_ICS        Outlook "Publish a calendar" ICS link
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
        url = os.environ.get(env, "").strip()
        if not url:
            result["sources"][source] = {"ok": False, "note": f"{env} secret not set"}
            continue
        try:
            evs = read_ics(url, source)
            result["events"] += evs
            result["sources"][source] = {"ok": True, "count": len(evs), "at": now_utc()}
        except Exception as e:  # keep the last good copy of this feed
            print(f"{source} feed failed: {e}", file=sys.stderr)
            kept = [x for x in old.get("events", []) if x.get("src") == source]
            result["events"] += kept
            prev = (old.get("sources") or {}).get(source, {})
            result["sources"][source] = {"ok": False, "note": f"feed failed: {type(e).__name__}", "count": len(kept), "at": prev.get("at")}
    result["events"].sort(key=lambda x: x["start"])
    save("calendar.json", result)


# ---------------------------------------------------------------- garmin
GARMIN = "https://personal.connectapi.garmin.com"


def garmin_get(token: str, path: str, params: dict | None = None):
    url = GARMIN + path + ("?" + urllib.parse.urlencode(params) if params else "")
    raw = fetch(url, headers={"Authorization": f"Bearer {token}", "Accept": "application/json"})
    return json.loads(raw) if raw.strip() else None


def pick(d: dict, *keys):
    for k in keys:
        if isinstance(d, dict) and d.get(k) is not None:
            return d[k]
    return None


def build_garmin() -> None:
    key = os.environ.get("GARMIN_API_KEY", "").strip()
    if not key:
        print("GARMIN_API_KEY not set, skipping Garmin")
        return
    old = load("garmin.json") or {}
    out = {"updated": now_utc(), "activities": old.get("activities", []), "days": old.get("days", []), "ok": True, "errors": []}
    try:
        token = fetch(
            GARMIN + "/personalapitoken-service/personal-api/personal-api-key/token",
            headers={"Authorization": f"ApiKey {key}"}, data=b"", method="POST",
        ).decode().strip()
    except Exception as e:
        out["ok"] = False
        out["errors"].append(f"token: {type(e).__name__} {getattr(e, 'code', '')}".strip())
        out["activities"], out["days"] = old.get("activities", []), old.get("days", [])
        save("garmin.json", out)
        return

    today = datetime.now(ET).date()
    # activities: last ~120 days, newest first. Start location is dropped on purpose (public repo).
    try:
        acts = []
        for page in range(4):
            batch = garmin_get(token, "/activitylist-service/activities/search/activities", {
                "start": page * 40, "limit": 40,
                "startDate": (today - timedelta(days=120)).isoformat(), "endDate": today.isoformat(),
            }) or []
            acts += batch
            if len(batch) < 40:
                break
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
            "sets": a.get("totalSets"),
            "reps": a.get("totalReps"),
        } for a in acts]
    except Exception as e:
        out["errors"].append(f"activities: {type(e).__name__} {getattr(e, 'code', '')}".strip())

    # daily stats for the last 14 days
    days: dict[str, dict] = {}
    start = today - timedelta(days=13)
    try:
        ds = garmin_get(token, "/usersummary-service/v2/dailysummaries", {"startDate": start.isoformat(), "endDate": today.isoformat()}) or []
        if isinstance(ds, dict):
            ds = ds.get("dailySummaries") or ds.get("summaries") or [ds]
        for d in ds:
            day = str(pick(d, "calendarDate", "date") or "")[:10]
            if not day:
                continue
            hr = d.get("heartRate") if isinstance(d.get("heartRate"), dict) else {}
            st = d.get("steps") if isinstance(d.get("steps"), dict) else {}
            bb = d.get("bodyBattery") if isinstance(d.get("bodyBattery"), dict) else {}
            stress = d.get("stress") if isinstance(d.get("stress"), dict) else {}
            days.setdefault(day, {})
            days[day].update({k: v for k, v in {
                "steps": pick(d, "totalSteps") or pick(st, "value", "totalSteps", "total"),
                "rhr": pick(d, "restingHeartRate") or pick(hr, "restingValue", "restingHeartRate"),
                "bb_high": pick(d, "bodyBatteryHighestValue") or pick(bb, "maxValue", "highest"),
                "bb_low": pick(d, "bodyBatteryLowestValue") or pick(bb, "minValue", "lowest"),
                "stress": pick(d, "averageStressLevel") or pick(stress, "avgStressLevel", "averageStressLevel"),
            }.items() if v is not None})
    except Exception as e:
        out["errors"].append(f"daily summaries: {type(e).__name__} {getattr(e, 'code', '')}".strip())
    try:
        ss = garmin_get(token, "/sleep-service/sleep/dailySleepSummariesByDate", {"startDate": start.isoformat(), "endDate": today.isoformat()}) or []
        if isinstance(ss, dict):
            ss = ss.get("dailySleepSummaries") or ss.get("summaries") or [ss]
        for s in ss:
            dto = s.get("dailySleepDTO") if isinstance(s.get("dailySleepDTO"), dict) else s
            day = str(pick(dto, "calendarDate", "date") or "")[:10]
            secs = pick(dto, "sleepTimeSeconds", "totalSleepSeconds", "durationInSeconds")
            if not day or not secs:
                continue
            score = pick(dto, "sleepScore", "overallSleepScore")
            if isinstance(score, dict):
                score = pick(score, "value", "overall")
            sc = dto.get("sleepScores") if isinstance(dto.get("sleepScores"), dict) else {}
            if score is None and isinstance(sc.get("overall"), dict):
                score = sc["overall"].get("value")
            days.setdefault(day, {})
            days[day]["sleep_h"] = round(secs / 3600, 1)
            if score is not None:
                days[day]["sleep_score"] = score
    except Exception as e:
        out["errors"].append(f"sleep: {type(e).__name__} {getattr(e, 'code', '')}".strip())
    try:
        hv = garmin_get(token, f"/hrv-service/hrv/daily/{start.isoformat()}/{today.isoformat()}") or {}
        for h in (hv.get("hrvSummaries") if isinstance(hv, dict) else hv) or []:
            day = str(h.get("calendarDate") or "")[:10]
            if day and h.get("lastNightAvg") is not None:
                days.setdefault(day, {})
                days[day]["hrv"] = h.get("lastNightAvg")
                if h.get("status"):
                    days[day]["hrv_status"] = h.get("status")
    except Exception as e:
        out["errors"].append(f"hrv: {type(e).__name__} {getattr(e, 'code', '')}".strip())

    if days:
        out["days"] = [dict(date=k, **v) for k, v in sorted(days.items())]
    out["ok"] = not out["errors"]
    save("garmin.json", out)


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
