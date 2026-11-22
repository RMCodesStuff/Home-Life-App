// Park days and the trip drive (bridge v3), app side. Everything here is fictional or public park names.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeParks, normalizeTripDrive, driveLine, parkDaysFor, parkTag, parkClock, hoursLine, rideName, modelForPark, parkView,
} from '../js/parks.js';
import { normalizeBridge, fetchCalendar } from '../js/calendar.js';

const DAY = {
  date: '2027-03-08', parkId: 'p1', name: 'Starfall Park', timezone: 'America/Los_Angeles',
  hours: { open: '2027-03-08T08:00:00-08:00', close: '2027-03-09T00:00:00-08:00' },
  early: { open: '2027-03-08T07:30:00-08:00', close: '2027-03-08T08:00:00-08:00' },
  shows: [{ name: 'Wondrous Journeys', times: ['2027-03-08T21:30:00-08:00'] }, { name: 'Magic Happens Parade', times: ['2027-03-08T17:00:00-08:00', '2027-03-08T14:00:00-08:00'] }],
  waits: [{ name: 'Star Wars: Rise of the Resistance', minutes: 75 }, { name: 'Indiana Jones™ Adventure', minutes: 50 }, { name: 'Space Mountain', minutes: 85 }],
};
const PARKS = { ok: true, source: 'themeparks.wiki', days: [DAY, { ...DAY, date: '2027-03-09', name: 'Sunrise Valley Adventure Park', hours: null, early: null, shows: [], waits: [] }] };

test('normalizeParks: defensive, sorted, capped', () => {
  const p = normalizeParks(PARKS);
  assert.equal(p.ok, true);
  assert.equal(p.days.length, 2);
  assert.deepEqual(p.days[0].waits.map((w) => w.minutes), [85, 75, 50], 'longest first');
  assert.deepEqual(p.days[0].shows[1].times, ['2027-03-08T14:00:00-08:00', '2027-03-08T17:00:00-08:00'], 'times sorted');
  assert.equal(p.days[1].hours, null);
  assert.deepEqual(normalizeParks({ ok: false, error: 'disabled' }), { ok: false, error: 'disabled', days: [] });
  assert.equal(normalizeParks(null), null);
  assert.equal(normalizeParks('x'), null);
  const messy = normalizeParks({
    ok: true,
    days: [
      { date: 'tomorrow', name: 'X' }, { date: '2027-03-08' }, null,
      { date: '2027-03-08', name: 'Park', hours: { open: 'bad', close: 'bad' }, early: { open: '2027-03-08T07:00:00-08:00' }, shows: [{ name: 'Show', times: ['nope'] }, { times: [] }], waits: [{ name: 'Ride', minutes: 'x' }, { name: 'Ride 2', minutes: -5 }, { name: 'Ride 3', minutes: 12.6 }] },
    ],
  });
  assert.equal(messy.days.length, 1);
  assert.equal(messy.days[0].hours, null);
  assert.deepEqual(messy.days[0].early, { open: '2027-03-08T07:00:00-08:00', close: null });
  assert.deepEqual(messy.days[0].shows, [], 'shows without valid times are dropped');
  assert.deepEqual(messy.days[0].waits, [{ name: 'Ride 3', minutes: 13 }]);
  const many = normalizeParks({ ok: true, days: [{ ...DAY, waits: Array.from({ length: 9 }, (_, i) => ({ name: `r${i}`, minutes: i })) }] });
  assert.equal(many.days[0].waits.length, 6);
  assert.equal(many.days[0].waits[0].minutes, 8);
});

test('normalizeTripDrive and driveLine', () => {
  const td = normalizeTripDrive({ ok: true, minutes: 342.4, miles: 372.4, summary: 'I-10 W', departAt: '2027-03-07T08:00:00-07:00' });
  assert.deepEqual(td, { ok: true, minutes: 342, miles: 372.4, summary: 'I-10 W', departAt: '2027-03-07T08:00:00-07:00' });
  assert.equal(driveLine(td), '5h 42m drive · 372 mi via I-10 W');
  assert.equal(driveLine(td, 'metric'), '5h 42m drive · 599 km via I-10 W');
  assert.equal(driveLine({ ok: true, minutes: 45, miles: null, summary: '' }), '45 min drive');
  assert.equal(driveLine({ ok: true, minutes: 90, miles: null, summary: 'US-60' }), '1h 30m drive · via US-60');
  assert.equal(driveLine(null), '');
  assert.equal(driveLine({ ok: false, error: 'too_close' }), '');
  assert.deepEqual(normalizeTripDrive({ ok: false, error: 'too_close' }), { ok: false, error: 'too_close' });
  assert.deepEqual(normalizeTripDrive({ ok: true, minutes: 0 }), { ok: false, error: 'bad_data' });
  assert.equal(normalizeTripDrive(undefined), null);
  assert.equal(normalizeTripDrive({ ok: true, minutes: 60, departAt: 'soon' }).departAt, '');
});

test('hours line, park clock, ride names, tags', () => {
  const p = normalizeParks(PARKS);
  assert.equal(parkClock('2027-03-09T00:00:00-08:00'), 'midnight');
  assert.equal(parkClock('2027-03-08T21:30:00-08:00'), '9:30pm');
  assert.equal(hoursLine(p.days[0]), 'open 8am–midnight · early entry 7:30');
  assert.equal(hoursLine(p.days[1]), '');
  assert.equal(hoursLine({ hours: { open: '2027-03-08T13:00:00-08:00', close: '2027-03-08T22:00:00-08:00' }, early: { open: '2027-03-08T11:30:00-08:00' } }), 'open 1pm–10pm · early entry 11:30am');
  assert.equal(hoursLine({ hours: null, early: { open: '2027-03-08T07:30:00-08:00', close: null } }), 'early entry 7:30am');
  assert.equal(rideName('Star Wars: Rise of the Resistance'), 'rise of the resistance');
  assert.equal(rideName('Guardians of the Galaxy – Mission: BREAKOUT!'), 'guardians of the galaxy – mission: breakout!');
  assert.equal(rideName('Indiana Jones™ Adventure'), 'indiana jones adventure');
  assert.equal(parkTag('Starfall Park'), 'starfall');
  assert.equal(parkTag('Sunrise Valley Adventure Park'), 'sunrise valley adventure');
  assert.equal(parkTag('Magic Kingdom Park'), 'magic kingdom');
  assert.deepEqual(parkDaysFor(p, '2027-03-09').map((d) => d.name), ['Sunrise Valley Adventure Park']);
  assert.deepEqual(parkDaysFor({ ok: false, days: [] }, '2027-03-09'), []);
  assert.deepEqual(parkDaysFor(null, '2027-03-09'), []);
});

// hourly rows for the park's evening (wall clock in the park's zone)
function parkModel(temps, tz = 'America/Los_Angeles') {
  const hours = [];
  for (let h = 0; h < 24; h++) hours.push({ time: `2027-03-08T${String(h).padStart(2, '0')}:00`, temp: temps(h), code: h >= 21 ? 0 : 1, isDay: h >= 7 && h < 17 ? 1 : 0 });
  hours.push({ time: '2027-03-09T00:00', temp: temps(24), code: 0, isDay: 0 });
  return { tz, offset: -28800, hours, days: [{ date: '2027-03-08', high: 66, low: 50 }] };
}

test('parkView: shows with the weather at showtime, waits only today, a layering note when the evening drops below 60', () => {
  const p = normalizeParks(PARKS).days[0];
  const m = parkModel((h) => (h <= 15 ? 50 + h : 68 - (h - 15) * 2));
  const v = parkView(p, { model: m, units: 'imperial', today: '2027-03-08' });
  assert.equal(v.name, 'Starfall Park');
  assert.equal(v.hours, 'open 8am–midnight · early entry 7:30');
  assert.deepEqual(v.shows, ['magic happens parade 2pm, 5pm · 64° & mostly sunny', 'wondrous journeys 9:30pm · 56° & clear']);
  assert.deepEqual(v.waits, [{ name: 'space mountain', minutes: 85 }, { name: 'rise of the resistance', minutes: 75 }, { name: 'indiana jones adventure', minutes: 50 }]);
  assert.equal(v.layer, '52° by 11pm, bring the warm layer', 'coldest hour before closing');
  const tomorrow = parkView(p, { model: m, today: '2027-03-07' });
  assert.deepEqual(tomorrow.waits, [], 'standby waits are only for today');
  const warm = parkView(p, { model: parkModel(() => 64), today: '2027-03-08' });
  assert.equal(warm.layer, '');
  const bare = parkView(p, { model: null, today: '2027-03-08' });
  assert.deepEqual(bare.shows, ['magic happens parade 2pm, 5pm', 'wondrous journeys 9:30pm']);
  assert.equal(bare.layer, '');
  const metric = parkView(p, { model: parkModel(() => 14), units: 'metric', today: '2027-03-08' });
  assert.equal(metric.layer, '14° by 6pm, bring the warm layer', '14°C is under 60°F');
});

test('modelForPark prefers a forecast in the park time zone', () => {
  const p = normalizeParks(PARKS).days[0];
  const home = { tz: 'America/Denver', days: [{ date: '2027-03-08' }], hours: [] };
  const coast = { tz: 'America/Los_Angeles', days: [{ date: '2027-03-08' }], hours: [] };
  assert.equal(modelForPark(p, [home, coast], home), coast);
  assert.equal(modelForPark(p, [home], home), home);
  assert.equal(modelForPark(p, [{ ...coast, days: [] }], home), home, 'must cover the date');
});

test('normalizeBridge: v3 adds parks and the trip drive; v2 has neither', () => {
  const v3 = normalizeBridge({ ok: true, version: 3, features: { gmail: true, leaveBy: true, oura: false, parks: true, tripDrive: true }, parks: PARKS, tripDrive: { ok: true, minutes: 342, miles: 372.4, summary: 'I-10 W' } });
  assert.equal(v3.version, 3);
  assert.deepEqual(v3.features, { gmail: true, leaveBy: true, oura: false, parks: true, tripDrive: true, briefing: false, birthdays: false });
  assert.equal(v3.parks.days.length, 2);
  assert.equal(v3.tripDrive.minutes, 342);
  const absent = normalizeBridge({ ok: true, version: 3, features: {} });
  assert.equal(absent.parks, null);
  assert.equal(absent.tripDrive, null, 'no trip param sent: no tripDrive');
  const off = normalizeBridge({ ok: true, version: 3, parks: { ok: false, error: 'disabled' }, tripDrive: { ok: false, error: 'too_close' } });
  assert.deepEqual(off.parks, { ok: false, error: 'disabled', days: [] });
  assert.deepEqual(off.tripDrive, { ok: false, error: 'too_close' });
  const v2 = normalizeBridge({ ok: true, version: 2, features: { gmail: true }, parks: PARKS });
  assert.equal(v2.parks, null);
  assert.equal(v2.tripDrive, null);
  assert.equal(normalizeBridge({ ok: true }).parks, null);
});

test('fetchCalendar sends trip and tripDate only for a valid trip', async () => {
  const urls = [];
  globalThis.fetch = async (u) => { urls.push(u); return { ok: true, status: 200, json: async () => ({ ok: true, version: 3, events: [], parks: PARKS }) }; };
  try {
    const r = await fetchCalendar('https://script.google.com/macros/s/FAKE/exec', 'k', 14, { from: { lat: 40.015, lon: -105.2705 }, trip: { lat: 47.620512, lon: -122.349301, date: '2027-03-07' } });
    assert.ok(urls[0].endsWith('&from=40.0150,-105.2705&trip=47.6205,-122.3493&tripDate=2027-03-07'), urls[0]);
    assert.equal(r.parks.days.length, 2);
    await fetchCalendar('https://script.google.com/macros/s/FAKE/exec', 'k', 14, { trip: { lat: 1, lon: 2, date: 'soon' } });
    assert.ok(!urls[1].includes('trip='), 'bad date: no trip param');
    await fetchCalendar('https://script.google.com/macros/s/FAKE/exec', 'k', 14, { trip: null });
    assert.ok(!urls[2].includes('trip='));
    await fetchCalendar('https://script.google.com/macros/s/FAKE/exec', 'k', 14, { trip: { lat: 33.8, lon: -117.9, date: '2027-03-07' } });
    assert.ok(!urls[3].includes('trip='), 'never trip without from (the bridge answers no_origin)');
  } finally { delete globalThis.fetch; }
});
