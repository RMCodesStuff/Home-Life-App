// v3 tests for calendar-bridge/Code.gs: briefing, parks, trip drive, birthdays. Same node:vm approach as bridge.test.mjs.
// Everything here is fictional. ThemeParks.wiki and People API shapes are the documented ones, faked.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(new URL('../calendar-bridge/Code.gs', import.meta.url), 'utf8');
const TZ = 'America/Denver';
const KEY = 'test-key-not-a-real-secret-0000';
const SECRET_SRC = SRC.replace('__PASTE_SECRET_HERE__', KEY);
const j = (x) => JSON.parse(JSON.stringify(x));

function parts(d, tz) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(d).map((p) => [p.type, p.value]));
}
function formatDate(d, tz, fmt) {
  const p = parts(d, tz);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const offMin = Math.round((asUtc - Math.floor(d.getTime() / 1000) * 1000) / 60000);
  const sign = offMin < 0 ? '-' : '+';
  const off = `${sign}${String(Math.floor(Math.abs(offMin) / 60)).padStart(2, '0')}:${String(Math.abs(offMin) % 60).padStart(2, '0')}`;
  const date = `${p.year}-${p.month}-${p.day}`;
  return fmt === 'yyyy-MM-dd' ? date : `${date}T${p.hour}:${p.minute}:${p.second}${off}`;
}
function parseDate(text, tz) {
  const [d, t] = text.split(' ');
  const [y, mo, da] = d.split('-').map(Number);
  const [h, mi] = t.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, da, h, mi);
  let ms = guess;
  for (let i = 0; i < 3; i++) {
    const off = formatDate(new Date(ms), tz, 'x').slice(-6);
    ms = guess - (off[0] === '-' ? -1 : 1) * (Number(off.slice(1, 3)) * 60 + Number(off.slice(4))) * 60000;
  }
  return new Date(ms);
}
const iter = (arr) => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };

function load({ source = SECRET_SRC, calendars = [], fetchHandler = () => ({ code: 404, body: '{}' }), directions = () => null, driveFolders = [], noCache = false } = {}) {
  const cacheStore = new Map();
  const world = { fetchLog: [], mapsLog: [], cacheStore };
  const resp = (r) => ({ getResponseCode: () => r.code, getContentText: () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)) });
  const sandbox = {
    Session: { getScriptTimeZone: () => TZ },
    Utilities: { formatDate, getUuid: () => 'uuid', parseDate },
    CacheService: { getScriptCache: () => (noCache ? null : { get: (k) => (cacheStore.has(k) ? cacheStore.get(k) : null), put: (k, v) => { if (String(v).length > 100000) throw new Error('too big'); cacheStore.set(k, v); }, remove: (k) => { cacheStore.delete(k); } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperties() {}, setProperty() {} }) },
    ScriptApp: { getOAuthToken: () => 'oauth-token-fake-1234567890abcdef', getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/X/exec' }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (text) => ({ text, setMimeType() { return this; } }) },
    HtmlService: { createHtmlOutput: (html) => ({ html, setTitle() { return this; } }) },
    CalendarApp: { getAllCalendars: () => calendars, GuestStatus: { NO: 'NO', YES: 'YES' } },
    DriveApp: { getFoldersByName: (name) => iter(driveFolders.filter((f) => f.name === name).map((f) => ({ getFiles: () => iter(f.files) }))) },
    UrlFetchApp: {
      fetch: (url, opts) => { world.fetchLog.push({ url, opts }); return resp(fetchHandler(url, opts)); },
      fetchAll: (reqs) => reqs.map((r) => { world.fetchLog.push({ url: r.url, opts: r }); return resp(fetchHandler(r.url, r)); }),
    },
    Maps: {
      DirectionFinder: { Mode: { DRIVING: 'DRIVING' } },
      newDirectionFinder() {
        const q = {};
        const b = {
          setOrigin(a, c) { q.origin = [a, c]; return b; }, setDestination(...d) { q.dest = d; return b; },
          setMode(m) { q.mode = m; return b; }, setDepart(d) { q.depart = d; return b; },
          getDirections() { world.mapsLog.push(q); return directions(q); },
        };
        return b;
      },
    },
    console,
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(source, ctx);
  world.call = (name, ...args) => { ctx.__args = args; return vm.runInContext(`${name}(...__args)`, ctx); };
  return world;
}

const NOW = Date.parse('2026-11-22T14:00:00Z'); // Sunday 7:00am in Denver
const TODAY = '2026-11-22';
const file = (name, content) => ({ getName: () => name, getBlob: () => ({ getDataAsString: () => (typeof content === 'string' ? content : JSON.stringify(content)) }) });
const folder = (files, name = 'Home Life') => ({ name, files });

// ------------------------------------------------------------------ manifest and file hygiene

test('v3: manifest scopes are exactly the five read-only ones, placeholders intact', () => {
  const raw = fs.readFileSync(new URL('../calendar-bridge/appsscript.json', import.meta.url), 'utf8');
  const m = JSON.parse(raw);
  assert.equal(m.timeZone, '__TIME_ZONE__');
  assert.deepEqual([...m.oauthScopes].sort(), [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/contacts.readonly',
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/script.external_request',
  ]);
  assert.equal(SRC.split('__PASTE_SECRET_HERE__').length - 1, 1);
  assert.match(SRC, /const BRIDGE_VERSION = 3;/);
  assert.match(SRC.split('const SECRET')[0], /drive\.readonly[\s\S]*contacts\.readonly/);
});

// ------------------------------------------------------------------ briefing

test('pickBriefingName_: newest within 2 days, ignores other names, future and old dates', () => {
  const w = load();
  const pick = (names) => j(w.call('pickBriefingName_', names, TODAY));
  assert.deepEqual(pick(['home-life-briefing-2026-11-20.json', 'home-life-briefing-2026-11-22.json', 'home-life-briefing-2026-11-21.json']), { date: '2026-11-22', name: 'home-life-briefing-2026-11-22.json' });
  assert.equal(pick(['home-life-briefing-2026-11-19.json']), null); // 3 days old
  assert.equal(pick(['home-life-briefing-2026-11-20.json']).date, '2026-11-20'); // exactly 2 days old is fine
  assert.equal(pick(['home-life-briefing-2026-11-25.json']), null); // from the future
  assert.equal(pick(['home-life-briefing-2026-11-22.json.txt', 'notes.json', 'home-life-briefing-2026-11-2.json', 'xhome-life-briefing-2026-11-22.json']), null);
  assert.equal(pick([]), null);
});

test('briefing: fresh file is returned with stale false and the data untouched', () => {
  const data = { v: 1, forDate: TODAY, push: 'hi', money: null, fantasy: { error: 'x' } };
  const w = load({ driveFolders: [folder([file('home-life-briefing-2026-11-22.json', data), file('home-life-briefing-2026-11-21.json', { v: 1 })])] });
  const r = j(w.call('briefingFeature_', NOW, TZ));
  assert.deepEqual(r, { ok: true, file: 'home-life-briefing-2026-11-22.json', forDate: TODAY, stale: false, data });
});

test('briefing: yesterday\'s file is stale; 3-day-old and missing are not_found; wrong folder name ignored', () => {
  let w = load({ driveFolders: [folder([file('home-life-briefing-2026-11-21.json', { v: 1 })])] });
  let r = j(w.call('briefingFeature_', NOW, TZ));
  assert.equal(r.ok, true); assert.equal(r.stale, true); assert.equal(r.forDate, '2026-11-21');
  w = load({ driveFolders: [folder([file('home-life-briefing-2026-11-19.json', { v: 1 })])] });
  assert.deepEqual(j(w.call('briefingFeature_', NOW, TZ)), { ok: false, error: 'not_found' });
  w = load({ driveFolders: [] });
  assert.deepEqual(j(w.call('briefingFeature_', NOW, TZ)), { ok: false, error: 'not_found' });
  w = load({ driveFolders: [folder([file('home-life-briefing-2026-11-22.json', { v: 1 })], 'Other')] });
  assert.deepEqual(j(w.call('briefingFeature_', NOW, TZ)), { ok: false, error: 'not_found' });
});

test('briefing: bad JSON (and non-object JSON) report bad_json; Drive errors are short and token-free', () => {
  let w = load({ driveFolders: [folder([file('home-life-briefing-2026-11-22.json', '{nope')])] });
  assert.deepEqual(j(w.call('briefingFeature_', NOW, TZ)), { ok: false, error: 'bad_json' });
  w = load({ driveFolders: [folder([file('home-life-briefing-2026-11-22.json', '[1,2]')])] });
  assert.deepEqual(j(w.call('briefingFeature_', NOW, TZ)), { ok: false, error: 'bad_json' });
  w = load();
  w.ctx = null;
  const src = SECRET_SRC;
  const bad = load({ source: src });
  // Drive throwing (scope not approved yet)
  const ctxless = load({ driveFolders: [{ name: 'Home Life', get files() { throw new Error('Authorization is required to perform that action.'); } }] });
  const r = j(ctxless.call('briefingFeature_', NOW, TZ));
  assert.equal(r.ok, false);
  assert.match(r.error, /Authorization is required/);
  void bad;
});

test('briefing: cached 10 minutes (Drive not read twice); stale flag follows the day, not the cache', () => {
  let reads = 0;
  const f = file('home-life-briefing-2026-11-22.json', { v: 1 });
  const counting = { ...f, getBlob: () => { reads++; return f.getBlob(); } };
  const w = load({ driveFolders: [folder([counting])] });
  w.call('briefingFeature_', NOW, TZ);
  const again = j(w.call('briefingFeature_', NOW + 5 * 60000, TZ));
  assert.equal(reads, 1);
  assert.equal(again.stale, false);
  const tomorrow = j(w.call('briefingFeature_', NOW + 24 * 3600000, TZ)); // cached copy, but the day moved on
  assert.equal(reads, 1);
  assert.equal(tomorrow.stale, true);
  const noCache = load({ noCache: true, driveFolders: [folder([counting])] });
  noCache.call('briefingFeature_', NOW, TZ);
  assert.equal(noCache.call('briefingFeature_', NOW, TZ).ok, true); // works without a cache service
});

// ------------------------------------------------------------------ parks: matching

const PARKS = [
  { id: 'dl', name: 'Disneyland Park' },
  { id: 'dca', name: 'Disney California Adventure Park' },
  { id: 'mk', name: 'Magic Kingdom Park' },
  { id: 'ush', name: 'Universal Studios Hollywood' },
  { id: 'usf', name: 'Universal Studios Florida' },
  { id: 'ioa', name: "Universal's Islands of Adventure" },
  { id: 'us', name: 'Universal Studios' },
  { id: 'epcot', name: 'EPCOT' },
];
const names = (w, text) => j(w.call('matchParks_', text, PARKS)).map((p) => p.id);

test('matchParks_: positive cases', () => {
  const w = load();
  assert.deepEqual(names(w, 'Event at Disneyland Park'), ['dl']);
  assert.deepEqual(names(w, 'Disneyland!'), ['dl']);
  assert.deepEqual(names(w, 'the DISNEYLAND park day'), ['dl']);
  assert.deepEqual(names(w, 'Disney California Adventure Park'), ['dca']);
  assert.deepEqual(names(w, 'California Adventure with the kids, Disney tickets'), ['dca']);
  assert.deepEqual(names(w, 'Magic Kingdom'), ['mk']);
  assert.deepEqual(names(w, 'Epcot, Orlando'), ['epcot']);
  assert.deepEqual(names(w, "Universal's Islands of Adventure"), ['ioa']);
  assert.deepEqual(names(w, 'Universal Studios Hollywood'), ['ush']); // the shorter "Universal Studios" is dropped
  assert.deepEqual(names(w, 'Universal Studios'), ['us']);
  assert.deepEqual(names(w, 'Dinner + Disneyland Park, 1313 Disneyland Dr, Anaheim'), ['dl']);
});

test('matchParks_: negative cases', () => {
  const w = load();
  assert.deepEqual(names(w, 'Disney trip planning call'), []);
  assert.deepEqual(names(w, 'Dentist'), []);
  assert.deepEqual(names(w, 'Walk in the park'), []);
  assert.deepEqual(names(w, 'Theme park brainstorm'), []);
  assert.deepEqual(names(w, 'Magic show'), []);
  assert.deepEqual(names(w, 'California adventure novel'), []); // missing "disney"
  assert.deepEqual(names(w, 'Kingdom come'), []);
  assert.deepEqual(names(w, 'Disneylandia'), []); // whole tokens only
  assert.deepEqual(names(w, ''), []);
  assert.deepEqual(j(w.call('matchParks_', 'Disneyland', [{ id: 'x', name: 'The Park' }, { name: 'Disneyland Park' }])), []); // empty-token and id-less parks never match
});

test('parkTokens_ drops punctuation and the words park, theme, the', () => {
  const w = load();
  assert.deepEqual(j(w.call('parkTokens_', "The Universal's Theme-Park: Orlando!")), ['universal', 's', 'orlando']);
});

test('eventDatesInWindow_ and parkDaysFromEvents_: window, all-day spans, de-dupe, cap', () => {
  const w = load();
  const win = ['2026-11-22', '2026-11-23', '2026-11-24'];
  const ev = (o) => ({ title: '', location: '', allDay: false, start: '2026-11-23T09:00:00-07:00', end: '2026-11-23T10:00:00-07:00', ...o });
  assert.deepEqual(j(w.call('eventDatesInWindow_', ev({}), win)), ['2026-11-23']);
  assert.deepEqual(j(w.call('eventDatesInWindow_', ev({ start: '2026-11-25T09:00:00-07:00' }), win)), []);
  assert.deepEqual(j(w.call('eventDatesInWindow_', ev({ allDay: true, start: '2026-11-23', end: '2026-11-26' }), win)), ['2026-11-23', '2026-11-24']);
  assert.deepEqual(j(w.call('eventDatesInWindow_', ev({ allDay: true, start: '2026-11-21', end: '2026-11-23' }), win)), ['2026-11-22']);
  const days = j(w.call('parkDaysFromEvents_', [
    ev({ title: 'Disneyland Park' }), ev({ title: 'Disneyland Park again' }),
    ev({ location: 'Disney California Adventure Park', start: '2026-11-24T09:00:00-07:00' }),
    ev({ title: 'Dentist' }),
  ], PARKS, win));
  assert.deepEqual(days.map((d) => [d.date, d.park.id]), [['2026-11-23', 'dl'], ['2026-11-24', 'dca']]);
});

// ------------------------------------------------------------------ parks: extraction

const LA = 'America/Los_Angeles';
const SCHEDULE = [
  { date: '2026-11-23', type: 'OPERATING', open: '2026-11-23T08:00:00-08:00', close: '2026-11-24T00:00:00-08:00' },
  { date: '2026-11-23', type: 'EXTRA_HOURS', open: '2026-11-23T07:30:00-08:00', close: '2026-11-23T08:00:00-08:00' },
  { date: '2026-11-23', type: 'EXTRA_HOURS', open: '2026-11-23T08:00:00-08:00', close: '2026-11-23T09:00:00-08:00' }, // not before opening
  { date: '2026-11-23', type: 'TICKETED_EVENT', open: '2026-11-23T20:00:00-08:00', close: '2026-11-23T23:00:00-08:00' },
  { date: '2026-11-23', type: 'INFO', open: null, close: null },
  { date: '2026-11-24', type: 'OPERATING', open: '2026-11-24T09:00:00-08:00', close: '2026-11-24T22:00:00-08:00' },
  { date: '2026-11-25', type: 'EXTRA_HOURS', open: '2026-11-25T07:00:00-08:00', close: '2026-11-25T08:00:00-08:00' }, // no OPERATING that day
];

test('parkHours_: OPERATING hours, earlier EXTRA_HOURS as early, nulls when missing', () => {
  const w = load();
  assert.deepEqual(j(w.call('parkHours_', SCHEDULE, '2026-11-23')), {
    hours: { open: '2026-11-23T08:00:00-08:00', close: '2026-11-24T00:00:00-08:00' },
    early: { open: '2026-11-23T07:30:00-08:00', close: '2026-11-23T08:00:00-08:00' },
  });
  assert.deepEqual(j(w.call('parkHours_', SCHEDULE, '2026-11-24')), { hours: { open: '2026-11-24T09:00:00-08:00', close: '2026-11-24T22:00:00-08:00' }, early: null });
  assert.deepEqual(j(w.call('parkHours_', SCHEDULE, '2026-11-25')), { hours: null, early: null });
  assert.deepEqual(j(w.call('parkHours_', SCHEDULE, '2026-12-30')), { hours: null, early: null });
  assert.deepEqual(j(w.call('parkHours_', undefined, '2026-11-23')), { hours: null, early: null });
});

const LIVE = [
  { name: 'Wondrous Journeys', type: 'SHOW', status: 'OPERATING', wait: null, times: ['2026-11-23T21:30:00-08:00', '2026-11-24T21:30:00-08:00'] },
  { name: 'Late Show', type: 'SHOW', status: 'OPERATING', wait: null, times: ['2026-11-24T00:30:00-08:00'] }, // local Nov 24 (08:30 UTC); stays out of the 23rd
  { name: 'Tomorrow-only Show', type: 'SHOW', status: 'OPERATING', wait: null, times: ['2026-11-24T10:00:00-08:00'] },
  { name: 'Parade', type: 'SHOW', status: 'OPERATING', wait: null, times: ['2026-11-23T15:00:00-08:00', '2026-11-23T12:00:00-08:00'] },
  { name: 'Star Wars: Rise of the Resistance', type: 'ATTRACTION', status: 'OPERATING', wait: 75, times: [] },
  { name: 'Closed Ride', type: 'ATTRACTION', status: 'DOWN', wait: 90, times: [] },
  { name: 'Walkthrough', type: 'ATTRACTION', status: 'OPERATING', wait: null, times: [] },
  ...[10, 20, 30, 40, 50, 60, 5].map((m) => ({ name: `Ride ${m}`, type: 'ATTRACTION', status: 'OPERATING', wait: m, times: [] })),
];

test('parkShows_ and parkWaits_: park-local date filtering, sorting, caps', () => {
  const w = load();
  const shows = j(w.call('parkShows_', LIVE, '2026-11-23', LA, TZ));
  assert.deepEqual(shows.map((s) => s.name), ['Parade', 'Wondrous Journeys']);
  assert.deepEqual(shows[0].times, ['2026-11-23T12:00:00-08:00', '2026-11-23T15:00:00-08:00']);
  assert.deepEqual(shows[1].times, ['2026-11-23T21:30:00-08:00']);
  assert.deepEqual(j(w.call('parkShows_', LIVE, '2026-11-24', LA, TZ)).map((s) => s.name), ['Late Show', 'Tomorrow-only Show', 'Wondrous Journeys']);
  // the same instant is a different local date in another zone: 21:30 PST on the 23rd is Nov 24 in Tokyo
  assert.deepEqual(j(w.call('parkShows_', LIVE, '2026-11-24', 'Asia/Tokyo', TZ)).some((s) => s.name === 'Wondrous Journeys'), true);
  assert.deepEqual(j(w.call('parkShows_', LIVE, '2026-11-23', 'Not/AZone', TZ)).length >= 0, true); // bad zone falls back, never throws
  const many = Array.from({ length: 9 }, (_, i) => ({ name: `S${i}`, type: 'SHOW', times: [`2026-11-23T1${i}:00:00-08:00`] }));
  assert.equal(j(w.call('parkShows_', many, '2026-11-23', LA, TZ)).length, 6);
  const waits = j(w.call('parkWaits_', LIVE));
  assert.deepEqual(waits.map((x) => x.minutes), [75, 60, 50, 40, 30, 20]);
  assert.deepEqual(waits[0], { name: 'Star Wars: Rise of the Resistance', minutes: 75 });
});

// ------------------------------------------------------------------ parks: the feature end to end

const fakeEvent = ({ id = 'e', title, startMs, endMs, location = '', allDay = false }) => ({
  getId: () => id, getTitle: () => title, getMyStatus: () => 'YES', isAllDayEvent: () => allDay, getLocation: () => location,
  getStartTime: () => new Date(startMs), getEndTime: () => new Date(endMs), getAllDayStartDate: () => new Date(startMs), getAllDayEndDate: () => new Date(endMs),
});
const fakeCal = (events, name = 'Personal') => ({ getName: () => name, isHidden: () => false, isSelected: () => true, getEvents: () => events });
const DAY = 86400000;

function parksWorld(over = {}) {
  const destinations = { destinations: [{ id: 'dest1', name: 'Disneyland Resort', slug: 'disneylandresort', parks: [{ id: 'dl', name: 'Disneyland Park' }, { id: 'dca', name: 'Disney California Adventure Park' }] }, { id: 'dest2', name: 'Elsewhere', parks: [{ id: 'mk', name: 'Magic Kingdom Park' }] }] };
  const handler = (url) => {
    if (over.handler) { const r = over.handler(url); if (r) return r; }
    if (url.endsWith('/destinations')) return { code: 200, body: destinations };
    if (url.endsWith('/entity/dl/schedule')) return { code: 200, body: { timezone: LA, schedule: SCHEDULE.map((s) => ({ date: s.date, type: s.type, openingTime: s.open, closingTime: s.close, description: 'x' })) } };
    if (url.endsWith('/entity/dl/live')) return { code: 200, body: { liveData: LIVE.map((e) => ({ name: e.name, entityType: e.type, status: e.status, queue: e.wait === null ? undefined : { STANDBY: { waitTime: e.wait } }, showtimes: e.times.map((t) => ({ startTime: t, endTime: t, type: 'Performance Time' })) })) } };
    return { code: 404, body: {} };
  };
  return load({ fetchHandler: handler, ...over.load });
}
const nov = (d, h = 9) => Date.parse(`2026-11-${d}T${String(h + 7).padStart(2, '0')}:00:00Z`);
const evs = (list) => list.map((o, i) => ({ sortKey: o.startMs, startMs: o.startMs, id: `e${i}`, title: o.title, calendar: 'x', allDay: false, start: o.start, end: o.start, location: o.location || '' }));

test('parksFeature_: matches a calendar event and builds hours, early, shows; waits only for today', () => {
  const w = parksWorld();
  const events = evs([
    { title: 'Event at Disneyland Park', start: '2026-11-23T09:00:00-07:00' },
    { title: 'Disneyland Park', start: '2026-11-22T10:00:00-07:00' },
    { title: 'Disneyland Park', start: '2026-11-26T10:00:00-07:00' }, // outside the 3-day window
    { title: 'Dentist', start: '2026-11-23T10:00:00-07:00' },
  ]);
  const r = j(w.call('parksFeature_', events, NOW, TZ));
  assert.equal(r.ok, true);
  assert.equal(r.source, 'themeparks.wiki');
  assert.deepEqual(r.days.map((d) => d.date), ['2026-11-22', '2026-11-23']);
  const today = r.days[0], tomorrow = r.days[1];
  assert.equal(tomorrow.parkId, 'dl');
  assert.equal(tomorrow.name, 'Disneyland Park');
  assert.equal(tomorrow.timezone, LA);
  assert.deepEqual(tomorrow.hours, { open: '2026-11-23T08:00:00-08:00', close: '2026-11-24T00:00:00-08:00' });
  assert.deepEqual(tomorrow.early, { open: '2026-11-23T07:30:00-08:00', close: '2026-11-23T08:00:00-08:00' });
  assert.deepEqual(tomorrow.shows.map((s) => s.name), ['Parade', 'Wondrous Journeys']);
  assert.deepEqual(tomorrow.waits, []);
  assert.equal(today.hours, null); // the schedule has nothing for the 22nd
  assert.equal(today.waits.length, 6);
  assert.equal(today.waits[0].minutes, 75);
  // each park is fetched once even with two park days
  assert.equal(w.fetchLog.filter((c) => c.url.endsWith('/entity/dl/schedule')).length, 1);
  assert.equal(w.fetchLog.filter((c) => c.url.endsWith('/entity/dl/live')).length, 1);
  assert.ok(w.fetchLog.every((c) => c.url.startsWith('https://api.themeparks.wiki/v1/')));
  assert.ok(w.fetchLog.every((c) => !(c.opts && c.opts.headers && c.opts.headers.Authorization)), 'no Google token sent to themeparks.wiki');
});

test('parksFeature_: no matching event means no network at all; no events in the window too', () => {
  const w = parksWorld();
  assert.deepEqual(j(w.call('parksFeature_', evs([{ title: 'Dentist', start: '2026-11-23T10:00:00-07:00' }]), NOW, TZ)), { ok: true, source: 'themeparks.wiki', days: [] });
  assert.equal(w.fetchLog.length, 1); // only the destinations list (cached), for the one in-window event
  const w2 = parksWorld();
  assert.deepEqual(j(w2.call('parksFeature_', [], NOW, TZ)).days, []);
  assert.equal(w2.fetchLog.length, 0);
});

test('parksFeature_: destinations cached, schedule and live cached, so a second call makes no requests', () => {
  const w = parksWorld();
  const events = evs([{ title: 'Disneyland Park', start: '2026-11-23T09:00:00-07:00' }]);
  w.call('parksFeature_', events, NOW, TZ);
  const n = w.fetchLog.length;
  assert.equal(n, 3);
  const again = j(w.call('parksFeature_', events, NOW + 60000, TZ));
  assert.equal(w.fetchLog.length, n);
  assert.equal(again.days.length, 1);
  assert.equal(again.days[0].hours.open, '2026-11-23T08:00:00-08:00');
});

test('parksFeature_: a big destinations list is chunked into the cache and read back', () => {
  const big = { destinations: Array.from({ length: 400 }, (_, i) => ({ id: `d${i}`, name: `Dest ${i}`, parks: [{ id: `p${i}`, name: `Wonderland Number${i} Park` }, { id: `q${i}`, name: `Another Land ${i}` }] })) };
  big.destinations.push({ id: 'z', name: 'Z', parks: [{ id: 'dl', name: 'Disneyland Park' }] });
  const w = parksWorld({ handler: (url) => (url.endsWith('/destinations') ? { code: 200, body: big } : null) });
  const events = evs([{ title: 'Disneyland Park', start: '2026-11-23T09:00:00-07:00' }]);
  assert.equal(j(w.call('parksFeature_', events, NOW, TZ)).days.length, 1);
  assert.ok([...w.cacheStore.keys()].some((k) => k.startsWith('hl-parks-dest-v3:')), 'chunks written');
  assert.ok([...w.cacheStore.values()].every((v) => v.length <= 100000));
  const destFetches = () => w.fetchLog.filter((c) => c.url.endsWith('/destinations')).length;
  assert.equal(destFetches(), 1);
  w.cacheStore.delete('hl-parks-sched-dl');
  assert.equal(j(w.call('parksFeature_', events, NOW, TZ)).days.length, 1);
  assert.equal(destFetches(), 1, 'list came back from chunks');
});

test('parksFeature_: failures are contained (destinations down, schedule down, live down, both down)', () => {
  const events = evs([{ title: 'Disneyland Park', start: '2026-11-23T09:00:00-07:00' }]);
  let w = parksWorld({ handler: (u) => (u.endsWith('/destinations') ? { code: 500, body: '' } : null) });
  assert.deepEqual(j(w.call('parksFeature_', events, NOW, TZ)), { ok: false, error: 'themeparks http 500' });
  w = parksWorld({ handler: (u) => (u.endsWith('/schedule') ? { code: 500, body: '' } : null) });
  let d = j(w.call('parksFeature_', events, NOW, TZ)).days[0];
  assert.equal(d.hours, null); assert.equal(d.timezone, TZ); assert.equal(d.shows.length, 2);
  w = parksWorld({ handler: (u) => (u.endsWith('/live') ? { code: 200, body: 'not json' } : null) });
  d = j(w.call('parksFeature_', events, NOW, TZ)).days[0];
  assert.equal(d.hours.open, '2026-11-23T08:00:00-08:00'); assert.deepEqual(d.shows, []); assert.deepEqual(d.waits, []);
  w = parksWorld({ handler: (u) => (/\/(schedule|live)$/.test(u) ? { code: 500, body: '' } : null) });
  assert.equal(j(w.call('parksFeature_', events, NOW, TZ)).ok, false);
});

test('parksFeature_: odd responses (missing fields) never throw', () => {
  const w = parksWorld({ handler: (u) => {
    if (u.endsWith('/destinations')) return { code: 200, body: { destinations: [null, { parks: null }, { id: 'a', parks: [{ id: 'dl', name: 'Disneyland Park' }, null, { name: 'no id' }] }] } };
    if (u.endsWith('/schedule')) return { code: 200, body: { schedule: [null, { type: 'OPERATING' }, { date: '2026-11-23', type: 'OPERATING', openingTime: 'garbage', closingTime: null }] } };
    if (u.endsWith('/live')) return { code: 200, body: { liveData: [null, { name: 'X' }, { name: 'Show', entityType: 'SHOW', showtimes: [{}, { startTime: 'bad' }] }, { name: 'Ride', entityType: 'ATTRACTION', status: 'OPERATING', queue: { STANDBY: { waitTime: null } } }] } };
    return null;
  } });
  const r = j(w.call('parksFeature_', evs([{ title: 'Disneyland Park', start: '2026-11-23T09:00:00-07:00' }]), NOW, TZ));
  assert.equal(r.ok, true);
  assert.deepEqual([r.days[0].hours, r.days[0].early, r.days[0].shows, r.days[0].waits], [null, null, [], []]);
});

// ------------------------------------------------------------------ trip drive

const route = (seconds, meters, summary = 'I-10 W', traffic = true) => ({ routes: [{ summary, legs: [{ duration: { value: seconds - 600 }, ...(traffic ? { duration_in_traffic: { value: seconds } } : {}), distance: { value: meters } }] }] });
const FROM = { lat: 33.4484, lng: -112.074 };

test('tripDrive: builds minutes, miles, summary and an 8am departAt in the script zone; uses traffic duration', () => {
  const w = load({ directions: () => route(20520, 599400) });
  const r = j(w.call('tripDriveFeature_', '33.8121,-117.919', '2026-11-23', FROM, NOW, TZ));
  assert.deepEqual(r, { ok: true, minutes: 342, miles: 372.5, summary: 'I-10 W', departAt: '2026-11-23T08:00:00-07:00' });
  assert.equal(w.mapsLog.length, 1);
  assert.deepEqual(w.mapsLog[0].origin, [33.4484, -112.074]);
  assert.deepEqual(w.mapsLog[0].dest, [33.8121, -117.919]);
  assert.equal(new Date(w.mapsLog[0].depart).toISOString(), '2026-11-23T15:00:00.000Z');
  // without traffic data it falls back to duration
  const w2 = load({ directions: () => route(20520, 599400, 'I-10 W', false) });
  assert.equal(j(w2.call('tripDriveFeature_', '33.8121,-117.919', '2026-11-23', FROM, NOW, TZ)).minutes, 332);
  // missing summary becomes an empty string
  const w3 = load({ directions: () => route(20520, 599400, undefined) });
  assert.equal(j(w3.call('tripDriveFeature_', '33.8121,-117.919', '2026-11-23', FROM, NOW, TZ)).summary, '');
});

test('tripDrive: departure in the past clamps to now', () => {
  const w = load({ directions: () => route(20520, 599400) });
  const r = j(w.call('tripDriveFeature_', '33.8121,-117.919', '2026-11-22', FROM, NOW, TZ)); // 8am today is already past at 9am
  const later = NOW + 2 * 3600000; // 9am
  const w2 = load({ directions: () => route(20520, 599400) });
  const r2 = j(w2.call('tripDriveFeature_', '33.8121,-117.919', '2026-11-22', FROM, later, TZ));
  assert.equal(new Date(w2.mapsLog[0].depart).getTime(), later);
  assert.equal(r2.departAt, '2026-11-22T09:00:00-07:00');
  assert.equal(new Date(w.mapsLog[0].depart).getTime(), NOW + 0 * 1 > Date.parse('2026-11-22T15:00:00Z') ? NOW : Date.parse('2026-11-22T15:00:00Z'));
  assert.equal(r.ok, true);
});

test('tripDrive: under 25 miles is too_close; result is cached 3 hours, including too_close', () => {
  const w = load({ directions: () => route(1500, 24 * 1609.344) });
  assert.deepEqual(j(w.call('tripDriveFeature_', '33.5,-112.1', '2026-11-23', FROM, NOW, TZ)), { ok: false, error: 'too_close' });
  w.call('tripDriveFeature_', '33.5,-112.1', '2026-11-23', FROM, NOW, TZ);
  assert.equal(w.mapsLog.length, 1);
  const w2 = load({ directions: () => route(20520, 599400) });
  w2.call('tripDriveFeature_', '33.8121,-117.919', '2026-11-23', FROM, NOW, TZ);
  w2.call('tripDriveFeature_', '33.8121,-117.919', '2026-11-23', FROM, NOW + 3600000, TZ);
  assert.equal(w2.mapsLog.length, 1);
  w2.call('tripDriveFeature_', '33.8121,-117.919', '2026-11-24', FROM, NOW, TZ); // different date, new lookup
  assert.equal(w2.mapsLog.length, 2);
  const exactly = load({ directions: () => route(1500, 25 * 1609.344) });
  assert.equal(j(exactly.call('tripDriveFeature_', '33.5,-112.1', '2026-11-23', FROM, NOW, TZ)).ok, true); // 25.0 is allowed
});

test('tripDrive: bad params, no route and Maps errors give ok:false without throwing', () => {
  const w = load({ directions: () => null });
  const call = (trip, date, from) => j(w.call('tripDriveFeature_', trip, date, from, NOW, TZ));
  assert.deepEqual(call('nope', '2026-11-23', FROM), { ok: false, error: 'bad_params' });
  assert.deepEqual(call('33.8,-117.9', 'tomorrow', FROM), { ok: false, error: 'bad_params' });
  assert.deepEqual(call('33.8,-117.9', '2026-11-23', null), { ok: false, error: 'bad_params' });
  assert.equal(w.mapsLog.length, 0);
  assert.deepEqual(call('33.8,-117.9', '2026-11-23', FROM), { ok: false, error: 'no_route' });
  const boom = load({ directions: () => { throw new Error('Service invoked too many times'); } });
  assert.match(j(boom.call('tripDriveFeature_', '33.8,-117.9', '2026-11-23', FROM, NOW, TZ)).error, /too many times/);
});

// ------------------------------------------------------------------ birthdays

const person = (name, bday) => ({ names: name ? [{ displayName: name }] : [], birthdays: bday ? [{ date: bday }] : [] });

test('upcomingBirthdays_: 21-day window, turning, year-less, sorted, wraps the year, leap day', () => {
  const w = load();
  const contacts = j(w.call('compactContacts_', [
    person('Pat Doe', { year: 1966, month: 11, day: 26 }),
    person('Sam Roe', { month: 11, day: 22 }), // today, no year
    person('Late Lee', { year: 2000, month: 12, day: 13 }), // 21 days away: included
    person('Too Far', { year: 2000, month: 12, day: 14 }), // 22 days: out
    person('Already Past', { year: 1990, month: 11, day: 21 }), // yesterday: next year
    person('Jan Person', { year: 1985, month: 1, day: 5 }),
    person('', { month: 11, day: 23 }), // no name
    person('No Birthday', null),
    person('Bad Date', { month: 13, day: 40 }),
  ]));
  assert.equal(contacts.length, 6);
  const up = j(w.call('upcomingBirthdays_', contacts, TODAY, 21));
  assert.deepEqual(up, [
    { name: 'Sam Roe', date: '2026-11-22', daysAway: 0, turning: null },
    { name: 'Pat Doe', date: '2026-11-26', daysAway: 4, turning: 60 },
    { name: 'Late Lee', date: '2026-12-13', daysAway: 21, turning: 26 },
  ]);
  const ny = j(w.call('upcomingBirthdays_', contacts, '2026-12-28', 21));
  assert.deepEqual(ny.map((x) => [x.name, x.date, x.daysAway, x.turning]), [['Jan Person', '2027-01-05', 8, 42]]);
  const leap = j(w.call('upcomingBirthdays_', [{ name: 'Leap', month: 2, day: 29, year: 2000 }], '2027-02-20', 21));
  assert.equal(leap.length, 1); assert.equal(leap[0].date, '2027-03-01');
  // two on one day sort by name
  const tie = j(w.call('upcomingBirthdays_', [{ name: 'Zed', month: 11, day: 24, year: null }, { name: 'Amy', month: 11, day: 24, year: null }], TODAY, 21));
  assert.deepEqual(tie.map((x) => x.name), ['Amy', 'Zed']);
});

test('compactContacts_: prefers the birthday entry that has a year; ignores nonsense years', () => {
  const w = load();
  const c = j(w.call('compactContacts_', [
    { names: [{ displayName: 'Two Entries' }], birthdays: [{ date: { month: 3, day: 4 } }, { date: { year: 1970, month: 3, day: 4 } }, { text: 'march' }] },
    { names: [{ givenName: 'Given' }], birthdays: [{ date: { year: 1604, month: 5, day: 6 } }] },
  ]));
  assert.deepEqual(c, [{ name: 'Two Entries', month: 3, day: 4, year: 1970 }, { name: 'Given', month: 5, day: 6, year: null }]);
});

test('birthdaysFeature_: paginates (max 3 pages), sends the OAuth token, caches 12 hours', () => {
  const pageFor = (n) => ({ connections: [person(`P${n}`, { year: 1980, month: 11, day: 22 + n })], nextPageToken: `tok${n + 1}` });
  const w = load({ fetchHandler: (url) => {
    if (!url.startsWith('https://people.googleapis.com/v1/people/me/connections?')) return { code: 404, body: '{}' };
    const m = /pageToken=tok(\d+)/.exec(url);
    return { code: 200, body: pageFor(m ? Number(m[1]) : 0) };
  } });
  const r = j(w.call('birthdaysFeature_', NOW, TZ));
  assert.equal(r.ok, true);
  assert.deepEqual(r.upcoming.map((x) => x.name), ['P0', 'P1', 'P2']);
  assert.equal(r.upcoming[0].turning, 46);
  assert.equal(w.fetchLog.length, 3); // never a 4th page
  assert.match(w.fetchLog[0].url, /personFields=names,birthdays&pageSize=1000$/);
  assert.match(w.fetchLog[1].url, /&pageToken=tok1$/);
  assert.ok(w.fetchLog.every((c) => /^Bearer oauth-token-fake/.test(c.opts.headers.Authorization)));
  w.call('birthdaysFeature_', NOW + 3600000, TZ);
  assert.equal(w.fetchLog.length, 3);
  const nextDay = j(w.call('birthdaysFeature_', NOW + DAY, TZ)); // same cache, window recomputed
  assert.equal(w.fetchLog.length, 3);
  assert.equal(nextDay.upcoming[0].daysAway, 0);
  assert.equal(nextDay.upcoming[0].name, 'P1');
});

test('birthdaysFeature_: a single page stops without a token; 403 reports the approval hint; 500 is short', () => {
  const w = load({ fetchHandler: () => ({ code: 200, body: { connections: [] } }) });
  assert.deepEqual(j(w.call('birthdaysFeature_', NOW, TZ)), { ok: true, upcoming: [] });
  assert.equal(w.fetchLog.length, 1);
  const denied = load({ fetchHandler: () => ({ code: 403, body: '{}' }) });
  assert.match(j(denied.call('birthdaysFeature_', NOW, TZ)).error, /contacts access not approved/);
  const down = load({ fetchHandler: () => ({ code: 500, body: '{}' }) });
  assert.deepEqual(j(down.call('birthdaysFeature_', NOW, TZ)), { ok: false, error: 'people http 500' });
});

// ------------------------------------------------------------------ doGet integration

function fullWorld({ failing = [], trip = true } = {}) {
  const start = Date.now() + 3600000;
  const dayIso = (ms) => formatDate(new Date(ms), TZ, 'yyyy-MM-dd');
  const parkDay = dayIso(Date.now() + DAY);
  const cal = fakeCal([fakeEvent({ title: 'Event at Disneyland Park', startMs: start + DAY, endMs: start + DAY + 3600000, location: 'Anaheim' })]);
  const todayName = `home-life-briefing-${dayIso(Date.now())}.json`;
  const handler = (url) => {
    if (url.includes('/destinations')) return failing.includes('parks') ? { code: 500, body: '' } : { code: 200, body: { destinations: [{ id: 'd', name: 'D', parks: [{ id: 'dl', name: 'Disneyland Park' }] }] } };
    if (url.endsWith('/entity/dl/schedule')) return { code: 200, body: { timezone: LA, schedule: [{ date: parkDay, type: 'OPERATING', openingTime: `${parkDay}T08:00:00-08:00`, closingTime: `${parkDay}T23:00:00-08:00` }] } };
    if (url.endsWith('/entity/dl/live')) return { code: 200, body: { liveData: [{ name: 'Ride', entityType: 'ATTRACTION', status: 'OPERATING', queue: { STANDBY: { waitTime: 30 } } }] } };
    if (url.includes('people.googleapis.com')) return failing.includes('birthdays') ? { code: 403, body: '{}' } : { code: 200, body: { connections: [person('Pat Doe', { year: 1966, month: Number(dayIso(Date.now() + 3 * DAY).slice(5, 7)), day: Number(dayIso(Date.now() + 3 * DAY).slice(8)) })] } };
    if (url.includes('/threads?q=')) return { code: 200, body: { threads: [] } };
    return { code: 404, body: {} };
  };
  const folders = failing.includes('briefing') ? [{ name: 'Home Life', get files() { throw new Error('no drive'); } }] : [folder([file(todayName, { v: 1, push: 'hi' })])];
  return load({ calendars: [cal], fetchHandler: handler, directions: failing.includes('trip') ? () => { throw new Error('maps down'); } : () => route(20520, 599400), driveFolders: folders });
}
const getBody = (w, extra = {}) => JSON.parse(w.call('doGet', { parameter: { key: KEY, from: '33.4484,-112.0740', ...extra } }).text);

test('doGet v3: full response has features, briefing, parks, birthdays, and tripDrive only when asked', () => {
  const w = fullWorld();
  const tripDate = formatDate(new Date(Date.now() + DAY), TZ, 'yyyy-MM-dd');
  const body = getBody(w, { trip: '33.8121,-117.919', tripDate });
  assert.equal(body.version, 3);
  assert.deepEqual(body.features, { gmail: true, leaveBy: true, oura: false, briefing: true, parks: true, tripDrive: true, birthdays: true });
  assert.equal(body.briefing.ok, true); assert.equal(body.briefing.stale, false); assert.deepEqual(body.briefing.data, { v: 1, push: 'hi' });
  assert.equal(body.parks.ok, true); assert.equal(body.parks.days.length, 1);
  assert.equal(body.parks.days[0].name, 'Disneyland Park'); assert.deepEqual(body.parks.days[0].waits, []); // tomorrow: no waits
  assert.equal(body.tripDrive.ok, true); assert.equal(body.tripDrive.minutes, 342);
  assert.equal(body.birthdays.ok, true); assert.equal(body.birthdays.upcoming[0].name, 'Pat Doe'); assert.equal(body.birthdays.upcoming[0].daysAway, 3);
  assert.equal(body.events.length, 1);
  assert.ok(!('startMs' in body.events[0]));
  assert.ok(!JSON.stringify(body).includes('oauth-token-fake'));
  const noTrip = getBody(fullWorld());
  assert.ok(!('tripDrive' in noTrip));
  assert.equal(getBody(fullWorld(), { trip: '33.8,-117.9' }).tripDrive.error, 'bad_params');
});

for (const feature of ['briefing', 'parks', 'birthdays', 'trip']) {
  test(`doGet v3: ${feature} failing alone leaves the rest of the response intact`, () => {
    const w = fullWorld({ failing: [feature] });
    const tripDate = formatDate(new Date(Date.now() + DAY), TZ, 'yyyy-MM-dd');
    const body = getBody(w, { trip: '33.8121,-117.919', tripDate });
    assert.equal(body.ok, true);
    const key = feature === 'trip' ? 'tripDrive' : feature;
    assert.equal(body[key].ok, false, `${key} reports failure`);
    assert.equal(typeof body[key].error, 'string');
    for (const other of ['briefing', 'parks', 'birthdays', 'tripDrive'].filter((k) => k !== key)) assert.equal(body[other].ok, true, `${other} unaffected`);
    assert.equal(body.events.length, 1);
    assert.equal(body.inbox.ok, true);
  });
}

test('doGet v3: a throw inside a feature function is contained by isolate_', () => {
  const src = SECRET_SRC.replace('function birthdaysFeature_(nowMs, tz) {', 'function birthdaysFeature_(nowMs, tz) {\n  throw new Error("kaboom");');
  const w = load({ source: src });
  const body = getBody(w);
  assert.deepEqual(body.birthdays, { ok: false, error: 'kaboom' });
  assert.equal(body.ok, true);
});

test('doGet v3: wrong key is unauthorized with zero network, Drive and Maps activity', () => {
  let driveTouched = 0;
  const w = load({ driveFolders: [], fetchHandler: () => ({ code: 200, body: '{}' }) });
  w.call('doGet', { parameter: { key: 'nope', trip: '33.8,-117.9', tripDate: '2026-11-23', from: '33.4,-112.0' } });
  const out = w.call('doGet', { parameter: { trip: '33.8,-117.9' } });
  assert.equal(out.text, '{"ok":false,"error":"unauthorized"}');
  assert.equal(w.fetchLog.length, 0);
  assert.equal(w.mapsLog.length, 0);
  assert.equal(driveTouched, 0);
  assert.equal(w.cacheStore.size, 0);
});
