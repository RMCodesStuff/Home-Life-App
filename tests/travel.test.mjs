import test from 'node:test';
import assert from 'node:assert/strict';
import { detectTrips, travelLine, tripsToForecast, buildResult, NOT_A_PLACE } from '../js/travel.js';
import { localizeEvents, yourDay, normalizeEvents } from '../js/calendar.js';
import { haversineMiles } from '../js/geo.js';

// Fictional home near Denver; all places and events are made up.
const HOME = { lat: 39.74, lon: -104.99 };
const PLACES = {
  'pier inn, 1 pier way, santa barbara, ca 93101': { lat: 34.42, lon: -119.7, city: 'Santa Barbara', region: 'California' },
  'state street cafe, santa barbara, ca': { lat: 34.43, lon: -119.69, city: 'Santa Barbara', region: 'California' },
  'riverside hall, laramie, wy': { lat: 41.31, lon: -105.59, city: 'Laramie', region: 'Wyoming' },
  '123 main st, denver, co': { lat: 39.75, lon: -104.98, city: 'Denver', region: 'Colorado' },
};
function fakeGeocoder() {
  const calls = [];
  const geocode = async (text) => { calls.push(text); return PLACES[text.toLowerCase()] || null; };
  return { geocode, calls };
}

const EVENTS = normalizeEvents([
  { id: 'stay', title: 'Stay at Pier Inn', allDay: true, start: '2026-11-22', end: '2026-11-26', location: '1 Pier Way, Santa Barbara, CA 93101'.replace(/^/, 'Pier Inn, ') },
  { id: 'dinner', title: 'Dinner', allDay: false, start: '2026-11-23T19:00:00-07:00', end: '2026-11-23T21:00:00-07:00', location: 'State Street Cafe, Santa Barbara, CA' },
  { id: 'gym', title: 'Gym', allDay: false, start: '2026-11-21T09:00:00-07:00', end: '2026-11-21T10:00:00-07:00', location: '123 Main St, Denver, CO' },
  { id: 'call', title: 'Planning call', allDay: false, start: '2026-11-21T13:00:00-07:00', end: '2026-11-21T13:30:00-07:00', location: 'https://zoom.us/j/000000' },
  { id: 'meet', title: 'Standup', allDay: false, start: '2026-11-21T15:00:00-07:00', end: '2026-11-21T15:15:00-07:00', location: 'meet.google.com/abc-defg-hij' },
  { id: 'fair', title: 'Book fair', allDay: false, start: '2026-11-28T10:00:00-07:00', end: '2026-11-28T15:00:00-07:00', location: 'Riverside Hall, Laramie, WY' },
  { id: 'far', title: 'Far future', allDay: false, start: '2026-12-20T10:00:00-07:00', end: '2026-12-20T11:00:00-07:00', location: 'Riverside Hall, Laramie, WY' },
]);

test('meeting links are not places', () => {
  for (const s of ['https://zoom.us/j/1', 'meet.google.com/x', 'teams.microsoft.com/l/x', 'Webex room', 'Online', 'http://x']) assert.ok(NOT_A_PLACE.test(s), s);
  assert.ok(!NOT_A_PLACE.test('1 Pier Way, Santa Barbara'));
});

test('detects a lodging trip with depart/return flags, a day trip, and ignores local + online events', async () => {
  const { geocode, calls } = fakeGeocoder();
  const t = await detectTrips({ events: EVENTS, home: HOME, today: '2026-11-21', geocode });
  assert.ok(!calls.some((c) => /zoom|meet\.google/.test(c)), 'meeting links are never geocoded');
  assert.ok(!calls.some((c) => /laramie/i.test(c) && calls.indexOf(c) !== calls.lastIndexOf(c)), 'each location geocoded once');
  assert.equal(calls[0], EVENTS[0].location, 'multi-day all-day events are geocoded first');
  assert.equal(t.trips.length, 2);
  const [sb, lar] = t.trips;
  assert.deepEqual({ city: sb.city, depart: sb.departDate, ret: sb.returnDate, lodging: sb.lodging }, { city: 'Santa Barbara', depart: '2026-11-22', ret: '2026-11-26', lodging: true });
  assert.deepEqual({ city: lar.city, depart: lar.departDate, ret: lar.returnDate, lodging: lar.lodging }, { city: 'Laramie', depart: '2026-11-28', ret: '2026-11-28', lodging: false });

  assert.deepEqual(pick(t.dayInfo('2026-11-21')), { where: 'home', flag: null, city: null }); // local gym is not away
  assert.deepEqual(pick(t.dayInfo('2026-11-22')), { where: 'home', flag: 'depart', city: 'Santa Barbara' });
  assert.deepEqual(pick(t.dayInfo('2026-11-23')), { where: 'away', flag: 'away', city: 'Santa Barbara' });
  assert.deepEqual(pick(t.dayInfo('2026-11-25')), { where: 'away', flag: 'away', city: 'Santa Barbara' });
  assert.deepEqual(pick(t.dayInfo('2026-11-26')), { where: 'away', flag: 'return', city: 'Santa Barbara' });
  assert.deepEqual(pick(t.dayInfo('2026-11-27')), { where: 'home', flag: null, city: null });
  assert.deepEqual(pick(t.dayInfo('2026-11-28')), { where: 'away', flag: 'daytrip', city: 'Laramie' });
});
const pick = (i) => ({ where: i.where, flag: i.flag, city: i.trip ? i.trip.city : null });

test('a nearby (< 75 mi) location is not away; events far outside the window are ignored', async () => {
  assert.ok(haversineMiles(HOME, PLACES['123 main st, denver, co']) < 75);
  assert.ok(haversineMiles(HOME, PLACES['riverside hall, laramie, wy']) > 75);
  const { geocode, calls } = fakeGeocoder();
  const t = await detectTrips({ events: EVENTS.filter((e) => ['gym', 'far'].includes(e.id)), home: HOME, today: '2026-11-21', geocode });
  assert.equal(t.trips.length, 0);
  assert.deepEqual(calls, ['123 Main St, Denver, CO']);
});

test('geocoder failures and misses do not throw', async () => {
  const t = await detectTrips({ events: EVENTS, home: HOME, today: '2026-11-21', geocode: async () => { throw new Error('offline'); } });
  assert.equal(t.trips.length, 0);
  const t2 = await detectTrips({ events: EVENTS, home: HOME, today: '2026-11-21', geocode: async () => undefined });
  assert.equal(t2.trips.length, 0);
});

test('travel line wording', async () => {
  const { geocode } = fakeGeocoder();
  const t = await detectTrips({ events: EVENTS, home: HOME, today: '2026-11-21', geocode });
  assert.equal(travelLine(t, '2026-11-21'), 'santa barbara trip starts tomorrow');
  assert.equal(travelLine(t, '2026-11-20'), 'next trip: santa barbara, nov 22–26');
  assert.equal(travelLine(t, '2026-11-22'), 'travel day · santa barbara tonight, back nov 26');
  assert.equal(travelLine(t, '2026-11-23'), 'day 2 in santa barbara · home thu, nov 26');
  assert.equal(travelLine(t, '2026-11-26'), 'heading home today');
  assert.equal(travelLine(t, '2026-11-27'), 'day trip to laramie tomorrow');
  assert.equal(travelLine(t, '2026-11-28'), 'day trip to laramie today');
  assert.equal(travelLine(buildResult([]), '2026-11-21'), 'no travel on your calendar for two weeks');
});

test('trips to forecast: within the 10-day window, max 2 distinct places', async () => {
  const { geocode } = fakeGeocoder();
  const t = await detectTrips({ events: EVENTS, home: HOME, today: '2026-11-21', geocode });
  assert.deepEqual(tripsToForecast(t, '2026-11-21').map((x) => x.city), ['Santa Barbara', 'Laramie']);
  assert.deepEqual(tripsToForecast(t, '2026-11-21', 1).map((x) => x.city), ['Santa Barbara']);
  assert.deepEqual(tripsToForecast(t, '2026-11-29').map((x) => x.city), []);
});

test('localize events + your day view in the location wall clock', () => {
  const denver = -25200; const coast = -28800;
  const ev = localizeEvents(EVENTS, (d) => (d >= '2026-11-23' && d <= '2026-11-26' ? coast : denver));
  const dinner = ev.find((e) => e.id === 'dinner');
  assert.equal(dinner.ls, '2026-11-23T18:00'); // 7pm Denver time is 6pm on the coast
  const stay = ev.find((e) => e.id === 'stay');
  assert.deepEqual(stay.dates, ['2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25']);
  const v = yourDay(ev, '2026-11-21T12:00');
  assert.equal(v.earlier, 1); // the 9am gym
  assert.deepEqual(v.upcoming.map((e) => e.id), ['call', 'meet']);
  assert.equal(v.next.id, 'call');
  assert.deepEqual(v.tomorrow, []); // two left today, so no tomorrow preview
  const v2 = yourDay(ev, '2026-11-21T15:20');
  assert.equal(v2.earlier, 3);
  assert.deepEqual(v2.chips, []);
  const v3 = yourDay(ev, '2026-11-23T08:00');
  assert.deepEqual(v3.chips.map((e) => e.id), ['stay']);
  assert.deepEqual(v3.upcoming.map((e) => e.id), ['dinner']);
});
