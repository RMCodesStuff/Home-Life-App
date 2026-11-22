// Phoenix home pack: power peak, watering, dust, the radar strip, chores and kid-friendly heat tips. Pure functions with
// injected dates (local wall clock strings), models and settings. Thresholds are °F / mph / inches internally.
import { addDays, diffDays, dowIndex, hourKey, fmtClock, addMinutes, datePart } from './time.js';
import { dayByDate, hoursBetween } from './weather.js';

const toF = (v, units) => (v == null ? null : units === 'metric' ? (v * 9) / 5 + 32 : v);
const toMph = (v, units) => (v == null ? null : units === 'metric' ? v / 1.609344 : v);
const toIn = (v, units) => (v == null ? null : units === 'metric' ? v / 25.4 : v);
const r = (v) => Math.round(v);
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const plain = (t) => fmtClock(t).replace(/(am|pm)$/, '');
const sameHalf = (a, b) => (+a.slice(0, 2) < 12) === (+b.slice(0, 2) < 12);

export const DEFAULT_PHOENIX = {
  power: { enabled: false, windows: [{ days: [1, 2, 3, 4, 5], start: '16:00', end: '19:00' }], months: [5, 6, 7, 8, 9, 10], mode: 'months', hotAt: 90 },
  watering: { enabled: false, days: [] },
};

// ---------------------------------------------------------------- power peak
/** "4–7pm", "11am–2pm" */
export function windowText(w) {
  const a = fmtClock(w.start); const b = fmtClock(w.end);
  return sameHalf(w.start, w.end) && !/noon|midnight/.test(a) ? `${plain(w.start)}–${b}` : `${a}–${b}`;
}
/**
 * "power peak 4–7pm · pre-cool by 3:45, high 104" on active days ('' otherwise). `now` hides a window that's over (today only).
 * Active: in one of `months` (mode 'months'), or when the high reaches `hotAt`°F (mode 'hot').
 */
export function powerPeakChip({ model, date, now = '', cfg, units = 'imperial' }) {
  if (!cfg || !cfg.enabled || !model || !date) return '';
  const d = dayByDate(model, date);
  if (!d) return '';
  const month = +date.slice(5, 7);
  const active = cfg.mode === 'hot' ? d.high != null && toF(d.high, units) >= (cfg.hotAt || 90) : (cfg.months || []).includes(month);
  if (!active) return '';
  const dow = dowIndex(date);
  const wins = (cfg.windows || []).filter((w) => w && TIME.test(w.start || '') && TIME.test(w.end || '') && w.end > w.start && (w.days || []).includes(dow))
    .filter((w) => !now || datePart(now) !== date || now.slice(11, 16) < w.end)
    .sort((a, b) => a.start.localeCompare(b.start));
  if (!wins.length) return '';
  const pre = addMinutes(`${date}T${wins[0].start}`, -15).slice(11, 16);
  const preText = sameHalf(pre, wins[0].start) ? plain(pre) : fmtClock(pre);
  return `power peak ${wins.map(windowText).join(', ')} · pre-cool by ${preText}${d.high != null ? `, high ${r(d.high)}` : ''}`;
}

// ---------------------------------------------------------------- watering
const amount = (inches, units) => (units === 'metric' ? `${r(inches * 25.4)} mm` : `${(Math.round(inches * 10) / 10).toFixed(1)} in.`);
/** Is `date` a watering day? */
export const wateringDay = (cfg, date) => !!(cfg && cfg.enabled && date && (cfg.days || []).includes(dowIndex(date)));
/**
 * The watering call for `date`: skip when 0.25 in. or more of rain is coming (that day and the next) or fell yesterday,
 * otherwise water as usual with the week's evaporation (et0). {skip, line, value, note} or null without a forecast.
 */
export function wateringAdvice(model, date, units = 'imperial') {
  if (!model || !dayByDate(model, date)) return null;
  const sumOf = (dates, key) => dates.map((x) => dayByDate(model, x)).filter(Boolean).map((x) => x[key]).filter((v) => v != null).reduce((a, b) => a + b, 0);
  const coming = toIn(sumOf([date, addDays(date, 1)], 'precipSum'), units);
  const yesterday = toIn(sumOf([addDays(date, -1)], 'precipSum'), units);
  const week = Array.from({ length: 7 }, (_, i) => addDays(date, i));
  const et = week.map((x) => dayByDate(model, x)).filter((x) => x && x.et0 != null);
  const evap = et.length ? toIn(et.reduce((a, x) => a + x.et0, 0), units) : null;
  const weekRain = toIn(sumOf(week, 'precipSum'), units);
  if (coming >= 0.25) return { skip: true, value: 'skip', note: `${amount(coming, units)} of rain coming`, line: `skip watering: ${amount(coming, units)} of rain coming` };
  if (yesterday >= 0.25) return { skip: true, value: 'skip', note: `${amount(yesterday, units)} of rain yesterday`, line: `skip watering: ${amount(yesterday, units)} of rain yesterday` };
  const rainText = weekRain >= 0.05 ? `${amount(weekRain, units)} of rain` : 'no rain';
  const note = evap != null ? `${amount(evap, units)} of evaporation this week, ${rainText}` : rainText;
  return { skip: false, value: 'water', note, line: `water as usual: ${note}` };
}

// ---------------------------------------------------------------- dust
export const dustHigh = (aqi) => !!(aqi && ((aqi.pm10 != null && aqi.pm10 > 150) || (aqi.dust != null && aqi.dust > 100)));
/** "dusty: pm10 180, keep the windows shut" ('' unless pm10 > 150 or dust > 100 µg/m³). */
export function dustChip(aqi) {
  if (!dustHigh(aqi)) return '';
  return aqi.pm10 != null && aqi.pm10 > 150 ? `dusty: pm10 ${r(aqi.pm10)}, keep the windows shut` : `dusty: dust ${r(aqi.dust)} µg/m³, keep the windows shut`;
}

// ---------------------------------------------------------------- radar
/** Rain 40% or more in the next 6 hours, or an active alert. */
export function radarWanted(model, now, alerts = []) {
  if ((alerts || []).length) return true;
  if (!model || !now) return false;
  const h = hourKey(now);
  return hoursBetween(model, h, addMinutes(h, 6 * 60)).some((x) => (x.precipProb ?? 0) >= 40);
}
/** A 3×3 block of slippy-map tiles centred on the place: {z, tiles:[{x, y, col, row}], fx, fy} (fx/fy: the point inside the centre tile, 0–1). */
export function tileGrid(lat, lon, z = 7) {
  const n = 2 ** z;
  const xf = ((lon + 180) / 360) * n;
  const rad = (Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180;
  const yf = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  const cx = Math.floor(xf); const cy = Math.floor(yf);
  const tiles = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const y = cy + row - 1;
      if (y < 0 || y >= n) continue;
      tiles.push({ x: (((cx + col - 1) % n) + n) % n, y, col, row });
    }
  }
  return { z, tiles, fx: xf - cx, fy: yf - cy };
}
/** Latest radar frame from RainViewer's weather-maps.json: {host, path, time} or null. */
export function latestRadar(maps) {
  const past = maps && maps.radar && Array.isArray(maps.radar.past) ? maps.radar.past.filter((f) => f && typeof f.path === 'string') : [];
  if (!maps || typeof maps.host !== 'string' || !/^https:\/\//.test(maps.host) || !past.length) return null;
  const f = past[past.length - 1];
  return { host: maps.host, path: f.path, time: f.time || null };
}
export const osmTile = (t, z) => `https://tile.openstreetmap.org/${z}/${t.x}/${t.y}.png`;
export const radarTile = (frame, t, z) => `${frame.host}${frame.path}/256/${z}/${t.x}/${t.y}/2/1_1.png`;

// ---------------------------------------------------------------- chores
export const CHORE_PRESETS = [
  { key: 'trash', name: 'trash', kind: 'bin', rule: { type: 'weekly', day: 4 }, holiday: true },
  { key: 'recycling', name: 'recycling', kind: 'bin', rule: { type: 'weeks', n: 2, start: null }, holiday: true },
  { key: 'filter', name: 'ac filter', kind: 'task', rule: { type: 'days', n: 30 } },
  { key: 'pest', name: 'pest control', kind: 'task', rule: { type: 'days', n: 90 } },
];

const nthWeekday = (year, month, dow, n) => { // n >= 1, or -1 for the last
  if (n > 0) {
    const first = `${year}-${String(month).padStart(2, '0')}-01`;
    return addDays(first, ((dow - dowIndex(first) + 7) % 7) + (n - 1) * 7);
  }
  const last = addDays(`${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}-01`, -1);
  return addDays(last, -((dowIndex(last) - dow + 7) % 7));
};
/** The pickup-delaying holidays in a year: New Year's Day, Memorial Day, Independence Day, Labor Day, Thanksgiving, Christmas. */
export function holidays(year) {
  return [`${year}-01-01`, nthWeekday(year, 5, 1, -1), `${year}-07-04`, nthWeekday(year, 9, 1, 1), nthWeekday(year, 11, 4, 4), `${year}-12-25`];
}
/** A holiday on or before `date` in the same Sunday–Saturday week. */
function holidayEarlierInWeek(date) {
  const sunday = addDays(date, -dowIndex(date));
  const set = new Set([...holidays(+sunday.slice(0, 4)), ...holidays(+date.slice(0, 4))]);
  for (let d = sunday; d <= date; d = addDays(d, 1)) if (set.has(d)) return true;
  return false;
}
/** Is `date` a scheduled pickup for this weekly / every-N-weeks chore (before any holiday delay)? */
function scheduled(chore, date) {
  const rule = chore.rule || {};
  if (rule.type === 'weekly') return dowIndex(date) === rule.day;
  if (rule.type === 'weeks' && rule.start && /^\d{4}-\d{2}-\d{2}$/.test(rule.start)) {
    const n = Math.max(1, rule.n || 1);
    const d = diffDays(date, rule.start);
    return d >= 0 && d % (7 * n) === 0;
  }
  return false;
}
/** Is `date` the (possibly holiday-delayed) pickup day? */
export function isPickup(chore, date) {
  if (!chore || !chore.rule || (chore.rule.type !== 'weekly' && chore.rule.type !== 'weeks')) return false;
  if (scheduled(chore, date)) return !(chore.holiday && holidayEarlierInWeek(date));
  const prev = addDays(date, -1);
  return !!chore.holiday && scheduled(chore, prev) && holidayEarlierInWeek(prev);
}
/** Days until an every-N-days chore is due (negative = overdue), from its last "done" (or its start). null if not that kind. */
export function daysUntilDue(chore, today) {
  if (!chore || !chore.rule || chore.rule.type !== 'days') return null;
  const since = chore.last || chore.start;
  if (!since) return 0;
  return Math.max(1, chore.rule.n || 1) - diffDays(today, since);
}

/**
 * Chore chips. Evening (the night before a pickup): "trash out tonight" (+ ", gusts to 28, weigh the lid" when overnight gusts
 * reach 25 mph). Morning: "ac filter due today" / "ac filter overdue, 3 days". `tonightModel` covers tonight's hours.
 */
export function choreChips({ chores, today, evening, morning = true, tonightModel = null, units = 'imperial' }) {
  const out = [];
  const list = Array.isArray(chores) ? chores.filter((c) => c && c.name) : [];
  if (evening) {
    const tomorrow = addDays(today, 1);
    let gust = null;
    if (tonightModel) {
      const g = hoursBetween(tonightModel, `${today}T18:00`, `${tomorrow}T07:00`).map((h) => h.gust).filter((v) => v != null);
      gust = g.length ? Math.max(...g) : null;
    }
    const due = list.filter((c) => isPickup(c, tomorrow));
    const bins = due.filter((c) => c.kind !== 'task');
    if (bins.length) {
      const names = bins.map((c) => c.name);
      let text = `${names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]} out tonight`;
      if (gust != null && toMph(gust, units) >= 25) text += `, gusts to ${r(gust)}, weigh the ${bins.length > 1 ? 'lids' : 'lid'}`;
      out.push({ key: 'chore:bins', label: 'bins', text });
    }
    for (const c of due.filter((x) => x.kind === 'task')) out.push({ key: `chore:${c.id || c.name}`, label: 'tomorrow', text: `${c.name} tomorrow` });
  }
  if (morning) {
    for (const c of list) {
      const due = daysUntilDue(c, today);
      if (due == null || due > 0) continue;
      out.push({ key: `chore:${c.id || c.name}`, label: 'chore', text: due === 0 ? `${c.name} due today` : `${c.name} overdue, ${-due} day${due === -1 ? '' : 's'}` });
    }
  }
  return out;
}

// ---------------------------------------------------------------- kid-friendly tips
/** Your day lines for hot or high-UV days. */
export function kidTips(model, date, units = 'imperial') {
  const d = model && dayByDate(model, date);
  if (!d) return [];
  const out = [];
  if (d.high != null && toF(d.high, units) >= 95) out.push(`playground before 9am, surfaces heat fast above ${units === 'metric' ? '32' : '90'}°`);
  if (d.uvMax != null && d.uvMax >= 8) {
    const noon = model.hours.find((h) => h.time === `${date}T12:00`);
    const uv = noon && noon.uv != null ? noon.uv : d.uvMax;
    out.push(`sunscreen by 9am, uv ${r(uv)} at noon`);
  }
  return out;
}

