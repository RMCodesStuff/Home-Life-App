// Whose event (calendars) and the Phoenix home pack. Everything here is fictional.
import test from 'node:test';
import assert from 'node:assert/strict';
import { autoLabel, calendarNames, calendarList, tagMap, filterEvents, isWorkCalendar, TAG_COLORS } from '../js/calendars.js';
import {
  windowText, powerPeakChip, wateringDay, wateringAdvice, dustChip, dustHigh, radarWanted, tileGrid, latestRadar, osmTile, radarTile,
  holidays, isPickup, daysUntilDue, choreChips, kidTips, CHORE_PRESETS,
} from '../js/phoenix.js';

// ---------------------------------------------------------------- calendars
const EVS = [
  ...Array.from({ length: 5 }, (_, i) => ({ id: `m${i}`, calendar: 'me@example.com' })),
  { id: 'k1', calendar: 'sam.doe@example.com' }, { id: 'k2', calendar: 'sam.doe@example.com' },
  { id: 'f1', calendar: 'Family' }, { id: 'h1', calendar: 'Holidays in United States' }, { id: 'x', calendar: '' },
];

test('auto labels and the busiest calendar as your own', () => {
  assert.equal(autoLabel('sam.doe@example.com'), 'sam');
  assert.equal(autoLabel('Family'), 'family');
  assert.equal(autoLabel('Holidays in United States'), 'holidays');
  assert.deepEqual(calendarNames(EVS).map((c) => [c.name, c.count]), [['me@example.com', 5], ['sam.doe@example.com', 2], ['Family', 1], ['Holidays in United States', 1]]);
  const list = calendarList(EVS, {});
  assert.deepEqual(list.map((c) => [c.name, c.own, c.label, c.color, c.show]), [
    ['me@example.com', true, '', '', true],
    ['sam.doe@example.com', false, 'sam', 'sage', true],
    ['Family', false, 'family', 'sky', true],
    ['Holidays in United States', false, 'holidays', 'plum', true],
  ]);
  assert.deepEqual(calendarList([], {}), []);
});

test('settings override labels, colors and visibility; the filter applies everywhere', () => {
  const cfg = { 'sam.doe@example.com': { label: 'Sam', color: 'plum' }, Family: { label: '' }, 'Holidays in United States': { show: false }, 'me@example.com': { label: 'me', color: 'nope' } };
  const list = calendarList(EVS, cfg);
  const by = Object.fromEntries(list.map((c) => [c.name, c]));
  assert.equal(by['sam.doe@example.com'].label, 'sam');
  assert.equal(by['sam.doe@example.com'].color, 'plum');
  assert.equal(by.Family.label, '', 'an empty label means no tag');
  assert.equal(by['Holidays in United States'].show, false);
  assert.equal(by['me@example.com'].label, 'me');
  assert.equal(by['me@example.com'].color, TAG_COLORS[0], 'a bad color falls back');
  const tags = tagMap(list);
  assert.deepEqual([...tags.keys()], ['me@example.com', 'sam.doe@example.com', 'Holidays in United States']);
  assert.deepEqual(filterEvents(EVS, cfg).map((e) => e.id).includes('h1'), false);
  assert.equal(filterEvents(EVS, cfg).length, EVS.length - 1);
  assert.equal(filterEvents(EVS, {}), EVS, 'nothing configured: everything');
});

test('work calendars: chosen in settings, or by name', () => {
  assert.equal(isWorkCalendar('Work'), true);
  assert.equal(isWorkCalendar('sam work'), true);
  assert.equal(isWorkCalendar('pat@acme.example'), true, 'a company email');
  assert.equal(isWorkCalendar('pat@gmail.example'), false);
  assert.equal(isWorkCalendar('Family'), false);
  assert.equal(isWorkCalendar('Workouts'), false);
  assert.equal(isWorkCalendar('en.usa#holiday@group.v.calendar.google.com'), false);
  assert.equal(isWorkCalendar('Family', ['Family']), true);
  assert.equal(isWorkCalendar('Work', ['Family']), false, 'an explicit list wins');
});

// ---------------------------------------------------------------- phoenix pack
const day = (date, o = {}) => ({ date, high: 75, low: 50, precipSum: 0, et0: 0.16, uvMax: 5, ...o });
const mdl = (days, hours = []) => ({ days, hours, offset: -25200, tz: 'America/Denver' });
const POWER = { enabled: true, windows: [{ days: [1, 2, 3, 4, 5], start: '16:00', end: '19:00' }], months: [5, 6, 7, 8, 9, 10], mode: 'months', hotAt: 90 };

test('power peak chip', () => {
  const july = mdl([day('2026-07-15', { high: 104 })]); // a wednesday
  assert.equal(windowText({ start: '16:00', end: '19:00' }), '4–7pm');
  assert.equal(windowText({ start: '11:00', end: '14:00' }), '11am–2pm');
  assert.equal(powerPeakChip({ model: july, date: '2026-07-15', cfg: POWER }), 'power peak 4–7pm · pre-cool by 3:45, high 104');
  assert.equal(powerPeakChip({ model: july, date: '2026-07-15', now: '2026-07-15T19:30', cfg: POWER }), '', 'the window is over');
  assert.equal(powerPeakChip({ model: july, date: '2026-07-15', now: '2026-07-14T19:30', cfg: POWER }), 'power peak 4–7pm · pre-cool by 3:45, high 104', 'tomorrow, seen the evening before');
  assert.equal(powerPeakChip({ model: july, date: '2026-07-15', cfg: { ...POWER, enabled: false } }), '');
  const nov = mdl([day('2026-11-18', { high: 92 })]);
  assert.equal(powerPeakChip({ model: nov, date: '2026-11-18', cfg: POWER }), '', 'outside the active months');
  assert.equal(powerPeakChip({ model: nov, date: '2026-11-18', cfg: { ...POWER, mode: 'hot' } }), 'power peak 4–7pm · pre-cool by 3:45, high 92', 'or only when the high is 90 or more');
  assert.equal(powerPeakChip({ model: mdl([day('2026-11-18', { high: 85 })]), date: '2026-11-18', cfg: { ...POWER, mode: 'hot' } }), '');
  assert.equal(powerPeakChip({ model: mdl([day('2026-07-18', { high: 104 })]), date: '2026-07-18', cfg: POWER }), '', 'saturday: no window');
  const two = { ...POWER, windows: [{ days: [3], start: '11:00', end: '14:00' }, { days: [3], start: '17:00', end: '20:00' }] };
  assert.equal(powerPeakChip({ model: july, date: '2026-07-15', cfg: two }), 'power peak 11am–2pm, 5–8pm · pre-cool by 10:45, high 104');
});

test('watering advice', () => {
  const dates = Array.from({ length: 8 }, (_, i) => `2026-11-${String(16 + i).padStart(2, '0')}`);
  const dry = mdl(dates.map((d) => day(d)));
  assert.deepEqual(wateringAdvice(dry, '2026-11-17'), { skip: false, value: 'water', note: '1.1 in. of evaporation this week, no rain', line: 'water as usual: 1.1 in. of evaporation this week, no rain' });
  const wet = mdl(dates.map((d) => day(d, d === '2026-11-18' ? { precipSum: 0.42 } : {})));
  assert.equal(wateringAdvice(wet, '2026-11-17').line, 'skip watering: 0.4 in. of rain coming');
  const yday = mdl(dates.map((d) => day(d, d === '2026-11-16' ? { precipSum: 0.5 } : {})));
  assert.equal(wateringAdvice(yday, '2026-11-17').line, 'skip watering: 0.5 in. of rain yesterday');
  const drizzle = mdl(dates.map((d) => day(d, d === '2026-11-21' ? { precipSum: 0.1 } : {})));
  assert.equal(wateringAdvice(drizzle, '2026-11-17').line, 'water as usual: 1.1 in. of evaporation this week, 0.1 in. of rain');
  const noEt = mdl(dates.map((d) => day(d, { et0: null })));
  assert.equal(wateringAdvice(noEt, '2026-11-17').line, 'water as usual: no rain');
  const mm = mdl(dates.map((d) => day(d, { et0: 4, precipSum: d === '2026-11-17' ? 7 : 0 })));
  assert.equal(wateringAdvice(mm, '2026-11-17', 'metric').line, 'skip watering: 7 mm of rain coming');
  assert.equal(wateringAdvice(dry, '2027-01-01'), null);
  assert.equal(wateringDay({ enabled: true, days: [2, 5] }, '2026-11-17'), true, 'a tuesday');
  assert.equal(wateringDay({ enabled: true, days: [2, 5] }, '2026-11-18'), false);
  assert.equal(wateringDay({ enabled: false, days: [2] }, '2026-11-17'), false);
});

test('dust', () => {
  assert.equal(dustChip({ pm10: 180, dust: 40 }), 'dusty: pm10 180, keep the windows shut');
  assert.equal(dustChip({ pm10: 90, dust: 120 }), 'dusty: dust 120 µg/m³, keep the windows shut');
  assert.equal(dustChip({ pm10: 150, dust: 100 }), '', 'thresholds are strict');
  assert.equal(dustChip(null), '');
  assert.equal(dustHigh({ pm10: null, dust: 101 }), true);
});

test('radar: when, which tiles, which frame', () => {
  const hours = [0, 1, 2, 3, 4, 5, 6, 7].map((h) => ({ time: `2026-11-17T${String(14 + h).padStart(2, '0')}:00`, precipProb: h === 5 ? 45 : 10 }));
  assert.equal(radarWanted(mdl([], hours), '2026-11-17T14:20'), true, '45% within 6 hours');
  assert.equal(radarWanted(mdl([], hours), '2026-11-17T08:00'), false);
  assert.equal(radarWanted(mdl([], []), '2026-11-17T08:00', [{ event: 'Dust Storm Warning' }]), true, 'an alert');
  const g = tileGrid(33.45, -112.07, 7);
  assert.equal(g.tiles.length, 9);
  assert.deepEqual(g.tiles[4], { x: 24, y: 51, col: 1, row: 1 });
  assert.deepEqual(g.tiles[0], { x: 23, y: 50, col: 0, row: 0 });
  assert.ok(g.fx > 0 && g.fx < 1 && g.fy > 0 && g.fy < 1);
  assert.deepEqual(tileGrid(10, 179.9, 2).tiles.map((t) => t.x).slice(0, 3), [2, 3, 0], 'wraps around the date line');
  const maps = { host: 'https://tilecache.rainviewer.com', radar: { past: [{ time: 1, path: '/v2/radar/111' }, { time: 2, path: '/v2/radar/222' }] } };
  const f = latestRadar(maps);
  assert.deepEqual(f, { host: 'https://tilecache.rainviewer.com', path: '/v2/radar/222', time: 2 });
  assert.equal(radarTile(f, { x: 24, y: 51 }, 7), 'https://tilecache.rainviewer.com/v2/radar/222/256/7/24/51/2/1_1.png');
  assert.equal(osmTile({ x: 24, y: 51 }, 7), 'https://tile.openstreetmap.org/7/24/51.png');
  assert.equal(latestRadar({ host: 'http://x', radar: { past: [{ path: '/a' }] } }), null, 'https only');
  assert.equal(latestRadar({}), null);
});

test('holidays and pickup delays', () => {
  assert.deepEqual(holidays(2026), ['2026-01-01', '2026-05-25', '2026-07-04', '2026-09-07', '2026-11-26', '2026-12-25']);
  const trash = { id: 't', name: 'trash', kind: 'bin', rule: { type: 'weekly', day: 4 }, holiday: true };
  assert.equal(isPickup(trash, '2026-11-19'), true);
  assert.equal(isPickup(trash, '2026-11-26'), false, 'thanksgiving');
  assert.equal(isPickup(trash, '2026-11-27'), true, 'one day later');
  assert.equal(isPickup(trash, '2026-12-24'), true, 'christmas falls after thursday that week');
  assert.equal(isPickup(trash, '2026-09-10'), false, 'labor day earlier in the week');
  assert.equal(isPickup(trash, '2026-09-11'), true);
  assert.equal(isPickup({ ...trash, holiday: false }, '2026-11-26'), true, 'without holiday delay');
  const rec = { id: 'r', name: 'recycling', kind: 'bin', rule: { type: 'weeks', n: 2, start: '2026-11-12' }, holiday: true };
  assert.equal(isPickup(rec, '2026-11-12'), true);
  assert.equal(isPickup(rec, '2026-11-19'), false);
  assert.equal(isPickup(rec, '2026-11-27'), true, 'every other week, delayed by thanksgiving');
  assert.equal(isPickup(rec, '2026-11-05'), false, 'before it started');
  assert.equal(isPickup({ ...rec, rule: { type: 'weeks', n: 2, start: null } }, '2026-11-12'), false);
});

test('chore chips: out tonight (with gusts), due today, overdue', () => {
  const trash = { id: 't', name: 'trash', kind: 'bin', rule: { type: 'weekly', day: 4 }, holiday: true };
  const filter = { id: 'f', name: 'ac filter', kind: 'task', rule: { type: 'days', n: 30 }, last: '2026-10-19' };
  const water = { id: 'w', name: 'water the citrus', kind: 'task', rule: { type: 'weekly', day: 4 } };
  const calm = mdl([], [{ time: '2026-11-18T21:00', gust: 12 }]);
  assert.deepEqual(choreChips({ chores: [trash, filter, water], today: '2026-11-18', evening: true, morning: false, tonightModel: calm }).map((c) => [c.label, c.text]), [['bins', 'trash out tonight'], ['tomorrow', 'water the citrus tomorrow']]);
  const rec = { id: 'r', name: 'recycling', kind: 'bin', rule: { type: 'weekly', day: 4 }, holiday: true };
  const both = choreChips({ chores: [trash, rec], today: '2026-11-18', evening: true, morning: false, tonightModel: mdl([], [{ time: '2026-11-18T22:00', gust: 31 }]) });
  assert.deepEqual(both.map((c) => c.text), ['trash and recycling out tonight, gusts to 31, weigh the lids'], 'one chip for all the bins');
  const windy = mdl([], [{ time: '2026-11-18T22:00', gust: 28.4 }, { time: '2026-11-19T03:00', gust: 20 }]);
  assert.equal(choreChips({ chores: [trash], today: '2026-11-18', evening: true, tonightModel: windy })[0].text, 'trash out tonight, gusts to 28, weigh the lid');
  assert.equal(choreChips({ chores: [trash], today: '2026-11-18', evening: true, tonightModel: windy, units: 'metric' })[0].text, 'trash out tonight', '28 km/h is under 25 mph');
  assert.deepEqual(choreChips({ chores: [trash], today: '2026-11-25', evening: true }), [], 'no pickup on thanksgiving');
  assert.equal(choreChips({ chores: [trash], today: '2026-11-26', evening: true })[0].text, 'trash out tonight', 'the delayed pickup');
  assert.equal(daysUntilDue(filter, '2026-11-18'), 0);
  assert.deepEqual(choreChips({ chores: [filter], today: '2026-11-18', evening: false }).map((c) => c.text), ['ac filter due today']);
  assert.deepEqual(choreChips({ chores: [filter], today: '2026-11-21', evening: false }).map((c) => c.text), ['ac filter overdue, 3 days']);
  assert.deepEqual(choreChips({ chores: [filter], today: '2026-11-19', evening: false }).map((c) => c.text), ['ac filter overdue, 1 day']);
  assert.deepEqual(choreChips({ chores: [{ ...filter, last: '2026-11-10' }], today: '2026-11-18', evening: false }), []);
  assert.equal(daysUntilDue(trash, '2026-11-18'), null);
  assert.deepEqual(choreChips({ chores: null, today: '2026-11-18', evening: true }), []);
  assert.deepEqual(CHORE_PRESETS.map((p) => p.key), ['trash', 'recycling', 'filter', 'pest']);
});

test('kid-friendly tips', () => {
  const hot = mdl([day('2026-07-15', { high: 104, uvMax: 9.4 })], [{ time: '2026-07-15T12:00', uv: 9 }]);
  assert.deepEqual(kidTips(hot, '2026-07-15'), ['playground before 9am, surfaces heat fast above 90°', 'sunscreen by 9am, uv 9 at noon']);
  assert.deepEqual(kidTips(mdl([day('2026-07-15', { high: 40, uvMax: 3 })]), '2026-07-15', 'metric'), ['playground before 9am, surfaces heat fast above 32°']);
  assert.deepEqual(kidTips(mdl([day('2026-11-17', { high: 75, uvMax: 5 })]), '2026-11-17'), []);
  assert.deepEqual(kidTips(null, '2026-11-17'), []);
});
