# Scoot Calendar

Personal calendar app in the Scoot family (same look as The Scoot and Scoot News).

Tabs: Home (daily AI overview + activity pick), Calendar (Day / Week / Month), School, Weather, Surf, Fitness.

## Setup

1. **Make the repo.** On GitHub, create a new **public** repo named `ScootCalendar`.
2. **Upload the files.** Unzip, then drag everything into the repo's upload page. On a Mac, press **Cmd + Shift + .** in Finder first so the hidden `.github` folder shows up, and make sure it gets uploaded too.
3. **Turn on the site.** Settings → Pages → Source: *Deploy from a branch*, Branch: `main`, folder `/ (root)`. The app will be at `https://scottymoj.github.io/ScootCalendar/`.
4. **Let the updater save data.** Settings → Actions → General → Workflow permissions → *Read and write permissions* → Save.
5. **Add your feed links and Garmin key as secrets.** Settings → Secrets and variables → Actions → *New repository secret*:
   - `OUTLOOK_ICS`: Outlook on the web → Settings → Calendar → Shared calendars → Publish a calendar → pick your calendar, *Can view all details* → Publish → copy the **ICS** link.
   - `BRIGHTSPACE_ICS`: Brightspace → Calendar → *Subscribe* (bottom of the calendar list) → pick *All Courses* → copy the link.
   - `GARMIN_API_KEY`: connect.garmin.com/app/settings/personalApiToken → Create key → 1 year → copy (Garmin only shows it once).
   Skip any you don't have yet. The rest still works.
6. **Run it once.** Actions → *Update calendar data* → *Run workflow*. After that it runs every hour on its own.
7. **Turn on sync from your phone** (so the daily overview can see your classes, grades and due dates):
   github.com/settings/personal-access-tokens/new → *Only select repositories* → `ScootCalendar` → Permissions → Repository → **Contents: Read and write** → Generate. In the app, tap ⚙ and paste it. It stays on your phone only.
8. **Add to your home screen.** Open the site in Safari → Share → *Add to Home Screen*.

## How it updates

| What | Where it comes from | How often |
| --- | --- | --- |
| Outlook + Brightspace events | `scripts/build.py` → `data/calendar.json` | Every hour (GitHub Action) |
| Garmin activities, sleep, HRV | Garmin Personal API → `data/garmin.json` | Every hour |
| Forecast summary for the AI | Open-Meteo + NOAA → `data/conditions.json` | Every hour |
| Your classes, grades, added due dates | The app → `data/user.json` | When you change something |
| Home overview | Claude, scheduled task → `data/brief.json` | Every morning about 6:15 AM |
| Weather, waves, tides, alerts in the app | Open-Meteo, NOAA, National Weather Service, live | Every time you open it |

## Privacy

The repo is public, so anything in `data/` can be seen by someone who finds it. That includes your calendar events, due dates, grades, and Garmin stats (no maps or GPS). Your GitHub token and Garmin key are never saved in the repo.

## Change things

- Places: ⚙ → Add a town, or edit `PRESETS` in `core.js`
- Surf rating: `surfScore()` in `core.js` and `surf_score()` in `scripts/build.py` (keep them the same)
- Look: `styles.css`
