// Theme-park days (bridge v3 `parks`, from ThemeParks.wiki) and the trip drive (`tripDrive`). Pure: no DOM, no network.
// Park times arrive as ISO timestamps with the park's own offset, so their wall clock is read straight from the string.
import { fmtClock, hourKey, addDays, meridiem, hourOf, fmtMinutes } from './time.js';
import { dayByDate, hoursBetween } from './weather.js';
import { skyWord } from './insights.js';

const str = (v, max = 120) => String(v ?? '').slice(0, max);
const isIso = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) && !Number.isNaN(Date.parse(s));
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function span(h, { needClose = true } = {}) {
  if (!h || typeof h !== 'object' || !isIso(h.open)) return null;
  if (isIso(h.close)) return { open: h.open, close: h.close };
  return needClose ? null : { open: h.open, close: null };
}

/** Bridge `parks` -> {ok, source, days:[{date, parkId, name, timezone, hours, early, shows, waits}]} | {ok:false, error, days:[]} | null. */
export function normalizeParks(x) {
  if (!x || typeof x !== 'object') return null;
  if (!x.ok) return { ok: false, error: str(x.error || 'unavailable', 80), days: [] };
  const days = (Array.isArray(x.days) ? x.days : []).filter((d) => d && ISO_DATE.test(d.date) && d.name).slice(0, 12).map((d) => ({
    date: d.date,
    parkId: str(d.parkId, 80),
    name: str(d.name, 80),
    timezone: str(d.timezone, 60),
    hours: span(d.hours),
    early: span(d.early, { needClose: false }),
    shows: (Array.isArray(d.shows) ? d.shows : []).filter((s) => s && s.name).slice(0, 6).map((s) => ({
      name: str(s.name, 80), times: (Array.isArray(s.times) ? s.times : []).filter(isIso).sort().slice(0, 8),
    })).filter((s) => s.times.length),
    waits: (Array.isArray(d.waits) ? d.waits : []).filter((w) => w && w.name && Number.isFinite(w.minutes) && w.minutes >= 0)
      .map((w) => ({ name: str(w.name, 80), minutes: Math.round(w.minutes) })).sort((a, b) => b.minutes - a.minutes).slice(0, 6),
  }));
  return { ok: true, source: str(x.source || 'themeparks.wiki', 40), days };
}

/** Bridge `tripDrive` -> {ok, minutes, miles, summary, departAt} | {ok:false, error} | null. */
export function normalizeTripDrive(x) {
  if (!x || typeof x !== 'object') return null;
  if (!x.ok) return { ok: false, error: str(x.error || 'unavailable', 80) };
  if (!Number.isFinite(x.minutes) || x.minutes <= 0) return { ok: false, error: 'bad_data' };
  return {
    ok: true,
    minutes: Math.round(x.minutes),
    miles: Number.isFinite(x.miles) ? x.miles : null,
    summary: str(x.summary, 60),
    departAt: isIso(x.departAt) ? x.departAt : '',
  };
}

/** "5h 42m drive · 372 mi via I-10 W" (km in metric). Empty when the bridge sent no drive. */
export function driveLine(td, units = 'imperial') {
  if (!td || !td.ok || !Number.isFinite(td.minutes) || td.minutes <= 0) return '';
  const parts = [`${fmtMinutes(td.minutes)} drive`];
  const via = td.summary ? `via ${td.summary}` : '';
  if (Number.isFinite(td.miles)) {
    const dist = units === 'metric' ? `${Math.round(td.miles * 1.609344)} km` : `${Math.round(td.miles)} mi`;
    parts.push(via ? `${dist} ${via}` : dist);
  } else if (via) parts.push(via);
  return parts.join(' · ');
}

/** Park days on `date` (only when the bridge answered). */
export function parkDaysFor(parks, date) {
  return parks && parks.ok ? parks.days.filter((d) => d.date === date) : [];
}

/** Short tag for the week card: "disneyland", "california adventure". */
export function parkTag(name) {
  return String(name || '').toLowerCase().replace(/[™®©]/g, '').replace(/^disney\s+/, '').replace(/\s+(theme\s+)?park$/, '').trim();
}

/** "8am", "midnight", "9:30pm": the park's own wall clock. */
export const parkClock = (iso) => fmtClock(iso.slice(0, 16));
const plain = (iso, ref) => {
  const c = parkClock(iso);
  if (c === 'noon' || c === 'midnight' || !ref) return c;
  return meridiem(hourOf(iso.slice(0, 16))) === meridiem(hourOf(ref.slice(0, 16))) ? c.replace(/(am|pm)$/, '') : c;
};

/** "open 8am–midnight · early entry 7:30" ('' when the park hasn't posted hours). */
export function hoursLine(day) {
  const parts = [];
  if (day.hours) parts.push(`open ${parkClock(day.hours.open)}–${parkClock(day.hours.close)}`);
  if (day.early && day.early.open && (!day.hours || day.early.open < day.hours.open)) parts.push(`early entry ${plain(day.early.open, day.hours && day.hours.open)}`);
  return parts.join(' · ');
}

/** Attraction names read plainly: "Star Wars: Rise of the Resistance" -> "rise of the resistance". */
export function rideName(name) {
  const s = String(name || '').replace(/[™®©]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const i = s.indexOf(': ');
  if (i > 0) {
    const rest = s.slice(i + 2).trim();
    if (rest.split(' ').length >= 3) return rest;
  }
  return s;
}

const toF = (v, units) => (v == null ? null : units === 'metric' ? (v * 9) / 5 + 32 : v);
const r = (v) => Math.round(v);

/** The forecast for the park: a model in the park's time zone that covers the date, else the fallback. */
export function modelForPark(day, models, fallback) {
  const m = (models || []).find((x) => x && x.tz && x.tz === day.timezone && dayByDate(x, day.date));
  return m || fallback || null;
}

/**
 * Everything the park-day section shows. `model` is the forecast for the park (see modelForPark); `today` is the date
 * at the park, so standby waits only show for today.
 */
export function parkView(day, { model = null, units = 'imperial', today = '' } = {}) {
  const hourWx = (iso) => {
    if (!model) return '';
    const h = model.hours.find((x) => x.time === hourKey(iso.slice(0, 16)));
    return h && h.temp != null ? `${r(h.temp)}° & ${skyWord(h.code ?? 0, h.isDay ?? 1).head}` : '';
  };
  const shows = day.shows.map((s) => ({ name: s.name.toLowerCase().replace(/[™®©]/g, ''), first: s.times[0], times: s.times }))
    .sort((a, b) => a.first.localeCompare(b.first))
    .map((s) => {
      const wx = hourWx(s.first);
      return `${s.name} ${s.times.map((t) => parkClock(t)).join(', ')}${wx ? ` · ${wx}` : ''}`;
    });
  const waits = day.date === today ? day.waits.map((w) => ({ name: rideName(w.name), minutes: w.minutes })) : [];
  // the evening chill: the coldest hour from 6pm to closing (or midnight)
  let layer = '';
  if (model) {
    const end = day.hours && day.hours.close ? hourKey(day.hours.close.slice(0, 16)) : `${addDays(day.date, 1)}T00:00`;
    const eve = hoursBetween(model, `${day.date}T18:00`, end > `${day.date}T18:00` ? end : `${addDays(day.date, 1)}T00:00`).filter((h) => h.temp != null);
    if (eve.length) {
      const cold = eve.reduce((a, b) => (b.temp < a.temp ? b : a));
      if (toF(cold.temp, units) < 60) layer = `${r(cold.temp)}° by ${fmtClock(hourOf(cold.time))}, bring the warm layer`;
    }
  }
  return { date: day.date, name: day.name, hours: hoursLine(day), shows, waits, layer };
}
