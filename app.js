// Home Life — entry module: boot, state, refresh loop, wiring.
import { loadSettings, saveSettings, getJSON, setJSON, KEYS, wxKey, aqKey, alKey, pruneCaches } from './js/store.js';
import { localNow, datePart } from './js/time.js';
import { fetchRawForecast, fetchAirQuality, fetchAlerts, normalize } from './js/weather.js';
import { makeGeocoder } from './js/geo.js';
import { fetchCalendar, localizeEvents, describeCalendarError } from './js/calendar.js';
import { detectTrips, travelLine, tripsToForecast, placeKey } from './js/travel.js';
import { writeAll, modelForDate } from './js/insights.js';
import { buildFacts, fingerprint, writeWithClaude, mergeWritten, friendlyAiError } from './js/ai.js';
import { renderAll } from './js/render.js';
import { initSettings, openSettings, refreshStatus, setInstallPrompt, mountCityPicker } from './js/settings.js';

const AI_MAX_AGE = 3 * 3600 * 1000;
const STALE_MS = 10 * 60 * 1000;

const els = {
  hero: document.getElementById('hero'),
  hourly: document.getElementById('hourly'),
  week: document.getElementById('week'),
  fine: document.getElementById('fine'),
  dialog: document.getElementById('settings'),
  toast: document.getElementById('toast'),
};

const state = {
  settings: loadSettings(),
  home: null, // normalized model
  wxFetchedAt: 0,
  wxError: null,
  wxStale: false,
  tripModels: {},
  cal: null, // {events, fetchedAt}
  calError: null,
  travel: null,
  ai: null, // {fp, at, result}
  aiError: null,
  loading: false,
  alertOpen: false,
  lastRefresh: 0,
};

// ---------- helpers ----------
function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'dark' || theme === 'light') root.setAttribute('data-theme', theme);
  else root.removeAttribute('data-theme');
}

function homeToday() {
  return datePart(localNow(state.home ? state.home.offset : 0));
}

function cachedModel(place, lat, lon, units, { withExtras = false } = {}) {
  const c = getJSON(wxKey(lat, lon, units));
  if (!c || !c.raw) return null;
  try {
    const extras = { fetchedAt: c.at };
    if (withExtras) {
      const aq = getJSON(aqKey(lat, lon));
      const al = getJSON(alKey(lat, lon));
      extras.aq = aq && aq.data;
      extras.alerts = al && Date.now() - al.at < 6 * 3600 * 1000 ? al.data : [];
    }
    return normalize(c.raw, place, units, extras);
  } catch { return null; }
}

function buildCtx() {
  const home = state.home;
  if (!home) return null;
  const today = homeToday();
  const info = state.travel ? state.travel.dayInfo(today) : null;
  let model = home;
  if (info && info.where === 'away' && info.trip && state.tripModels[info.trip.id]) model = state.tripModels[info.trip.id];
  const base = { now: localNow(model.offset), units: state.settings.units, model, homeModel: home, tripModels: state.tripModels, travel: state.travel, events: [] };
  const events = state.cal ? localizeEvents(state.cal.events, (date) => modelForDate(base, date).offset) : [];
  return { ...base, events };
}

function buildView({ fade = false } = {}) {
  const s = state.settings;
  if (!s.home) return { status: 'onboarding', settings: s };
  if (!state.home) return { status: state.wxError ? 'error' : 'loading', settings: s, wxErrorText: state.wxError ? 'check your connection and try again.' : '' };
  const ctx = buildCtx();
  const onDevice = writeAll(ctx);
  let written = onDevice;
  let writtenBy = 'on-device';
  const ai = state.ai;
  if (s.ai.enabled && s.ai.key && ai && ai.result && Date.now() - ai.at < AI_MAX_AGE && ai.fp.slice(0, 10) === datePart(ctx.now)) {
    written = mergeWritten(onDevice, ai.result);
    writtenBy = 'claude';
  }
  const today = datePart(ctx.now);
  const info = state.travel ? state.travel.dayInfo(today) : null;
  return {
    status: 'ready',
    settings: s,
    ctx,
    written,
    writtenBy,
    aiNote: s.ai.enabled && s.ai.key && state.aiError ? `claude: ${state.aiError}` : '',
    fade,
    loading: state.loading,
    wxFetchedAt: state.wxFetchedAt || state.home.fetchedAt,
    wxStale: state.wxStale,
    awayToday: !!(info && info.where === 'away' && ctx.model !== state.home),
    calendarConnected: !!s.calendar.url,
    hasCalendarData: !!state.cal,
    calFetchedAt: state.cal && state.cal.fetchedAt,
    calErrorText: state.calError ? describeCalendarError(state.calError) : '',
    travelLine: s.calendar.url && state.travel ? travelLine(state.travel, today) : (s.calendar.url && state.cal ? 'checking your calendar for trips…' : ''),
    alertOpen: state.alertOpen,
  };
}

let obMounted = false;
function render(opts = {}) {
  const view = buildView(opts);
  if (view.status === 'onboarding') {
    if (obMounted && els.hero.querySelector('#ob-picker')) return;
    renderAll(view, els);
    obMounted = true;
    mountCityPicker(els.hero.querySelector('#ob-picker'), {
      prefix: 'ob',
      onPick: (place) => { const st = state.settings; st.home = place; onSettingsSaved(st, 'home'); },
    });
    return;
  }
  obMounted = false;
  renderAll(view, els);
}

// ---------- data ----------
async function loadTripModels(force) {
  const out = {};
  if (!state.travel || !state.home) { state.tripModels = out; return; }
  const units = state.settings.units;
  const trips = tripsToForecast(state.travel, homeToday());
  const byPlace = new Map();
  for (const t of trips) { const k = placeKey(t); if (!byPlace.has(k)) byPlace.set(k, []); byPlace.get(k).push(t); }
  await Promise.all([...byPlace.values()].map(async (list) => {
    const t = list[0];
    const place = { name: t.city, region: t.region, lat: t.lat, lon: t.lon };
    let model = cachedModel(place, t.lat, t.lon, units);
    const fresh = model && Date.now() - (model.fetchedAt || 0) < STALE_MS;
    if (force !== false && !fresh) {
      try {
        const raw = await fetchRawForecast(t.lat, t.lon, units);
        const at = Date.now();
        setJSON(wxKey(t.lat, t.lon, units), { at, raw });
        model = normalize(raw, place, units, { fetchedAt: at });
      } catch { /* keep cached trip model if any */ }
    }
    if (model) list.forEach((x) => { out[x.id] = model; });
  }));
  state.tripModels = out;
  const keep = [wxKey(state.home.place.lat, state.home.place.lon, units), aqKey(state.settings.home.lat, state.settings.home.lon), alKey(state.settings.home.lat, state.settings.home.lon),
    ...trips.map((t) => wxKey(t.lat, t.lon, units)), wxKey(state.settings.home.lat, state.settings.home.lon, units)];
  pruneCaches(keep);
}

async function runTravel(maxUncached) {
  if (!state.cal || !state.home) { state.travel = null; return; }
  const h = state.settings.home;
  try {
    state.travel = await detectTrips({ events: state.cal.events, home: { lat: h.lat, lon: h.lon }, today: homeToday(), geocode: makeGeocoder({ maxUncached }) });
  } catch { /* keep previous */ }
}

function restoreFromCache() {
  const s = state.settings;
  const h = s.home;
  state.home = cachedModel(h, h.lat, h.lon, s.units, { withExtras: true });
  state.wxFetchedAt = state.home ? state.home.fetchedAt : 0;
  const cal = s.calendar.url ? getJSON(KEYS.cal) : null;
  state.cal = cal && cal.data && cal.url === s.calendar.url ? { events: cal.data.events, fetchedAt: cal.at } : null;
  const ai = getJSON(KEYS.ai);
  state.ai = ai && ai.result ? ai : null;
}

let refreshing = null;
async function refresh({ manual = false } = {}) {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const s = state.settings;
    const h = s.home;
    if (!h) return;
    state.loading = true;
    state.lastRefresh = Date.now();
    render();
    const units = s.units;
    const [wx, aq, al, cal] = await Promise.allSettled([
      fetchRawForecast(h.lat, h.lon, units),
      fetchAirQuality(h.lat, h.lon),
      fetchAlerts(h.lat, h.lon, h.countryCode),
      s.calendar.url ? fetchCalendar(s.calendar.url, s.calendar.secret) : Promise.resolve(null),
    ]);
    if (units !== state.settings.units || h !== state.settings.home) return; // settings changed mid-flight
    let aqData;
    if (aq.status === 'fulfilled' && aq.value) { aqData = aq.value; setJSON(aqKey(h.lat, h.lon), { at: Date.now(), data: aq.value }); } else { const c = getJSON(aqKey(h.lat, h.lon)); aqData = c && c.data; }
    let alerts = [];
    if (al.status === 'fulfilled') { alerts = al.value; setJSON(alKey(h.lat, h.lon), { at: Date.now(), data: al.value }); } else if (state.home) alerts = state.home.alerts;
    if (wx.status === 'fulfilled') {
      const at = Date.now();
      setJSON(wxKey(h.lat, h.lon, units), { at, raw: wx.value });
      try {
        state.home = normalize(wx.value, h, units, { fetchedAt: at, aq: aqData, alerts });
        state.wxFetchedAt = at; state.wxError = null; state.wxStale = false;
      } catch (e) { state.wxError = e; state.wxStale = !!state.home; }
    } else {
      state.wxError = wx.reason || { kind: 'network' };
      state.wxStale = !!state.home;
      if (state.home) state.home = { ...state.home, aqi: state.home.aqi, alerts };
    }
    if (cal.status === 'fulfilled') {
      if (cal.value) { state.cal = { events: cal.value.events, fetchedAt: cal.value.fetchedAt }; setJSON(KEYS.cal, { at: cal.value.fetchedAt, url: s.calendar.url, data: { events: cal.value.events } }); }
      else state.cal = null;
      state.calError = null;
    } else state.calError = cal.reason || { kind: 'network' };
    render();
    refreshStatus();
    if (state.home) {
      const hadTravel = !!state.travel;
      await runTravel(12);
      await loadTripModels(true);
      if (state.travel || hadTravel) render();
      await maybeAI();
    }
    state.loading = false;
    render();
    void manual;
  })();
  try { await refreshing; } finally { refreshing = null; state.loading = false; }
}

let aiInFlight = false;
async function maybeAI() {
  const a = state.settings.ai;
  if (!a.enabled || !a.key || !state.home || aiInFlight) return;
  const ctx = buildCtx();
  const fp = fingerprint(ctx);
  const cached = getJSON(KEYS.ai);
  if (cached && cached.fp === fp && cached.model === a.model && Date.now() - cached.at < AI_MAX_AGE) {
    state.ai = cached; return;
  }
  aiInFlight = true;
  try {
    const onDevice = writeAll(ctx);
    const facts = buildFacts(ctx, onDevice);
    const result = await writeWithClaude({ apiKey: a.key, model: a.model, facts });
    state.ai = { fp, at: Date.now(), model: a.model, result };
    setJSON(KEYS.ai, state.ai);
    state.aiError = null;
    render({ fade: true });
  } catch (e) {
    state.aiError = friendlyAiError(e);
    render();
  } finally { aiInFlight = false; }
}

// ---------- settings ----------
function onSettingsSaved(st, kind) {
  state.settings = { ...st, calendar: { ...st.calendar }, ai: { ...st.ai } };
  saveSettings(state.settings);
  switch (kind) {
    case 'theme': applyTheme(state.settings.theme); break;
    case 'label': render(); break;
    case 'home':
    case 'units':
      state.home = null; state.travel = null; state.tripModels = {}; state.ai = null; state.wxError = null; state.wxStale = false;
      restoreFromCache();
      if (state.home) { runTravel(0).then(() => loadTripModels(false)).then(() => render()); }
      render();
      refresh();
      break;
    case 'calendar':
      if (!state.settings.calendar.url) { state.cal = null; state.travel = null; state.tripModels = {}; state.calError = null; render(); }
      else refresh();
      break;
    case 'ai':
      state.aiError = null;
      render();
      if (state.settings.ai.enabled && state.settings.ai.key) maybeAI();
      break;
    default: render();
  }
}

function getStatus() {
  const off = state.home ? state.home.offset : 0;
  return { calendar: { count: state.cal ? state.cal.events.length : 0, fetchedAt: state.cal && state.cal.fetchedAt, offset: off, error: state.calError ? describeCalendarError(state.calError) : '' } };
}

// ---------- service worker ----------
function showUpdateToast(worker) {
  els.toast.innerHTML = 'new version ready <button class="btn btn-accent" type="button" id="toast-reload">reload</button>';
  els.toast.hidden = false;
  els.toast.querySelector('#toast-reload').addEventListener('click', () => {
    reloadOnChange = true;
    worker.postMessage({ type: 'SKIP_WAITING' });
  });
}
let reloadOnChange = false;
function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloadOnChange) location.reload(); });
  navigator.serviceWorker.register('./sw.js', { scope: './' }).then((reg) => {
    if (reg.waiting && navigator.serviceWorker.controller) showUpdateToast(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (!w) return;
      w.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) showUpdateToast(w);
      });
    });
  }).catch(() => { /* offline support unavailable; the app still works */ });
}

// ---------- boot ----------
function wire() {
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const a = b.dataset.action;
    if (a === 'open-settings') openSettings();
    else if (a === 'open-settings-calendar') openSettings('calendar');
    else if (a === 'refresh' || a === 'retry') refresh({ manual: true });
  });
  document.addEventListener('toggle', (e) => {
    if (e.target.matches && e.target.matches('details.alert')) state.alertOpen = e.target.open;
  }, true);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.settings.home) {
      if (Date.now() - state.lastRefresh > STALE_MS) refresh();
      else render();
    }
  });
  setInterval(() => { if (document.visibilityState === 'visible' && state.settings.home) refresh(); }, 15 * 60 * 1000);
  // keep "now" fresh (your day, current hour) between refreshes
  setInterval(() => { if (document.visibilityState === 'visible' && state.home && !els.dialog.open) render(); }, 5 * 60 * 1000);
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); setInstallPrompt(e); });
  window.addEventListener('appinstalled', () => setInstallPrompt(null));
}

function boot() {
  applyTheme(state.settings.theme);
  wire();
  initSettings(els.dialog, { getSettings: () => ({ ...state.settings, calendar: { ...state.settings.calendar }, ai: { ...state.settings.ai } }), save: onSettingsSaved, getStatus });
  if (!state.settings.home) { render(); registerSW(); return; }
  restoreFromCache();
  render();
  if (state.home && state.cal) {
    // trips from cached geocodes only, then cached trip forecasts — instant
    runTravel(0).then(() => loadTripModels(false)).then(() => render()).finally(() => refresh());
  } else refresh();
  registerSW();
}

boot();
