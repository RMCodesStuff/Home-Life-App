# Home Life

A morning weather report that preps you for your day. Open it and you get:

- **Current conditions** with a written forecast in plain language
- **Chips** for the umbrella question, what to wear, and the best window outside
- **Hour by hour** for the next 24 hours
- **Your day** from Google Calendar, with the weather at each event
- **The week**, ten days with highs, lows and a one-line note per day
- **The fine print**: sunrise to sunset, wind, humidity, dew point, pressure, UV and air quality

It is travel-aware. If your calendar shows a trip (a hotel stay, or events far from home), the app uses the forecast for where you will be on those days.

It is a static site with no build step and no backend. You can install it from Chrome like an app.

## Host it on GitHub Pages

1. Push this repository to GitHub (branch `main`).
2. Go to **Settings -> Pages -> Build and deployment -> Source** and choose **GitHub Actions**.
3. The workflow in `.github/workflows/pages.yml` deploys the repo root on every push to `main` (or run it by hand from the Actions tab).
4. Your app is at `https://<your-user>.github.io/<repo-name>/`.

GitHub Pages on a private repository needs a paid GitHub plan. Otherwise make the repository public. That is safe: nothing personal is stored in the repo. Your location, calendar link and API key live only in your browser.

## Install from Chrome

- **Desktop:** open the site, then use the install icon in the address bar, or the menu (three dots) -> **Cast, save, and share -> Install page as app**.
- **Android:** menu (three dots) -> **Add to Home screen** or **Install app**.

## First run

Choose your home: search for a city or tap "use my current location". You can change it, and give it a label, in settings (the gear icon).

## Connect your calendar

The app reads your calendar through a small Google Apps Script that you deploy in your own Google account.

1. Open https://script.google.com and create a new project.
2. Delete the sample code and paste the script (in the app: settings -> calendar -> **copy script**, which already contains your private key).
3. Click **Deploy -> New deployment**, choose type **Web app**.
4. Set **Execute as: Me** and **Who has access: Anyone**, then **Deploy**.
5. Approve the Google permission prompt (it only reads your calendars).
6. Copy the **Web app URL** (ends in `/exec`), paste it into settings -> calendar, then tap **test connection**.

The script is in `calendar-bridge/Code.gs`. It returns only event titles, times and locations for the next two weeks (never descriptions or guests) and skips declined events.

Privacy note: anyone who has both the URL and the key could read event titles, times and locations for the next two weeks. Keep them private. The key is generated in your browser and stored only there.

## Optional: Claude-written forecast

The app always writes the forecast on your device. If you like, it can have Claude rewrite it.

1. Create an API key at https://platform.claude.com/settings/keys.
2. In settings -> written forecast, turn on "use claude" and paste the key.
3. Pick a model: **Opus 5.5** (default, best writing), **Sonnet 5.5**, or **Haiku 5.5** (cheapest).

The key is stored only in your browser and sent only to `api.anthropic.com`. Claude rewrites the forecast at most every 3 hours. The on-device text always shows first and is the fallback if anything fails.

## Data sources

- [Open-Meteo](https://open-meteo.com/) forecast and air quality (free, no key)
- [National Weather Service](https://www.weather.gov/) alerts, US locations only
- [OpenStreetMap Nominatim](https://nominatim.openstreetmap.org/) for finding event locations. Data (c) OpenStreetMap contributors, ODbL. Lookups are rate-limited and cached.
- Open-Meteo geocoding for city search
- Fonts: Newsreader and DM Sans from Google Fonts

## Privacy

Everything is stored in your browser's localStorage: home, settings, cached forecasts, calendar events, geocoding results and your optional API key. There is no server and no analytics. Network requests go only to the data sources above, your own Apps Script URL, and `api.anthropic.com` if you enable Claude.

## Local development

```
python3 -m http.server
```

Then open http://localhost:8000. Run the tests with:

```
node --test
```
