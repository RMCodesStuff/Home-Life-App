// Home Life — entry module: boot, state, refresh loop, wiring.
import { loadSettings, saveSettings, cloneSettings, getJSON, setJSON, remove, KEYS, wxKey, aqKey, alKey, pruneCaches } from './js/store.js';
import { localNow, datePart, diffDays, addDays, dowShort } from './js/time.js';
import { fetchRawForecast, fetchAirQuality, fetchAlerts, normalize } from './js/weather.js';
import { makeGeocoder, cachedGeocode } from './js/geo.js';
import { fetchCalendar, localizeEvents, describeCalendarError } from './js/calendar.js';
import { detectTrips, travelLine, tripsToForecast, placeKey, withManualTrip } from './js/travel.js';
import { bridgeTrip, checksKey, setCheck } from './js/tripprep.js';
import { eveningOn, tomorrowEdition } from './js/evening.js';
import { composeTrip, composeHome, fineWithHome } from './js/compose.js';
import { calendarList, tagMap, filterEvents } from './js/calendars.js';
import { fbStatus, fbGetDoc, fbGetDocs } from './js/fb.js';
import { mealPlanPath, recipePath, rackUserPath, RACK_LOCAL_KEY } from './js/connections.js';
import { recipeIdsFor, slimRecipe, slotKey, MEALS, mealsForDay } from './js/meals.js';
import { pickSummary } from './js/workout.js';
import { radarWanted, tileGrid, latestRadar } from './js/phoenix.js';
import { readAloudText, toggleSpeech, canSpeak } from './js/speech.js';
import { relTime } from './js/time.js';
import { writeAll, modelForDate, withEasyPace } from './js/insights.js';
import { buildFacts, fingerprint, writeWithClaude, mergeWritten, friendlyAiError } from './js/ai.js';
import { renderAll, renderPlanCard, clockAt } from './js/render.js';
import { initSettings, openSettings, refreshStatus, setInstallPrompt, mountCityPicker, rebuildSettings } from './js/settings.js';
import { offerSetupFromHash } from './js/setupui.js';
import { loadPlan, savePlan, clearPlan, loadDone, saveDone, setDone, composePlan } from './js/plan.js';
import { initPlanUI, initPlanSheet, openPlanSheet, offerPlanFromHash } from './js/planui.js';

const AI_MAX_AGE = 3 * 3600 * 1000;
const STALE_MS = 10 * 60 * 1000;

const els = {
  hero: document.getElementById('hero'),
  hourly: document.getElementById('hourly'),
  week: document.getElementById('week'),
  fine: document.getElementById('fine'),
  rundown: document.getElementById('rundown'),
  plan: document.getElementById('plan'),
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
  aiFailAt: 0,
  loading: false,
  alertOpen: false,
  lastRefresh: 0,
  showToday: '', // the date on which "show today" was tapped during evening mode (per session)
  meals: null, // {at, dates, plan: {slot: recipeId}, recipes: {id: {name, ingredients}}} (cached, read-only)
  mealStatus: null, // {connected, kind}
  rack: null, // {at, summary} from the rack timer account (the device copy is read live from localStorage)
  rackStatus: null,
  radar: null, // {at, frame}
  speaking: false,
  plan: loadPlan(), // the trip plan (itinerary), this device only
  planDone: {},
  planWaits: [], // today's standby waits from the last full render
};
state.planDone = state.plan ? loadDone(state.plan.id) : {};
try { state.showToday = sessionStorage.getItem('hl.showToday') || ''; } catch { /* ignore */ }

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

/**
 * Where you are today (trip city when away, else home), for the bridge's leave-by drive times.
 * In evening mode the leave-by times that matter are tomorrow's, so a night before waking up away uses the trip.
 */
function primaryPlace() {
  const h = state.settings.home;
  const today = homeToday();
  let info = state.travel && state.home ? state.travel.dayInfo(today) : null;
  if (state.travel && state.home && eveningEditionNow()) {
    const next = state.travel.dayInfo(addDays(today, 1));
    if (next.where === 'away') info = next;
  }
  const t = info && info.where === 'away' ? info.trip : null;
  return t && Number.isFinite(t.lat) && Number.isFinite(t.lon) ? { lat: t.lat, lon: t.lon } : { lat: h.lat, lon: h.lon };
}

function buildCtx() {
  const home = state.home;
  if (!home) return null;
  const today = homeToday();
  const info = state.travel ? state.travel.dayInfo(today) : null;
  let model = home;
  if (info && info.where === 'away' && info.trip && state.tripModels[info.trip.id]) model = state.tripModels[info.trip.id];
  const show = state.settings.show;
  const bridge = state.cal && state.cal.bridge;
  const base = { now: localNow(model.offset), units: state.settings.units, model, homeModel: home, tripModels: state.tripModels, travel: state.travel, events: [] };
  const visible = state.cal ? filterEvents(state.cal.events, state.settings.calendars) : [];
  const raw = show.leaveBy ? visible : visible.map(({ travel, ...rest }) => rest);
  const events = localizeEvents(raw, (date) => modelForDate(base, date).offset);
  return {
    ...base,
    events,
    inbox: show.inbox && bridge && bridge.inbox && bridge.inbox.ok ? bridge.inbox : null,
    oura: show.oura && bridge && bridge.oura && bridge.oura.ok ? bridge.oura : null,
  };
}

/** The trip plan card's view model (null hides it). Times are the plan's own zone; `evening` = tomorrow's edition is showing. */
function planView(evening) {
  return composePlan(state.plan, { nowMs: Date.now(), evening, waits: state.planWaits, done: state.planDone });
}

function buildView({ fade = false } = {}) {
  const s = state.settings;
  if (!s.home) return { status: 'onboarding', settings: s };
  if (!state.home) return { status: state.wxError ? 'error' : 'loading', settings: s, plan: planView(false), wxErrorText: state.wxError ? 'check your connection and try again.' : '' };
  const ctx = buildCtx();
  const onDevice = writeAll(ctx);
  let written = onDevice;
  let writtenBy = 'on-device';
  const ai = state.ai;
  if (s.ai.enabled && s.ai.key && ai && ai.result && Date.now() - ai.at < AI_MAX_AGE && ai.fp.slice(0, 10) === datePart(ctx.now)) {
    written = mergeWritten(onDevice, ai.result);
    written.best_window = withEasyPace(written.best_window, ctx.oura);
    writtenBy = 'claude';
  }
  const today = datePart(ctx.now);
  const info = state.travel ? state.travel.dayInfo(today) : null;
  const evening = eveningOn(ctx.now, s.evening);
  const tomorrow = evening && state.showToday !== today ? tomorrowEdition(ctx) : null;
  const target = tomorrow ? tomorrow.date : today;
  const bridge = state.cal && state.cal.bridge ? state.cal.bridge : null;
  const h = s.home;
  const trip = composeTrip(ctx, {
    target, today, settings: s, bridge,
    home: { lat: h.lat, lon: h.lon, name: h.name },
    coordsFor: cachedGeocode,
    checks: (id) => getJSON(checksKey(id)) || {},
    briefingPacking: s.show.rundown !== false && bridge && bridge.briefing && bridge.briefing.ok && bridge.briefing.data.trip ? bridge.briefing.data.trip.packing : null,
  });
  const summary = currentSummary();
  const meals = state.meals && Array.isArray(state.meals.dates) && state.meals.dates.includes(target) ? state.meals : null;
  const homeFx = composeHome(ctx, { target, today, evening: !!tomorrow, settings: s, bridge, meals, summary });
  homeFx.workoutSource = summary ? 'rack timer' : 'no timer plan yet';
  let radar = null;
  if (homeFx.radar && state.radar && state.radar.frame) {
    const pl = ctx.model.place;
    radar = { grid: tileGrid(pl.lat, pl.lon, 7), frame: state.radar.frame, ago: state.radar.frame.time ? relTime(new Date(state.radar.frame.time * 1000).toISOString(), Date.now()) : '' };
  }
  written = { ...written, fine: fineWithHome(written.fine, homeFx.fine, today) };
  state.planWaits = trip.park.filter((p) => p.date === today).flatMap((p) => p.waits);
  return {
    status: 'ready',
    plan: planView(!!tomorrow),
    home: homeFx,
    radar,
    tags: tagMap(calendarList(state.cal ? state.cal.events : [], s.calendars)),
    canSpeak: canSpeak(),
    speaking: state.speaking,
    edition: tomorrow ? 'tomorrow' : 'today',
    evening,
    tomorrow,
    target,
    trip,
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
    bridge, // {version, features, inbox, oura, parks, tripDrive, tripReq}; null = not fetched yet
    calErrorText: state.calError ? describeCalendarError(state.calError) : '',
    travelLine: (s.calendar.url || s.trip.manual) && state.travel ? travelLine(state.travel, today) : (s.calendar.url && state.cal ? 'checking your calendar for trips…' : ''),
    travelLineTarget: tomorrow && state.travel ? travelLine(state.travel, target) : '',
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
  if (!state.home) { state.travel = null; return; }
  const h = state.settings.home;
  let detected = null;
  if (state.cal) {
    try {
      detected = await detectTrips({ events: filterEvents(state.cal.events, state.settings.calendars), home: { lat: h.lat, lon: h.lon }, today: homeToday(), geocode: makeGeocoder({ maxUncached }) });
    } catch { detected = state.travel; } // keep previous
  }
  // a trip typed in settings works without the calendar, and wins over detected trips on the same dates
  state.travel = withManualTrip(detected, state.settings.trip.manual);
}

function restoreFromCache() {
  const s = state.settings;
  const h = s.home;
  state.home = cachedModel(h, h.lat, h.lon, s.units, { withExtras: true });
  state.wxFetchedAt = state.home ? state.home.fetchedAt : 0;
  const cal = s.calendar.url ? getJSON(KEYS.cal) : null;
  state.cal = cal && cal.data && cal.url === s.calendar.url ? { events: cal.data.events, fetchedAt: cal.at, bridge: cal.data.bridge || null } : null;
  const ai = getJSON(KEYS.ai);
  state.ai = ai && ai.result ? ai : null;
  const meals = getJSON('hl.meals');
  state.meals = meals && meals.plan ? meals : null;
  const rack = getJSON('hl.rack');
  state.rack = rack && rack.summary ? rack : null;
  const radar = getJSON('hl.radar');
  state.radar = radar && radar.frame && Date.now() - radar.at < 30 * 60 * 1000 ? radar : null;
}

// ---------- meal plan, rack timer, radar ----------
const withTimeout = (p, ms = 12000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { kind: 'network' })), ms))]);

/** The rack timer's summary: the newer of this device's copy (same origin) and the account's. */
function currentSummary() {
  return pickSummary(getJSON(RACK_LOCAL_KEY), state.rack && state.rack.summary);
}

/** Today's to the day after tomorrow's meals and their recipes, read-only, when the meal plan is connected. */
async function loadMeals() {
  if (state.settings.show.dinner === false) return;
  const st = await fbStatus('meals');
  state.mealStatus = st;
  if (!st.connected) return;
  const today = homeToday();
  const dates = [today, addDays(today, 1), addDays(today, 2)];
  try {
    const plan = (await withTimeout(fbGetDoc('meals', mealPlanPath()))) || {};
    const ids = recipeIdsFor(plan, dates);
    const docs = ids.length ? await withTimeout(fbGetDocs('meals', ids.map(recipePath))) : [];
    const recipes = {};
    docs.forEach((d, i) => { const r = slimRecipe(d.data); if (r && r.name) recipes[ids[i]] = r; });
    const slots = {};
    for (const d of dates) for (const m of MEALS) { const k = slotKey(d, m); if (typeof plan[k] === 'string' && plan[k]) slots[k] = plan[k]; }
    state.meals = { at: Date.now(), dates, plan: slots, recipes };
    setJSON('hl.meals', state.meals);
    state.mealStatus = { ...st, at: state.meals.at };
  } catch (e) { state.mealStatus = { ...st, kind: e.kind || 'other', error: true }; }
}

/** The summary the rack timer wrote to its account (users/{uid}.homelife), when connected. */
async function loadRack() {
  if (state.settings.show.workout === false) return;
  const st = await fbStatus('rack');
  state.rackStatus = st;
  if (!st.connected || !st.uid) return;
  try {
    const doc = await withTimeout(fbGetDoc('rack', rackUserPath(st.uid)));
    if (doc && doc.homelife && typeof doc.homelife === 'object') { state.rack = { at: Date.now(), summary: doc.homelife }; setJSON('hl.rack', state.rack); }
  } catch (e) { state.rackStatus = { ...st, kind: e.kind || 'other' }; }
}

/** RainViewer's latest radar frame, only when the radar strip would show (cached 5 minutes). */
async function loadRadar() {
  if (state.settings.show.radar === false || !state.home) return;
  const ctx = buildCtx();
  if (!radarWanted(ctx.model, ctx.now, ctx.model.alerts)) return;
  const c = getJSON('hl.radar');
  if (c && c.frame && Date.now() - c.at < 5 * 60 * 1000) { state.radar = c; return; }
  try {
    const res = await withTimeout(fetch('https://api.rainviewer.com/public/weather-maps.json'), 10000);
    const frame = res.ok ? latestRadar(await res.json()) : null;
    if (frame) { state.radar = { at: Date.now(), frame }; setJSON('hl.radar', state.radar); }
  } catch { /* the strip stays hidden */ }
}

async function loadExtras() {
  await Promise.allSettled([loadMeals(), loadRack(), loadRadar()]);
}

/** Keep a bridge answer (and what it was asked: `from` and the trip). */
function applyCalendar(value, asked) {
  const { version, features, inbox, oura, parks, tripDrive, briefing, birthdays } = value;
  const trip = asked.trip ? { id: asked.trip.id, date: asked.trip.date } : null;
  const from = asked.from ? { lat: asked.from.lat, lon: asked.from.lon } : null;
  const bridge = { version, features, inbox, oura, parks, tripDrive, briefing, birthdays, tripReq: trip, fromReq: from };
  state.cal = { events: value.events, fetchedAt: value.fetchedAt, bridge };
  setJSON(KEYS.cal, { at: value.fetchedAt, url: state.settings.calendar.url, data: { events: value.events, bridge } });
}

const samePlace = (a, b) => !!a && !!b && Math.abs(a.lat - b.lat) < 0.01 && Math.abs(a.lon - b.lon) < 0.01;
/**
 * Trips are found from the calendar answer itself, so a first load asks before it knows about them. When travel changes
 * where you are (`from`) or which trip leaves soon, ask once more so leave-by and the trip drive match.
 */
async function refetchIfTravelChanged() {
  const s = state.settings;
  const b = state.cal && state.cal.bridge;
  if (!s.calendar.url || !b || b.version < 2 || !state.home) return;
  const trip = b.version >= 3 ? bridgeTrip(state.travel, homeToday()) : null;
  const from = primaryPlace();
  const tripChanged = (trip ? trip.id : '') !== (b.tripReq ? b.tripReq.id : '');
  if (!tripChanged && samePlace(from, b.fromReq || from)) return;
  try {
    const url = s.calendar.url;
    const v = await fetchCalendar(url, s.calendar.secret, 14, { from, trip });
    if (url !== state.settings.calendar.url) return;
    applyCalendar(v, { from, trip });
    render();
  } catch { /* the next refresh asks again */ }
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
    const tripReq = state.home ? bridgeTrip(state.travel, homeToday()) : null; // a trip leaving within 2 days: ask for the drive
    const fromReq = primaryPlace();
    // The calendar script can take a minute on a cold run, so it runs alongside the weather and must not hold it back.
    const calUrl = s.calendar.url;
    const calP = Promise.allSettled([calUrl ? fetchCalendar(calUrl, s.calendar.secret, 14, { from: fromReq, trip: tripReq }) : Promise.resolve(null)]);
    const [wx, aq, al] = await Promise.allSettled([
      fetchRawForecast(h.lat, h.lon, units),
      fetchAirQuality(h.lat, h.lon),
      fetchAlerts(h.lat, h.lon, h.countryCode),
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
    // Weather first: hero, hourly and week render now; calendar sections keep their cached / loading state until the script answers.
    if (state.home || state.wxError) { render(); refreshStatus(); }
    const [cal] = await calP;
    if (units !== state.settings.units || h !== state.settings.home || calUrl !== state.settings.calendar.url) return;
    if (cal.status === 'fulfilled') {
      if (cal.value) applyCalendar(cal.value, { from: fromReq, trip: tripReq });
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
      await refetchIfTravelChanged();
      await loadExtras();
      render();
      await maybeAI();
    }
    state.loading = false;
    render();
    void manual;
  })();
  try { await refreshing; } finally { refreshing = null; state.loading = false; }
}

/** The v3 facts Claude may weave in (today's view only). */
function aiExtras(view) {
  const h = view.home || {};
  const park = view.trip && view.trip.park && view.trip.park[0];
  return { workout: h.workout, dinner: h.dinner, birthdays: h.birthdays, rundownNote: h.rundown ? h.rundown.note : '', parkDay: park || null };
}

function eveningEditionNow() {
  if (!state.home) return false;
  const now = localNow(state.home.offset);
  return eveningOn(now, state.settings.evening) && state.showToday !== datePart(now);
}

let aiInFlight = false;
async function maybeAI() {
  const a = state.settings.ai;
  if (!a.enabled || !a.key || !state.home || aiInFlight) return;
  if (eveningEditionNow()) return; // tomorrow's edition is written on-device only
  if (state.aiFailAt && Date.now() - state.aiFailAt < 30 * 60 * 1000) return; // don't retry a failure on every refresh
  const view = buildView();
  const ctx = view.ctx;
  const extras = aiExtras(view);
  const fp = fingerprint(ctx, extras);
  const cached = getJSON(KEYS.ai);
  if (cached && cached.fp === fp && cached.model === a.model && Date.now() - cached.at < AI_MAX_AGE) {
    state.ai = cached; return;
  }
  aiInFlight = true;
  try {
    const onDevice = writeAll(ctx);
    const facts = buildFacts(ctx, onDevice, extras);
    const result = await writeWithClaude({ apiKey: a.key, model: a.model, facts });
    state.ai = { fp, at: Date.now(), model: a.model, result };
    setJSON(KEYS.ai, state.ai);
    state.aiError = null;
    render({ fade: true });
  } catch (e) {
    state.aiError = friendlyAiError(e);
    state.aiFailAt = Date.now();
    render();
  } finally { aiInFlight = false; }
}

/** What "read it to me" reads: the edition on screen (headline, narrative, chips), plus the rundown note in the morning. */
function speechText(view) {
  if (view.status !== 'ready') return '';
  const h = view.home || {};
  if (view.tomorrow) {
    const t = view.tomorrow;
    return readAloudText({ lead: `tomorrow, ${t.headline_lead}`, accent: t.headline_accent, narrative: t.narrative, chips: [...t.chips, ...(h.chipsTomorrow || [])] });
  }
  const w = view.written;
  const extra = h.chipsToday || [];
  const chips = [
    { label: 'umbrella', text: w.umbrella }, { label: 'wear', text: w.wear },
    w.leave_chip ? { label: 'leave', text: w.leave_chip.replace(/^leave\s+/, '') } : null,
    ...extra.filter((c) => c.after === 'leave'),
    { label: 'best window', text: w.best_window },
    w.inbox_chip ? { label: 'inbox', text: w.inbox_chip } : null,
    ...extra.filter((c) => c.after !== 'leave'),
  ].filter(Boolean);
  const planNext = view.plan && view.plan.mode === 'today' && view.plan.next ? `next on the plan: ${view.plan.next.title} at ${view.plan.next.clock}.` : '';
  return readAloudText({ lead: w.headline_lead, accent: w.headline_accent, narrative: w.narrative, chips, note: [h.rundown ? h.rundown.note : '', planNext].filter(Boolean).join(' ') });
}

// ---------- trip plan ----------
function renderPlanOnly() {
  if (!state.settings.home) return;
  renderPlanCard(planView(eveningEditionNow()), els.plan);
}
const planHost = {
  getPlan: () => state.plan,
  getDone: () => state.planDone,
  setPlan(plan) {
    state.plan = plan;
    state.planDone = loadDone(plan.id);
    savePlan(plan);
    render();
  },
  removePlan() {
    if (state.plan) clearPlan(state.plan.id);
    state.plan = null; state.planDone = {};
    render();
  },
};

// ---------- settings ----------
function onSettingsSaved(st, kind) {
  state.settings = cloneSettings(st);
  saveSettings(state.settings);
  switch (kind) {
    case 'theme': applyTheme(state.settings.theme); break;
    case 'label': case 'show': case 'evening': case 'checklist': case 'workout': case 'chores': case 'phoenix': render(); refreshStatus(); break;
    case 'calendars': // the filter also changes which trips exist
      runTravel(0).then(() => loadTripModels(false)).then(() => render());
      render();
      break;
    case 'trip':
      // a manual trip changes travel, the forecasts to load and what the bridge is asked
      runTravel(0).then(() => loadTripModels(true)).then(() => { render(); refreshStatus(); refresh(); });
      break;
    case 'home':
    case 'units':
      state.home = null; state.travel = null; state.tripModels = {}; state.ai = null; state.wxError = null; state.wxStale = false;
      restoreFromCache();
      if (state.home) { runTravel(0).then(() => loadTripModels(false)).then(() => render()); }
      render();
      refresh();
      break;
    case 'calendar':
      if (!state.settings.calendar.url) {
        state.cal = null; state.calError = null;
        runTravel(0).then(() => loadTripModels(true)).then(() => render()); // a manual trip survives without the calendar
        render();
      }
      else refresh();
      break;
    case 'ai':
      state.aiError = null; state.aiFailAt = 0;
      render();
      if (state.settings.ai.enabled && state.settings.ai.key) maybeAI();
      break;
    default: render();
  }
}

/** "use these settings" on a setup link: the merged settings replace this device's, then everything reloads like a home change. */
function applySetupSettings(merged) {
  const inFlight = refreshing;
  state.settings = cloneSettings(merged);
  saveSettings(state.settings);
  applyTheme(state.settings.theme);
  state.cal = null; state.calError = null; state.ai = null; state.aiError = null; state.aiFailAt = 0;
  rebuildSettings();
  if (!state.settings.home) { state.home = null; state.travel = null; state.tripModels = {}; render(); return; }
  onSettingsSaved(state.settings, 'home');
  if (inFlight) inFlight.catch(() => {}).then(() => refresh());
}

/** After connecting or disconnecting an account in settings. */
async function reloadSource(kind) {
  if (kind === 'meals-off') { state.meals = null; state.mealStatus = null; remove('hl.meals'); }
  else if (kind === 'rack-off') { state.rack = null; state.rackStatus = null; remove('hl.rack'); }
  else if (kind === 'meals') await loadMeals();
  else if (kind === 'rack') await loadRack();
  render();
  refreshStatus();
}

function getStatus() {
  const off = state.home ? state.home.offset : 0;
  const b = state.cal && state.cal.bridge;
  return {
    calendar: { count: state.cal ? state.cal.events.length : 0, fetchedAt: state.cal && state.cal.fetchedAt, offset: off, error: state.calError ? describeCalendarError(state.calError) : '' },
    bridge: b ? { version: b.version, features: b.features } : null,
    oura: b ? { version: b.version, data: b.oura } : null,
    today: homeToday(),
    trips: state.travel ? state.travel.trips.map((t) => ({ city: t.city, departDate: t.departDate, returnDate: t.returnDate, manual: !!t.manual })) : [],
    calendars: calendarList(state.cal ? state.cal.events : [], state.settings.calendars),
    bridgeExtras: b && b.version >= 3 ? { briefing: b.briefing, birthdays: b.birthdays, parks: b.parks, tripDrive: b.tripDrive } : null,
    meals: (() => {
      const ms = state.mealStatus || {};
      const today = homeToday();
      const tonight = state.meals && state.meals.dates && state.meals.dates.includes(today) ? mealsForDay(state.meals.plan, state.meals.recipes, today).dinner : null;
      return { connected: !!ms.connected, kind: ms.kind || '', at: state.meals ? clockAt(state.meals.at, off) : '', dinner: tonight ? tonight.name.toLowerCase() : '' };
    })(),
    rack: (() => {
      const sum = currentSummary();
      let when = '';
      if (sum && sum.updatedAt) {
        const ms = Date.parse(sum.updatedAt);
        const day = datePart(localNow(off, ms));
        when = `${day === homeToday() ? '' : `${dowShort(day)} `}${clockAt(ms, off)}`;
      }
      return { connected: !!(state.rackStatus && state.rackStatus.connected), source: sum && state.rack && state.rack.summary && sum.updatedAt === state.rack.summary.updatedAt ? 'account' : 'device', updatedAt: when };
    })(),
  };
}

/** Ticks for trips that left more than 45 days ago are dropped. */
function pruneTripChecks() {
  try {
    const today = datePart(localNow(0));
    const drop = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const m = /^hl\.trip\..*\|(\d{4}-\d{2}-\d{2})$/.exec(k || '');
      if (m && diffDays(today, m[1]) > 45) drop.push(k);
    }
    drop.forEach((k) => remove(k));
  } catch { /* ignore */ }
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
    else if (a === 'show-today' || a === 'show-tomorrow') {
      state.showToday = a === 'show-today' && state.home ? datePart(localNow(state.home.offset)) : '';
      try { if (state.showToday) sessionStorage.setItem('hl.showToday', state.showToday); else sessionStorage.removeItem('hl.showToday'); } catch { /* ignore */ }
      render();
      if (!state.showToday) return;
      maybeAI();
    } else if (a === 'open-settings-trip') openSettings('trip');
    else if (a === 'open-plan') openPlanSheet();
    else if (a === 'speak') {
      toggleSpeech(speechText(buildView()), { onChange: (on) => { state.speaking = on; render(); } });
    }
  });
  document.addEventListener('change', (e) => {
    const pbox = e.target.closest && e.target.closest('input[data-plan-item], input[data-plan-check]');
    if (pbox && state.plan) {
      const id = pbox.dataset.planItem || pbox.dataset.planCheck;
      state.planDone = setDone(state.planDone, id, pbox.checked);
      saveDone(state.plan.id, state.planDone);
      // the same stop can be in the card and the whole-trip sheet: keep every copy in step
      document.querySelectorAll('input[data-plan-item], input[data-plan-check]').forEach((n) => { if ((n.dataset.planItem || n.dataset.planCheck) === id) n.checked = pbox.checked; });
      renderPlanOnly();
      return;
    }
    const box = e.target.closest && e.target.closest('input[data-check]');
    if (!box) return;
    const key = checksKey(box.dataset.trip);
    setJSON(key, setCheck(getJSON(key), box.dataset.check, box.checked));
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
  // the plan card counts down in minutes, so it re-renders on its own between the full renders
  setInterval(() => { if (document.visibilityState === 'visible' && state.plan && !els.plan.hidden && !els.dialog.open) renderPlanOnly(); }, 60 * 1000);
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); setInstallPrompt(e); });
  window.addEventListener('appinstalled', () => setInstallPrompt(null));
}

function boot() {
  applyTheme(state.settings.theme);
  wire();
  initPlanUI(planHost); // before initSettings: the settings sheet paints the plan section as it builds
  initSettings(els.dialog, { getSettings: () => cloneSettings(state.settings), save: onSettingsSaved, getStatus, reload: reloadSource });
  pruneTripChecks();
  initPlanSheet();
  offerPlanFromHash();
  window.addEventListener('hashchange', offerPlanFromHash); // a plan link opened while the app is already running
  const offerSetup = () => offerSetupFromHash({ getSettings: () => cloneSettings(state.settings), apply: applySetupSettings });
  offerSetup();
  window.addEventListener('hashchange', offerSetup); // a setup link opened while the app is already running
  if (!state.settings.home) { render(); registerSW(); return; }
  restoreFromCache();
  render();
  if (state.home && (state.cal || state.settings.trip.manual)) {
    // trips from cached geocodes only, then cached trip forecasts — instant
    runTravel(0).then(() => loadTripModels(false)).then(() => render()).finally(() => refresh());
  } else refresh();
  registerSW();
}

boot();
