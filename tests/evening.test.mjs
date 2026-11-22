// Evening mode (tomorrow's edition), the second card's trip/park composition, and the cache-only geocode. All fictional.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalize } from '../js/weather.js';
import { eveningOn, eveningStart, tomorrowEdition, firstUp, tonightLow, dayCondition, modelAt } from '../js/evening.js';
import { composeTrip } from '../js/compose.js';
import { withManualTrip, manualTrip } from '../js/travel.js';
import { yourDay } from '../js/calendar.js';
import { normalizeParks } from '../js/parks.js';

const raw = JSON.parse(fs.readFileSync(new URL('./fixtures/forecast.json', import.meta.url), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const home = normalize(raw, { name: 'Fictionville' }, 'imperial', {});
/** The same fixture moved to the coast: 8 degrees warmer, an hour behind. */
function coastModel() {
  const r2 = clone(raw);
  r2.timezone = 'America/Los_Angeles'; r2.utc_offset_seconds = -28800;
  r2.hourly.temperature_2m = r2.hourly.temperature_2m.map((t) => t + 8);
  r2.daily.temperature_2m_max = r2.daily.temperature_2m_max.map((t) => t + 8);
  r2.daily.temperature_2m_min = r2.daily.temperature_2m_min.map((t) => t + 8);
  return normalize(r2, { name: 'Anaheim' }, 'imperial', {});
}
const at = (model, now) => modelAt(model, now);
const ctxAt = (now, over = {}) => ({ now, units: 'imperial', model: at(home, now), homeModel: at(home, now), tripModels: {}, travel: null, events: [], ...over });
const ev = (o) => ({ id: 'e', title: 'Church service', allDay: false, date: '2026-11-22', dates: ['2026-11-22'], ls: '2026-11-22T08:00', le: '2026-11-22T09:00', location: '', ...o });

test('eveningOn: from the start time to midnight, only when enabled', () => {
  const on = { enabled: true, start: '18:00' };
  assert.equal(eveningOn('2026-11-21T17:59', on), false);
  assert.equal(eveningOn('2026-11-21T18:00', on), true);
  assert.equal(eveningOn('2026-11-21T23:59', on), true);
  assert.equal(eveningOn('2026-11-22T00:30', on), false, 'after midnight it is today again');
  assert.equal(eveningOn('2026-11-21T19:30', { enabled: false, start: '18:00' }), false);
  assert.equal(eveningOn('2026-11-21T19:30', { enabled: true, start: '20:15' }), false);
  assert.equal(eveningOn('2026-11-21T20:15', { enabled: true, start: '20:15' }), true);
  assert.equal(eveningOn('2026-11-21T19:30', { enabled: true, start: 'evening' }), true, 'bad start falls back to 18:00');
  assert.equal(eveningOn('2026-11-21T19:30', null), false);
  assert.equal(eveningStart({ start: '25:00' }), '18:00');
  assert.equal(eveningStart({ start: '21:30' }), '21:30');
});

test("tomorrow's edition: high, condition, headline, a narrative that starts at 7am, and chips", () => {
  const ctx = ctxAt('2026-11-21T19:30', { events: [ev({ travel: { minutes: 22, leaveBy: '2026-11-22T07:33' } })] });
  const t = tomorrowEdition(ctx);
  assert.equal(t.date, '2026-11-22');
  assert.equal(t.high, 63);
  assert.equal(t.away, false);
  assert.match(t.condition, /^[a-z ]+ & [a-z]+$/);
  assert.match(t.headline_lead, /^63° & /);
  assert.ok(t.headline_accent.length > 3);
  assert.match(t.narrative, /^starts around \d+ & [a-z ]+ at 7(, feels \d+)?\./);
  assert.match(t.narrative, /\*.+\.\*$/, 'ends with the italic outlook');
  assert.deepEqual(t.chips.map((c) => c.key), ['first', 'wear', 'tonight']);
  assert.equal(t.chips[0].text, '8am church service · leave 7:33');
  assert.match(t.chips[1].text, /church service/, 'wear is tied to the first morning event');
  assert.match(t.chips[2].text, /^low \d+ & [a-z ]+$/);
  assert.equal(tomorrowEdition(ctxAt('2026-11-30T19:30')), null, 'tomorrow beyond the forecast');
});

test("tomorrow's edition uses the trip forecast when you wake up away, and adds an umbrella on wet days", () => {
  const coast = coastModel();
  const travel = withManualTrip(null, { city: 'Anaheim', lat: 33.83, lon: -117.91, departDate: '2026-11-21', returnDate: '2026-11-25' });
  const id = manualTrip({ city: 'Anaheim', lat: 33.83, lon: -117.91, departDate: '2026-11-21', returnDate: '2026-11-25' }).id;
  const t = tomorrowEdition(ctxAt('2026-11-21T19:30', { travel, tripModels: { [id]: coast } }));
  assert.equal(t.away, true);
  assert.equal(t.high, 71);
  assert.equal(t.model, coast);
  // you sleep tonight where you wake up: the coast's coldest hour, read on the coast's clock (an hour behind)
  const coastNight = coast.hours.filter((h) => h.time >= '2026-11-21T18:00' && h.time < '2026-11-22T08:00');
  const coldest = Math.round(Math.min(...coastNight.map((h) => h.temp)));
  assert.match(t.chips.find((c) => c.key === 'tonight').text, new RegExp(`^low ${coldest} & `));
  assert.match(tonightLow(ctxAt('2026-11-21T19:30'), coast), new RegExp(`^low ${coldest} & `));
  const wet = clone(raw);
  wet.daily.precipitation_probability_max[2] = 70;
  wet.hourly.time.forEach((x, i) => { if (x.startsWith('2026-11-22T1')) wet.hourly.precipitation_probability[i] = 70; });
  const wm = normalize(wet, { name: 'Fictionville' }, 'imperial', {});
  const tw = tomorrowEdition({ ...ctxAt('2026-11-21T19:30'), model: at(wm, '2026-11-21T19:30'), homeModel: at(wm, '2026-11-21T19:30') });
  const u = tw.chips.find((c) => c.key === 'umbrella');
  assert.ok(u, 'umbrella chip');
  assert.match(u.text, /^yes, 70% from 10am$/);
});

test('firstUp, tonightLow, dayCondition', () => {
  assert.equal(firstUp([ev({})], '2026-11-22'), '8am church service');
  assert.equal(firstUp([ev({ ls: '2026-11-22T13:00', travel: { minutes: 30, leaveBy: '2026-11-22T12:30' } })], '2026-11-22'), '1pm church service · leave 12:30');
  assert.equal(firstUp([ev({ ls: '2026-11-22T12:15', travel: { minutes: 30, leaveBy: '2026-11-22T11:45' } })], '2026-11-22'), '12:15pm church service · leave 11:45am');
  assert.equal(firstUp([ev({ allDay: true })], '2026-11-22'), '');
  assert.equal(firstUp([], '2026-11-22'), '');
  const later = ev({ id: 'b', title: 'Brunch', ls: '2026-11-22T11:00' });
  assert.equal(firstUp([later, ev({})], '2026-11-22'), '8am church service', 'earliest first');
  assert.match(tonightLow(ctxAt('2026-11-21T19:30')), /^low \d+ & (clear|mostly clear|partly cloudy|overcast|[a-z ]+)$/);
  assert.match(dayCondition(home, '2026-11-22', 'imperial'), /^mostly clear & /);
  assert.equal(dayCondition(home, '2027-01-01', 'imperial'), '');
});

test('yourDay with a date shows that whole day and nothing after it', () => {
  const evs = [
    ev({ id: 'a', ls: '2026-11-22T08:00' }),
    ev({ id: 'b', ls: '2026-11-22T19:00', le: '2026-11-22T20:00' }),
    ev({ id: 'c', date: '2026-11-23', dates: ['2026-11-23'], ls: '2026-11-23T09:00', le: '2026-11-23T10:00' }),
    ev({ id: 'd', allDay: true, dates: ['2026-11-22'], ls: '2026-11-22T00:00' }),
  ];
  const v = yourDay(evs, '2026-11-21T19:30', { date: '2026-11-22' });
  assert.deepEqual(v.upcoming.map((e) => e.id), ['a', 'b']);
  assert.deepEqual(v.chips.map((e) => e.id), ['d']);
  assert.deepEqual(v.tomorrow, []);
  assert.equal(v.earlier, 0);
  assert.equal(v.next.id, 'a');
  assert.deepEqual(yourDay(evs, '2026-11-22T07:00', { date: '2026-11-22' }).upcoming.map((e) => e.id), ['a', 'b'], 'same day: the normal view');
});

// ---------------------------------------------------------------- the second card
const M = { city: 'Anaheim', region: 'California', lat: 33.83, lon: -117.91, departDate: '2026-11-22', returnDate: '2026-11-26' };
const TRIP_ID = 'anaheim|2026-11-22';
const PARKS = normalizeParks({
  ok: true,
  days: [{ date: '2026-11-23', name: 'Disneyland Park', timezone: 'America/Los_Angeles', hours: { open: '2026-11-23T08:00:00-08:00', close: '2026-11-24T00:00:00-08:00' }, shows: [], waits: [] }],
});
const SETTINGS = { show: { tripPrep: true, parks: true }, trip: { manual: M, checklist: null } };
function scene(over = {}) {
  const travel = withManualTrip(null, M);
  const ctx = ctxAt('2026-11-21T09:00', { travel, tripModels: { [TRIP_ID]: coastModel() }, ...over.ctx });
  return composeTrip(ctx, {
    target: '2026-11-21', today: '2026-11-21', settings: SETTINGS, bridge: null,
    home: { lat: 39.74, lon: -104.99, name: 'Fictionville' }, coordsFor: () => null, checks: () => ({ 'todo:hold the mail': true }), ...over.opts,
  });
}

test('composeTrip: trip prep with packing from the trip forecast and ticks', () => {
  const v = scene();
  assert.deepEqual(v.park, []);
  assert.equal(v.prep.trip.id, TRIP_ID);
  assert.equal(v.prep.sub, 'anaheim · nov 22–26');
  assert.equal(v.prep.departsIn, 1);
  assert.equal(v.prep.drive, '', 'no bridge: no drive line');
  assert.equal(v.prep.needsUpdate, false);
  assert.ok(v.prep.packing.length >= 1);
  assert.match(v.prep.packing[0].text, /^a warm layer for nights in the (low|mid|high) \d0s$/);
  assert.deepEqual(v.prep.todo.map((x) => [x.text, x.done]), [['book the cat sitter', false], ['hold the mail', true], ['set the thermostat', false], ['take out the trash', false]]);
  assert.equal(scene({ opts: { target: '2026-11-18' } }).prep, null, 'too early');
  assert.equal(scene({ opts: { settings: { ...SETTINGS, show: { tripPrep: false, parks: true } } } }).prep, null, 'switched off');
  const custom = scene({ opts: { settings: { ...SETTINGS, trip: { manual: M, checklist: ['feed the fish'] } } } });
  assert.deepEqual(custom.prep.todo.map((x) => x.text), ['feed the fish']);
});

test('composeTrip: bridge drive only for the trip it was asked about; old scripts get a nudge; park days and tags', () => {
  const td = { ok: true, minutes: 342, miles: 372.4, summary: 'I-10 W', departAt: '2026-11-22T08:00:00-07:00' };
  const v = scene({ opts: { bridge: { version: 3, parks: PARKS, tripDrive: td, tripReq: { id: TRIP_ID, date: '2026-11-22' } } } });
  assert.equal(v.prep.drive, '5h 42m drive · 372 mi via I-10 W');
  assert.ok(v.prep.packing.some((x) => x.text === 'comfortable walking shoes'), 'a park day during the trip');
  assert.deepEqual(v.parkTags, { '2026-11-23': 'disneyland' });
  const other = scene({ opts: { bridge: { version: 3, parks: null, tripDrive: td, tripReq: { id: 'elsewhere|2026-11-22' } } } });
  assert.equal(other.prep.drive, '');
  assert.equal(scene({ opts: { bridge: { version: 2 } } }).prep.needsUpdate, true);
  const park = scene({ opts: { target: '2026-11-23', today: '2026-11-23', bridge: { version: 3, parks: PARKS } } });
  assert.equal(park.park.length, 1);
  assert.equal(park.park[0].name, 'Disneyland Park');
  assert.equal(park.park[0].hours, 'open 8am–midnight');
  const off = scene({ opts: { target: '2026-11-23', settings: { ...SETTINGS, show: { tripPrep: true, parks: false } }, bridge: { version: 3, parks: PARKS } } });
  assert.deepEqual(off.park, []);
  assert.deepEqual(off.parkTags, {});
});

test('composeTrip: conflicts for the target day', () => {
  const near = { lat: 39.75, lon: -104.98, city: 'Fictionville' };
  const events = [{ id: 'x', title: 'Book club', allDay: false, start: '2026-11-24T18:00:00-07:00', date: '2026-11-24', dates: ['2026-11-24'], ls: '2026-11-24T17:00', le: '2026-11-24T18:00', location: '1 Main St, Fictionville' }];
  const v = scene({ ctx: { events }, opts: { target: '2026-11-24', coordsFor: () => near } });
  assert.deepEqual(v.dayConflicts, ["book club tue 6pm is in fictionville, but you're in anaheim that day"]);
  assert.deepEqual(scene({ ctx: { events }, opts: { coordsFor: () => near } }).dayConflicts, [], 'other days stay out of your day');
  assert.equal(scene({ ctx: { events }, opts: { target: '2026-11-21', coordsFor: () => near } }).prep.conflicts.length, 1, 'trip prep lists the trip\'s conflicts');
});

test('cachedGeocode reads only the geocoder cache, with the comma fallback', async () => {
  const store = new Map([['hl.geo.1 main st, fictionville', JSON.stringify({ lat: 1, lon: 2, city: 'Fictionville' })], ['hl.geo.nowhere', 'null'], ['hl.geo.fictionville', JSON.stringify({ lat: 3, lon: 4, city: 'Fictionville' })]]);
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: () => {}, removeItem: () => {} };
  try {
    const { cachedGeocode } = await import('../js/geo.js');
    assert.deepEqual(cachedGeocode('1 Main St,  Fictionville'), { lat: 1, lon: 2, city: 'Fictionville' });
    assert.equal(cachedGeocode('Nowhere'), null);
    assert.equal(cachedGeocode('Never seen'), null);
    assert.equal(cachedGeocode(''), null);
    store.set('hl.geo.old hall, fictionville', 'null');
    assert.deepEqual(cachedGeocode('Old Hall, Fictionville'), { lat: 3, lon: 4, city: 'Fictionville' }, 'a cached miss falls back to the part after the first comma');
  } finally { delete globalThis.localStorage; }
});
