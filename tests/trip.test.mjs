// Trip prep, manual trips and conflicts. Everything here is fictional.
import test from 'node:test';
import assert from 'node:assert/strict';
import { manualTrip, withManualTrip, buildResult } from '../js/travel.js';
import {
  prepTrip, bridgeTrip, packingList, mergePacking, parseChecklist, checklistItems, setCheck, checksKey, findConflicts, tripSub, DEFAULT_CHECKLIST,
} from '../js/tripprep.js';
import { fmtDateRange, addMinutes } from '../js/time.js';
import { localizeEvents, normalizeEvents } from '../js/calendar.js';

const HOME = { lat: 32.22, lon: -110.97, name: 'Tucson' }; // fictional home
const COAST = { city: 'Anaheim', region: 'California', lat: 33.83, lon: -117.91 };
const M = { ...COAST, departDate: '2026-11-22', returnDate: '2026-11-26' };

test('addMinutes does wall-clock math across days', () => {
  assert.equal(addMinutes('2026-11-22T23:30', 45), '2026-11-23T00:15');
  assert.equal(addMinutes('2026-11-22T00:10', -20), '2026-11-21T23:50');
  assert.equal(addMinutes('2026-11-22T10:00', 342), '2026-11-22T15:42');
});

test('manualTrip validates and uses the detected-trip id format', () => {
  const t = manualTrip(M);
  assert.deepEqual(t, { id: 'anaheim|2026-11-22', city: 'Anaheim', region: 'California', lat: 33.83, lon: -117.91, departDate: '2026-11-22', returnDate: '2026-11-26', lodging: true, manual: true });
  assert.equal(manualTrip({ ...M, returnDate: '2026-11-21' }), null, 'back before leaving');
  assert.equal(manualTrip({ ...M, departDate: '' }), null);
  assert.equal(manualTrip({ ...M, lat: NaN }), null);
  assert.equal(manualTrip(null), null);
  assert.equal(manualTrip({ ...M, returnDate: '2026-11-22' }).lodging, false, 'same-day trip is a day trip');
});

test('withManualTrip works with no calendar, replaces overlapping detected trips, and is idempotent', () => {
  const alone = withManualTrip(null, M);
  assert.equal(alone.trips.length, 1);
  assert.equal(alone.dayInfo('2026-11-22').flag, 'depart');
  assert.equal(alone.dayInfo('2026-11-23').where, 'away');
  assert.equal(alone.dayInfo('2026-11-26').flag, 'return');
  const detected = buildResult([
    { id: 'santa barbara|2026-11-23', city: 'Santa Barbara', lat: 34.4, lon: -119.7, departDate: '2026-11-23', returnDate: '2026-11-25', lodging: true },
    { id: 'laramie|2026-11-28', city: 'Laramie', lat: 41.3, lon: -105.6, departDate: '2026-11-28', returnDate: '2026-11-28', lodging: false },
  ]);
  const merged = withManualTrip(detected, M);
  assert.deepEqual(merged.trips.map((t) => t.city), ['Anaheim', 'Laramie']);
  const again = withManualTrip(merged, M);
  assert.deepEqual(again.trips.map((t) => t.id), merged.trips.map((t) => t.id));
  const cleared = withManualTrip(merged, null);
  assert.deepEqual(cleared.trips.map((t) => t.city), ['Laramie'], 'clearing drops the manual trip');
  assert.equal(withManualTrip(null, null), null);
  assert.equal(withManualTrip(detected, null), detected, 'untouched without a manual trip');
});

const travel = withManualTrip(null, M);

test('prep window: 3 days before departure through departure day, overnight trips only', () => {
  assert.equal(prepTrip(travel, '2026-11-18'), null);
  for (const d of ['2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']) assert.equal(prepTrip(travel, d).id, 'anaheim|2026-11-22', d);
  assert.equal(prepTrip(travel, '2026-11-23'), null, 'not once you are there');
  assert.equal(prepTrip(withManualTrip(null, { ...M, returnDate: '2026-11-22' }), '2026-11-21'), null, 'day trips need no prep');
  assert.equal(prepTrip(null, '2026-11-21'), null);
  assert.equal(tripSub(prepTrip(travel, '2026-11-21'), fmtDateRange), 'anaheim · nov 22–26');
});

test('bridgeTrip asks for the drive only within 2 days of departure', () => {
  assert.equal(bridgeTrip(travel, '2026-11-19'), null);
  assert.deepEqual(bridgeTrip(travel, '2026-11-20'), { id: 'anaheim|2026-11-22', lat: 33.83, lon: -117.91, date: '2026-11-22' });
  assert.ok(bridgeTrip(travel, '2026-11-22'));
  assert.equal(bridgeTrip(travel, '2026-11-23'), null, 'already left');
  assert.equal(bridgeTrip(null, '2026-11-22'), null);
});

// a tiny model: daily rows only (nightLow then falls back to the next day's low)
const day = (date, o = {}) => ({ date, high: 70, low: 58, precipProbMax: 0, uvMax: 3, ...o });
const model = (days) => ({ hours: [], days, offset: -28800, tz: 'America/Los_Angeles' });
const trip = manualTrip(M);

test('packing rules: cold nights, hot days, rain, uv, park days', () => {
  const mild = model(['2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26'].map((d) => day(d)));
  assert.deepEqual(packingList({ model: mild, trip }), []);
  // the night of the 25th (still away) bottoms out on the 26th's morning; the night of the 26th (home) is the 27th's low
  const cold = model([day('2026-11-22'), day('2026-11-23', { low: 52 }), day('2026-11-24', { low: 48 }), day('2026-11-25'), day('2026-11-26', { low: 50 }), day('2026-11-27', { low: 30 })]);
  assert.deepEqual(packingList({ model: cold, trip }), ['a warm layer for nights in the high 40s'], 'coldest night counts; the night after you get home does not');
  const low50s = model([day('2026-11-22'), day('2026-11-23', { low: 51 }), day('2026-11-24'), day('2026-11-25'), day('2026-11-26')]);
  assert.deepEqual(packingList({ model: low50s, trip }), ['a warm layer for nights in the low 50s']);
  const busy = model([day('2026-11-22', { high: 84 }), day('2026-11-23', { precipProbMax: 30 }), day('2026-11-24', { uvMax: 6 }), day('2026-11-25'), day('2026-11-26')]);
  assert.deepEqual(packingList({ model: busy, trip, parkDates: ['2026-11-23'] }), [
    'shorts', 'a rain jacket or poncho', 'sunscreen and hats', 'comfortable walking shoes', 'a portable charger', 'a refillable water bottle',
  ]);
  const edge = model([day('2026-11-22', { high: 80, precipProbMax: 29, uvMax: 5.9 }), day('2026-11-23', { low: 55 }), day('2026-11-24'), day('2026-11-25'), day('2026-11-26')]);
  assert.deepEqual(packingList({ model: edge, trip }), [], 'thresholds are strict where the spec says so');
  assert.deepEqual(packingList({ model: null, trip, parkDates: ['2026-11-23'] }), ['comfortable walking shoes', 'a portable charger', 'a refillable water bottle'], 'no forecast: park items only');
  const metric = model([day('2026-11-22', { high: 28 }), day('2026-11-23', { low: 11 }), day('2026-11-24', { high: 20, low: 15 }), day('2026-11-25', { high: 20, low: 15 }), day('2026-11-26', { high: 20, low: 15 })]);
  assert.deepEqual(packingList({ model: metric, trip, units: 'metric' }), ['a warm layer for nights near 11°', 'shorts']);
});

test('mergePacking keeps on-device items first and drops repeats and near-repeats', () => {
  const out = mergePacking(['a warm layer for nights in the low 50s', 'sunscreen and hats'], ['A warm layer for nights in the low 50s.', 'sunscreen', 'Ear plugs for the hotel', 42, null, '  ']);
  assert.deepEqual(out, ['a warm layer for nights in the low 50s', 'sunscreen and hats', 'ear plugs for the hotel']);
  assert.deepEqual(mergePacking(['shorts'], ['short socks']), ['shorts', 'short socks'], 'word boundaries, not substrings');
  assert.deepEqual(mergePacking(['a warm layer for nights in the high 40s'], ['a warm layer for nights in the low 50s', 'a portable fan']), ['a warm layer for nights in the high 40s', 'a portable fan'], 'same first three words: one is enough');
  assert.deepEqual(mergePacking(['a portable charger'], ['a portable fan']), ['a portable charger', 'a portable fan'], 'short items are compared whole');
  assert.deepEqual(mergePacking([], undefined), []);
  assert.equal(mergePacking(Array.from({ length: 20 }, (_, i) => `item ${i}`)).length, 12);
});

test('checklist parsing, defaults and ticks', () => {
  assert.deepEqual(parseChecklist('- Book the cat sitter\n\n  hold the mail  \n• water plants\nhold the mail'), ['book the cat sitter', 'hold the mail', 'water plants']);
  assert.equal(parseChecklist('  \n '), null);
  assert.deepEqual(checklistItems(null), DEFAULT_CHECKLIST);
  assert.deepEqual(checklistItems(['x']), ['x']);
  assert.deepEqual(DEFAULT_CHECKLIST, ['book the cat sitter', 'hold the mail', 'set the thermostat', 'take out the trash']);
  let s = setCheck(undefined, 'todo:hold the mail', true);
  s = setCheck(s, 'pack:shorts', true);
  assert.deepEqual(s, { 'todo:hold the mail': true, 'pack:shorts': true });
  const before = s;
  s = setCheck(s, 'pack:shorts', false);
  assert.deepEqual(s, { 'todo:hold the mail': true });
  assert.ok(before['pack:shorts'], 'returns a new object');
  assert.equal(checksKey('anaheim|2026-11-22'), 'hl.trip.anaheim|2026-11-22');
});

// ---------------------------------------------------------------- conflicts
const PLACES = {
  '1 harvest ln, tucson, az': { lat: 32.25, lon: -110.9, city: 'Tucson' },
  '9 far rd, flagstaff, az': { lat: 35.2, lon: -111.65, city: 'Flagstaff' },
};
const coordsFor = (loc) => PLACES[loc.toLowerCase()] || null;
const HOME_OFF = -25200; // arizona, no daylight saving
const TRIP_OFF = -28800; // california in november
const offsetFor = (date) => (travel.dayInfo(date).where === 'away' ? TRIP_OFF : HOME_OFF);
const evs = localizeEvents(normalizeEvents([
  { id: 'pickup', title: 'Thanksgiving pickup', start: '2026-11-26T10:15:00-07:00', end: '2026-11-26T10:45:00-07:00', location: '1 Harvest Ln, Tucson, AZ' },
  { id: 'late', title: 'Movie night', start: '2026-11-26T19:00:00-07:00', end: '2026-11-26T21:00:00-07:00', location: '1 Harvest Ln, Tucson, AZ' },
  { id: 'mid', title: 'Book club', start: '2026-11-24T18:00:00-07:00', end: '2026-11-24T19:00:00-07:00', location: '1 Harvest Ln, Tucson, AZ' },
  { id: 'brunch', title: 'Brunch with the neighbors', start: '2026-11-22T11:30:00-07:00', end: '2026-11-22T13:00:00-07:00', location: '1 Harvest Ln, Tucson, AZ' },
  { id: 'early', title: 'Coffee', start: '2026-11-22T07:00:00-07:00', end: '2026-11-22T07:30:00-07:00', location: '1 Harvest Ln, Tucson, AZ' },
  { id: 'far', title: 'Hike', start: '2026-11-24T09:00:00-07:00', end: '2026-11-24T12:00:00-07:00', location: '9 Far Rd, Flagstaff, AZ' },
  { id: 'zoom', title: 'Call', start: '2026-11-24T09:00:00-07:00', end: '2026-11-24T10:00:00-07:00', location: 'https://zoom.us/j/1' },
  { id: 'allday', title: 'Holiday', allDay: true, start: '2026-11-24', end: '2026-11-25', location: '1 Harvest Ln, Tucson, AZ' },
  { id: 'old', title: 'Past thing', start: '2026-11-20T10:00:00-07:00', end: '2026-11-20T11:00:00-07:00', location: '1 Harvest Ln, Tucson, AZ' },
]), offsetFor);
const base = { events: evs, travel, home: HOME, coordsFor, today: '2026-11-21', homeName: 'Tucson', homeOffset: HOME_OFF, tripOffset: () => TRIP_OFF };

test('conflicts: near-home events while away, before you are back, or after you leave', () => {
  const td = { ok: true, minutes: 342, miles: 372.4, summary: 'I-10 W', departAt: '2026-11-22T08:00:00-07:00' };
  const out = findConflicts({ ...base, tripDrive: td, driveTripId: 'anaheim|2026-11-22' });
  assert.deepEqual(out.map((c) => c.text), [
    'brunch with the neighbors sun 11:30am is in tucson, but you leave for anaheim at 8am',
    "book club tue 6pm is in tucson, but you're in anaheim that day",
    'thanksgiving pickup thu 10:15am is in tucson, but you check out in anaheim that morning (5h 42m drive)',
  ]);
  assert.ok(out.every((c) => c.tripId === 'anaheim|2026-11-22'));
  // 10am checkout in california is 11am at home; plus 5h 42m = 4:42pm, so the 7pm movie is fine and so is the 7am coffee
  assert.ok(!out.some((c) => c.id === 'late' || c.id === 'early' || c.id === 'far' || c.id === 'zoom' || c.id === 'allday' || c.id === 'old'));
});

test('conflicts: estimated drive without the bridge, departure time from the bridge', () => {
  const est = findConflicts(base);
  const pickup = est.find((c) => c.id === 'pickup');
  assert.match(pickup.text, /\(about \d+h( \d+m)? drive\)$/);
  const late = findConflicts({ ...base, tripDrive: { ok: true, minutes: 342, departAt: '2026-11-22T12:00:00-07:00' }, driveTripId: 'anaheim|2026-11-22' });
  assert.ok(!late.some((c) => c.id === 'brunch'), 'leaving at noon: the 11:30 brunch is fine');
  const other = findConflicts({ ...base, tripDrive: { ok: true, minutes: 30, departAt: '2026-11-22T06:00:00-07:00' }, driveTripId: 'someplace|2026-11-22' });
  assert.match(other.find((c) => c.id === 'pickup').text, /about/, 'a drive for another trip is ignored');
  assert.deepEqual(findConflicts({ ...base, travel: null }), []);
  assert.deepEqual(findConflicts({ ...base, coordsFor: () => null }), [], 'no cached geocode, no conflict');
});

test('conflicts that already started are left out (now is the home wall clock)', () => {
  const out = findConflicts({ ...base, today: '2026-11-22', now: '2026-11-22T12:00' });
  assert.ok(!out.some((c) => c.id === 'brunch'), 'the 11:30 brunch is past at noon');
  assert.ok(out.some((c) => c.id === 'pickup'));
  assert.ok(findConflicts({ ...base, today: '2026-11-22', now: '2026-11-22T11:00' }).some((c) => c.id === 'brunch'));
});
