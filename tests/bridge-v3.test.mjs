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

/** DriveApp fake: searchFiles understands the title = '...' / title contains '...' and trashed = false parts of the bridge's query. */
function driveApp(driveFolders, world) {
  world.drive = { searches: [], getNames: 0, parentCalls: 0, blobReads: 0, lastUpdatedCalls: 0 };
  const all = () => driveFolders.flatMap((f) => (f.files || []).map((file) => ({ file, folder: f })));
  return {
    searchFiles(q) {
      world.drive.searches.push(q);
      const exact = [...q.matchAll(/title = '([^']+)'/g)].map((m) => m[1]);
      const contains = [...q.matchAll(/title contains '([^']+)'/g)].map((m) => m[1]);
      const rows = all().filter(({ file, folder }) => {
        const name = file.getName();
        if (exact.length && !exact.includes(name)) return false;
        if (contains.length && !contains.every((c) => name.includes(c))) return false;
        if (/trashed = false/.test(q) && ((file.isTrashed && file.isTrashed()) || folder.trashed)) return false;
        return true;
      });
      const wrapped = rows.map(({ file, folder }) => ({
        getName: () => { world.drive.getNames++; return file.getName(); },
        getLastUpdated: () => { world.drive.lastUpdatedCalls++; return file.getLastUpdated(); },
        getBlob: () => { world.drive.blobReads++; return file.getBlob(); },
        getParents: () => { world.drive.parentCalls++; return iter([{ getName: () => folder.name, isTrashed: () => !!folder.trashed }]); },
      }));
      return iter(wrapped);
    },
  };
}

function load({ source = SECRET_SRC, calendars = [], fetchHandler = () => ({ code: 404, body: '{}' }), directions = () => null, driveFolders = [], noCache = false } = {}) {
  const cacheStore = new Map();
  const world = { fetchLog: [], mapsLog: [], cacheStore };
  const resp = (r) => ({ getResponseCode: () => r.code, getContentText: () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)) });
  const sandbox = {
    Session: { getScriptTimeZone: () => TZ },
    Utilities: { formatDate, getUuid: () => 'uuid', parseDate },
    CacheService: { getScriptCache: () => (noCache ? null : { get: (k) => (cacheStore.has(k) ? cacheStore.get(k) : null), put: (k, v, ttl) => { if (String(v).length > 100000) throw new Error('too big'); if (!(ttl >= 1 && ttl <= 21600)) throw new Error('Argument too large: expirationInSeconds'); cacheStore.set(k, v); }, remove: (k) => { cacheStore.delete(k); } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperties() {}, setProperty() {} }) },
    ScriptApp: { getOAuthToken: () => 'oauth-token-fake-1234567890abcdef', getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/X/exec' }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (text) => ({ text, setMimeType() { return this; } }) },
    HtmlService: { createHtmlOutput: (html) => ({ html, setTitle() { return this; } }) },
    CalendarApp: { getAllCalendars: () => calendars, GuestStatus: { NO: 'NO', YES: 'YES' } },
    DriveApp: driveApp(driveFolders, world),
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
  world.ctx = ctx;
  world.call = (name, ...args) => { ctx.__args = args; return vm.runInContext(`${name}(...__args)`, ctx); };
  return world;
}

const NOW = Date.parse('2027-03-07T14:00:00Z'); // Sunday 7:00am in Denver
const TODAY = '2027-03-07';
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
  assert.deepEqual(pick(['home-life-briefing-2027-03-05.json', 'home-life-briefing-2027-03-07.json', 'home-life-briefing-2027-03-06.json']), { date: '2027-03-07', name: 'home-life-briefing-2027-03-07.json' });
  assert.equal(pick(['home-life-briefing-2027-03-04.json']), null); // 3 days old
  assert.equal(pick(['home-life-briefing-2027-03-05.json']).date, '2027-03-05'); // exactly 2 days old is fine
  assert.equal(pick(['home-life-briefing-2027-03-10.json']), null); // from the future
  assert.equal(pick(['home-life-briefing-2027-03-07.json.txt', 'notes.json', 'home-life-briefing-2027-03-7.json', 'xhome-life-briefing-2027-03-07.json']), null);
  assert.equal(pick([]), null);
});

test('briefing: fresh file is returned with stale false and the data untouched', () => {
  const data = { v: 1, forDate: TODAY, push: 'hi', money: null, fantasy: { error: 'x' } };
  const w = load({ driveFolders: [folder([file('home-life-briefing-2027-03-07.json', data), file('home-life-briefing-2027-03-06.json', { v: 1 })])] });
  const r = j(w.call('briefingFeature_', NOW, TZ));
  assert.deepEqual(r, { ok: true, file: 'home-life-briefing-2027-03-07.json', forDate: TODAY, stale: false, data });
});

test('briefing: yesterday\'s file is stale; 3-day-old and missing are not_found; wrong folder name ignored', () => {
  let w = load({ driveFolders: [folder([file('home-life-briefing-2027-03-06.json', { v: 1 })])] });
  let r = j(w.call('briefingFeature_', NOW, TZ));
  assert.equal(r.ok, true); assert.equal(r.stale, true); assert.equal(r.forDate, '2027-03-06');
  w = load({ driveFolders: [folder([file('home-life-briefing-2027-03-04.json', { v: 1 })])] });
  assert.deepEqual(j(w.call('briefingFeature_', NOW, TZ)), { ok: false, error: 'not_found' });
  w = load({ driveFolders: [] });
  assert.deepEqual(j(w.call('briefingFeature_', NOW, TZ)), { ok: false, error: 'not_found' });
  w = load({ driveFolders: [folder([file('home-life-briefing-2027-03-07.json', { v: 1 })], 'Other')] });
  assert.deepEqual(j(w.call('briefingFeature_', NOW, TZ)), { ok: false, error: 'not_found' });
});

test('briefing: bad JSON (and non-object JSON) report bad_json; Drive errors are short and token-free', () => {
  let w = load({ driveFolders: [folder([file('home-life-briefing-2027-03-07.json', '{nope')])] });
  assert.deepEqual(j(w.call('briefingFeature_', NOW, TZ)), { ok: false, error: 'bad_json' });
  w = load({ driveFolders: [folder([file('home-life-briefing-2027-03-07.json', '[1,2]')])] });
  assert.deepEqual(j(w.call('briefingFeature_', NOW, TZ)), { ok: false, error: 'bad_json' });
  // Drive throwing (scope not approved yet)
  w = load({ driveFolders: [{ name: 'Home Life', get files() { throw new Error('Authorization is required to perform that action.'); } }] });
  const r = j(w.call('briefingFeature_', NOW, TZ));
  assert.equal(r.ok, false);
  assert.match(r.error, /Authorization is required/);
});

test('briefing: trashed files and folders are skipped; the newest copy of a duplicated name wins', () => {
  const at = (name, content, updatedMs, trashed = false) => ({ ...file(name, content), isTrashed: () => trashed, getLastUpdated: () => new Date(updatedMs) });
  const w = load({ driveFolders: [
    folder([at('home-life-briefing-2027-03-07.json', { v: 1, push: 'old run' }, NOW - 7200000), at('home-life-briefing-2027-03-07.json', { v: 1, push: 'new run' }, NOW - 600000), at('home-life-briefing-2027-03-07.json', { v: 1, push: 'trashed' }, NOW, true)]),
  ] });
  assert.equal(j(w.call('briefingFeature_', NOW, TZ)).data.push, 'new run');
  const onlyTrashed = load({ driveFolders: [folder([at('home-life-briefing-2027-03-07.json', { v: 1 }, NOW, true)])] });
  assert.deepEqual(j(onlyTrashed.call('briefingFeature_', NOW, TZ)), { ok: false, error: 'not_found' });
  const trashedFolder = load({ driveFolders: [{ name: 'Home Life', trashed: true, files: [file('home-life-briefing-2027-03-07.json', { v: 1 })] }, folder([file('home-life-briefing-2027-03-06.json', { v: 1, push: 'live folder' })])] });
  const r = j(trashedFolder.call('briefingFeature_', NOW, TZ));
  assert.equal(r.forDate, '2027-03-06'); // today's file sits in a trashed folder, so yesterday's live one is used
  assert.equal(r.stale, true);
});

test('briefing: cached 10 minutes (Drive not read twice); stale flag follows the day, not the cache', () => {
  let reads = 0;
  const f = file('home-life-briefing-2027-03-07.json', { v: 1 });
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
  { id: 'sf', name: 'Starfall Park' },
  { id: 'sva', name: 'Sunrise Valley Adventure Park' },
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
  assert.deepEqual(names(w, 'Event at Starfall Park'), ['sf']);
  assert.deepEqual(names(w, 'Starfall!'), ['sf']);
  assert.deepEqual(names(w, 'the STARFALL park day'), ['sf']);
  assert.deepEqual(names(w, 'Sunrise Valley Adventure Park'), ['sva']);
  assert.deepEqual(names(w, 'Valley Adventure with the kids, Sunrise tickets'), ['sva']);
  assert.deepEqual(names(w, 'Magic Kingdom'), ['mk']);
  assert.deepEqual(names(w, 'Epcot, Orlando'), ['epcot']);
  assert.deepEqual(names(w, "Universal's Islands of Adventure"), ['ioa']);
  assert.deepEqual(names(w, 'Universal Studios Hollywood'), ['ush']); // the shorter "Universal Studios" is dropped
  assert.deepEqual(names(w, 'Universal Studios'), ['us']);
  assert.deepEqual(names(w, 'Dinner + Starfall Park, 1313 Starfall Dr, Seattle'), ['sf']);
});

test('matchParks_: negative cases', () => {
  const w = load();
  assert.deepEqual(names(w, 'Sunrise trip planning call'), []);
  assert.deepEqual(names(w, 'Dentist'), []);
  assert.deepEqual(names(w, 'Walk in the park'), []);
  assert.deepEqual(names(w, 'Theme park brainstorm'), []);
  assert.deepEqual(names(w, 'Magic show'), []);
  assert.deepEqual(names(w, 'Valley adventure novel'), []); // missing "sunrise"
  assert.deepEqual(names(w, 'Kingdom come'), []);
  assert.deepEqual(names(w, 'Starfallia'), []); // whole tokens only
  assert.deepEqual(names(w, ''), []);
  assert.deepEqual(j(w.call('matchParks_', 'Starfall', [{ id: 'x', name: 'The Park' }, { name: 'Starfall Park' }])), []); // empty-token and id-less parks never match
});

test('parkTokens_ drops punctuation and the words park, theme, the', () => {
  const w = load();
  assert.deepEqual(j(w.call('parkTokens_', "The Universal's Theme-Park: Orlando!")), ['universal', 's', 'orlando']);
});

test('eventDatesInWindow_ and parkDaysFromEvents_: window, all-day spans, de-dupe, cap', () => {
  const w = load();
  const win = ['2027-03-07', '2027-03-08', '2027-03-09'];
  const ev = (o) => ({ title: '', location: '', allDay: false, start: '2027-03-08T09:00:00-07:00', end: '2027-03-08T10:00:00-07:00', ...o });
  assert.deepEqual(j(w.call('eventDatesInWindow_', ev({}), win)), ['2027-03-08']);
  assert.deepEqual(j(w.call('eventDatesInWindow_', ev({ start: '2027-03-10T09:00:00-07:00' }), win)), []);
  assert.deepEqual(j(w.call('eventDatesInWindow_', ev({ allDay: true, start: '2027-03-08', end: '2027-03-11' }), win)), ['2027-03-08', '2027-03-09']);
  assert.deepEqual(j(w.call('eventDatesInWindow_', ev({ allDay: true, start: '2027-03-06', end: '2027-03-08' }), win)), ['2027-03-07']);
  const days = j(w.call('parkDaysFromEvents_', [
    ev({ title: 'Starfall Park' }), ev({ title: 'Starfall Park again' }),
    ev({ location: 'Sunrise Valley Adventure Park', start: '2027-03-09T09:00:00-07:00' }),
    ev({ title: 'Dentist' }),
  ], PARKS, win));
  assert.deepEqual(days.map((d) => [d.date, d.park.id]), [['2027-03-08', 'sf'], ['2027-03-09', 'sva']]);
});

// ------------------------------------------------------------------ parks: extraction

const LA = 'America/Los_Angeles';
const SCHEDULE = [
  { date: '2027-03-08', type: 'OPERATING', open: '2027-03-08T08:00:00-08:00', close: '2027-03-09T00:00:00-08:00' },
  { date: '2027-03-08', type: 'EXTRA_HOURS', open: '2027-03-08T07:30:00-08:00', close: '2027-03-08T08:00:00-08:00' },
  { date: '2027-03-08', type: 'EXTRA_HOURS', open: '2027-03-08T08:00:00-08:00', close: '2027-03-08T09:00:00-08:00' }, // not before opening
  { date: '2027-03-08', type: 'TICKETED_EVENT', open: '2027-03-08T20:00:00-08:00', close: '2027-03-08T23:00:00-08:00' },
  { date: '2027-03-08', type: 'INFO', open: null, close: null },
  { date: '2027-03-09', type: 'OPERATING', open: '2027-03-09T09:00:00-08:00', close: '2027-03-09T22:00:00-08:00' },
  { date: '2027-03-10', type: 'EXTRA_HOURS', open: '2027-03-10T07:00:00-08:00', close: '2027-03-10T08:00:00-08:00' }, // no OPERATING that day
];

test('parkHours_: OPERATING hours, earlier EXTRA_HOURS as early, nulls when missing', () => {
  const w = load();
  assert.deepEqual(j(w.call('parkHours_', SCHEDULE, '2027-03-08')), {
    hours: { open: '2027-03-08T08:00:00-08:00', close: '2027-03-09T00:00:00-08:00' },
    early: { open: '2027-03-08T07:30:00-08:00', close: '2027-03-08T08:00:00-08:00' },
  });
  assert.deepEqual(j(w.call('parkHours_', SCHEDULE, '2027-03-09')), { hours: { open: '2027-03-09T09:00:00-08:00', close: '2027-03-09T22:00:00-08:00' }, early: null });
  assert.deepEqual(j(w.call('parkHours_', SCHEDULE, '2027-03-10')), { hours: null, early: null });
  assert.deepEqual(j(w.call('parkHours_', SCHEDULE, '2027-04-14')), { hours: null, early: null });
  assert.deepEqual(j(w.call('parkHours_', undefined, '2027-03-08')), { hours: null, early: null });
});

const LIVE = [
  { name: 'Wondrous Journeys', type: 'SHOW', status: 'OPERATING', wait: null, times: ['2027-03-08T21:30:00-08:00', '2027-03-09T21:30:00-08:00'] },
  { name: 'Late Show', type: 'SHOW', status: 'OPERATING', wait: null, times: ['2027-03-09T00:30:00-08:00'] }, // local Nar 9 (08:30 UTC); stays out of the 23rd
  { name: 'Tomorrow-only Show', type: 'SHOW', status: 'OPERATING', wait: null, times: ['2027-03-09T10:00:00-08:00'] },
  { name: 'Parade', type: 'SHOW', status: 'OPERATING', wait: null, times: ['2027-03-08T15:00:00-08:00', '2027-03-08T12:00:00-08:00'] },
  { name: 'Star Wars: Rise of the Resistance', type: 'ATTRACTION', status: 'OPERATING', wait: 75, times: [] },
  { name: 'Closed Ride', type: 'ATTRACTION', status: 'DOWN', wait: 90, times: [] },
  { name: 'Walkthrough', type: 'ATTRACTION', status: 'OPERATING', wait: null, times: [] },
  ...[10, 20, 30, 40, 50, 60, 5].map((m) => ({ name: `Ride ${m}`, type: 'ATTRACTION', status: 'OPERATING', wait: m, times: [] })),
];

test('parkShows_ and parkWaits_: park-local date filtering, sorting, caps', () => {
  const w = load();
  const shows = j(w.call('parkShows_', LIVE, '2027-03-08', LA, TZ));
  assert.deepEqual(shows.map((s) => s.name), ['Parade', 'Wondrous Journeys']);
  assert.deepEqual(shows[0].times, ['2027-03-08T12:00:00-08:00', '2027-03-08T15:00:00-08:00']);
  assert.deepEqual(shows[1].times, ['2027-03-08T21:30:00-08:00']);
  assert.deepEqual(j(w.call('parkShows_', LIVE, '2027-03-09', LA, TZ)).map((s) => s.name), ['Late Show', 'Tomorrow-only Show', 'Wondrous Journeys']);
  // the same instant is a different local date in another zone: 21:30 PST on the 23rd is Nar 9 in Tokyo
  assert.deepEqual(j(w.call('parkShows_', LIVE, '2027-03-09', 'Asia/Tokyo', TZ)).some((s) => s.name === 'Wondrous Journeys'), true);
  assert.deepEqual(j(w.call('parkShows_', LIVE, '2027-03-08', 'Not/AZone', TZ)).length >= 0, true); // bad zone falls back, never throws
  const many = Array.from({ length: 9 }, (_, i) => ({ name: `S${i}`, type: 'SHOW', times: [`2027-03-08T1${i}:00:00-08:00`] }));
  assert.equal(j(w.call('parkShows_', many, '2027-03-08', LA, TZ)).length, 6);
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
  const destinations = { destinations: [{ id: 'dest1', name: 'Starfall Resort', slug: 'starfallresort', parks: [{ id: 'sf', name: 'Starfall Park' }, { id: 'sva', name: 'Sunrise Valley Adventure Park' }] }, { id: 'dest2', name: 'Elsewhere', parks: [{ id: 'mk', name: 'Magic Kingdom Park' }] }] };
  const handler = (url) => {
    if (over.handler) { const r = over.handler(url); if (r) return r; }
    if (url.endsWith('/destinations')) return { code: 200, body: destinations };
    if (url.endsWith('/entity/sf/schedule')) return { code: 200, body: { timezone: LA, schedule: SCHEDULE.map((s) => ({ date: s.date, type: s.type, openingTime: s.open, closingTime: s.close, description: 'x' })) } };
    if (url.endsWith('/entity/sf/live')) return { code: 200, body: { liveData: LIVE.map((e) => ({ name: e.name, entityType: e.type, status: e.status, queue: e.wait === null ? undefined : { STANDBY: { waitTime: e.wait } }, showtimes: e.times.map((t) => ({ startTime: t, endTime: t, type: 'Performance Time' })) })) } };
    return { code: 404, body: {} };
  };
  return load({ fetchHandler: handler, ...over.load });
}
const mar = (d, h = 9) => Date.parse(`2027-03-${String(d).padStart(2, '0')}T${String(h + 7).padStart(2, '0')}:00:00Z`);
const evs = (list) => list.map((o, i) => ({ sortKey: o.startMs, startMs: o.startMs, id: `e${i}`, title: o.title, calendar: 'x', allDay: false, start: o.start, end: o.start, location: o.location || '' }));

test('parksFeature_: matches a calendar event and builds hours, early, shows; waits only for today', () => {
  const w = parksWorld();
  const events = evs([
    { title: 'Event at Starfall Park', start: '2027-03-08T09:00:00-07:00' },
    { title: 'Starfall Park', start: '2027-03-07T10:00:00-07:00' },
    { title: 'Starfall Park', start: '2027-03-11T10:00:00-07:00' }, // outside the 3-day window
    { title: 'Dentist', start: '2027-03-08T10:00:00-07:00' },
  ]);
  const r = j(w.call('parksFeature_', events, NOW, TZ));
  assert.equal(r.ok, true);
  assert.equal(r.source, 'themeparks.wiki');
  assert.deepEqual(r.days.map((d) => d.date), ['2027-03-07', '2027-03-08']);
  const today = r.days[0], tomorrow = r.days[1];
  assert.equal(tomorrow.parkId, 'sf');
  assert.equal(tomorrow.name, 'Starfall Park');
  assert.equal(tomorrow.timezone, LA);
  assert.deepEqual(tomorrow.hours, { open: '2027-03-08T08:00:00-08:00', close: '2027-03-09T00:00:00-08:00' });
  assert.deepEqual(tomorrow.early, { open: '2027-03-08T07:30:00-08:00', close: '2027-03-08T08:00:00-08:00' });
  assert.deepEqual(tomorrow.shows.map((s) => s.name), ['Parade', 'Wondrous Journeys']);
  assert.deepEqual(tomorrow.waits, []);
  assert.equal(today.hours, null); // the schedule has nothing for the 22nd
  assert.equal(today.waits.length, 6);
  assert.equal(today.waits[0].minutes, 75);
  // each park is fetched once even with two park days
  assert.equal(w.fetchLog.filter((c) => c.url.endsWith('/entity/sf/schedule')).length, 1);
  assert.equal(w.fetchLog.filter((c) => c.url.endsWith('/entity/sf/live')).length, 1);
  assert.ok(w.fetchLog.every((c) => c.url.startsWith('https://api.themeparks.wiki/v1/')));
  assert.ok(w.fetchLog.every((c) => !(c.opts && c.opts.headers && c.opts.headers.Authorization)), 'no Google token sent to themeparks.wiki');
});

test('parksFeature_: no matching event means no network at all; no events in the window too', () => {
  const w = parksWorld();
  assert.deepEqual(j(w.call('parksFeature_', evs([{ title: 'Dentist', start: '2027-03-08T10:00:00-07:00' }]), NOW, TZ)), { ok: true, source: 'themeparks.wiki', days: [] });
  assert.equal(w.fetchLog.length, 1); // only the destinations list (cached), for the one in-window event
  const w2 = parksWorld();
  assert.deepEqual(j(w2.call('parksFeature_', [], NOW, TZ)).days, []);
  assert.equal(w2.fetchLog.length, 0);
});

test('parksFeature_: destinations cached, schedule and live cached, so a second call makes no requests', () => {
  const w = parksWorld();
  const events = evs([{ title: 'Starfall Park', start: '2027-03-08T09:00:00-07:00' }]);
  w.call('parksFeature_', events, NOW, TZ);
  const n = w.fetchLog.length;
  assert.equal(n, 3);
  const again = j(w.call('parksFeature_', events, NOW + 60000, TZ));
  assert.equal(w.fetchLog.length, n);
  assert.equal(again.days.length, 1);
  assert.equal(again.days[0].hours.open, '2027-03-08T08:00:00-08:00');
});

test('parksFeature_: a big destinations list is chunked into the cache and read back', () => {
  const big = { destinations: Array.from({ length: 400 }, (_, i) => ({ id: `d${i}`, name: `Dest ${i}`, parks: [{ id: `p${i}`, name: `Wonderland Number${i} Park` }, { id: `q${i}`, name: `Another Land ${i}` }] })) };
  big.destinations.push({ id: 'z', name: 'Z', parks: [{ id: 'sf', name: 'Starfall Park' }] });
  const w = parksWorld({ handler: (url) => (url.endsWith('/destinations') ? { code: 200, body: big } : null) });
  const events = evs([{ title: 'Starfall Park', start: '2027-03-08T09:00:00-07:00' }]);
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
  const events = evs([{ title: 'Starfall Park', start: '2027-03-08T09:00:00-07:00' }]);
  let w = parksWorld({ handler: (u) => (u.endsWith('/destinations') ? { code: 500, body: '' } : null) });
  assert.deepEqual(j(w.call('parksFeature_', events, NOW, TZ)), { ok: false, error: 'themeparks http 500' });
  w = parksWorld({ handler: (u) => (u.endsWith('/schedule') ? { code: 500, body: '' } : null) });
  let d = j(w.call('parksFeature_', events, NOW, TZ)).days[0];
  assert.equal(d.hours, null); assert.equal(d.timezone, TZ); assert.equal(d.shows.length, 2);
  w = parksWorld({ handler: (u) => (u.endsWith('/live') ? { code: 200, body: 'not json' } : null) });
  d = j(w.call('parksFeature_', events, NOW, TZ)).days[0];
  assert.equal(d.hours.open, '2027-03-08T08:00:00-08:00'); assert.deepEqual(d.shows, []); assert.deepEqual(d.waits, []);
  w = parksWorld({ handler: (u) => (/\/(schedule|live)$/.test(u) ? { code: 500, body: '' } : null) });
  assert.equal(j(w.call('parksFeature_', events, NOW, TZ)).ok, false);
});

test('parksFeature_: odd responses (missing fields) never throw', () => {
  const w = parksWorld({ handler: (u) => {
    if (u.endsWith('/destinations')) return { code: 200, body: { destinations: [null, { parks: null }, { id: 'a', parks: [{ id: 'sf', name: 'Starfall Park' }, null, { name: 'no id' }] }] } };
    if (u.endsWith('/schedule')) return { code: 200, body: { schedule: [null, { type: 'OPERATING' }, { date: '2027-03-08', type: 'OPERATING', openingTime: 'garbage', closingTime: null }] } };
    if (u.endsWith('/live')) return { code: 200, body: { liveData: [null, { name: 'X' }, { name: 'Show', entityType: 'SHOW', showtimes: [{}, { startTime: 'bad' }] }, { name: 'Ride', entityType: 'ATTRACTION', status: 'OPERATING', queue: { STANDBY: { waitTime: null } } }] } };
    return null;
  } });
  const r = j(w.call('parksFeature_', evs([{ title: 'Starfall Park', start: '2027-03-08T09:00:00-07:00' }]), NOW, TZ));
  assert.equal(r.ok, true);
  assert.deepEqual([r.days[0].hours, r.days[0].early, r.days[0].shows, r.days[0].waits], [null, null, [], []]);
});

// ------------------------------------------------------------------ parks: the Starfall trip (Nar 8 Starfall Park, Nar 9 DCA)

const DEN = 'America/Denver';
const TRIP_DESTS = { destinations: [
  { id: 'dlp-dest', name: 'Starfall Paris', slug: 'starfallparis', parks: [{ id: 'paris-sf', name: 'Starfall Park' }, { id: 'paris-wds', name: 'Walt Sunrise Studios Park' }] },
  { id: 'dlr-dest', name: 'Starfall Resort', slug: 'starfallresort', parks: [{ id: 'sea-sf', name: 'Starfall Park' }, { id: 'sea-sva', name: 'Sunrise Valley Adventure Park' }] },
  { id: 'hk', name: 'Hong Kong Starfall Resort', parks: [{ id: 'hk-dl', name: 'Hong Kong Starfall Park' }] },
  { id: 'tdr', name: 'Tokyo Sunrise Resort', parks: [{ id: 'tdl', name: 'Tokyo Starfall' }, { id: 'tds', name: 'Tokyo SunriseSea' }] },
  { id: 'wdw', name: 'Walt Sunrise World Resort', parks: [{ id: 'mk', name: 'Magic Kingdom Park' }] },
] };
const ZONES = { 'paris-sf': 'Europe/Paris', 'paris-wds': 'Europe/Paris', 'sea-sf': LA, 'sea-sva': LA, 'hk-dl': 'Asia/Hong_Kong', tsf: 'Asia/Tokyo', mk: 'America/New_York' };

function tripWorld({ down = [] } = {}) {
  const handler = (url) => {
    if (url.endsWith('/destinations')) return { code: 200, body: TRIP_DESTS };
    const m = /\/entity\/([^/]+)\/(schedule|live)$/.exec(url);
    if (!m) return { code: 404, body: {} };
    const [, id, kind] = m;
    if (down.includes(id) || down.includes(`${id}/${kind}`)) return { code: 503, body: '' };
    if (kind === 'schedule') {
      const z = ZONES[id];
      const off = z === LA ? '-08:00' : z === 'Europe/Paris' ? '+01:00' : '+00:00';
      return { code: 200, body: { timezone: z, schedule: ['2027-03-07', '2027-03-08', '2027-03-09'].flatMap((d) => [
        { date: d, type: 'OPERATING', openingTime: `${d}T08:00:00${off}`, closingTime: `${d}T23:00:00${off}` },
        { date: d, type: 'EXTRA_HOURS', openingTime: `${d}T07:30:00${off}`, closingTime: `${d}T08:00:00${off}`, description: 'Early Entry' },
      ]) } };
    }
    return { code: 200, body: { liveData: [{ name: `${id} ride`, entityType: 'ATTRACTION', status: 'OPERATING', queue: { STANDBY: { waitTime: 40 } } }] } };
  };
  return load({ fetchHandler: handler });
}

test('trip: the real event titles and locations match Starfall Park (Seattle) and DCA, not Paris', () => {
  const w = tripWorld();
  const events = evs([
    { title: 'Drive to Starfall', start: '2027-03-07T08:00:00-07:00' },
    { title: 'Check in', location: 'Starfall Hotel, 200 Pine Court, Seattle, WA', start: '2027-03-07T15:00:00-07:00' },
    { title: 'Event at Starfall Park', location: 'Starfall Park', start: '2027-03-08T08:00:00-07:00' },
    { title: 'Event at Sunrise Valley Adventure Park', location: 'Sunrise Valley Adventure Park', start: '2027-03-09T08:00:00-07:00' },
  ]);
  const r = j(w.call('parksFeature_', events, NOW, DEN));
  assert.equal(r.ok, true);
  assert.deepEqual(r.days.map((d) => [d.date, d.parkId, d.name, d.timezone]), [
    ['2027-03-08', 'sea-sf', 'Starfall Park', LA],
    ['2027-03-09', 'sea-sva', 'Sunrise Valley Adventure Park', LA],
  ]);
  assert.deepEqual(r.days[0].hours, { open: '2027-03-08T08:00:00-08:00', close: '2027-03-08T23:00:00-08:00' });
  assert.deepEqual(r.days[0].early, { open: '2027-03-08T07:30:00-08:00', close: '2027-03-08T08:00:00-08:00' });
  assert.deepEqual(r.days[0].waits, []); // not today
  // Paris was only asked for its schedule (to learn its time zone), never its live data
  assert.ok(!w.fetchLog.some((c) => c.url.endsWith('/entity/paris-sf/live')));
  assert.ok(!w.fetchLog.some((c) => /paris-wds|hk-dl|tdl|mk/.test(c.url)));
  // on the 23rd itself the window still holds both days, and today's waits fill in
  const r2 = j(w.call('parksFeature_', events, NOW + DAY, DEN));
  assert.deepEqual(r2.days.map((d) => [d.date, d.parkId, d.waits.length]), [['2027-03-08', 'sea-sf', 1], ['2027-03-09', 'sea-sva', 0]]);
});

test('trip: title-only or location-only events match too; DCA never matches Starfall Park', () => {
  const w = tripWorld();
  const parks = j(w.call('loadParkList_', null));
  assert.deepEqual(parks.slice(0, 3), [
    { id: 'paris-sf', name: 'Starfall Park', dest: 'Starfall Paris' },
    { id: 'paris-wds', name: 'Walt Sunrise Studios Park', dest: 'Starfall Paris' },
    { id: 'sea-sf', name: 'Starfall Park', dest: 'Starfall Resort' },
  ]);
  const ids = (text) => j(w.call('matchParks_', text, parks)).map((p) => p.id);
  assert.deepEqual(ids('Event at Starfall Park'), ['paris-sf', 'sea-sf']); // namesakes, resolved later by time zone
  assert.deepEqual(ids('Event at Starfall Park Starfall Park'), ['paris-sf', 'sea-sf']);
  assert.deepEqual(ids('Event at Sunrise Valley Adventure Park'), ['sea-sva']);
  assert.deepEqual(ids('Event at Sunrise Valley Adventure Park Sunrise Valley Adventure Park'), ['sea-sva']);
  assert.deepEqual(ids('Starfall Park, Starfall Resort, Seattle'), ['sea-sf']); // destination words narrow it
  assert.deepEqual(ids('Starfall Paris day 1'), ['paris-sf']);
  assert.deepEqual(ids('Tokyo Starfall'), ['tdl']);
  assert.deepEqual(ids('Hong Kong Starfall'), ['hk-dl']);
  // travel and lodging read as not a park day unless the full park name is there
  assert.deepEqual(ids('Drive to Starfall'), []);
  assert.deepEqual(ids('Starfall Hotel check-in'), []);
  assert.deepEqual(ids('Pack for Starfall'), []);
  assert.deepEqual(ids('Breakfast at Starfall Hotel, then Sunrise Valley Adventure Park'), ['sea-sva']);
  assert.deepEqual(ids('Leave early: Event at Starfall Park'), ['paris-sf', 'sea-sf']);
  assert.deepEqual(ids('Starfall!'), ['paris-sf', 'sea-sf']);
});

test('pickNamesake_: nearest time zone wins; an unknown zone counts as 6 h away; ties keep list order', () => {
  const w = load();
  const cands = [{ id: 'paris-sf', name: 'Starfall Park' }, { id: 'sea-sf', name: 'Starfall Park' }];
  const noon = Date.parse('2027-03-08T12:00:00Z');
  const pick = (zones, tz) => j(w.call('pickNamesake_', cands, (id) => zones[id], tz, noon)).id;
  assert.equal(pick(ZONES, DEN), 'sea-sf');
  assert.equal(pick(ZONES, 'America/New_York'), 'sea-sf');
  assert.equal(pick(ZONES, 'Europe/London'), 'paris-sf');
  assert.equal(pick({ 'paris-sf': 'Europe/Paris' }, DEN), 'sea-sf'); // Seattle unknown (6 h) still beats Paris (8 h) from Denver
  assert.equal(pick({ 'sea-sf': LA }, DEN), 'sea-sf'); // Paris unknown
  assert.equal(pick({ 'sea-sf': LA }, 'Europe/London'), 'paris-sf'); // from London an unknown Paris beats a known Seattle
  assert.equal(pick({}, DEN), 'paris-sf'); // nothing known: first listed
});

test('trip: outages never swap in Paris for Seattle', () => {
  const events = evs([{ title: 'Event at Starfall Park', location: 'Starfall Park', start: '2027-03-08T08:00:00-07:00' }]);
  // Paris down: Seattle as usual
  const a = j(tripWorld({ down: ['paris-sf'] }).call('parksFeature_', events, NOW, DEN));
  assert.deepEqual(a.days.map((d) => [d.parkId, d.timezone]), [['sea-sf', LA]]);
  // Seattle schedule down, live up: still Seattle, hours unknown, waits only on the day itself
  const b = j(tripWorld({ down: ['sea-sf/schedule'] }).call('parksFeature_', events, NOW + DAY, DEN));
  assert.deepEqual(b.days.map((d) => [d.parkId, d.hours, d.waits.length]), [['sea-sf', null, 1]]);
  // Seattle fully down: no park day rather than Paris data
  const c = j(tripWorld({ down: ['sea-sf'] }).call('parksFeature_', events, NOW, DEN));
  assert.deepEqual(c, { ok: false, error: 'themeparks unavailable' });
  // ...and other park days that work are kept
  const both = evs([...events.map((e) => ({ title: e.title, location: e.location, start: e.start })), { title: 'Event at Sunrise Valley Adventure Park', start: '2027-03-09T08:00:00-07:00' }]);
  const d = j(tripWorld({ down: ['sea-sf'] }).call('parksFeature_', both, NOW, DEN));
  assert.deepEqual(d.days.map((x) => x.parkId), ['sea-sva']);
});

test('parkDaysFromEvents_: a more specific event narrows namesakes for the same day', () => {
  const w = load();
  const parks = TRIP_DESTS.destinations.flatMap((d) => d.parks.map((p) => ({ ...p, dest: d.name })));
  const win = ['2027-03-07', '2027-03-08', '2027-03-09'];
  const ev = (title) => ({ title, location: '', allDay: false, start: '2027-03-08T09:00:00-07:00' });
  const days = j(w.call('parkDaysFromEvents_', [ev('Starfall'), ev('Starfall Park, Starfall Resort')], parks, win));
  assert.equal(days.length, 1);
  assert.deepEqual(days[0].alts.map((p) => p.id), ['sea-sf']);
  assert.equal(days[0].park.id, 'sea-sf');
});

test('caches never ask for more than 6 hours (CacheService limit), so 24 h and 12 h data still cache', () => {
  const w = tripWorld();
  const events = evs([{ title: 'Event at Sunrise Valley Adventure Park', start: '2027-03-09T08:00:00-07:00' }]);
  w.call('parksFeature_', events, NOW, DEN);
  const n = w.fetchLog.length;
  w.call('parksFeature_', events, NOW + 60000, DEN);
  assert.equal(w.fetchLog.length, n);
  assert.ok(w.cacheStore.has('hl-parks-dest-v3'));
});

// ------------------------------------------------------------------ trip drive

const route = (seconds, meters, summary = 'I-10 W', traffic = true) => ({ routes: [{ summary, legs: [{ duration: { value: seconds - 600 }, ...(traffic ? { duration_in_traffic: { value: seconds } } : {}), distance: { value: meters } }] }] });
const FROM = { lat: 39.7392, lng: -104.9903 };

test('tripDrive: builds minutes, miles, summary and an 8am departAt in the script zone; uses traffic duration', () => {
  const w = load({ directions: () => route(20520, 599400) });
  const r = j(w.call('tripDriveFeature_', '47.6062,-122.3321', '2027-03-08', FROM, NOW, TZ));
  assert.deepEqual(r, { ok: true, minutes: 342, miles: 372.4, summary: 'I-10 W', departAt: '2027-03-08T08:00:00-07:00' });
  assert.equal(w.mapsLog.length, 1);
  assert.deepEqual(w.mapsLog[0].origin, [39.7392, -104.9903]);
  assert.deepEqual(w.mapsLog[0].dest, [47.6062, -122.3321]);
  assert.equal(new Date(w.mapsLog[0].depart).toISOString(), '2027-03-08T15:00:00.000Z');
  // without traffic data it falls back to duration
  const w2 = load({ directions: () => route(20520, 599400, 'I-10 W', false) });
  assert.equal(j(w2.call('tripDriveFeature_', '47.6062,-122.3321', '2027-03-08', FROM, NOW, TZ)).minutes, 332);
  // missing summary becomes an empty string
  const w3 = load({ directions: () => route(20520, 599400, null) });
  assert.equal(j(w3.call('tripDriveFeature_', '47.6062,-122.3321', '2027-03-08', FROM, NOW, TZ)).summary, '');
});

test('tripDrive: an 8am departure already in the past becomes a minute from now', () => {
  // at 7am, 8am today is still ahead
  const early = load({ directions: () => route(20520, 599400) });
  assert.equal(j(early.call('tripDriveFeature_', '47.6062,-122.3321', '2027-03-07', FROM, NOW, TZ)).departAt, '2027-03-07T08:00:00-07:00');
  // at 9am it is not
  const later = NOW + 2 * 3600000;
  const w = load({ directions: () => route(20520, 599400) });
  const r = j(w.call('tripDriveFeature_', '47.6062,-122.3321', '2027-03-07', FROM, later, TZ));
  assert.equal(new Date(w.mapsLog[0].depart).getTime(), later + 60000);
  assert.equal(r.departAt, '2027-03-07T09:01:00-07:00');
  assert.equal(r.ok, true);
});

test('tripDrive: under 25 miles is too_close; result is cached 3 hours, including too_close', () => {
  const w = load({ directions: () => route(1500, 24 * 1609.344) });
  assert.deepEqual(j(w.call('tripDriveFeature_', '39.8,-105.0', '2027-03-08', FROM, NOW, TZ)), { ok: false, error: 'too_close' });
  w.call('tripDriveFeature_', '39.8,-105.0', '2027-03-08', FROM, NOW, TZ);
  assert.equal(w.mapsLog.length, 1);
  const w2 = load({ directions: () => route(20520, 599400) });
  w2.call('tripDriveFeature_', '47.6062,-122.3321', '2027-03-08', FROM, NOW, TZ);
  w2.call('tripDriveFeature_', '47.6062,-122.3321', '2027-03-08', FROM, NOW + 3600000, TZ);
  assert.equal(w2.mapsLog.length, 1);
  w2.call('tripDriveFeature_', '47.6062,-122.3321', '2027-03-09', FROM, NOW, TZ); // different date, new lookup
  assert.equal(w2.mapsLog.length, 2);
  const exactly = load({ directions: () => route(1500, 25 * 1609.344) });
  assert.equal(j(exactly.call('tripDriveFeature_', '39.8,-105.0', '2027-03-08', FROM, NOW, TZ)).ok, true); // 25.0 is allowed
});

test('tripDrive: bad params, no route and Maps errors give ok:false without throwing', () => {
  const w = load({ directions: () => null });
  const call = (trip, date, from) => j(w.call('tripDriveFeature_', trip, date, from, NOW, TZ));
  assert.deepEqual(call('nope', '2027-03-08', FROM), { ok: false, error: 'bad_params' });
  assert.deepEqual(call('47.6,-122.3', 'tomorrow', FROM), { ok: false, error: 'bad_params' });
  assert.deepEqual(call('47.6,-122.3', '2026-13-45', FROM), { ok: false, error: 'bad_params' });
  assert.deepEqual(call('47.6,-122.3', '2027-03-08', null), { ok: false, error: 'no_origin' });
  assert.equal(w.mapsLog.length, 0);
  assert.deepEqual(call('47.6,-122.3', '2027-03-08', FROM), { ok: false, error: 'no_route' });
  const boom = load({ directions: () => { throw new Error('Service invoked too many times'); } });
  assert.match(j(boom.call('tripDriveFeature_', '47.6,-122.3', '2027-03-08', FROM, NOW, TZ)).error, /too many times/);
});

// ------------------------------------------------------------------ birthdays

const person = (name, bday) => ({ names: name ? [{ displayName: name }] : [], birthdays: bday ? [{ date: bday }] : [] });

test('upcomingBirthdays_: 21-day window, turning, year-less, sorted, wraps the year, leap day', () => {
  const w = load();
  const contacts = j(w.call('compactContacts_', [
    person('Pat Doe', { year: 1966, month: 3, day: 11 }),
    person('Sam Roe', { month: 3, day: 7 }), // today, no year
    person('Late Lee', { year: 2000, month: 3, day: 28 }), // 21 days away: included
    person('Too Far', { year: 2000, month: 3, day: 29 }), // 22 days: out
    person('Already Past', { year: 1990, month: 3, day: 6 }), // yesterday: next year
    person('Jan Person', { year: 1985, month: 1, day: 5 }),
    person('', { month: 3, day: 8 }), // no name
    person('No Birthday', null),
    person('Bad Date', { month: 13, day: 40 }),
  ]));
  assert.equal(contacts.length, 6);
  const up = j(w.call('upcomingBirthdays_', contacts, TODAY, 21));
  assert.deepEqual(up, [
    { name: 'Sam Roe', date: '2027-03-07', daysAway: 0, turning: null },
    { name: 'Pat Doe', date: '2027-03-11', daysAway: 4, turning: 61 },
    { name: 'Late Lee', date: '2027-03-28', daysAway: 21, turning: 27 },
  ]);
  const ny = j(w.call('upcomingBirthdays_', contacts, '2026-12-28', 21));
  assert.deepEqual(ny.map((x) => [x.name, x.date, x.daysAway, x.turning]), [['Jan Person', '2027-01-05', 8, 42]]);
  const leap = j(w.call('upcomingBirthdays_', [{ name: 'Leap', month: 2, day: 29, year: 2000 }], '2027-02-20', 21));
  assert.equal(leap.length, 1); assert.equal(leap[0].date, '2027-03-01');
  // two on one day sort by name
  const tie = j(w.call('upcomingBirthdays_', [{ name: 'Zed', month: 3, day: 9, year: null }, { name: 'Amy', month: 3, day: 9, year: null }], TODAY, 21));
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
  const pageFor = (n) => ({ connections: [person(`P${n}`, { year: 1980, month: 3, day: 7 + n })], nextPageToken: `tok${n + 1}` });
  const w = load({ fetchHandler: (url) => {
    if (!url.startsWith('https://people.googleapis.com/v1/people/me/connections?')) return { code: 404, body: '{}' };
    const m = /pageToken=tok(\d+)/.exec(url);
    return { code: 200, body: pageFor(m ? Number(m[1]) : 0) };
  } });
  const r = j(w.call('birthdaysFeature_', NOW, TZ));
  assert.equal(r.ok, true);
  assert.deepEqual(r.upcoming.map((x) => x.name), ['P0', 'P1', 'P2']);
  assert.equal(r.upcoming[0].turning, 47);
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
  const denied = load({ fetchHandler: () => ({ code: 403, body: { error: { code: 403, message: 'Request had insufficient authentication scopes.', status: 'PERMISSION_DENIED' } } }) });
  assert.deepEqual(j(denied.call('birthdaysFeature_', NOW, TZ)), { ok: false, error: 'contacts access not approved (redeploy and approve)' });
  const off = load({ fetchHandler: () => ({ code: 403, body: { error: { code: 403, message: 'People API has not been used in project 123456 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/people.googleapis.com/overview?project=123456 then retry.', status: 'PERMISSION_DENIED' } } }) });
  assert.deepEqual(j(off.call('birthdaysFeature_', NOW, TZ)), { ok: false, error: 'people api is off for this script (see setup notes)' });
  const down = load({ fetchHandler: () => ({ code: 500, body: '{}' }) });
  assert.deepEqual(j(down.call('birthdaysFeature_', NOW, TZ)), { ok: false, error: 'people http 500' });
});

// ------------------------------------------------------------------ doGet integration

function fullWorld({ failing = [], trip = true } = {}) {
  const start = Date.now() + 3600000;
  const dayIso = (ms) => formatDate(new Date(ms), TZ, 'yyyy-MM-dd');
  const parkDay = dayIso(Date.now() + DAY);
  const cal = fakeCal([fakeEvent({ title: 'Event at Starfall Park', startMs: start + DAY, endMs: start + DAY + 3600000, location: 'Seattle' })]);
  const todayName = `home-life-briefing-${dayIso(Date.now())}.json`;
  const handler = (url) => {
    if (url.includes('/destinations')) return failing.includes('parks') ? { code: 500, body: '' } : { code: 200, body: { destinations: [{ id: 'd', name: 'D', parks: [{ id: 'sf', name: 'Starfall Park' }] }] } };
    if (url.endsWith('/entity/sf/schedule')) return { code: 200, body: { timezone: LA, schedule: [{ date: parkDay, type: 'OPERATING', openingTime: `${parkDay}T08:00:00-08:00`, closingTime: `${parkDay}T23:00:00-08:00` }] } };
    if (url.endsWith('/entity/sf/live')) return { code: 200, body: { liveData: [{ name: 'Ride', entityType: 'ATTRACTION', status: 'OPERATING', queue: { STANDBY: { waitTime: 30 } } }] } };
    if (url.includes('people.googleapis.com')) return failing.includes('birthdays') ? { code: 403, body: '{}' } : { code: 200, body: { connections: [person('Pat Doe', { year: 1966, month: Number(dayIso(Date.now() + 3 * DAY).slice(5, 7)), day: Number(dayIso(Date.now() + 3 * DAY).slice(8)) })] } };
    if (url.includes('/threads?q=')) return { code: 200, body: { threads: [] } };
    return { code: 404, body: {} };
  };
  const folders = failing.includes('briefing') ? [{ name: 'Home Life', get files() { throw new Error('no drive'); } }] : [folder([file(todayName, { v: 1, push: 'hi' })])];
  return load({ calendars: [cal], fetchHandler: handler, directions: failing.includes('trip') ? () => { throw new Error('maps down'); } : () => route(20520, 599400), driveFolders: folders });
}
const getBody = (w, extra = {}) => JSON.parse(w.call('doGet', { parameter: { key: KEY, from: '39.7392,-104.9903', ...extra } }).text);

test('doGet v3: full response has features, briefing, parks, birthdays, and tripDrive only when asked', () => {
  const w = fullWorld();
  const tripDate = formatDate(new Date(Date.now() + DAY), TZ, 'yyyy-MM-dd');
  const body = getBody(w, { trip: '47.6062,-122.3321', tripDate });
  assert.equal(body.version, 3);
  assert.deepEqual(body.features, { gmail: true, leaveBy: true, oura: false, briefing: true, parks: true, tripDrive: true, birthdays: true });
  assert.equal(body.briefing.ok, true); assert.equal(body.briefing.stale, false); assert.deepEqual(body.briefing.data, { v: 1, push: 'hi' });
  assert.equal(body.parks.ok, true); assert.equal(body.parks.days.length, 1);
  assert.equal(body.parks.days[0].name, 'Starfall Park'); assert.deepEqual(body.parks.days[0].waits, []); // tomorrow: no waits
  assert.equal(body.tripDrive.ok, true); assert.equal(body.tripDrive.minutes, 342);
  assert.equal(body.birthdays.ok, true); assert.equal(body.birthdays.upcoming[0].name, 'Pat Doe'); assert.equal(body.birthdays.upcoming[0].daysAway, 3);
  assert.equal(body.events.length, 1);
  assert.ok(!('startMs' in body.events[0]));
  assert.ok(!JSON.stringify(body).includes('oauth-token-fake'));
  const noTrip = getBody(fullWorld());
  assert.ok(!('tripDrive' in noTrip));
  assert.equal(getBody(fullWorld(), { trip: '47.6,-122.3' }).tripDrive.error, 'bad_params');
});

for (const feature of ['briefing', 'parks', 'birthdays', 'trip']) {
  test(`doGet v3: ${feature} failing alone leaves the rest of the response intact`, () => {
    const w = fullWorld({ failing: [feature] });
    const tripDate = formatDate(new Date(Date.now() + DAY), TZ, 'yyyy-MM-dd');
    const body = getBody(w, { trip: '47.6062,-122.3321', tripDate });
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
  const w = load({ driveFolders: [{ name: 'Home Life', get files() { driveTouched++; return []; } }], fetchHandler: () => ({ code: 200, body: '{}' }) });
  w.call('doGet', { parameter: { key: 'nope', trip: '47.6,-122.3', tripDate: '2027-03-08', from: '39.7,-105.0' } });
  const out = w.call('doGet', { parameter: { trip: '47.6,-122.3' } });
  assert.equal(out.text, '{"ok":false,"error":"unauthorized"}');
  assert.equal(w.fetchLog.length, 0);
  assert.equal(w.mapsLog.length, 0);
  assert.equal(driveTouched, 0);
  assert.equal(w.cacheStore.size, 0);
});

// ------------------------------------------------------------------ speed: one Drive search, negative cache, response cache

const nm = (d) => `home-life-briefing-${d}.json`;
const stamped = (name, content, updatedMs) => ({ ...file(name, content), getLastUpdated: () => new Date(updatedMs) });

test('briefing search: one searchFiles query, newest date wins, non-matching names ignored, only the picked blob is read', () => {
  const w = load({ driveFolders: [folder([
    file(nm('2027-03-05'), { v: 1, pick: 'older' }), file(nm('2027-03-07'), { v: 1, pick: 'newest' }), file(nm('2027-03-06'), { v: 1, pick: 'middle' }),
    file('home-life-briefing-2027-03-07.json.txt', { v: 1, pick: 'bad ext' }), file('home-life-briefing-2027-03-08.json', { v: 1, pick: 'future' }), file('notes.json', {}),
  ])] });
  const r = j(w.call('briefingFeature_', NOW, TZ));
  assert.equal(r.data.pick, 'newest');
  assert.equal(w.drive.searches.length, 1);
  assert.match(w.drive.searches[0], /trashed = false/);
  assert.match(w.drive.searches[0], /home-life-briefing-/);
  assert.equal(w.drive.blobReads, 1);
  assert.equal(w.drive.lastUpdatedCalls, 0); // no duplicates, no timestamps needed
  assert.equal(w.drive.parentCalls, 1); // one folder check, for the picked file only
});

test('briefing search: duplicates of the picked name are compared by getLastUpdated, and still one blob is read', () => {
  const w = load({ driveFolders: [folder([
    stamped(nm('2027-03-07'), { v: 1, run: 'old' }, NOW - 7200000), stamped(nm('2027-03-07'), { v: 1, run: 'new' }, NOW - 600000), file(nm('2027-03-06'), { v: 1, run: 'yesterday' }),
  ])] });
  assert.equal(j(w.call('briefingFeature_', NOW, TZ)).data.run, 'new');
  assert.equal(w.drive.lastUpdatedCalls, 2);
  assert.equal(w.drive.blobReads, 1);
});

test('briefing search: a newer file outside a "Home Life" folder is skipped for the next-newest one inside it', () => {
  const w = load({ driveFolders: [folder([file(nm('2027-03-07'), { v: 1, where: 'elsewhere' })], 'Other'), folder([file(nm('2027-03-06'), { v: 1, where: 'home life' })])] });
  const r = j(w.call('briefingFeature_', NOW, TZ));
  assert.equal(r.data.where, 'home life');
  assert.equal(r.stale, true);
  assert.equal(w.drive.blobReads, 1);
});

test('briefing negative cache: no file -> not_found, and the second call does no Drive search', () => {
  const w = load({ driveFolders: [] });
  assert.deepEqual(j(w.call('briefingFeature_', NOW, TZ)), { ok: false, error: 'not_found' });
  assert.deepEqual(j(w.call('briefingFeature_', NOW + 60000, TZ)), { ok: false, error: 'not_found' });
  assert.equal(w.drive.searches.length, 1);
  assert.match(SRC, /const BRIEFING_MISSING_CACHE_SECONDS = 300;/); // the missing marker lives 5 minutes
});

test('briefing negative cache: Drive errors are not cached as "missing"', () => {
  let n = 0;
  const w = load({ driveFolders: [{ name: 'Home Life', get files() { n++; throw new Error('Drive is down'); } }] });
  assert.equal(j(w.call('briefingFeature_', NOW, TZ)).ok, false);
  assert.equal(j(w.call('briefingFeature_', NOW, TZ)).ok, false);
  assert.equal(n, 2);
});

test('response cache: an identical second request makes no Drive, Maps or UrlFetch calls and returns the same data', () => {
  const w = fullWorld();
  const a = getBody(w);
  const fetches = w.fetchLog.length; const searches = w.drive.searches.length; const maps = w.mapsLog.length;
  assert.ok(fetches > 0 && searches > 0);
  const b = getBody(w);
  assert.deepEqual(b, a);
  assert.equal(w.fetchLog.length, fetches);
  assert.equal(w.drive.searches.length, searches);
  assert.equal(w.mapsLog.length, maps);
});

test('response cache: keyed by days / from / trip / tripDate; a different key recomputes', () => {
  const w = fullWorld();
  getBody(w);
  getBody(w, { days: '7' });
  getBody(w, { from: '40.0000,-105.0000' });
  const before = w.fetchLog.length;
  getBody(w, { days: '7' }); // now cached
  assert.equal(w.fetchLog.length, before);
  const calls = [];
  const src = SECRET_SRC.replace('function collectEvents_(start, end, tz) {', 'function collectEvents_(start, end, tz) {\n  __count();');
  const w2 = load({ source: src });
  w2.ctx.__count = () => calls.push(1);
  getBody(w2); getBody(w2); getBody(w2, { days: '3' }); getBody(w2, { trip: '47.6062,-122.3321', tripDate: '2027-03-08' }); getBody(w2, { trip: '47.6062,-122.3321', tripDate: '2027-03-08' });
  assert.equal(calls.length, 3);
});

test('response cache: a wrong or missing key is refused and never served from cache, even right after a cached good request', () => {
  const w = fullWorld();
  const good = getBody(w);
  assert.equal(good.ok, true);
  assert.ok([...w.cacheStore.keys()].some((k) => k.startsWith('hl-resp-')));
  for (const parameter of [{ key: 'nope', from: '39.7392,-104.9903' }, { from: '39.7392,-104.9903' }, { key: '', from: '39.7392,-104.9903' }]) {
    assert.equal(w.call('doGet', { parameter }).text, '{"ok":false,"error":"unauthorized"}');
  }
});

test('response cache: oura-connect is never cached and responses over the size cap are not stored', () => {
  const w = load();
  w.call('doGet', { parameter: { key: KEY, action: 'oura-connect' } });
  w.call('doGet', { parameter: { key: KEY, action: 'oura-connect', days: '14' } });
  assert.ok(![...w.cacheStore.keys()].some((k) => k.startsWith('hl-resp-')));
  assert.equal(w.call('responseCacheKey_', 14, { action: 'oura-connect' }), null);
  assert.equal(w.call('responseCacheKey_', 14, { code: 'x', state: 'y' }) !== null, true); // the callback path never reaches it (handled before the key check)
  const big = load({ calendars: [fakeCal(Array.from({ length: 2500 }, (_, i) => fakeEvent({ title: 'x'.repeat(100) + i, startMs: Date.now() + 3600000 + i * 60000, endMs: Date.now() + 3700000 + i * 60000, location: 'y'.repeat(150) })))] });
  const body = getBody(big);
  assert.ok(JSON.stringify(body).length > 500000);
  assert.ok(![...big.cacheStore.keys()].some((k) => k.startsWith('hl-resp-')));
});

test('response cache: the oauth callback path is handled before any caching', () => {
  const w = load();
  w.call('doGet', { parameter: { state: 'unknown', code: 'abc' } });
  assert.ok(![...w.cacheStore.keys()].some((k) => k.startsWith('hl-resp-')));
});

test('timings: per-feature durations go to console.log, never into the response', () => {
  const logs = [];
  const orig = console.log; console.log = (...a) => logs.push(a.join(' '));
  let body;
  try { body = getBody(fullWorld()); } finally { console.log = orig; }
  for (const label of ['calendar', 'parks', 'inbox', 'oura', 'briefing', 'birthdays', 'total']) assert.ok(logs.some((l) => l.startsWith(`hl-timing ${label} `)), label);
  assert.ok(!JSON.stringify(body).includes('hl-timing'));
});

test('parks: schedule and live of several parks are fetched in one parallel round (fetchAll)', () => {
  const d = formatDate(new Date(Date.now() + DAY), TZ, 'yyyy-MM-dd');
  const s = Date.now() + DAY;
  const cal = fakeCal([
    fakeEvent({ title: 'Day at Alpha Park', startMs: s, endMs: s + 3600000, location: '' }),
    fakeEvent({ title: 'Day at Beta Park', startMs: s + 7200000, endMs: s + 10800000, location: '' }),
  ]);
  let rounds = 0;
  const handler = (url) => {
    if (url.includes('/destinations')) return { code: 200, body: { destinations: [{ id: 'd', name: 'D', parks: [{ id: 'a1', name: 'Alpha Park' }, { id: 'b1', name: 'Beta Park' }] }] } };
    if (url.endsWith('/schedule')) return { code: 200, body: { timezone: TZ, schedule: [{ date: d, type: 'OPERATING', openingTime: `${d}T09:00:00-07:00`, closingTime: `${d}T21:00:00-07:00` }] } };
    if (url.endsWith('/live')) return { code: 200, body: { liveData: [] } };
    return { code: 404, body: {} };
  };
  const w = load({ calendars: [cal], fetchHandler: handler });
  const orig = w.ctx.UrlFetchApp.fetchAll;
  w.ctx.UrlFetchApp.fetchAll = (reqs) => { rounds++; return orig(reqs); };
  const r = j(w.call('parksFeature_', w.call('collectEvents_', new Date(Date.now() - 3600000), new Date(Date.now() + 5 * DAY), TZ), Date.now(), TZ));
  assert.equal(r.ok, true);
  assert.equal(r.days.length, 2);
  assert.equal(rounds, 1);
  assert.equal(w.fetchLog.filter((f) => /\/(schedule|live)$/.test(f.url)).length, 4);
});

test('inbox: both Gmail thread searches share one parallel round, then all threads in a second', () => {
  const handler = (url) => {
    if (url.includes('/threads?q=')) return { code: 200, body: { threads: [{ id: url.includes('newer_than%3A10d') || url.includes('inbox') ? 't1' : 't2' }] } };
    if (url.includes('/threads/')) return { code: 200, body: { id: url.includes('t1') ? 't1' : 't2', messages: [] } };
    return { code: 404, body: {} };
  };
  const w = load({ fetchHandler: handler });
  let rounds = 0;
  const orig = w.ctx.UrlFetchApp.fetchAll;
  w.ctx.UrlFetchApp.fetchAll = (reqs) => { rounds++; return orig(reqs); };
  const r = j(w.call('inboxFeature_', NOW, TZ));
  assert.equal(r.ok, true);
  assert.equal(rounds, 2);
  // a failing package search still leaves the waiting list
  const w2 = load({ fetchHandler: (url) => (url.includes('delivery') || url.includes('out%20for') ? { code: 500, body: '' } : handler(url)) });
  assert.equal(j(w2.call('inboxFeature_', NOW, TZ)).ok, true);
  // a failing waiting search fails the feature
  const w3 = load({ fetchHandler: () => ({ code: 500, body: '' }) });
  assert.equal(j(w3.call('inboxFeature_', NOW, TZ)).ok, false);
});
