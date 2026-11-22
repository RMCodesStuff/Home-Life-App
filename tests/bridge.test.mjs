// Tests for calendar-bridge/Code.gs. The script is loaded into a node:vm context with minimal fakes for the
// Apps Script globals, so the pure helpers and doGet run for real. Everything here is fictional.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(new URL('../calendar-bridge/Code.gs', import.meta.url), 'utf8');
const TZ = 'America/Denver';
const KEY = 'test-key-not-a-real-secret-0000';
const SECRET_SRC = SRC.replace('__PASTE_SECRET_HERE__', KEY);
const j = (x) => JSON.parse(JSON.stringify(x)); // cross-realm objects -> plain objects

function formatDate(d, tz, fmt) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(d).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  const offMin = Math.round((asUtc - Math.floor(d.getTime() / 1000) * 1000) / 60000);
  const sign = offMin < 0 ? '-' : '+';
  const oh = String(Math.floor(Math.abs(offMin) / 60)).padStart(2, '0');
  const om = String(Math.abs(offMin) % 60).padStart(2, '0');
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  if (fmt === 'yyyy-MM-dd') return date;
  return `${date}T${parts.hour}:${parts.minute}:${parts.second}${sign}${oh}:${om}`;
}

// Apps Script style iterator
function iter(arr) { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; }
// Utilities.parseDate(text, tz, 'yyyy-MM-dd HH:mm'): find the instant whose wall clock in tz reads `text`
function parseDateIn(text, tz) {
  const [d, t] = text.split(' ');
  const [y, mo, da] = d.split('-').map(Number);
  const [h, mi] = t.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, da, h, mi);
  let ms = guess;
  for (let i = 0; i < 3; i++) {
    const f = formatDate(new Date(ms), tz, "yyyy-MM-dd'T'HH:mm:ssXXX");
    const off = f.slice(-6);
    const sign = off[0] === '-' ? -1 : 1;
    ms = guess - sign * (Number(off.slice(1, 3)) * 60 + Number(off.slice(4))) * 60000;
  }
  return new Date(ms);
}

/** Build a fresh script context. `world` lets each test script the outside world. */
function load({ source = SECRET_SRC, props = {}, calendars = [], fetchHandler = () => ({ code: 404, body: '{}' }), directions = () => null, driveFolders = [] } = {}) {
  const store = new Map();
  const cacheStore = new Map();
  const propStore = { ...props };
  const world = { fetchLog: [], mapsLog: [], store, propStore, cacheStore };
  const resp = (r) => ({ getResponseCode: () => r.code, getContentText: () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)) });
  let uuid = 0;
  const sandbox = {
    Session: { getScriptTimeZone: () => TZ },
    Utilities: { formatDate, getUuid: () => `uuid-${++uuid}`, parseDate: parseDateIn },
    DriveApp: { getFoldersByName: (name) => iter(driveFolders.filter((f) => f.name === name).map((f) => ({ getFiles: () => iter(f.files) }))) },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (cacheStore.has(k) ? cacheStore.get(k) : null),
        put: (k, v) => { cacheStore.set(k, v); },
        remove: (k) => { cacheStore.delete(k); },
      }),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in propStore ? propStore[k] : null),
        setProperties: (o) => Object.assign(propStore, o),
        setProperty: (k, v) => { propStore[k] = v; },
      }),
    },
    ScriptApp: { getOAuthToken: () => 'gmail-oauth-token-fake-1234567890', getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/FAKE_DEPLOYMENT/exec' }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (text) => ({ text, setMimeType() { return this; } }) },
    HtmlService: { createHtmlOutput: (html) => ({ html, setTitle(t) { this.title = t; return this; } }) },
    CalendarApp: { getAllCalendars: () => calendars, GuestStatus: { NO: 'NO', YES: 'YES' } },
    UrlFetchApp: {
      fetch: (url, opts) => { world.fetchLog.push({ url, opts }); return resp(fetchHandler(url, opts)); },
      fetchAll: (reqs) => reqs.map((r) => { world.fetchLog.push({ url: r.url, opts: r }); return resp(fetchHandler(r.url, r)); }),
    },
    Maps: {
      DirectionFinder: { Mode: { DRIVING: 'DRIVING' } },
      newDirectionFinder() {
        const q = {};
        const b = {
          setOrigin(a, c) { q.origin = [a, c]; return b; }, setDestination(d) { q.dest = d; return b; },
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
  world.get = (expr) => vm.runInContext(expr, ctx);
  return world;
}

const NOW = Date.parse('2026-11-22T14:00:00Z'); // 7:00am in Denver
const hdrs = (from, subject) => [{ name: 'From', value: from }, { name: 'Subject', value: subject }, { name: 'Date', value: 'x' }];
const msg = (ms, from, subject, snippet, labels = ['INBOX', 'UNREAD']) => ({ id: `m${ms}`, internalDate: String(ms), snippet, labelIds: labels, payload: { headers: hdrs(from, subject) } });
const thread = (id, ...messages) => ({ id, messages });
const AGO = (h) => NOW - h * 3600000;

// ------------------------------------------------------------------ the file itself

test('Code.gs has exactly one secret placeholder and parses', () => {
  assert.equal(SRC.split('__PASTE_SECRET_HERE__').length - 1, 1);
  assert.match(SRC, /const SECRET = '__PASTE_SECRET_HERE__';/);
  assert.doesNotThrow(() => new vm.Script(SRC));
  for (const name of ['ENABLE_GMAIL', 'ENABLE_LEAVE_BY', 'ENABLE_BRIEFING', 'ENABLE_PARKS', 'ENABLE_TRIP_DRIVE', 'ENABLE_BIRTHDAYS', 'DEFAULT_DAYS']) assert.ok(SRC.includes(`const ${name}`), name);
});

test('appsscript.json is valid, read-only, and has the time zone placeholder', () => {
  const raw = fs.readFileSync(new URL('../calendar-bridge/appsscript.json', import.meta.url), 'utf8');
  const m = JSON.parse(raw);
  assert.equal(m.timeZone, '__TIME_ZONE__');
  assert.equal(m.runtimeVersion, 'V8');
  assert.deepEqual(m.webapp, { executeAs: 'USER_DEPLOYING', access: 'ANYONE_ANONYMOUS' });
  assert.deepEqual(m.oauthScopes, [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/contacts.readonly',
    'https://www.googleapis.com/auth/script.external_request',
  ]);
  assert.ok(!m.oauthScopes.some((s) => /gmail\.(modify|send|compose)|mail\.google\.com|calendar$|auth\/drive$|drive\.file|contacts$/.test(s)));
  assert.ok(raw.replace('__TIME_ZONE__', 'America/Denver').includes('America/Denver'));
});

// ------------------------------------------------------------------ gmail: waiting on you

test('displayName_: strips the address, falls back to the local part', () => {
  const w = load();
  assert.equal(w.call('displayName_', 'Little Shop <hello@littleshop.example>'), 'Little Shop');
  assert.equal(w.call('displayName_', '"Maple Dental" <front@maple.example>'), 'Maple Dental');
  assert.equal(w.call('displayName_', 'front.desk@maple.example'), 'front.desk');
  assert.equal(w.call('displayName_', '<jo@x.example>'), 'jo');
  assert.equal(w.call('displayName_', 'Plain Name'), 'Plain Name');
});

test('classifyThread_: action patterns map to reasons', () => {
  const w = load();
  const c = (subject, snippet = '', labels) => j(w.call('classifyThread_', thread('t', msg(AGO(5), 'A <a@x.example>', subject, snippet, labels))));
  assert.deepEqual(c('Quick question', 'Please confirm your appointment on Friday'), { reason: 'asks you to confirm' });
  assert.deepEqual(c('Quick question', 'kindly confirm by noon'), { reason: 'asks you to confirm' });
  assert.deepEqual(c('Block party', 'RSVP by Thursday'), { reason: 'wants an rsvp' });
  assert.deepEqual(c('Re: ride', 'Let me know if that works'), { reason: 'waiting for your reply' });
  assert.deepEqual(c('Re: ride', 'please reply by tonight'), { reason: 'waiting for your reply' });
  assert.deepEqual(c('Action required: update your details', ''), { reason: 'action needed' });
  assert.deepEqual(c('Your lease', 'Please sign the lease agreement'), { reason: 'needs a signature' });
  assert.deepEqual(c('Review and sign', 'sent via DocuSign'), { reason: 'needs a signature' });
  assert.deepEqual(c('Invoice 1042', 'Your balance is due tomorrow'), { reason: 'payment due' });
  assert.deepEqual(c('Expense report', 'needs your approval'), { reason: 'needs your approval' });
  assert.equal(c('Weekly newsletter', 'ten tips for a tidy garage'), null);
});

test('classifyThread_: needs UNREAD or IMPORTANT, ignores receipts, honours stars and replies', () => {
  const w = load();
  const one = (labels, subject, snippet, extra = []) => j(w.call('classifyThread_', thread('t', ...extra, msg(AGO(3), 'Shop <s@x.example>', subject, snippet, labels))));
  // already read and not important: not a task
  assert.equal(one(['INBOX'], 'RSVP please', 'rsvp by friday'), null);
  // IMPORTANT counts even when read
  assert.deepEqual(one(['INBOX', 'IMPORTANT'], 'RSVP please', 'rsvp by friday'), { reason: 'wants an rsvp' });
  // plain order confirmation is a receipt, not "asks you to confirm"
  assert.equal(one(['INBOX', 'UNREAD'], 'Order Confirmation #1234', 'Thanks for your order. We will email you when it ships.'), null);
  assert.equal(one(['INBOX', 'UNREAD'], 'Your receipt from Northwind', 'Total $12.00. Paid with card ending 0000.'), null);
  assert.equal(one(['INBOX', 'UNREAD'], 'Your verification code', 'Your security code is 123456. It expires in ten minutes.'), null);
  // ...but a confirmation email whose body asks for a reply is caught
  assert.deepEqual(one(['INBOX', 'UNREAD'], 'Booking confirmation', 'To keep your table, reply CONFIRM to this email.'), { reason: 'asks you to confirm' });
  // starred threads always count
  assert.deepEqual(one(['INBOX', 'STARRED'], 'Garage ideas', 'nothing actionable here'), { reason: 'starred' });
  // newest message sent by the user: already replied, even when starred earlier
  const replied = j(w.call('classifyThread_', thread('t',
    msg(AGO(9), 'Shop <s@x.example>', 'RSVP please', 'rsvp by friday', ['INBOX', 'UNREAD', 'STARRED']),
    msg(AGO(2), 'Me <me@x.example>', 'Re: RSVP please', 'yes, we will be there', ['SENT']))));
  assert.equal(replied, null);
  // the newest message decides, not the first one in the array
  const reordered = j(w.call('classifyThread_', thread('t',
    msg(AGO(2), 'Shop <s@x.example>', 'Re: plans', 'please reply by tonight', ['INBOX', 'UNREAD']),
    msg(AGO(9), 'Me <me@x.example>', 'plans', 'hello', ['SENT']))));
  assert.deepEqual(reordered, { reason: 'waiting for your reply' });
});

test('buildWaiting_: newest first, at most 5, trimmed fields, entities decoded', () => {
  const w = load();
  const threads = [];
  for (let i = 0; i < 8; i++) threads.push(thread(`t${i}`, msg(AGO(10 - i), `Sender ${i} <s${i}@x.example>`, `RSVP ${i}`, `rsvp needed &#39;soon&#39; ${'x'.repeat(200)}`)));
  threads.push(thread('skip', msg(AGO(1), 'News <n@x.example>', 'Weekly digest', 'nothing to do')));
  const out = j(w.call('buildWaiting_', threads));
  assert.equal(out.length, 5);
  assert.deepEqual(out.map((x) => x.id), ['t7', 't6', 't5', 't4', 't3']);
  assert.equal(out[0].from, 'Sender 7');
  assert.equal(out[0].reason, 'wants an rsvp');
  assert.ok(out[0].snippet.length <= 120);
  assert.ok(out[0].snippet.startsWith("rsvp needed 'soon'"));
  assert.equal(out[0].url, 'https://mail.google.com/mail/u/0/#all/t7');
  assert.equal(out[0].date, new Date(AGO(3)).toISOString());
  assert.deepEqual(Object.keys(out[0]).sort(), ['date', 'from', 'id', 'reason', 'snippet', 'subject', 'url']);
});

// ------------------------------------------------------------------ gmail: packages

test('merchantName_: strips noise words and domains', () => {
  const w = load();
  const m = (s) => w.call('merchantName_', s);
  assert.equal(m('Amazon.com <ship-confirm@amazon.com>'), 'amazon');
  assert.equal(m('Northwind Orders <orders@northwind.example>'), 'northwind');
  assert.equal(m('Acme Shipping Inc <ship@acme.example>'), 'acme');
  assert.equal(m('"Little Shop" <hi@littleshop.example>'), 'little shop');
  assert.equal(m('Parcel Co. Delivery Updates <u@parcel.example>'), 'parcel');
  assert.equal(m('tracking@acmepost.example'), 'acmepost'); // no display name: use the domain
});

test('packageStatus_: priority, today-only delivered, plain shipped dropped', () => {
  const w = load();
  const s = (subject, snippet = '', ms = NOW - 3600000) => w.call('packageStatus_', subject, snippet, ms, NOW, TZ);
  assert.equal(s('Your package was delivered', 'Left at the front door'), 'delivered');
  assert.equal(s('Delivered: Garden gloves', ''), 'delivered');
  assert.equal(s('Out for delivery', 'Arriving today by 8pm'), 'out for delivery');
  assert.equal(s('Arriving today: your order', ''), 'arriving today');
  assert.equal(s('Your order will be delivered today', ''), 'arriving today');
  assert.equal(s('Arriving tomorrow', 'Your order is on the way'), 'arriving tomorrow');
  assert.equal(s('Your order has shipped', 'It is on its way'), null);
  assert.equal(s('Your order will be delivered soon', ''), null);
  // delivered and out-for-delivery both present: delivered wins; yesterday's mail is stale
  assert.equal(s('Delivered', 'earlier it was out for delivery'), 'delivered');
  assert.equal(s('Delivered', '', NOW - 30 * 3600000), null);
  assert.equal(s('Out for delivery', '', NOW - 30 * 3600000), null);
});

test('buildPackages_: dedupes by merchant+status, newest first, at most 4', () => {
  const w = load();
  const t = (id, hoursAgo, from, subject) => thread(id, msg(AGO(hoursAgo), from, subject, ''));
  const threads = [
    t('a1', 5, 'Northwind Orders <o@northwind.example>', 'Out for delivery'),
    t('a2', 4, 'Northwind Orders <o@northwind.example>', 'Out for delivery: your second box'),
    t('b', 3, 'Acme Shipping <s@acme.example>', 'Delivered: your parcel'),
    t('c', 2, 'Little Shop <h@littleshop.example>', 'Arriving tomorrow'),
    t('d', 1, 'Parcel Co <u@parcel.example>', 'Arriving today'),
    t('e', 0.5, 'Maple Goods <u@maple.example>', 'Arriving today'),
    t('f', 6, 'Quiet Mail <q@quiet.example>', 'Your order has shipped'),
  ];
  const out = j(w.call('buildPackages_', threads, NOW, TZ));
  assert.equal(out.length, 4);
  assert.deepEqual(out.map((x) => `${x.merchant}:${x.status}`), ['maple goods:arriving today', 'parcel:arriving today', 'little shop:arriving tomorrow', 'acme:delivered']);
  assert.deepEqual(Object.keys(out[0]).sort(), ['date', 'id', 'merchant', 'status', 'subject', 'url']);
  const dedupe = j(w.call('buildPackages_', threads.slice(0, 2), NOW, TZ));
  assert.equal(dedupe.length, 1);
  assert.equal(dedupe[0].id, 'a2'); // the newest of the duplicates
});

// ------------------------------------------------------------------ leave-by

test('parseFromParam_ and isPhysicalLocation_', () => {
  const w = load();
  assert.deepEqual(j(w.call('parseFromParam_', '39.7400,-104.9900')), { lat: 39.74, lng: -104.99 });
  assert.equal(w.call('parseFromParam_', ''), null);
  assert.equal(w.call('parseFromParam_', 'abc'), null);
  assert.equal(w.call('parseFromParam_', '95,10'), null);
  assert.equal(w.call('parseFromParam_', '10,200'), null);
  assert.equal(w.call('isPhysicalLocation_', '100 Example Ave, Denver, CO'), true);
  for (const bad of ['', 'https://zoom.us/j/1', 'meet.google.com/abc', 'Microsoft Teams: teams.microsoft.com/x', 'Webex', 'Online']) assert.equal(w.call('isPhysicalLocation_', bad), false, bad);
});

test('computeTravel_: leave by = start - drive - 5 min, floored to the minute, with the zone offset', () => {
  const w = load();
  const start = Date.parse('2026-11-22T15:30:00Z'); // 8:30am Denver
  const t = j(w.call('computeTravel_', start, 22 * 60 + 17, 9.8 * 1609.344, TZ)); // 22m17s drive
  assert.equal(t.minutes, 22);
  assert.equal(t.miles, 9.8);
  // 8:30:00 - 22:17 - 5:00 = 8:02:43 -> floored to 8:02
  assert.equal(t.leaveBy, '2026-11-22T08:02:00-07:00');
  assert.deepEqual(Object.keys(t), ['minutes', 'miles', 'leaveBy']);
});

function leaveWorld(directionsFn) {
  return load({ directions: directionsFn });
}
const route = (seconds, meters = 8000, key = 'duration') => ({ routes: [{ legs: [{ [key]: { value: seconds }, distance: { value: meters } }] }] });
const timed = (id, startMs, location) => ({ id, title: id, allDay: false, start: '', end: '', location, startMs, sortKey: startMs });

test('addLeaveBy_: adds travel to physical timed events only, within the window, under 3 hours', () => {
  const w = leaveWorld((q) => (q.dest.includes('Nowhere') ? { routes: [] } : q.dest.includes('Far') ? route(4 * 3600, 400000) : route(20 * 60, 8000)));
  const from = { lat: 39.74, lng: -104.99 };
  const events = [
    timed('ok', NOW + 3600000, '1 Chapel Rd, Denver, CO'),
    timed('zoom', NOW + 7200000, 'https://zoom.us/j/1'),
    timed('past', NOW - 3600000, '2 Chapel Rd, Denver, CO'),
    timed('later', NOW + 40 * 3600000, '3 Chapel Rd, Denver, CO'), // beyond tomorrow noon
    timed('noroute', NOW + 3 * 3600000, 'Nowhere Lane'),
    timed('far', NOW + 4 * 3600000, 'Far Away Airport'),
    { ...timed('allday', NOW + 3600000, '4 Chapel Rd'), allDay: true },
    timed('empty', NOW + 5 * 3600000, ''),
  ];
  w.call('addLeaveBy_', events, from, NOW, TZ);
  const by = Object.fromEntries(j(events).map((e) => [e.id, e.travel]));
  assert.equal(by.ok.minutes, 20);
  assert.equal(by.ok.leaveBy, '2026-11-22T07:35:00-07:00'); // 8:00 start, minus 20, minus 5
  for (const id of ['zoom', 'past', 'later', 'noroute', 'far', 'allday', 'empty']) assert.equal(by[id], undefined, id);
  const q = j(w.mapsLog.find((x) => x.dest.startsWith('1 Chapel')));
  assert.deepEqual(q.origin, [39.74, -104.99]);
  assert.equal(q.mode, 'DRIVING');
  // depart is event start minus 30 minutes (never in the past)
  assert.equal(new Date(w.mapsLog.find((x) => x.dest.startsWith('1 Chapel')).depart).getTime(), NOW + 3600000 - 30 * 60000);
});

test('addLeaveBy_: prefers duration_in_traffic, caps lookups at 8, and caches per origin|destination|hour', () => {
  const w = leaveWorld(() => ({ routes: [{ legs: [{ duration: { value: 600 }, duration_in_traffic: { value: 1500 }, distance: { value: 3000 } }] }] }));
  const from = { lat: 39.74, lng: -104.99 };
  const make = () => Array.from({ length: 12 }, (_, i) => timed(`e${i}`, NOW + (1 + i) * 1200000, `${i} Test Street`));
  const first = make();
  w.call('addLeaveBy_', first, from, NOW, TZ);
  assert.equal(w.mapsLog.length, 8);
  assert.equal(j(first).filter((e) => e.travel).length, 8);
  assert.equal(j(first)[0].travel.minutes, 25); // in-traffic, not the 10 minute base
  // second request: the 8 cached ones need no lookups, and the cap still applies to the rest
  const second = make();
  w.call('addLeaveBy_', second, from, NOW, TZ);
  assert.equal(w.mapsLog.length, 8 + 4);
  assert.equal(j(second).filter((e) => e.travel).length, 12);
});

test('addLeaveBy_: a Maps error skips that event and the rest still work', () => {
  let n = 0;
  const w = leaveWorld(() => { n++; if (n === 1) throw new Error('Maps quota'); return route(900); });
  const events = [timed('a', NOW + 3600000, '1 A St'), timed('b', NOW + 7200000, '2 B St')];
  w.call('addLeaveBy_', events, { lat: 1, lng: 1 }, NOW, TZ);
  const e = j(events);
  assert.equal(e[0].travel, undefined);
  assert.equal(e[1].travel.minutes, 15);
});

// ------------------------------------------------------------------ oura

const rd = (day, score, td = 0.1) => ({ day, score, temperature_deviation: td });
const ds = (day, score) => ({ day, score });
const sl = (day, o = {}) => ({ day, type: 'long_sleep', total_sleep_duration: 25000, deep_sleep_duration: 4000, rem_sleep_duration: 5000, efficiency: 90, average_hrv: 45, lowest_heart_rate: 52, bedtime_start: `${day}T22:30:00-07:00`, bedtime_end: `${day}T06:30:00-07:00`, ...o });

test('pickOura_: latest day, long_sleep preferred, fields optional', () => {
  const w = load();
  const out = j(w.call('pickOura_',
    [rd('2026-11-20', 70), rd('2026-11-22', 64, -0.2), rd('2026-11-21', 80)],
    [ds('2026-11-22', 84), ds('2026-11-21', 80)],
    [sl('2026-11-22', { type: 'rest', total_sleep_duration: 99999 }), sl('2026-11-22', { total_sleep_duration: 25920 }), sl('2026-11-21')]));
  assert.equal(out.ok, true);
  assert.equal(out.day, '2026-11-22');
  assert.deepEqual(out.readiness, { score: 64, temperatureDeviation: -0.2 });
  assert.equal(out.sleep.score, 84);
  assert.equal(out.sleep.totalSec, 25920); // the long_sleep record, not the longer "rest" one
  assert.equal(out.sleep.efficiency, 90);
  assert.equal(out.sleep.bedtimeStart, '2026-11-22T22:30:00-07:00');
});

test('pickOura_: falls back to the longest record and tolerates missing pieces', () => {
  const w = load();
  const out = j(w.call('pickOura_', [], [ds('2026-11-22', 77)], [sl('2026-11-22', { type: 'rest', total_sleep_duration: 1000 }), sl('2026-11-22', { type: 'late_nap', total_sleep_duration: 9000 })]));
  assert.equal(out.sleep.totalSec, 9000);
  assert.equal(out.readiness, null);
  const empty = j(w.call('pickOura_', [], [], []));
  assert.equal(empty.ok, false);
  const bare = j(w.call('pickOura_', [{ day: '2026-11-22' }], [], []));
  assert.equal(bare.ok, true);
  assert.deepEqual(bare.readiness, { score: null, temperatureDeviation: null });
  assert.equal(bare.sleep, null);
});

test('pickOura_: week averages cover the previous 7 days and exclude the latest', () => {
  const w = load();
  const days = ['2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21'];
  const readiness = [...days.map((d, i) => rd(d, 70 + i)), rd('2026-11-22', 90)];
  const dailySleep = [...days.map((d, i) => ds(d, 80 + i)), ds('2026-11-22', 50)];
  const sleeps = [...days.map((d) => sl(d, { total_sleep_duration: 25200 })), sl('2026-11-22', { total_sleep_duration: 1 })];
  const out = j(w.call('pickOura_', readiness, dailySleep, sleeps));
  // window is 11-15..11-21 (7 days); 11-14 is outside, 11-22 is the latest and excluded
  assert.equal(out.week.readinessAvg, Math.round((71 + 72 + 73 + 74 + 75 + 76 + 77) / 7));
  assert.equal(out.week.sleepScoreAvg, Math.round((81 + 82 + 83 + 84 + 85 + 86 + 87) / 7));
  assert.equal(out.week.totalSecAvg, 25200);
  const thin = j(w.call('pickOura_', [rd('2026-11-22', 70)], [ds('2026-11-22', 70)], [sl('2026-11-22')]));
  assert.deepEqual(thin.week, { readinessAvg: null, sleepScoreAvg: null, totalSecAvg: null });
});

// ------------------------------------------------------------------ doGet

const GOOD_PROPS = { OURA_CLIENT_ID: 'cid-fake', OURA_CLIENT_SECRET: 'csecret-fake-value-not-real-0001', OURA_ACCESS_TOKEN: 'access-token-fake-abcdefghijklmnopqrstuvwxyz', OURA_REFRESH_TOKEN: 'refresh-token-fake-abcdefghijklmnopqrstuvwxyz', OURA_EXPIRES_AT: String(Date.now() + 3600000) };

function fakeEvent({ id, title, startMs, endMs, location = '', status = 'YES', allDay = false }) {
  return {
    getId: () => id, getTitle: () => title, getMyStatus: () => status, isAllDayEvent: () => allDay, getLocation: () => location,
    getStartTime: () => new Date(startMs), getEndTime: () => new Date(endMs), getAllDayStartDate: () => new Date(startMs), getAllDayEndDate: () => new Date(endMs),
  };
}
const fakeCal = (events, name = 'Personal') => ({ getName: () => name, isHidden: () => false, isSelected: () => true, getEvents: () => events });

test('doGet: a wrong or missing key is unauthorized and never leaks tokens or touches the network', () => {
  const w = load({ props: GOOD_PROPS });
  for (const params of [{}, { key: 'nope' }, { key: 'nope', action: 'oura-connect' }, { key: '' , days: '3' }]) {
    const out = w.call('doGet', { parameter: params });
    assert.equal(out.text, '{"ok":false,"error":"unauthorized"}');
    for (const v of Object.values(GOOD_PROPS)) assert.ok(!out.text.includes(v));
  }
  assert.equal(w.call('doGet', undefined).text, '{"ok":false,"error":"unauthorized"}');
  assert.equal(w.fetchLog.length, 0);
  assert.equal(w.mapsLog.length, 0);
});

test('doGet: v2 fields are all still present, with version 3;  events, travel, inbox and oura; no secrets in the body', () => {
  const start = Date.now() + 2 * 3600000;
  const cal = fakeCal([
    fakeEvent({ id: 'ev1', title: 'Chapel meetup', startMs: start, endMs: start + 3600000, location: '1 Chapel Rd, Denver, CO' }),
    fakeEvent({ id: 'ev2', title: 'Declined thing', startMs: start, endMs: start + 3600000, status: 'NO' }),
  ]);
  const gmailThreads = { threads: [{ id: 'w1' }] };
  const handler = (url) => {
    if (url.includes('/threads?q=') && url.includes('in%3Ainbox')) return { code: 200, body: gmailThreads };
    if (url.includes('/threads?q=')) return { code: 200, body: { threads: [{ id: 'p1' }] } };
    if (url.includes('/threads/w1')) return { code: 200, body: thread('w1', msg(Date.now() - 3600000, 'Little Shop <hi@littleshop.example>', 'Please confirm your pickup', 'Please confirm your pickup time')) };
    if (url.includes('/threads/p1')) return { code: 200, body: thread('p1', msg(Date.now() - 1800000, 'Northwind Orders <o@northwind.example>', 'Out for delivery', 'Arriving today')) };
    if (url.includes('/destinations')) return { code: 200, body: { destinations: [{ id: 'd1', name: 'Somewhere', parks: [{ id: 'p-fake', name: 'Fake Land Park' }] }] } };
    if (url.includes('people.googleapis.com')) return { code: 200, body: { connections: [] } };
    if (url.includes('daily_readiness')) return { code: 200, body: { data: [rd('2026-11-22', 64)] } };
    if (url.includes('daily_sleep')) return { code: 200, body: { data: [ds('2026-11-22', 84)] } };
    if (url.includes('/usercollection/sleep')) return { code: 200, body: { data: [sl('2026-11-22')] } };
    return { code: 404, body: {} };
  };
  const w = load({ props: GOOD_PROPS, calendars: [cal], fetchHandler: handler, directions: () => route(1320, 15800) });
  const out = w.call('doGet', { parameter: { key: KEY, days: '3', from: '39.7400,-104.9900' } });
  const body = JSON.parse(out.text);
  assert.equal(body.ok, true);
  assert.equal(body.version, 3);
  assert.equal(body.timeZone, TZ);
  assert.deepEqual(body.features, { gmail: true, leaveBy: true, oura: true, briefing: true, parks: true, tripDrive: true, birthdays: true });
  assert.equal(body.events.length, 1);
  assert.equal(body.events[0].travel.minutes, 22);
  assert.equal(body.events[0].travel.miles, 9.8);
  assert.ok(body.events[0].travel.leaveBy.endsWith('-07:00'));
  assert.ok(!('startMs' in body.events[0]) && !('sortKey' in body.events[0]));
  assert.equal(body.inbox.ok, true);
  assert.equal(body.inbox.waiting[0].reason, 'asks you to confirm');
  assert.equal(body.inbox.waiting[0].from, 'Little Shop');
  assert.equal(body.inbox.packages[0].status, 'out for delivery');
  assert.equal(body.oura.ok, true);
  assert.equal(body.oura.readiness.score, 64);
  assert.equal(body.oura.sleep.score, 84);
  assert.ok(!out.text.includes('token') || !/access-token-fake|refresh-token-fake|csecret-fake/.test(out.text));
  for (const v of [GOOD_PROPS.OURA_ACCESS_TOKEN, GOOD_PROPS.OURA_REFRESH_TOKEN, GOOD_PROPS.OURA_CLIENT_SECRET, 'gmail-oauth-token-fake']) assert.ok(!out.text.includes(v), v);
  // Gmail was called with the bearer token, read-only endpoints only
  const gmailCalls = w.fetchLog.filter((c) => c.url.startsWith('https://gmail.googleapis.com/'));
  assert.ok(gmailCalls.length >= 3);
  assert.ok(gmailCalls.every((c) => /^Bearer gmail-oauth-token/.test(c.opts.headers.Authorization)));
  // a second request is served from the cache for inbox and oura
  const before = w.fetchLog.length;
  w.call('doGet', { parameter: { key: KEY } });
  assert.equal(w.fetchLog.length, before);
});

test('doGet: no from param means no leave-by; features fail independently and report why', () => {
  const start = Date.now() + 3600000;
  const cal = fakeCal([fakeEvent({ id: 'ev1', title: 'Chapel meetup', startMs: start, endMs: start + 3600000, location: '1 Chapel Rd, Denver, CO' })]);
  const w = load({ calendars: [cal], fetchHandler: () => ({ code: 403, body: '{}' }), directions: () => route(600) });
  const body = JSON.parse(w.call('doGet', { parameter: { key: KEY } }).text);
  assert.equal(body.ok, true);
  assert.equal(w.mapsLog.length, 0);
  assert.equal(body.events[0].travel, undefined);
  assert.equal(body.inbox.ok, false);
  assert.match(body.inbox.error, /gmail access not approved/);
  assert.deepEqual(body.oura, { ok: false, error: 'not_configured' });
  assert.equal(body.features.oura, false);
  assert.equal(body.events.length, 1); // the calendar is unaffected by the failures
});

test('doGet: disabled features are reported as disabled', () => {
  const src = SECRET_SRC.replace('const ENABLE_GMAIL = true', 'const ENABLE_GMAIL = false').replace('const ENABLE_LEAVE_BY = true', 'const ENABLE_LEAVE_BY = false')
    .replace('const ENABLE_BRIEFING = true', 'const ENABLE_BRIEFING = false').replace('const ENABLE_PARKS = true', 'const ENABLE_PARKS = false')
    .replace('const ENABLE_TRIP_DRIVE = true', 'const ENABLE_TRIP_DRIVE = false').replace('const ENABLE_BIRTHDAYS = true', 'const ENABLE_BIRTHDAYS = false');
  const start = Date.now() + 3600000;
  const w = load({ source: src, calendars: [fakeCal([fakeEvent({ id: 'e', title: 'x', startMs: start, endMs: start + 1, location: '1 A St' })])], directions: () => route(600) });
  const body = JSON.parse(w.call('doGet', { parameter: { key: KEY, from: '39.74,-104.99', trip: '33.8,-117.9', tripDate: '2026-11-23' } }).text);
  assert.deepEqual(body.inbox, { ok: false, error: 'disabled' });
  for (const k of ['briefing', 'parks', 'tripDrive', 'birthdays']) assert.deepEqual(body[k], { ok: false, error: 'disabled' }, k);
  assert.deepEqual(body.features, { gmail: false, leaveBy: false, oura: false, briefing: false, parks: false, tripDrive: false, birthdays: false });
  assert.equal(body.features.gmail, false);
  assert.equal(body.features.leaveBy, false);
  assert.equal(w.mapsLog.length, 0);
  assert.equal(w.fetchLog.length, 0);
});

test('oura: configured but not connected yet', () => {
  const w = load({ props: { OURA_CLIENT_ID: 'cid', OURA_CLIENT_SECRET: 'sec' }, fetchHandler: () => ({ code: 200, body: { threads: [] } }) });
  const body = JSON.parse(w.call('doGet', { parameter: { key: KEY } }).text);
  assert.deepEqual(body.oura, { ok: false, error: 'not_connected' });
});

test('oura: an expired token refreshes first, and the rotated refresh token is stored', () => {
  const props = { ...GOOD_PROPS, OURA_EXPIRES_AT: String(NOW - 1000) };
  const handler = (url, opts) => {
    if (url.endsWith('/oauth/token')) {
      assert.equal(opts.payload.grant_type, 'refresh_token');
      assert.equal(opts.payload.refresh_token, GOOD_PROPS.OURA_REFRESH_TOKEN);
      return { code: 200, body: { access_token: 'new-access-token-fake-abcdefghijklmnopqrstuv', refresh_token: 'new-refresh-token-fake-abcdefghijklmnopqrstuv', expires_in: 86400 } };
    }
    if (url.includes('daily_readiness')) { assert.equal(opts.headers.Authorization, 'Bearer new-access-token-fake-abcdefghijklmnopqrstuv'); return { code: 200, body: { data: [rd('2026-11-22', 70)] } }; }
    return { code: 200, body: { data: [] } };
  };
  const w = load({ props, fetchHandler: handler });
  const out = w.call('ouraFeature_', NOW, TZ);
  assert.equal(out.ok, true);
  assert.equal(w.propStore.OURA_REFRESH_TOKEN, 'new-refresh-token-fake-abcdefghijklmnopqrstuv');
  assert.equal(w.propStore.OURA_ACCESS_TOKEN, 'new-access-token-fake-abcdefghijklmnopqrstuv');
  assert.ok(Number(w.propStore.OURA_EXPIRES_AT) > NOW);
});

test('oura: a 401 refreshes once and retries once; a 403 after connect says membership required', () => {
  let tokenCalls = 0;
  let dataCalls = 0;
  const handler = (url) => {
    if (url.endsWith('/oauth/token')) { tokenCalls++; return { code: 200, body: { access_token: 'fresh-access-token-fake-abcdefghijklmnopqrstuv', refresh_token: 'fresh-refresh-token-fake-abcdefghijklmnopqrstuv', expires_in: 86400 } }; }
    dataCalls++;
    return dataCalls <= 3 ? { code: 401, body: {} } : { code: 200, body: { data: url.includes('readiness') ? [rd('2026-11-22', 71)] : [] } };
  };
  const w = load({ props: GOOD_PROPS, fetchHandler: handler });
  const out = w.call('ouraFeature_', Date.now(), TZ);
  assert.equal(out.ok, true);
  assert.equal(tokenCalls, 1);
  assert.equal(dataCalls, 6);

  const w2 = load({ props: GOOD_PROPS, fetchHandler: (url) => (url.endsWith('/oauth/token') ? { code: 200, body: { access_token: 'x'.repeat(30), refresh_token: 'y'.repeat(30), expires_in: 10 } } : { code: 403, body: {} }) });
  const denied = j(w2.call('ouraFeature_', Date.now(), TZ));
  assert.equal(denied.ok, false);
  assert.equal(denied.error, 'auth_failed');
  assert.equal(denied.message, 'oura refused access (membership required for gen3 and newer)');
  const persistent401 = load({ props: GOOD_PROPS, fetchHandler: (url) => (url.endsWith('/oauth/token') ? { code: 200, body: { access_token: 'x'.repeat(30), refresh_token: 'y'.repeat(30), expires_in: 10 } } : { code: 401, body: {} }) });
  assert.equal(j(persistent401.call('ouraFeature_', Date.now(), TZ)).error, 'auth_failed');
});

test('oura-connect: needs the key, issues a cached state, links to the authorize page; callback validates state', () => {
  const props = { OURA_CLIENT_ID: 'cid-fake', OURA_CLIENT_SECRET: 'csecret-fake-value-not-real-0001' };
  const handler = (url, opts) => {
    assert.ok(url.endsWith('/oauth/token'));
    assert.equal(opts.payload.grant_type, 'authorization_code');
    assert.equal(opts.payload.code, 'auth-code-fake');
    assert.equal(opts.payload.redirect_uri, 'https://script.google.com/macros/s/FAKE_DEPLOYMENT/exec');
    assert.equal(opts.payload.client_id, 'cid-fake');
    return { code: 200, body: { access_token: 'granted-access-token-fake-abcdefghijklmnop', refresh_token: 'granted-refresh-token-fake-abcdefghijklmnop', expires_in: 86400 } };
  };
  const w = load({ props, fetchHandler: handler });
  assert.equal(w.call('doGet', { parameter: { action: 'oura-connect' } }).text, '{"ok":false,"error":"unauthorized"}');
  const page = w.call('doGet', { parameter: { key: KEY, action: 'oura-connect' } });
  assert.match(page.html, /authorize with oura/);
  assert.match(page.html, /target="_top"/);
  const href = /href="([^"]+)"/.exec(page.html)[1].replace(/&amp;/g, '&');
  const u = new URL(href);
  assert.equal(u.origin + u.pathname, 'https://cloud.ouraring.com/oauth/authorize');
  assert.equal(u.searchParams.get('response_type'), 'code');
  assert.equal(u.searchParams.get('client_id'), 'cid-fake');
  assert.equal(u.searchParams.get('scope'), 'daily');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://script.google.com/macros/s/FAKE_DEPLOYMENT/exec');
  assert.ok(!page.html.includes('csecret-fake'));
  const state = u.searchParams.get('state');
  assert.ok(state);

  // a callback with an unknown state does nothing
  const bad = w.call('doGet', { parameter: { code: 'auth-code-fake', state: 'made-up' } });
  assert.match(bad.html, /expired/);
  assert.equal(w.propStore.OURA_ACCESS_TOKEN, undefined);
  assert.equal(w.fetchLog.length, 0);

  // the real state works once, stores tokens, and shows no token in the page
  const ok = w.call('doGet', { parameter: { code: 'auth-code-fake', state } });
  assert.match(ok.html, /oura connected/);
  assert.ok(!/granted-(access|refresh)-token/.test(ok.html));
  assert.equal(w.propStore.OURA_ACCESS_TOKEN, 'granted-access-token-fake-abcdefghijklmnop');
  assert.equal(w.propStore.OURA_REFRESH_TOKEN, 'granted-refresh-token-fake-abcdefghijklmnop');
  const again = w.call('doGet', { parameter: { code: 'auth-code-fake', state } });
  assert.match(again.html, /expired/); // state is single-use
});

test('oura-connect: OURA_REDIRECT_URI overrides getUrl(); not configured says so', () => {
  const w = load({ props: { OURA_CLIENT_ID: 'cid', OURA_CLIENT_SECRET: 'sec', OURA_REDIRECT_URI: 'https://script.google.com/macros/s/OTHER/exec' } });
  const page = w.call('doGet', { parameter: { key: KEY, action: 'oura-connect' } });
  assert.ok(decodeURIComponent(page.html).includes('redirect_uri=https://script.google.com/macros/s/OTHER/exec'));
  const none = load();
  assert.match(none.call('doGet', { parameter: { key: KEY, action: 'oura-connect' } }).html, /not set up/);
});

test('shortError_ never lets a long token-like string through', () => {
  const w = load();
  const msg2 = w.call('shortError_', new Error('failed for access_token=abcdefghijklmnopqrstuvwxyz0123456789 ok'));
  assert.ok(!msg2.includes('abcdefghijklmnopqrstuvwxyz'));
  assert.ok(msg2.length <= 80);
});
