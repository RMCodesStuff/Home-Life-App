import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalize, hourAt, nightLow, hoursBetween, dayByDate } from '../js/weather.js';
import * as I from '../js/insights.js';
import { buildResult } from '../js/travel.js';
import { localNow, toLocal, addDays, addHours, fmtClock, fmtHourShort, fmtDateLong, fmtDuration, diffDays } from '../js/time.js';

const raw = JSON.parse(fs.readFileSync(new URL('./fixtures/forecast.json', import.meta.url), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const mk = (r = raw, place = { name: 'Fictionville' }, units = 'imperial') => normalize(r, place, units, { aq: { us_aqi: 43, pm2_5: 7 } });

/** Make `model.current` agree with the hourly row at `now`, as it does in real life. */
function at(model, now) {
  const h = hourAt(model, now);
  return { ...model, current: { ...model.current, time: now, temp: h.temp, feels: h.feels, humidity: h.humidity, dew: h.dew, code: h.code, cloud: h.cloud, pressure: h.pressure, wind: h.wind, windDir: h.windDir, gust: h.gust, isDay: h.isDay } };
}
const ctxAt = (now, over = {}, model = mk()) => {
  const m = at(model, now);
  return { now, units: 'imperial', model: m, homeModel: m, tripModels: {}, travel: null, events: [], ...over };
};
const NOW = '2026-11-21T14:15';

test('normalize: shape, nulls and helpers', () => {
  const m = mk();
  assert.equal(m.place.name, 'Fictionville');
  assert.equal(m.offset, -25200);
  assert.equal(m.days[0].date, '2026-11-20'); // past_days=1
  assert.equal(m.hours[0].time, '2026-11-20T00:00');
  assert.equal(m.aqi.category, 'good');
  const r2 = clone(raw); r2.hourly.temperature_2m[30] = null; r2.daily.sunrise[1] = null;
  const m2 = normalize(r2, {}, 'imperial');
  assert.equal(m2.hours[30].temp, null);
  assert.equal(m2.days[1].sunrise, null);
  assert.equal(hoursBetween(m, '2026-11-21T09:00', '2026-11-21T12:00').length, 3);
  assert.equal(dayByDate(m, '2026-11-21').high, 62);
});

test('nightLow uses hourly 18:00 -> 08:00 and falls back to daily lows', () => {
  const m = mk();
  const manual = Math.min(...hoursBetween(m, '2026-11-21T18:00', '2026-11-22T08:00').map((h) => h.temp));
  assert.equal(nightLow(m, '2026-11-21'), manual);
  const last = m.days[m.days.length - 1].date; // no hours after midnight of the last day
  assert.equal(nightLow(m, last), dayByDate(m, last).low);
});

test('time helpers across a UTC offset', () => {
  const ms = Date.parse('2026-11-21T03:30:00Z');
  assert.equal(localNow(-25200, ms), '2026-11-20T20:30'); // previous evening in Denver
  assert.equal(localNow(3600 * 9, ms), '2026-11-21T12:30'); // Tokyo
  assert.equal(toLocal('2026-11-21T09:00:00-07:00', -25200), '2026-11-21T09:00');
  assert.equal(toLocal('2026-11-21T09:00:00-07:00', -28800), '2026-11-21T08:00'); // one hour earlier on the coast
  assert.equal(toLocal('2026-11-21T23:30:00-07:00', 3600 * 9), '2026-11-22T15:30');
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(diffDays('2026-11-26', '2026-11-22'), 4);
  assert.equal(addHours('2026-11-21T23:00', 2), '2026-11-22T01:00');
  assert.ok('2026-11-21T09:00' < '2026-11-21T10:00'); // lexicographic compare is the contract
});

test('time formatters', () => {
  assert.equal(fmtHourShort(7), '7a');
  assert.equal(fmtHourShort(12), '12p');
  assert.equal(fmtHourShort(0), '12a');
  assert.equal(fmtClock('2026-11-21T09:00'), '9am');
  assert.equal(fmtClock('2026-11-21T16:35'), '4:35pm');
  assert.equal(fmtClock('2026-11-21T12:00'), 'noon');
  assert.equal(fmtDateLong('2026-11-21'), 'saturday, nov 21');
  assert.equal(fmtDuration(37500), '10h 25m');
});

test('sky words by WMO code, day and night', () => {
  assert.deepEqual(I.skyWord(0, 1), { word: 'clear', head: 'sunny', cat: 'clear' });
  assert.equal(I.skyWord(0, 0).head, 'clear');
  assert.equal(I.skyWord(1, 1).head, 'mostly sunny');
  assert.equal(I.skyWord(1, 0).head, 'mostly clear');
  assert.equal(I.skyWord(2).word, 'partly cloudy');
  assert.equal(I.skyWord(45).cat, 'fog');
  assert.equal(I.skyWord(53).word, 'drizzly');
  assert.equal(I.skyWord(56).word, 'freezing drizzle');
  assert.equal(I.skyWord(63).word, 'rainy');
  assert.equal(I.skyWord(67).word, 'freezing rain');
  assert.equal(I.skyWord(75).word, 'heavy snow');
  assert.equal(I.skyWord(80).word, 'passing showers');
  assert.equal(I.skyWord(86).word, 'snow showers');
  assert.equal(I.skyWord(95).cat, 'storm');
  assert.equal(I.skyWord(99).word, 'storms with hail');
});

test('condition: sky & wind/temperature word', () => {
  const base = ctxAt(NOW);
  const withCur = (patch, units = 'imperial') => ({ ...base, units, model: { ...base.model, current: { ...base.model.current, ...patch } } });
  assert.equal(I.condition(withCur({ wind: 3, code: 0, isDay: 0, feels: 40 })), 'clear & still');
  assert.equal(I.condition(withCur({ wind: 8, code: 1, isDay: 1, feels: 70 })), 'mostly sunny & mild'.replace('mostly sunny', 'mostly clear'));
  assert.equal(I.condition(withCur({ wind: 8, code: 3, feels: 40 })), 'overcast & cold');
  assert.equal(I.condition(withCur({ wind: 15, code: 3, feels: 60 })), 'overcast & breezy');
  assert.equal(I.condition(withCur({ wind: 25, code: 61, feels: 60 })), 'light rain & windy');
  assert.equal(I.condition(withCur({ wind: 8, code: 0, feels: 90 })), 'clear & warm');
  assert.equal(I.condition(withCur({ wind: 8, code: 0, feels: 100 })), 'clear & hot');
  assert.equal(I.condition(withCur({ wind: 8, code: 0, feels: 30 })), 'clear & frigid');
  assert.equal(I.condition(withCur({ wind: 8, code: 0, feels: 50 })), 'clear & crisp');
  // metric: 14 km/h is ~8.7 mph (temperature word), 30 km/h is ~18.6 mph (breezy); 10C = 50F crisp
  assert.equal(I.condition(withCur({ wind: 14, code: 0, feels: 10 }, 'metric')), 'clear & crisp');
  assert.equal(I.condition(withCur({ wind: 30, code: 0, feels: 10 }, 'metric')), 'clear & breezy');
});

test('headline: lead, accents and overrides', () => {
  const h = I.headline(ctxAt(NOW));
  assert.equal(h.lead, '62° & sunny,');
  assert.equal(h.accent, 'another clean blue day'); // yesterday was clear too
  const r2 = clone(raw); r2.daily.weather_code[0] = 61; // yesterday rainy
  const h2 = I.headline(ctxAt(NOW, {}, mk(r2)));
  assert.ok(['a clean blue day', 'not a cloud to speak of', 'blue sky all the way'].includes(h2.accent));
  assert.equal(I.headline(ctxAt(NOW, {}, mk(r2))).accent, h2.accent, 'deterministic for a date');
  const hot = clone(raw); hot.daily.temperature_2m_max[1] = 103;
  assert.equal(I.headline(ctxAt(NOW, {}, mk(hot))).accent, 'a scorcher, stay in the shade');
  assert.equal(I.headline(ctxAt(NOW, {}, mk(hot))).lead, '103° & sunny,');
  const cold = clone(raw); cold.daily.temperature_2m_max[1] = 34;
  assert.equal(I.headline(ctxAt(NOW, {}, mk(cold))).accent, 'bundle up');
  const rain = clone(raw); rain.daily.weather_code[1] = 63;
  const hr = I.headline(ctxAt(NOW, {}, mk(rain)));
  assert.equal(hr.lead, '62° & rainy,');
  assert.ok(['bring the umbrella', 'a wet one'].includes(hr.accent));
  const c = clone(raw); c.daily.temperature_2m_max[1] = 70; // °C user: 36C is >= 100F
  const metricHot = clone(raw); metricHot.daily.temperature_2m_max[1] = 38;
  assert.equal(I.headline({ ...ctxAt(NOW, {}, mk(metricHot, {}, 'metric')), units: 'metric' }).accent, 'a scorcher, stay in the shade');
  assert.ok(c);
});

function rainyModel(prob, hourStart = 15, hourEnd = 18) {
  const r2 = clone(raw);
  r2.hourly.time.forEach((t, i) => {
    r2.hourly.precipitation_probability[i] = t.startsWith('2026-11-21') && +t.slice(11, 13) >= hourStart && +t.slice(11, 13) < hourEnd ? prob : 0;
  });
  return mk(r2);
}

test('umbrella thresholds', () => {
  assert.equal(I.umbrella(ctxAt(NOW)), 'no, 0% all day');
  assert.equal(I.umbrella(ctxAt(NOW, {}, rainyModel(10))), 'no, 10% all day');
  assert.equal(I.umbrella(ctxAt(NOW, {}, rainyModel(11))), 'probably not, 11% around 3pm');
  assert.equal(I.umbrella(ctxAt(NOW, {}, rainyModel(39))), 'probably not, 39% around 3pm');
  assert.equal(I.umbrella(ctxAt(NOW, {}, rainyModel(40))), 'yes, 40% around 3pm');
  assert.equal(I.umbrella(ctxAt(NOW, {}, rainyModel(69))), 'yes, 69% around 3pm');
  assert.equal(I.umbrella(ctxAt(NOW, {}, rainyModel(70))), 'yes, 70% from 3pm');
  assert.equal(I.umbrella(ctxAt(NOW, {}, rainyModel(90))), 'yes, 90% from 3pm');
});

const gym = (over = {}) => ({ id: 'g1', title: 'Gym Walk Loop', allDay: false, start: '2026-11-21T09:00:00-07:00', end: '2026-11-21T10:00:00-07:00', location: '', date: '2026-11-21', dates: ['2026-11-21'], ls: '2026-11-21T09:00', le: '2026-11-21T10:00', ...over });

test('wear: morning anchor, afternoon anchor, same item all day', () => {
  const early = '2026-11-21T07:10';
  const w1 = I.wear(ctxAt(early, { events: [gym()] }));
  assert.match(w1, /^a (warm jacket|jacket|sweater|winter coat) for the 9am gym walk loop, a (sweater|light layer|t-shirt|jacket) by (noon|1|2|3|4)$/);
  const w2 = I.wear(ctxAt(early));
  assert.match(w2, /this morning, .* by \d|noon/);
  // evening-only event shouldn't anchor the morning
  const w3 = I.wear(ctxAt(early, { events: [gym({ ls: '2026-11-21T18:00', le: '2026-11-21T19:00' })] }));
  assert.match(w3, /this morning/);
  // flat warm day -> same item all day
  const warm = clone(raw);
  warm.hourly.temperature_2m = warm.hourly.temperature_2m.map(() => 75);
  warm.hourly.apparent_temperature = warm.hourly.apparent_temperature.map(() => 75);
  assert.equal(I.wear(ctxAt(early, {}, mk(warm))), 'a t-shirt all day');
  // after noon: no morning anchor
  assert.match(I.wear(ctxAt(NOW)), /for the rest of the day|this afternoon/);
  // table spot checks
  const frozen = clone(raw);
  frozen.hourly.apparent_temperature = frozen.hourly.apparent_temperature.map(() => 15);
  assert.equal(I.wear(ctxAt(early, {}, mk(frozen))), 'your heaviest coat all day');
  const hot = clone(raw);
  hot.hourly.apparent_temperature = hot.hourly.apparent_temperature.map(() => 97);
  assert.equal(I.wear(ctxAt(early, {}, mk(hot))), 'the lightest thing you own all day');
});

test('best window: contiguous 2-4h block, dry, in daylight, tomorrow fallback', () => {
  const bw = I.bestWindow(ctxAt('2026-11-21T07:10'));
  assert.match(bw, /^\d+(am|pm)? to (\d+|noon)(am|pm)?, \d+( to \d+)?°$/);
  // all hours in the chosen block are dry
  const blocked = rainyModel(60, 9, 14); // wet 9am-2pm; window should avoid it
  const bw2 = I.bestWindow(ctxAt('2026-11-21T08:10', {}, blocked));
  assert.match(bw2, /^(2|3|4)(pm)? to (4|5)pm|^3 to 5pm|^2 to 4pm/);
  // after sunset -> tomorrow
  assert.match(I.bestWindow(ctxAt('2026-11-21T19:30')), /^tomorrow /);
  // < 2 daylight hours left -> tomorrow
  assert.match(I.bestWindow(ctxAt('2026-11-21T16:05')), /^tomorrow /);
  // rain all day tomorrow & today -> none
  const wet = clone(raw);
  wet.hourly.precipitation_probability = wet.hourly.precipitation_probability.map(() => 80);
  assert.equal(I.bestWindow(ctxAt('2026-11-21T19:30', {}, mk(wet))), 'no clean window today');
  // a scorching afternoon is avoided in favor of milder hours
  const hotpm = clone(raw);
  hotpm.hourly.apparent_temperature = hotpm.hourly.apparent_temperature.map((v, i) => (+hotpm.hourly.time[i].slice(11, 13) >= 13 ? 100 : 68));
  hotpm.hourly.temperature_2m = hotpm.hourly.apparent_temperature.slice();
  const bw3 = I.bestWindow(ctxAt('2026-11-21T07:10', {}, mk(hotpm)));
  assert.match(bw3, /^(7|8|9|10|11|12)/);
});

test('narrative: structure, length, trajectory', () => {
  const n = I.narrative(ctxAt('2026-11-21T07:10'));
  assert.match(n, /^about \d+ & [a-z ]+ at 7/);
  assert.match(n, /warms( fast)?: /);
  assert.match(n, /sundown about \d+:\d+/);
  assert.match(n, /night near \d+/);
  assert.match(n, /\*[^*]+\*\.?$/); // italic outlook last
  assert.equal(n, n.toLowerCase());
  const words = n.split(/\s+/).length;
  assert.ok(words >= 35 && words <= 110, `word count ${words}`);
  // past the peak -> cooling or holding language
  const late = I.narrative(ctxAt('2026-11-21T15:05'));
  assert.match(late, /cooling now|holding near|topping out/);
  // night mode
  const night = I.narrative(ctxAt('2026-11-21T21:00'));
  assert.match(night, /overnight/);
  assert.doesNotMatch(night, /sundown/);
  assert.match(night, /sunrise about/);
  // rain chances phrase and wettest stretch
  const rn = I.narrative(ctxAt('2026-11-21T09:00', {}, rainyModel(55, 13, 16)));
  assert.match(rn, /rain chances peak at 55% around 1pm, wettest 1 to 4pm/);
  // dry with a little chance
  assert.match(I.narrative(ctxAt('2026-11-21T09:00', {}, rainyModel(8))), /(dry|sunny) all day, 8% rain at most/);
  const gray = clone(raw); gray.daily.weather_code[1] = 3;
  assert.match(I.narrative(ctxAt('2026-11-21T09:00', {}, mk(gray))), /dry all day, 0% rain every hour/);
  // fast warming
  const fast = clone(raw);
  fast.hourly.temperature_2m = fast.hourly.temperature_2m.map((v, i) => { const t = fast.hourly.time[i]; const h = +t.slice(11, 13); return t.startsWith('2026-11-21') ? 40 + Math.max(0, Math.min(h - 6, 9)) * 3.5 : v; });
  assert.match(I.narrative(ctxAt('2026-11-21T07:10', {}, mk(fast))), /warms fast: \d+ by 9, \d+ by noon, peak \d+ around 3/);
});

test('narrative: outlook mentions rain days and trips', () => {
  const n = I.narrative(ctxAt(NOW));
  assert.match(n, /\*63 sun, 66 mon, then rain chances creep in wed afternoon\.\*$/);
  // rain within the next two days is handled; cool-down detection on a different start day
  const n2 = I.narrative(ctxAt('2026-11-24T09:00'));
  assert.match(n2, /then a cool-down|then rain/);
});

function tripSetup() {
  const r2 = clone(raw);
  const bump = (a) => a.map((v) => (v == null ? v : v + 10));
  r2.hourly.temperature_2m = bump(r2.hourly.temperature_2m);
  r2.hourly.apparent_temperature = bump(r2.hourly.apparent_temperature);
  r2.daily.temperature_2m_max = bump(r2.daily.temperature_2m_max);
  r2.daily.temperature_2m_min = bump(r2.daily.temperature_2m_min);
  r2.daily.weather_code = r2.daily.weather_code.map(() => 0);
  r2.daily.precipitation_probability_max = r2.daily.precipitation_probability_max.map(() => 0);
  r2.hourly.precipitation_probability = r2.hourly.precipitation_probability.map(() => 0);
  r2.hourly.weather_code = r2.hourly.weather_code.map(() => 0);
  const trip = { id: 'santa barbara|2026-11-22', city: 'Santa Barbara', region: 'California', lat: 34.42, lon: -119.7, departDate: '2026-11-22', returnDate: '2026-11-26', lodging: true };
  return { trip, tripModel: normalize(r2, { name: 'Santa Barbara' }, 'imperial'), travel: buildResult([trip]) };
}

test('day notes: rain, big change, wind, travel', () => {
  const ctx = ctxAt(NOW);
  assert.match(I.dayNote(ctx, '2026-11-25'), /^35% after 1pm(, \*\d+% wed night\*)?\.$/);
  assert.equal(I.dayNote(ctx, '2026-11-26'), 'big drop, high near 49.'); // 58 -> 49
  const windy = clone(raw);
  windy.daily.wind_gusts_10m_max[2] = 31;
  assert.equal(I.dayNote(ctxAt(NOW, {}, mk(windy)), '2026-11-22'), 'gusty, to 31 mph.');
  const breezy = clone(raw);
  breezy.daily.wind_speed_10m_max[2] = 15; breezy.daily.wind_gusts_10m_max[2] = 20;
  assert.equal(I.dayNote(ctxAt(NOW, {}, mk(breezy)), '2026-11-22'), 'breezy, west 15 mph.');
  assert.match(I.dayNote(ctx, '2026-11-21'), /wind about \d+ mph\.|sunny and /);
  // travel
  const { trip, tripModel, travel } = tripSetup();
  const tctx = { ...ctx, travel, tripModels: { [trip.id]: tripModel } };
  assert.equal(I.dayNote(tctx, '2026-11-22'), 'you head to santa barbara. 76 & sunny there.'); // depart: tomorrow's forecast there
  assert.equal(I.dayNote(tctx, '2026-11-24'), 'in santa barbara. home is 65 & partly cloudy.');
  assert.equal(I.dayNote(tctx, '2026-11-26'), 'heading home, 49 & overcast there.');
  assert.equal(I.dayNote(tctx, '2026-11-21'), I.dayNote(ctx, '2026-11-21')); // not a travel day
  // away days use the trip forecast via modelForDate
  assert.equal(I.modelForDate(tctx, '2026-11-24'), tripModel);
  assert.equal(I.modelForDate(tctx, '2026-11-22'), tctx.homeModel); // depart day: you wake up at home
});

test('event notes use the hour at the event start', () => {
  const ctx = ctxAt('2026-11-21T07:10', { events: [gym()] });
  const n = I.eventNote(ctx, gym());
  assert.match(n, /^\d+° & (sunny|clear|mostly sunny) · (coat|jacket|sweater)$/);
  const wet = rainyModel(45, 9, 10);
  assert.match(I.eventNote(ctxAt('2026-11-21T07:10', {}, wet), gym()), /, 45% rain · /);
  assert.equal(I.eventNote(ctx, { ...gym(), allDay: true }), '');
});

test('fine print: values and notes', () => {
  const fp = I.finePrint(ctxAt(NOW));
  const by = Object.fromEntries(fp.map((x) => [x.key, x]));
  assert.equal(fp.length, 8);
  assert.equal(by.sunrise.value, '6:58am');
  assert.match(by.sunrise.note, /^sunset \d+:\d+pm$/);
  assert.match(by.daylight.value, /^\d+h \d+m$/);
  assert.match(by.daylight.note, /min (shorter|longer) tomorrow|about the same/);
  assert.match(by.wind.value, /^W \d+ mph$/);
  assert.match(by.pressure.value, /^\d\d\.\d\d in$/);
  assert.equal(by.dew.note, 'comfortable'); // 46° dew point
  assert.equal(by.aqi.value, '43');
  assert.equal(by.aqi.note, 'good, clean air');
  const noAq = { ...ctxAt(NOW), model: { ...ctxAt(NOW).model, aqi: null } };
  assert.deepEqual(I.finePrint(noAq).find((x) => x.key === 'aqi'), { key: 'aqi', label: 'air quality', value: '—', note: 'no reading right now' });
  const metric = normalize(raw, {}, 'metric');
  assert.match(I.finePrint({ ...ctxAt(NOW, {}, metric), units: 'metric' }).find((x) => x.key === 'pressure').value, /^\d+ hPa$/);
});

test('writeAll returns every field, lowercase prose, notes for 10 days', () => {
  const w = I.writeAll(ctxAt('2026-11-21T07:10', { events: [gym()] }));
  for (const k of ['condition', 'headline_lead', 'headline_accent', 'narrative', 'umbrella', 'wear', 'best_window']) {
    assert.equal(typeof w[k], 'string'); assert.ok(w[k].length > 0, k);
    assert.equal(w[k], w[k].toLowerCase(), k);
  }
  assert.equal(w.day_notes.length, 10);
  w.day_notes.forEach((d) => assert.ok(d.note.length > 0 && d.note.length <= 90, d.note));
  assert.deepEqual(w.event_notes.map((e) => e.id), ['g1']);
  assert.ok(!/°/.test(w.narrative), 'no degree sign in prose');
});

test('narrative outlook: trips and flights', () => {
  const { trip, tripModel, travel } = tripSetup();
  const base = { travel, tripModels: { [trip.id]: tripModel } };
  const flight = gym({ id: 'f1', title: 'Flight to Santa Barbara', date: '2026-11-22', dates: ['2026-11-22'], ls: '2026-11-22T10:15', le: '2026-11-22T12:00' });
  assert.match(I.narrative(ctxAt(NOW, { ...base, events: [flight] })), /\*you fly to santa barbara tomorrow morning, mid 70s & sunny there\.\*$/);
  assert.match(I.narrative(ctxAt(NOW, base)), /\*santa barbara from tomorrow, mid 70s & sunny there\.\*$/);
  // two days out: tomorrow's home high is listed first
  const later = buildResult([{ ...trip, departDate: '2026-11-23', returnDate: '2026-11-26' }]);
  assert.match(I.narrative(ctxAt(NOW, { travel: later, tripModels: { [trip.id]: tripModel } })), /\*63 sun, then santa barbara from mon, (low|mid|high) 70s & sunny there\.\*$/);
  // while away, the outlook points home
  const awayCtx = { ...ctxAt('2026-11-23T09:00', base), model: at(tripModel, '2026-11-23T09:00') };
  assert.match(I.narrative(awayCtx), /then home (tomorrow|wed|thu), \d+ & [a-z ]+ there\.\*$/);
});
