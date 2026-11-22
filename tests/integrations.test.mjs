// Tests for the Gmail / leave-by / Oura additions on the app side. Everything here is fictional.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalize, hourAt } from '../js/weather.js';
import * as I from '../js/insights.js';
import { buildFacts, fingerprint, mergeWritten, SCHEMA, SYSTEM_PROMPT } from '../js/ai.js';
import { fetchCalendar, normalizeBridge, normalizeEvents, localizeEvents } from '../js/calendar.js';
import { relTime, diffMinutes, fmtMinutes } from '../js/time.js';
import { personalManifest } from '../js/settings.js';
import { DEFAULT_SETTINGS } from '../js/store.js';

const raw = JSON.parse(fs.readFileSync(new URL('./fixtures/forecast.json', import.meta.url), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const mk = (r = raw) => normalize(r, { name: 'Fictionville' }, 'imperial', { aq: { us_aqi: 43, pm2_5: 7 } });
function at(model, now) {
  const h = hourAt(model, now);
  return { ...model, current: { ...model.current, time: now, temp: h.temp, feels: h.feels, humidity: h.humidity, dew: h.dew, code: h.code, cloud: h.cloud, pressure: h.pressure, wind: h.wind, windDir: h.windDir, gust: h.gust, isDay: h.isDay } };
}
const ctxAt = (now, over = {}, model = mk()) => {
  const m = at(model, now);
  return { now, units: 'imperial', model: m, homeModel: m, tripModels: {}, travel: null, events: [], inbox: null, oura: null, ...over };
};
/** Rewrite today's hourly rows for a window. */
function tweak(fn) {
  const r2 = clone(raw);
  r2.hourly.time.forEach((t, i) => { if (t.startsWith('2026-11-21') || t.startsWith('2026-11-22T0')) fn(r2.hourly, i, +t.slice(11, 13), t.slice(0, 10)); });
  return mk(r2);
}
const wetAfternoon = () => tweak((h, i, hr, d) => { h.precipitation_probability[i] = d === '2026-11-21' && hr >= 14 && hr < 17 ? 60 : 0; });
const hotDay = () => tweak((h, i, hr, d) => { if (d === '2026-11-21') { h.apparent_temperature[i] = hr >= 12 && hr < 17 ? 104 : 80; h.precipitation_probability[i] = 0; } });
const freezing = () => tweak((h, i, hr, d) => { h.precipitation_probability[i] = 0; if ((d === '2026-11-21' && hr >= 18) || d === '2026-11-22') h.temperature_2m[i] = 28; });
const dry = () => tweak((h, i) => { h.precipitation_probability[i] = 0; });

const ev = (o = {}) => ({
  id: 'e1', title: 'Church service downtown', calendar: 'Personal', allDay: false, location: '1 Chapel Rd, Fictionville', myStatus: 'YES',
  start: '2026-11-21T08:00:00-07:00', end: '2026-11-21T09:00:00-07:00', date: '2026-11-21', dates: ['2026-11-21'], ls: '2026-11-21T08:00', le: '2026-11-21T09:00',
  travel: { minutes: 22, miles: 9.8, leaveBy: '2026-11-21T07:33' }, ...o,
});

// ------------------------------------------------------------------ leave-by

test('leaveNote: leave by, drive time, and a wet-roads nudge at 40% rain', () => {
  const m = dry();
  assert.equal(I.leaveNote(ev(), m.hours), 'leave by 7:33 · 22 min drive');
  const w = wetAfternoon();
  const pm = ev({ ls: '2026-11-21T15:30', le: '2026-11-21T16:30', travel: { minutes: 40, miles: 20, leaveBy: '2026-11-21T14:45' } });
  assert.equal(I.leaveNote(pm, w.hours), 'leave by 2:45 · 40 min drive · wet roads, add a few minutes');
  // 39% at departure stays quiet; the hour of departure decides, not the event hour
  const just = tweak((h, i, hr, d) => { h.precipitation_probability[i] = d === '2026-11-21' && hr === 14 ? 39 : 0; });
  assert.equal(I.leaveNote(pm, just.hours), 'leave by 2:45 · 40 min drive');
  // am/pm only when it differs from the event, long drives read in hours
  const cross = ev({ ls: '2026-11-21T08:10', travel: { minutes: 75, miles: 50, leaveBy: '2026-11-21T06:50' } });
  assert.equal(I.leaveNote(cross, m.hours), 'leave by 6:50 · 1h 15m drive');
  const crossMeridiem = ev({ ls: '2026-11-21T12:20', travel: { minutes: 30, miles: 12, leaveBy: '2026-11-21T11:45' } });
  assert.equal(I.leaveNote(crossMeridiem, m.hours), 'leave by 11:45am · 30 min drive');
  assert.equal(I.leaveNote(ev({ travel: { minutes: 20, miles: 5, leaveBy: '2026-11-21T12:00' }, ls: '2026-11-21T12:25' }), m.hours), 'leave by noon · 20 min drive');
  assert.equal(I.leaveNote(ev({ travel: undefined }), m.hours), '');
});

test('leave chip: next timed event with a drive within 4 hours, short lowercase title', () => {
  const ctx = ctxAt('2026-11-21T06:40', { events: [ev()] });
  assert.equal(I.leaveChip(ctx), 'leave 7:33 for church service downtown, 22 min');
  assert.equal(I.leaveChip({ ...ctx, events: [ev({ title: 'Big Family Reunion Picnic Day' })] }), 'leave 7:33 for big family reunion, 22 min');
  // more than 4 hours out: no chip
  assert.equal(I.leaveChip({ ...ctx, now: '2026-11-21T03:30' }), '');
  // 4 hours exactly still counts
  assert.equal(I.leaveChip({ ...ctx, now: '2026-11-21T04:00' }), 'leave 7:33 for church service downtown, 22 min');
  // departure already due: say so
  assert.equal(I.leaveChip({ ...ctx, now: '2026-11-21T07:45' }), 'leave now for church service downtown, 22 min');
  // events without a drive, all-day events and past events are ignored; the earliest with a drive wins
  const noTravel = ev({ id: 'n', travel: undefined, ls: '2026-11-21T07:00' });
  const later = ev({ id: 'l', title: 'Dentist', ls: '2026-11-21T10:00', travel: { minutes: 15, miles: 5, leaveBy: '2026-11-21T09:40' } });
  assert.equal(I.leaveChip({ ...ctx, events: [later, noTravel, ev()] }), 'leave 7:33 for church service downtown, 22 min');
  assert.equal(I.leaveChip({ ...ctx, events: [noTravel] }), '');
  assert.equal(I.leaveChip({ ...ctx, now: '2026-11-21T09:30', events: [ev()] }), '');
});

// ------------------------------------------------------------------ inbox + packages

const W = (from, reason) => ({ id: from, from, subject: 'subject', snippet: 'snip', date: '2026-11-19T10:00:00Z', reason, url: 'https://mail.google.com/mail/u/0/#all/x' });

test('inbox chip: count, first sender and reason, 60 characters at most', () => {
  assert.equal(I.inboxChip({ ok: true, waiting: [W('Little Shop', 'asks you to confirm'), W('Maple Dental', 'wants an rsvp')], packages: [] }), '2 waiting on you · little shop asks you to confirm');
  assert.equal(I.inboxChip({ ok: true, waiting: [W('Maple Dental', 'wants an rsvp')], packages: [] }), '1 waiting on you · maple dental wants an rsvp');
  const long = I.inboxChip({ ok: true, waiting: [W('The Extraordinarily Long Sender Name Association', 'waiting for your reply')], packages: [] });
  assert.ok(long.length <= 60, long);
  assert.ok(long.endsWith('…'));
  assert.equal(I.inboxChip({ ok: true, waiting: [], packages: [] }), '');
  assert.equal(I.inboxChip(null), '');
  assert.equal(I.inboxChip({ ok: false, error: 'disabled', waiting: [], packages: [] }), '');
});

test('package note: weather pairing for rain, heat and freezing; none for delivered or tomorrow', () => {
  const pkg = (status) => ({ id: 'p', merchant: 'Northwind', status });
  const now = '2026-11-21T08:00';
  assert.equal(I.packageNote(pkg('arriving today'), ctxAt(now, {}, dry())), 'northwind package arriving today');
  assert.equal(I.packageNote(pkg('out for delivery'), ctxAt(now, {}, wetAfternoon())), 'northwind package out for delivery, rain after 2pm, grab it early');
  assert.equal(I.packageNote(pkg('arriving today'), ctxAt(now, {}, wetAfternoon())), 'northwind package arriving today, rain after 2pm, grab it early');
  assert.equal(I.packageNote(pkg('arriving today'), ctxAt(now, {}, hotDay())), 'northwind package arriving today, porch hits 104, bring it in early');
  assert.equal(I.packageNote(pkg('arriving today'), ctxAt(now, {}, freezing())), 'northwind package arriving today, below freezing tonight');
  assert.equal(I.packageNote(pkg('delivered'), ctxAt(now, {}, wetAfternoon())), 'northwind package delivered');
  assert.equal(I.packageNote(pkg('arriving tomorrow'), ctxAt(now, {}, wetAfternoon())), 'northwind package arriving tomorrow');
  // rain that already passed does not trigger "grab it early"
  assert.equal(I.packageNote(pkg('arriving today'), ctxAt('2026-11-21T17:00', {}, wetAfternoon())), 'northwind package arriving today');
  // rain beats heat when both apply
  const both = tweak((h, i, hr, d) => { if (d === '2026-11-21') { h.apparent_temperature[i] = 103; h.precipitation_probability[i] = hr === 15 ? 70 : 0; } });
  assert.match(I.packageNote(pkg('arriving today'), ctxAt(now, {}, both)), /rain after 3pm/);
  // metric users: 40C feels-like is over 100F
  const mm = normalize((() => { const r2 = clone(raw); r2.hourly.apparent_temperature = r2.hourly.apparent_temperature.map(() => 40); r2.hourly.precipitation_probability = r2.hourly.precipitation_probability.map(() => 0); return r2; })(), {}, 'metric');
  assert.equal(I.packageNote(pkg('arriving today'), { ...ctxAt(now, {}, mm), units: 'metric' }), 'northwind package arriving today, porch hits 40, bring it in early');
});

// ------------------------------------------------------------------ last night

const oura = (readiness, over = {}) => ({
  ok: true, day: '2026-11-21', readiness: { score: readiness, temperatureDeviation: -0.1 },
  sleep: { score: 84, totalSec: 7 * 3600 + 12 * 60, deepSec: 4800, remSec: 5400, efficiency: 91, avgHrv: 48, lowestHr: 52 },
  week: { readinessAvg: 80, sleepScoreAvg: 82, totalSecAvg: 7 * 3600 + 12 * 60 }, ...over,
});

test('bodyNote: readiness bands', () => {
  assert.equal(I.bodyNote(oura(88)), "readiness 88, you're primed. good day to push it. slept 7h 12m.");
  assert.equal(I.bodyNote(oura(85)), "readiness 85, you're primed. good day to push it. slept 7h 12m.");
  assert.equal(I.bodyNote(oura(78)), 'readiness 78, about your usual. slept 7h 12m.');
  assert.equal(I.bodyNote(oura(75)), 'readiness 75, about your usual. slept 7h 12m.'); // within 5 of 80
  assert.equal(I.bodyNote(oura(72)), 'readiness 72, down from your usual 80. slept 7h 12m.');
  assert.equal(I.bodyNote(oura(84, { week: { readinessAvg: 70, sleepScoreAvg: 82, totalSecAvg: 25920 } })), 'readiness 84, up from your usual 70. slept 7h 12m.');
  assert.equal(I.bodyNote(oura(64)), 'readiness 64, lower than your usual 80. keep it easy today. slept 7h 12m.');
  assert.equal(I.bodyNote(oura(69)), 'readiness 69, lower than your usual 80. keep it easy today. slept 7h 12m.');
  assert.equal(I.bodyNote(oura(70)), 'readiness 70, down from your usual 80. slept 7h 12m.');
});

test('bodyNote: sleep clause compares with the week at 30 minutes or more', () => {
  const total = (sec, avg) => oura(78, { sleep: { score: 80, totalSec: sec }, week: { readinessAvg: 80, sleepScoreAvg: 80, totalSecAvg: avg } });
  assert.equal(I.bodyNote(total(6 * 3600 + 20 * 60, 7 * 3600)), 'readiness 78, about your usual. slept 6h 20m, 40 min less than usual.');
  assert.equal(I.bodyNote(total(8 * 3600 + 15 * 60, 7 * 3600)), 'readiness 78, about your usual. slept 8h 15m, 1h 15m more than usual.');
  assert.equal(I.bodyNote(total(7 * 3600 + 29 * 60, 7 * 3600)), 'readiness 78, about your usual. slept 7h 29m.'); // 29 minutes: not worth a clause
  assert.equal(I.bodyNote(total(7 * 3600 + 30 * 60, 7 * 3600)), 'readiness 78, about your usual. slept 7h 30m, 30 min more than usual.');
});

test('bodyNote: missing data, lowercase, no degree signs, 140 characters at most', () => {
  assert.equal(I.bodyNote(null), '');
  assert.equal(I.bodyNote({ ok: false, error: 'not_connected' }), '');
  assert.equal(I.bodyNote(oura(78, { sleep: null })), 'readiness 78, about your usual.');
  assert.equal(I.bodyNote(oura(null, { readiness: null })), 'slept 7h 12m.');
  assert.equal(I.bodyNote(oura(78, { week: { readinessAvg: null, sleepScoreAvg: null, totalSecAvg: null } })), 'readiness 78, steady enough. slept 7h 12m.');
  assert.equal(I.bodyNote(oura(60, { week: { readinessAvg: null, sleepScoreAvg: null, totalSecAvg: null } })), 'readiness 60, on the low side. keep it easy today. slept 7h 12m.');
  for (const o of [oura(88), oura(64), oura(64, { sleep: { score: 50, totalSec: 3 * 3600 + 5 * 60 }, week: { readinessAvg: 90, sleepScoreAvg: 80, totalSecAvg: 8 * 3600 } })]) {
    const t = I.bodyNote(o);
    assert.ok(t.length <= 140, t);
    assert.equal(t, t.toLowerCase());
    assert.ok(!/°/.test(t));
  }
});

test('easy pace: best window gains a suffix only when readiness is under 70', () => {
  const plain = I.bestWindow(ctxAt('2026-11-21T07:40'));
  assert.ok(!/easy pace/.test(plain));
  assert.equal(I.bestWindow(ctxAt('2026-11-21T07:40', { oura: oura(64) })), `${plain} · easy pace`);
  assert.equal(I.bestWindow(ctxAt('2026-11-21T07:40', { oura: oura(69) })), `${plain} · easy pace`);
  assert.equal(I.bestWindow(ctxAt('2026-11-21T07:40', { oura: oura(70) })), plain);
  assert.equal(I.bestWindow(ctxAt('2026-11-21T07:40', { oura: oura(90) })), plain);
  assert.equal(I.withEasyPace(`${plain} · easy pace`, oura(50)), `${plain} · easy pace`); // idempotent for the AI merge
  assert.equal(I.withEasyPace('no clean window today', oura(50)), 'no clean window today');
  assert.equal(I.withEasyPace('9 to 11, 60°', null), '9 to 11, 60°');
});

test('writeAll carries the new fields and stays lowercase', () => {
  const inbox = { ok: true, waiting: [W('Little Shop', 'asks you to confirm')], packages: [{ id: 'p1', merchant: 'Northwind', status: 'out for delivery', subject: 's', date: 'd', url: '' }] };
  const w = I.writeAll(ctxAt('2026-11-21T06:40', { events: [ev()], inbox, oura: oura(64) }, wetAfternoon()));
  assert.equal(w.leave_chip, 'leave 7:33 for church service downtown, 22 min');
  assert.equal(w.inbox_chip, '1 waiting on you · little shop asks you to confirm');
  assert.match(w.body_note, /^readiness 64, lower than your usual 80/);
  assert.match(w.best_window, / · easy pace$/);
  assert.deepEqual(w.package_notes, [{ id: 'p1', note: 'northwind package out for delivery, rain after 2pm, grab it early' }]);
  assert.deepEqual(w.leave_notes.map((n) => n.id), ['e1']);
  assert.equal(w.leave_notes[0].note, 'leave by 7:33 · 22 min drive');
  // nothing connected: empty strings and lists, never undefined
  const bare = I.writeAll(ctxAt('2026-11-21T06:40'));
  assert.deepEqual([bare.leave_chip, bare.inbox_chip, bare.body_note], ['', '', '']);
  assert.deepEqual(bare.package_notes, []);
  assert.deepEqual(bare.leave_notes, []);
});

// ------------------------------------------------------------------ calendar normalization

const V2 = {
  ok: true, version: 2, timeZone: 'America/Denver', features: { gmail: true, leaveBy: true, oura: true },
  events: [{ id: 'a', title: 'Church', allDay: false, start: '2026-11-22T08:00:00-07:00', end: '2026-11-22T09:00:00-07:00', location: '1 Chapel Rd', travel: { minutes: 22, miles: 9.8, leaveBy: '2026-11-22T07:33:00-07:00' } },
    { id: 'b', title: 'Walk', allDay: false, start: '2026-11-22T10:00:00-07:00', end: '2026-11-22T11:00:00-07:00', location: '', travel: { minutes: 'x', leaveBy: 'bad' } }],
  inbox: { ok: true, waiting: [{ id: 't1', from: 'Little Shop', subject: 's', snippet: 'n', date: '2026-11-21T10:00:00Z', reason: 'asks you to confirm', url: 'https://mail.google.com/mail/u/0/#all/t1' },
    { id: 't2', from: 'Evil', subject: 's', snippet: '', date: '', reason: 'starred', url: 'javascript:alert(1)' }], packages: [{ id: 'p1', merchant: 'northwind', status: 'arriving today', subject: 's', date: 'd', url: 'https://mail.google.com/mail/u/0/#all/p1' }] },
  oura: { ok: true, day: '2026-11-22', readiness: { score: 64, temperatureDeviation: -0.1 }, sleep: { score: 84, totalSec: 25920, bedtimeStart: '2026-11-21T22:30:00-07:00' }, week: { readinessAvg: 80, sleepScoreAvg: 82, totalSecAvg: 25200 } },
};

test('normalizeBridge: v2 fields, defensive copies, safe links', () => {
  const b = normalizeBridge(V2);
  assert.equal(b.version, 2);
  assert.deepEqual(b.features, { gmail: true, leaveBy: true, oura: true });
  assert.equal(b.inbox.waiting.length, 2);
  assert.equal(b.inbox.waiting[0].url, 'https://mail.google.com/mail/u/0/#all/t1');
  assert.equal(b.inbox.waiting[1].url, ''); // only gmail links are ever linked
  assert.equal(b.inbox.packages[0].status, 'arriving today');
  assert.equal(b.oura.readiness.score, 64);
  assert.equal(b.oura.week.totalSecAvg, 25200);
  assert.deepEqual(normalizeBridge({ ...V2, inbox: { ok: false, error: 'disabled' } }).inbox, { ok: false, error: 'disabled', waiting: [], packages: [] });
  assert.deepEqual(normalizeBridge({ ...V2, oura: { ok: false, error: 'auth_failed', message: 'oura refused access' } }).oura, { ok: false, error: 'auth_failed', message: 'oura refused access' });
  assert.equal(normalizeBridge({ ...V2, oura: undefined }).oura, null);
});

test('normalizeBridge: a response with no version is a v1 bridge', () => {
  const b = normalizeBridge({ ok: true, events: [] });
  assert.equal(b.version, 1);
  assert.deepEqual(b.features, { gmail: false, leaveBy: false, oura: false });
  assert.equal(b.inbox, null);
  assert.equal(b.oura, null);
  assert.equal(normalizeBridge({ ok: true, version: 1, inbox: { ok: true, waiting: [W('x', 'y')], packages: [] } }).inbox, null);
});

test('events: travel is validated, and leaveBy is localized like the other times', () => {
  const evs = normalizeEvents(V2.events);
  assert.deepEqual(evs[0].travel, { minutes: 22, miles: 9.8, leaveBy: '2026-11-22T07:33:00-07:00' });
  assert.equal(evs[1].travel, undefined);
  const local = localizeEvents(evs, () => -25200);
  assert.equal(local[0].travel.leaveBy, '2026-11-22T07:33');
  assert.equal(local[0].ls, '2026-11-22T08:00');
  const coast = localizeEvents(evs, () => -28800); // the same instant on the west coast
  assert.equal(coast[0].travel.leaveBy, '2026-11-22T06:33');
});

test('fetchCalendar sends from=lat,lon at 4 decimals and returns the v2 extras', async () => {
  const urls = [];
  globalThis.fetch = async (u) => { urls.push(u); return { ok: true, status: 200, json: async () => V2 }; };
  try {
    const r = await fetchCalendar('https://script.google.com/macros/s/FAKE/exec', 'k', 14, { from: { lat: 39.739236, lon: -104.990251 } });
    assert.ok(urls[0].includes('&days=14&from=39.7392,-104.9903'), urls[0]);
    assert.equal(r.version, 2);
    assert.equal(r.inbox.waiting.length, 2);
    assert.equal(r.events[0].travel.minutes, 22);
    await fetchCalendar('https://script.google.com/macros/s/FAKE/exec', 'k');
    assert.ok(!urls[1].includes('from='));
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, events: [] }) });
    const v1 = await fetchCalendar('https://script.google.com/macros/s/FAKE/exec', 'k', 14, { from: { lat: 1, lon: 2 } });
    assert.equal(v1.version, 1);
    assert.equal(v1.inbox, null);
  } finally { delete globalThis.fetch; }
});

// ------------------------------------------------------------------ claude writer

test('buildFacts: inbox (no snippets), packages, travel and oura; SCHEMA and prompt know body_note', () => {
  const longSubject = 'A very long subject line that goes on well past sixty characters for sure';
  const inbox = { ok: true, waiting: [W('Little Shop', 'asks you to confirm'), W('B', 'starred'), W('C', 'wants an rsvp'), W('D', 'action needed')].map((x, i) => ({ ...x, subject: i === 0 ? longSubject : x.subject, snippet: 'PRIVATE BODY TEXT' })), packages: [{ id: 'p', merchant: 'northwind', status: 'arriving today', subject: 'Secret subject', date: 'd', url: 'u' }] };
  const facts = buildFacts(ctxAt('2026-11-21T06:40', { events: [ev()], inbox, oura: oura(64) }), I.writeAll(ctxAt('2026-11-21T06:40')));
  assert.equal(facts.inbox.count, 4);
  assert.equal(facts.inbox.items.length, 3);
  assert.deepEqual(Object.keys(facts.inbox.items[0]).sort(), ['from', 'reason', 'subject']);
  assert.ok(facts.inbox.items[0].subject.length <= 60);
  assert.deepEqual(facts.packages, [{ merchant: 'northwind', status: 'arriving today' }]);
  assert.deepEqual(facts.events[0].travel, { minutes: 22, leave_by: '2026-11-21T07:33' });
  assert.equal(facts.oura.readiness, 64);
  assert.equal(facts.oura.sleep_score, 84);
  assert.equal(facts.oura.total_sleep_min, 432);
  assert.equal(facts.oura.temperature_deviation, -0.1);
  assert.deepEqual(facts.oura.week, { readiness_avg: 80, sleep_score_avg: 82, total_sleep_min_avg: 432 });
  const flat = JSON.stringify(facts);
  assert.ok(!flat.includes('PRIVATE BODY TEXT') && !flat.includes('Secret subject'), 'no snippets or package subjects leave the browser');
  const bare = buildFacts(ctxAt('2026-11-21T06:40'), I.writeAll(ctxAt('2026-11-21T06:40')));
  assert.equal(bare.inbox, null);
  assert.equal(bare.oura, null);
  assert.deepEqual(bare.packages, []);
  assert.ok(SCHEMA.required.includes('body_note'));
  assert.equal(SCHEMA.properties.body_note.type, 'string');
  assert.ok(Object.keys(SCHEMA.properties).every((k) => SCHEMA.required.includes(k)));
  assert.match(SYSTEM_PROMPT, /body_note/);
  assert.match(SYSTEM_PROMPT, /never medical advice/);
  assert.match(SYSTEM_PROMPT, /leave by/);
  assert.match(SYSTEM_PROMPT, /package/);
});

test('fingerprint changes with oura scores, waiting ids and package statuses', () => {
  const base = ctxAt('2026-11-21T06:40', { events: [ev()] });
  const a = fingerprint(base);
  const inbox = (ids, status) => ({ ok: true, waiting: ids.map((id) => ({ ...W(id, 'starred'), id })), packages: [{ id: 'p', merchant: 'northwind', status, subject: '', date: '', url: '' }] });
  assert.notEqual(fingerprint({ ...base, oura: oura(64) }), a);
  assert.notEqual(fingerprint({ ...base, oura: oura(64) }), fingerprint({ ...base, oura: oura(65) }));
  assert.notEqual(fingerprint({ ...base, oura: oura(64) }), fingerprint({ ...base, oura: oura(64, { sleep: { score: 70, totalSec: 20000 } }) }));
  assert.notEqual(fingerprint({ ...base, inbox: inbox(['t1'], 'arriving today') }), fingerprint({ ...base, inbox: inbox(['t1', 't2'], 'arriving today') }));
  assert.notEqual(fingerprint({ ...base, inbox: inbox(['t1'], 'arriving today') }), fingerprint({ ...base, inbox: inbox(['t1'], 'delivered') }));
  assert.equal(fingerprint({ ...base, oura: oura(64) }), fingerprint({ ...base, oura: oura(64) }));
});

test('mergeWritten: body_note comes from claude only when there is oura data', () => {
  const withOura = I.writeAll(ctxAt('2026-11-21T06:40', { oura: oura(64) }));
  const ai = { body_note: 'claude says take it slow', umbrella: 'no, 0% all day' };
  assert.equal(mergeWritten(withOura, ai).body_note, 'claude says take it slow');
  assert.equal(mergeWritten(withOura, { ...ai, body_note: '  ' }).body_note, withOura.body_note);
  const without = I.writeAll(ctxAt('2026-11-21T06:40'));
  assert.equal(mergeWritten(without, ai).body_note, '');
  assert.equal(mergeWritten(withOura, ai).leave_chip, withOura.leave_chip); // on-device chips survive the merge
});

// ------------------------------------------------------------------ small helpers

test('relTime, diffMinutes, fmtMinutes', () => {
  const now = Date.parse('2026-11-21T12:00:00Z');
  assert.equal(relTime('2026-11-21T11:59:40Z', now), 'just now');
  assert.equal(relTime('2026-11-21T11:48:00Z', now), '12m ago');
  assert.equal(relTime('2026-11-21T09:00:00Z', now), '3h ago');
  assert.equal(relTime('2026-11-20T10:00:00Z', now), '1d ago');
  assert.equal(relTime('2026-11-19T10:00:00Z', now), '2d ago');
  assert.equal(relTime('nonsense', now), '');
  assert.equal(diffMinutes('2026-11-21T06:40', '2026-11-21T08:00'), 80);
  assert.equal(diffMinutes('2026-11-21T23:30', '2026-11-22T00:15'), 45);
  assert.equal(fmtMinutes(40), '40 min');
  assert.equal(fmtMinutes(-65), '1h 5m');
  assert.equal(fmtMinutes(120), '2h');
});

test('manifest time zone, settings defaults', () => {
  const m = fs.readFileSync(new URL('../calendar-bridge/appsscript.json', import.meta.url), 'utf8');
  const out = JSON.parse(personalManifest(m, 'America/Denver'));
  assert.equal(out.timeZone, 'America/Denver');
  assert.ok(!personalManifest(m).includes('__TIME_ZONE__'));
  assert.deepEqual(DEFAULT_SETTINGS.show, { inbox: true, leaveBy: true, oura: true });
});
