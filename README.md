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

It is travel-aware. If your calendar shows a trip (a hotel stay, or events far from home), the app uses the forecast for where you will be on those days.

It is a static site with no build step and no backend. You can install it from Chrome like an app.

## Host it on GitHub Pages

1. Push this repository to GitHub (branch `main`).
2. Go to **Settings -> Pages -> Build and deployment -> Source** and choose **GitHub Actions**.
3. The workflow in `.github/workflows/pages.yml` deploys the repo root on every push to `main` (or run it by hand from the Actions tab).
4. Your app is at `https://<your-user>.github.io/<repo-name>/`.

GitHub Pages on a private repository needs a paid GitHub plan. Otherwise make the repository public. That is safe: nothing personal is stored in the repo. Your location, script link and API key live only in your browser.

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
4. Back in the editor open `appsscript.json` and paste over it (in the app: **copy manifest**, which fills in your own time zone). The manifest limits Google's permission prompt to read-only calendar and gmail.
5. Click **Deploy -> New deployment**, choose **Web app**, set **Execute as: Me** and **Who has access: Anyone**, then **Deploy**.
6. Approve the Google permission prompt (read-only calendar and gmail).
7. Copy the **Web app URL** (ends in `/exec`), paste it into settings -> Google, then tap **test connection**.

The files are `calendar-bridge/Code.gs` and `calendar-bridge/appsscript.json`. Gmail is read through the Gmail REST API with the read-only scope. If Google's Maps service asks for an extra permission the first time, approve it; drive times only run for today's and tomorrow-morning events that have a street address.

### Updating an existing deployment

If the app says "update your google script", your deployment is the older calendar-only version. Paste the new script and manifest (copy script, copy manifest), then **Deploy -> Manage deployments**, click the pencil (edit), set **Version: New version** and **Deploy**. The URL stays the same, so nothing changes in the app.

### Turning pieces off

In settings -> Google you can hide **waiting on you** and **leave-by times**, and in settings -> Oura **last night**. To stop the script itself from reading Gmail or Maps, set `ENABLE_GMAIL` or `ENABLE_LEAVE_BY` to `false` at the top of `Code.gs` and deploy a new version.

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
- [OpenStreetMap Nominatim](https://nominatim.openstreetmap.org/) for finding event locations. Data (c) OpenStreetMap contributors, ODbL. Lookups are rate-limited and cached.
- Open-Meteo geocoding for city search
- Fonts: Newsreader and DM Sans from Google Fonts

## Privacy

Everything is stored in your browser's localStorage: home, settings, cached forecasts, calendar events, inbox and Oura results, geocoding results and your optional API key. There is no server and no analytics. Network requests go only to the data sources above, your own Apps Script URL, and `api.anthropic.com` if you enable Claude.

The script returns event titles, times and locations; email senders, subjects and short snippets of up to 5 threads; package statuses; drive times; and Oura scores. Anyone who holds both the web app URL and the key can read all of that, so keep both private. Nothing is stored outside your Google account and your browser. Oura tokens live only in the script's properties. If you enable Claude, it receives senders, reasons and subjects, but no snippets.

## Local development

```
python3 -m http.server
```

Then open http://localhost:8000. Run the tests with:

```
node --test
```
