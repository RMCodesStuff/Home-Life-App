// Multi-device setup helpers. Everything here is fictional.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toBase64Url, fromBase64Url, extractKeyFromUrl, isValidKey, pickPortable, buildPayload, encodePayload, decodePayload,
  buildSetupLink, parseSetupHash, applySetup, summarizeSetup, MAX_ENCODED,
} from '../js/devicesetup.js';
import { DEFAULT_SETTINGS, normalizeSettings } from '../js/store.js';

const KEY = 'k3Y_abcdEFGH-1234567890xyz';
const URL_EXEC = 'https://script.google.com/macros/s/AKfycbFAKE_deployment_id/exec';
const device = () => normalizeSettings({
  home: { name: 'Zürich', region: 'Zürich', lat: 47.3769, lon: 8.5417, countryCode: 'CH', timezone: 'Europe/Zurich' },
  homeLabel: 'casa', units: 'metric', theme: 'dark',
  calendar: { url: URL_EXEC, secret: KEY },
  show: { inbox: false, oura: false },
  calendars: { 'Family': { label: 'fam', color: 'sage', show: true }, 'Spam': { show: false } },
  evening: { enabled: true, start: '19:30' },
  trip: { manual: { city: 'São Paulo', region: 'SP', countryCode: 'BR', lat: -23.55, lon: -46.63, departDate: '2026-12-01', returnDate: '2026-12-05' }, checklist: ['passport', 'chargers'] },
  phoenix: { power: { enabled: true, windows: [{ days: [1, 2], start: '15:00', end: '18:00' }], months: [6, 7], mode: 'hot', hotAt: 95 }, watering: { enabled: true, days: [2, 5] } },
  chores: [{ id: 'c1', name: 'trash', kind: 'bin', rule: { type: 'weekly', day: 3 }, holiday: true, last: null, start: '2026-11-01' }],
  workout: { workCalendars: ['Office'], window: 'morning' },
  ai: { enabled: true, key: 'sk-ant-FAKEFAKEFAKE', model: 'claude-haiku-5-5' },
});

test('base64url round trips non-ASCII text and is url safe', () => {
  for (const text of ['São Paulo · Zürich 東京 🌧', '', '???>>>~~~', 'a'.repeat(5000)]) {
    const enc = toBase64Url(text);
    assert.match(enc, /^[A-Za-z0-9_-]*$/);
    assert.equal(fromBase64Url(enc), text);
  }
  assert.throws(() => fromBase64Url('not base64!'));
  assert.throws(() => fromBase64Url('/w=='), 'standard base64 alphabet is rejected');
});

test('key format: 16+ of [A-Za-z0-9_-]', () => {
  assert.ok(isValidKey(KEY));
  assert.ok(isValidKey('a'.repeat(16)));
  for (const bad of ['', 'short', 'a'.repeat(15), 'has space in the key!!', 'ünïcode-key-1234567', null, undefined, 42]) assert.ok(!isValidKey(bad), String(bad));
});

test('extractKeyFromUrl: key only, key with other params, no key, malformed', () => {
  assert.deepEqual(extractKeyFromUrl(`${URL_EXEC}?key=${KEY}`), { url: URL_EXEC, key: KEY, found: true });
  assert.deepEqual(extractKeyFromUrl(`  ${URL_EXEC}?days=14&key=${KEY}&from=1,2#frag `), { url: URL_EXEC, key: KEY, found: true });
  assert.deepEqual(extractKeyFromUrl(`${URL_EXEC}?key=${encodeURIComponent('a b')}`), { url: URL_EXEC, key: 'a b', found: true }, 'invalid keys are returned for the caller to reject');
  assert.deepEqual(extractKeyFromUrl(`${URL_EXEC}?key=`), { url: URL_EXEC, key: '', found: true });
  assert.deepEqual(extractKeyFromUrl(URL_EXEC), { url: URL_EXEC, key: null, found: false });
  assert.deepEqual(extractKeyFromUrl(`${URL_EXEC}?days=14`), { url: `${URL_EXEC}?days=14`, key: null, found: false }, 'no key: left as typed');
  for (const bad of ['', 'not a url', 'script.google.com/macros/s/x/exec?key=abc', 'javascript:alert(1)?key=abcdefabcdefabcdef', 'https://', null, undefined]) {
    const r = extractKeyFromUrl(bad);
    assert.equal(r.found, false, String(bad));
    assert.equal(r.key, null);
  }
});

test('pickPortable keeps portable settings and never the Claude key by default', () => {
  const p = pickPortable(device());
  assert.equal(p.home.name, 'Zürich');
  assert.equal(p.homeLabel, 'casa');
  assert.equal(p.units, 'metric');
  assert.equal(p.theme, 'dark');
  assert.deepEqual(p.calendar, { url: URL_EXEC, secret: KEY });
  assert.equal(p.show.inbox, false);
  assert.equal(p.calendars.Family.label, 'fam');
  assert.equal(p.evening.start, '19:30');
  assert.equal(p.trip.manual.city, 'São Paulo');
  assert.deepEqual(p.trip.checklist, ['passport', 'chargers']);
  assert.equal(p.phoenix.power.hotAt, 95);
  assert.deepEqual(p.phoenix.watering.days, [2, 5]);
  assert.equal(p.chores[0].name, 'trash');
  assert.deepEqual(p.workout, { workCalendars: ['Office'], window: 'morning' });
  assert.equal('ai' in p, false);
  assert.ok(!JSON.stringify(p).includes('sk-ant'));
});

test('pickPortable includes the Claude key only when asked, and drops unknown or cache-like fields', () => {
  const s = { ...device(), fbAuth: { token: 'x' }, aiCache: { result: 1 }, wx: { big: true } };
  const p = pickPortable(s, { includeClaudeKey: true });
  assert.deepEqual(p.ai, { enabled: true, key: 'sk-ant-FAKEFAKEFAKE', model: 'claude-haiku-5-5' });
  assert.deepEqual(Object.keys(p).filter((k) => !(k in DEFAULT_SETTINGS)), []);
  assert.ok(!JSON.stringify(p).includes('fbAuth'));
  // ticked, but no key typed: nothing to carry
  assert.equal('ai' in pickPortable({ ...device(), ai: { enabled: false, key: '', model: 'm' } }, { includeClaudeKey: true }), false);
});

test('defaults are left out so links stay short', () => {
  const p = pickPortable(normalizeSettings({ home: device().home }));
  assert.deepEqual(Object.keys(p), ['home']);
});

test('payload shape and round trip', () => {
  const now = Date.UTC(2026, 10, 22, 12, 0, 0);
  const pl = buildPayload(device(), { now });
  assert.equal(pl.v, 1); assert.equal(pl.app, 'home-life'); assert.equal(pl.exportedAt, '2026-11-22T12:00:00.000Z');
  const enc = encodePayload(device(), { now });
  const dec = decodePayload(enc);
  assert.equal(dec.ok, true);
  assert.deepEqual(dec.payload, pl);
  assert.deepEqual(dec.settings, pl.settings);
  // apply on a fresh device gives back the portable settings, with the other device's own Claude key untouched
  const fresh = normalizeSettings({ ai: { enabled: false, key: 'sk-ant-OTHER', model: 'x' }, calendar: { url: '', secret: 'ownkey_ownkey_ownkey' } });
  const merged = applySetup(fresh, dec.settings);
  assert.deepEqual(pickPortable(merged), pickPortable(device()));
  assert.equal(merged.calendar.secret, KEY);
  assert.equal(merged.ai.key, 'sk-ant-OTHER');
});

test('Claude key travels only when included, and applies', () => {
  const off = decodePayload(encodePayload(device()));
  assert.equal(off.settings.ai, undefined);
  const on = decodePayload(encodePayload(device(), { includeClaudeKey: true }));
  const merged = applySetup(normalizeSettings({}), on.settings);
  assert.equal(merged.ai.key, 'sk-ant-FAKEFAKEFAKE');
  assert.equal(merged.ai.enabled, true);
});

test('applying replaces portable settings with defaults for anything left out', () => {
  const cur = device();
  const merged = applySetup(cur, { home: null, units: 'imperial' });
  assert.equal(merged.home, null);
  assert.equal(merged.homeLabel, 'home');
  assert.deepEqual(merged.chores, []);
  assert.equal(merged.trip.manual, null);
  assert.equal(merged.calendar.url, '');
  assert.equal(merged.calendar.secret, KEY, 'no key in the link: this device keeps its own');
  assert.deepEqual(merged.show, DEFAULT_SETTINGS.show);
});

test('non-ASCII city survives the whole link', () => {
  const link = buildSetupLink('http://localhost:8000/', device());
  assert.ok(link.startsWith('http://localhost:8000/#setup='));
  assert.match(link.slice(link.indexOf('#setup=') + 7), /^[A-Za-z0-9_-]+$/);
  const r = parseSetupHash(link.slice(link.indexOf('#')));
  assert.equal(r.ok, true);
  assert.equal(r.settings.home.name, 'Zürich');
  assert.equal(r.settings.trip.manual.city, 'São Paulo');
});

test('parseSetupHash ignores other hashes', () => {
  for (const h of ['', '#', '#settings', '#setup', '#Setup=abc', null, undefined]) assert.equal(parseSetupHash(h), null, String(h));
});

const enc = (obj) => toBase64Url(JSON.stringify(obj));
test('bad, foreign and oversized payloads are rejected with a one-line error', () => {
  const good = { v: 1, app: 'home-life', settings: { units: 'metric' } };
  assert.equal(decodePayload(enc(good)).ok, true);
  const cases = [
    '', 'not*base64', enc(good).slice(0, 10), toBase64Url('not json'),
    enc([]), enc('str'), enc(null),
    enc({ ...good, v: 2 }), enc({ ...good, v: '1' }), enc({ v: 1, settings: {} }),
    enc({ ...good, app: 'other-app' }),
    enc({ v: 1, app: 'home-life' }), enc({ ...good, settings: 'x' }), enc({ ...good, settings: [] }), enc({ ...good, settings: null }),
    'A'.repeat(MAX_ENCODED + 1),
  ];
  for (const c of cases) {
    const r = decodePayload(c);
    assert.equal(r.ok, false, c.slice(0, 30));
    assert.equal(typeof r.error, 'string');
    assert.ok(r.error.length > 0 && !r.error.includes('\n'));
  }
  assert.equal(decodePayload(undefined).ok, false);
  assert.equal(parseSetupHash('#setup=' + enc({ ...good, app: 'x' })).ok, false);
});

test('hostile settings are sanitized: bad types dropped, keys validated, script and html not carried', () => {
  const evil = {
    v: 1, app: 'home-life',
    settings: {
      home: { name: '<img src=x onerror=1>', lat: 'NaN', lon: 5 }, units: 'kelvin', theme: 'neon',
      calendar: { url: 'javascript:alert(1)', secret: 'short' },
      show: { inbox: 'yes', oura: false, bogus: true }, chores: [{ id: 'x' }, 5, null],
      trip: { manual: { city: 'X', lat: 1, lon: 2, departDate: 'soon', returnDate: 'later' }, checklist: [1, 2] },
      __proto__x: 1, constructor: { a: 1 }, ai: { key: '' },
    },
  };
  const r = decodePayload(enc(evil));
  assert.equal(r.ok, true);
  const s = r.settings;
  assert.equal(s.home, null);
  assert.equal(s.units, undefined); assert.equal(s.theme, undefined);
  assert.deepEqual(s.calendar, { url: '', secret: '' });
  assert.deepEqual(s.show, { oura: false });
  assert.deepEqual(s.chores, []);
  assert.deepEqual(s.trip, { manual: null, checklist: null });
  assert.equal(s.ai, undefined);
  assert.equal(applySetup(normalizeSettings({}), s).units, 'imperial');
});

test('a link whose url carries ?key= is stored as the bare url', () => {
  const r = decodePayload(enc({ v: 1, app: 'home-life', settings: { calendar: { url: `${URL_EXEC}?key=${KEY}&x=1`, secret: KEY } } }));
  assert.equal(r.settings.calendar.url, URL_EXEC);
});

test('summarizeSetup says what will be applied', () => {
  const m = applySetup(normalizeSettings({}), decodePayload(encodePayload(device())).settings);
  const lines = summarizeSetup(m).join('\n');
  assert.match(lines, /home: zürich, zürich \(called "casa"\)/);
  assert.match(lines, /google: connected/);
  assert.match(lines, /trip: são paulo, 2026-12-01 to 2026-12-05/);
  assert.match(lines, /chores: 1/);
  assert.match(lines, /claude api key: not included/);
  assert.ok(!lines.includes(KEY), 'the key is never shown');
  const empty = summarizeSetup(normalizeSettings({})).join('\n');
  assert.match(empty, /home: not set/); assert.match(empty, /google: not connected/); assert.match(empty, /trip: none/); assert.match(empty, /chores: 0/);
});
