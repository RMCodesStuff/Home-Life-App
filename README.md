# Home Life

A morning weather report that preps you for your day. Open it and you get:

- **Current conditions** with a written forecast in plain language
- **Chips** for the umbrella question, what to wear, and the best window outside
- **Hour by hour** for the next 24 hours
- **Your day** from Google Calendar, with the weather at each event and a **leave by** time and drive length for events with an address
- **Waiting on you** from Gmail: emails that need a reply or an action, plus packages arriving today paired with the weather
- **Last night** from your Oura ring: sleep and readiness, with a line that tailors the day (and an easy-pace nudge on low-readiness days)
- **The week**, ten days with highs, lows and a one-line note per day
- **The fine print**: sunrise to sunset, wind, humidity, dew point, pressure, UV and air quality
- **Trip prep**, from 3 days before an overnight trip: the drive there, what to pack (from the forecast where you're going), a before-you-go checklist you tick off, and calendar conflicts back home
- **Park days**: theme-park hours, early entry, showtimes with the weather at each show, today's longest waits and a warm-layer nudge for cold evenings
- **Tomorrow's edition** in the evening: tomorrow's high, a written forecast that starts at 7am, your first event and when to leave, what to wear and tonight's low
- **The rundown**, from a daily Claude run: a short note about the day, money (bills due, budget pace, over-budget categories, notable charges), fantasy football on game days, and a playlist
- **Birthdays** from your Google contacts in the next two weeks
- **Dinner tonight** from the meal planner, with a thaw reminder the evening before and an eat-by time on busy evenings
- **Today's workout** from the rack session timer: which session, the best free window in your calendar, and a button that opens the timer on it
- **Whose event**: calendar labels and colors, and a filter for which calendars show (see "A second person's view")
- **Phoenix home pack** (opt-in): power peak hours with a pre-cool time, skip-or-water advice, dust warnings, a rain radar strip, chore reminders and kid-friendly heat tips
- **Read it to me**: the speaker button in the top card reads the forecast aloud

It is travel-aware. If your calendar shows a trip (a hotel stay, or events far from home), or you add one in settings, the app uses the forecast for where you will be on those days.

It is a static site with no build step and no backend. You can install it from Chrome like an app.

## Host it on GitHub Pages

1. Push this repository to GitHub (branch `main`).
2. Go to **Settings -> Pages -> Build and deployment -> Source** and choose **GitHub Actions**.
3. The workflow in `.github/workflows/pages.yml` deploys the repo root on every push to `main` (or run it by hand from the Actions tab).
4. Your app is at `https://<your-user>.github.io/<repo-name>/`.

GitHub Pages on a private repository needs a paid GitHub plan. Otherwise make the repository public. That is safe: nothing personal is stored in the repo. Your location, script link and API key live only in your browser (a setup link, which you create yourself, carries them to your other devices).

## Install from Chrome

- **Desktop:** open the site, then use the install icon in the address bar, or the menu (three dots) -> **Cast, save, and share -> Install page as app**.
- **Android:** menu (three dots) -> **Add to Home screen** or **Install app**.

## First run

Choose your home: search for a city or tap "use my current location". You can change it, and give it a label, in settings (the gear icon).

## Connect Google (calendar, gmail, drive times)

The app reads Google through a small Apps Script that you deploy in your own Google account. It runs as you, needs no servers or keys, and asks only for read-only access. Gmail, drive times and Oura are each optional; if one fails the others (and the weather) keep working.

1. Open https://script.google.com and create a new project.
2. Delete the sample code and paste the script (in the app: settings -> Google -> **copy script**, which already contains your private key).
3. Open **Project Settings** (gear icon) and tick **Show "appsscript.json" manifest file in editor**.
4. Back in the editor open `appsscript.json` and paste over it (in the app: **copy manifest**, which fills in your own time zone). The manifest limits Google's permission prompt to read-only calendar, gmail, drive and contacts.
5. Click **Deploy -> New deployment**, choose **Web app**, set **Execute as: Me** and **Who has access: Anyone**, then **Deploy**.
6. Approve the Google permission prompt (read-only calendar, gmail, drive and contacts).
7. Copy the **Web app URL** (ends in `/exec`), paste it into settings -> Google, then tap **test connection**.

The first sync can take up to a minute: a cold Apps Script run reads Calendar, Gmail, Drive, Contacts, Maps and ThemeParks.wiki. The app waits up to 90 seconds, and later runs are much faster (the script caches its answers).

The files are `calendar-bridge/Code.gs` and `calendar-bridge/appsscript.json`. Gmail is read through the Gmail REST API with the read-only scope. If Google's Maps service asks for an extra permission the first time, approve it; drive times only run for today's and tomorrow-morning events that have a street address.

### Updating an existing deployment

If the app says "update your google script", your deployment is an older version. Version 3 adds park hours and the drive time for trips. Its manifest also asks for two more read-only permissions: Google Drive (to read the daily rundown file) and Contacts (for birthdays); approve them when Google asks. Paste the new script and manifest (copy script, copy manifest), then **Deploy -> Manage deployments**, click the pencil (edit), set **Version: New version** and **Deploy**. The URL stays the same, so nothing changes in the app.

### Turning pieces off

In settings -> Google you can hide **waiting on you** and **leave-by times**, and in settings -> Oura **last night**. To stop the script itself from reading Gmail or Maps, set `ENABLE_GMAIL` or `ENABLE_LEAVE_BY` to `false` at the top of `Code.gs` and deploy a new version.

## Using more than one device

Each browser makes its own private key for the Google script, so a second device can't use a script you deployed from the first one until it has the same key. The easy way is a setup link.

1. On the device that already works: settings -> **Other devices** -> **copy setup link** (or **show QR code** and scan it with the other phone's camera).
2. Send the link to yourself or someone else in your home and open it on the other device (installed app or browser). The app asks "Set up this device with your Home Life settings?" and lists what it will apply. **use these settings** replaces that device's settings with yours; **cancel** changes nothing. The address bar is cleared either way.

The link carries your home, units and theme, evening settings, the Google web app url and private key, calendar labels, colors and filters, work calendars, a trip you added and your checklist, chores, power peak and watering, the on/off switches and workout preferences. It never carries cached data or the meal planner / rack timer sign-ins, and it leaves out your Claude API key unless you tick **include my claude api key**. The data sits in the part of the link after `#`, which browsers don't send to any server. It still contains your script key, so anyone who has the link can read what your script returns: send it only to yourself or someone else in your home.

### The private key field

Settings -> Google -> **private key** shows the key this device uses (hidden until you tap **show**, with a **copy** button). It must be the same key as the one inside the deployed script. Change it only to match a script you already deployed elsewhere: paste that key (16 or more letters, numbers, `-` or `_`) and **copy script** will embed it from then on. If you paste a web app url that ends in `?key=...`, the key is moved into this field and only the `/exec` url is kept.

## Trips, trip prep and park days

Trips are spotted from your calendar. To add one by hand (it works before Google is connected too): settings -> **Trips**, search for the city, pick the day you leave and the day you get back, then **save trip**. A trip you add wins over calendar trips on the same dates; **remove trip** turns it off.

From 3 days before you leave through the departure day, the second card starts with **Trip prep**:

- the drive there and how long it takes (needs the version 3 Google script; asked for when you leave within 2 days, otherwise the line is hidden)
- what to pack, from the forecast at your destination: a warm layer for nights under 55°F, shorts above 80°F, a rain jacket at 30% rain or more, sunscreen and hats at UV 6 or more, and walking shoes, a portable charger and a water bottle when there are park days
- a before-you-go checklist; edit it in settings -> Trips (one item per line). Ticks are saved per trip on this device
- conflicts: events within 40 miles of home on days you're away, before you could be back on the way-home day, or after you planned to leave on the departure day

On a day with a theme park on your calendar (an event titled or located at a park ThemeParks.wiki knows, like "Disneyland Park"), **Park day** replaces trip prep: hours and early entry, showtimes with the weather, the longest standby waits right now, and a warm-layer note when the evening drops below 60°F. In the evening it shows tomorrow's park. Park data comes from the Google script (version 3) and [ThemeParks.wiki](https://themeparks.wiki). Both sections can be switched off in settings -> Trips.

## Trip plan (itinerary)

A hand-made day-by-day plan can live in the app. On the days it covers, a **today's plan** card sits under the hero with what's happening now, what's next (with a countdown), a to-do list, the timeline with check-offs, and live standby waits for the rides a stop mentions. The night before (or once the last stop is over) it shows tomorrow's plan, and 1-3 days ahead it shows a short "starts tomorrow" card. **whole trip** opens every day, the checklist, tips and ride heights.

A plan is one JSON document (`"v": 1, "kind": "home-life-plan"`) with an `id`, `title`, IANA `tz`, optional `source` (https only) and `intro`, `days` (each with a `date`, `title`, `hours`, `summary`, `items` and `tips`), a `checklist` (`id`, `text`, optional `due`), general `tips` and `heights` (`park`, `ride`, `min`, `call`). Items have an `id`, a `HH:MM` `time` in the plan's own zone, a `title`, and optionally `where`, `note`, `who`, `family`, `rides` and `tags` (`reserved`, `phone`, `multipass`, `switch`, `food`, `show`). Ids are lowercase letters, numbers and dashes and are unique across the plan. Bad plans are rejected with a one-line reason.

Add a plan by opening a link of the form `https://<your-pages-site>/#plan=<payload>`, where the payload is `z.` plus base64url of the deflate-raw compressed JSON (or `j.` plus plain base64url). The app clears the link from the address bar and asks before adding it. In settings -> **Trip plan** you can paste a link, a bare payload or the raw JSON, **copy link for another device**, **show plan**, or **remove plan**. The plan and its check-offs are stored only in this browser's localStorage (`hl.plan`, `hl.plan.done.<id>`); they are not part of the setup link and nothing is sent anywhere, so keep the link itself private and never commit a plan to this repo.

## Evening: tomorrow's edition

From 6pm (settings -> **Evening** sets the time, or turns it off) the top card previews tomorrow: the high, the sky, a forecast that starts at 7am, your first event with its leave-by time, what to wear and tonight's low. Your day lists tomorrow's events, and a park day shows tomorrow's park. **now 63° · show today** switches back for the rest of the evening. The evening edition is always written on-device (Claude is not called for it).

## The rundown (daily Claude run)

Each morning a scheduled Claude task (set up by the lead, managed at claude.ai under scheduled tasks) writes `home-life-briefing-YYYY-MM-DD.json` into a `Home Life` folder in Google Drive. The version 3 script reads the newest file (it needs the Drive read-only permission) and the app shows it as **The rundown** under the top card: a note, money, fantasy (only on game days or when there are waivers) and a playlist. Its packing ideas feed trip prep. It hides itself when the file is missing or older than yesterday, and says "from yesterday" when today's hasn't arrived yet. Settings -> Google shows why if the file can't be read (missing, too big, not valid JSON). Turn it off in settings -> Google.

## Birthdays

The version 3 script reads birthdays from your Google contacts (Contacts read-only permission). Birthdays in the next 14 days show at the top of Your day, and the evening before shows "tomorrow is pat's birthday". If Google says the People API is off for the script, open the script's Google Cloud project and enable the People API, then redeploy.

## Dinner tonight (meal planner)

Read-only, from the meal planner's Firestore (today's and tomorrow's meals and their recipes, cached on this device for offline):

1. One-time: in the Firebase console for the meal planner (recipe-planner-bcd94): **Authentication -> Settings -> Authorized domains -> Add domain -> rmcodesstuff.github.io**.
2. In the app: settings -> **Meal plan -> connect meal plan**, and sign in with the Google account you use in the meal planner.

Your day ends with `dinner · chicken fried rice` (and breakfast and lunch when planned), and an **open meal plan** link. The evening before a dinner with raw meat or fish, a chip says what to move to the fridge. When an event starts between 5:30 and 8:30pm, the dinner row says when to eat by (its start, minus its drive, minus 15 minutes).

## Today's workout (rack session timer)

The rack timer (same site, so same browser storage) leaves a small summary for this app every time its log changes. Home Life reads it directly; to also see it from your other devices, settings -> **Workout -> connect rack timer account** (the timer's Firebase already allows this site). The card proposes a session (lighter on low readiness, the short version on workdays or after three days in a row, a hotel-room circuit when you're away, rest on park days), the best free window in your calendar (it steers around a hot garage), and a **start in rack timer** button that opens the timer on that session. Pick your work calendars and a preferred time of day in settings -> Workout.

## A second person's view: calendars and whose event

Settings -> **Calendars** lists the calendars your script sends. Give each a short label and one of five colors (your busiest calendar has no tag; others are tagged with their name, like `sam`), and switch off any calendar to hide it everywhere: Your day, trip detection, leave-by times, the workout window and tomorrow's edition.

A second person's view is the same app on their phone: they install it, open the setup link you send them (see "Using more than one device"; or they deploy their own script for their own calendars and inbox), they pick their calendars in settings -> Calendars, and turn off what isn't theirs (waiting on you, Oura, the workout, the rundown) with the switches in settings.

## Phoenix home pack

All in settings -> **Home extras** and **Chores**; each piece can be switched off:

- **Power peak** (off by default): your utility's peak windows (default weekdays 4–7pm), active in chosen months (default May–October) or only when the high reaches 90°F. Chip: `power peak 4–7pm · pre-cool by 3:45, high 104`.
- **Watering** (off by default): pick your watering days. On those days (and the evening before) the app says to skip when a quarter inch of rain is coming or fell yesterday, otherwise to water as usual with the week's evaporation. Also in the fine print.
- **Dust**: a chip when PM10 tops 150 or dust tops 100 µg/m³, and a note in air quality.
- **Radar**: when rain is 40% or more within 6 hours, or a weather alert is active, a small radar map shows under the hourly chart (OpenStreetMap tiles with RainViewer radar).
- **Chores**: presets for trash night, recycling night, the AC filter (30 days) and pest control (90 days), or your own. Bins show the night before pickup (with a gust warning), with an optional holiday delay; interval chores show the morning they're due, and you mark them done in settings.
- **Kid-friendly tips**: playground timing on 95°F days and a sunscreen reminder when UV reaches 8.

## Connect Oura (optional)

Oura retired personal access tokens in December 2025, so this uses OAuth. One-time setup:

1. Create an application at https://cloud.ouraring.com/oauth/applications (free; personal apps allow up to 10 users). Set the **redirect URI** to your Web app URL (the one ending in `/exec`; settings -> Oura shows it ready to copy) and the scope to `daily`.
2. In Apps Script: **Project Settings -> Script properties**, add `OURA_CLIENT_ID` and `OURA_CLIENT_SECRET`. If Oura reports a redirect mismatch, also add `OURA_REDIRECT_URI` with your exact Web app URL.
3. In the app: settings -> Oura -> **connect oura**, then authorize. The tokens are stored in the script's own properties and are never sent to the app.

Gen3 and newer rings need an active Oura membership for API access; without one the app shows "oura refused access (membership required for gen3 and newer)".

## Optional: Claude-written forecast

The app always writes the forecast on your device. If you like, it can have Claude rewrite it.

1. Create an API key at https://platform.claude.com/settings/keys.
2. In settings -> written forecast, turn on "use claude" and paste the key.
3. Pick a model: **Opus 5.5** (default, best writing), **Sonnet 5.5**, or **Haiku 5.5** (cheapest).

The key is stored only in your browser and sent only to `api.anthropic.com`. Claude rewrites the forecast at most every 3 hours. It receives senders, reasons and subjects of up to 3 waiting emails (never snippets), package statuses, drive times and Oura scores, so it can phrase the day. The on-device text always shows first and is the fallback if anything fails.

## Data sources

- [Open-Meteo](https://open-meteo.com/) forecast and air quality (free, no key)
- [National Weather Service](https://www.weather.gov/) alerts, US locations only
- Gmail, Google Maps and your calendar through your own Apps Script; [Oura API v2](https://cloud.ouraring.com/v2/docs) if you connect a ring
- [ThemeParks.wiki](https://themeparks.wiki/) park hours, showtimes and waits, through your Apps Script
- [RainViewer](https://www.rainviewer.com/) radar frames and [OpenStreetMap](https://www.openstreetmap.org/copyright) map tiles for the radar strip (© OpenStreetMap contributors)
- The meal planner and the rack session timer, read-only through their own Firebase projects, when you connect them
- [OpenStreetMap Nominatim](https://nominatim.openstreetmap.org/) for finding event locations. Data (c) OpenStreetMap contributors, ODbL. Lookups are rate-limited and cached.
- Open-Meteo geocoding for city search
- Fonts: Newsreader and DM Sans from Google Fonts

## Privacy

Everything is stored in your browser's localStorage: home, your trip plan and its check-offs, settings (including a trip you add, your checklist, calendar labels and chores), checklist ticks per trip, cached forecasts, calendar events, inbox, Oura, park, rundown and birthday results, today's and tomorrow's meals, the rack timer summary, geocoding results and your optional API key. A setup link built in settings -> Other devices contains your portable settings in its `#` fragment (never sent to a server); the QR code library comes from jsDelivr the first time settings opens. Signing in to the meal planner or the rack timer keeps a Google sign-in for those Firebase projects in this browser; disconnect removes it. There is no server and no analytics. Network requests go only to the data sources above, your own Apps Script URL, and `api.anthropic.com` if you enable Claude.

The script returns event titles, times and locations; email senders, subjects and short snippets of up to 5 threads; package statuses; drive times (including the drive to a trip leaving soon, so the trip's coordinates are sent to the script); park hours, showtimes and waits for parks on your calendar; the morning rundown (its note, the money line with bills, budget and notable charges, and fantasy lines); upcoming birthdays (names and dates) from your contacts; and Oura scores. Anyone who holds both the web app URL and the key can read all of that, so keep both private. Nothing is stored outside your Google account and your browser. Oura tokens live only in the script's properties. If you enable Claude, it receives senders, reasons and subjects, but no snippets; it also gets the workout proposal, tonight's dinner, upcoming birthdays (first names), the rundown's note and a park day's hours and shows, never money amounts.

## Local development

```
python3 -m http.server
```

Then open http://localhost:8000. Run the tests with:

```
node --test
```
