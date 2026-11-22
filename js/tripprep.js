// Trip prep: the prep window, what to pack (from the trip forecast), the before-you-go checklist, and calendar conflicts.
// Pure functions with injected dates and lookups: no DOM, no network, no Date.now().
import { addDays, diffDays, dowShort, fmtClock, fmtMinutes, addMinutes, toLocal } from './time.js';
import { dayByDate, nightLow } from './weather.js';
import { haversineMiles } from './geo.js';
import { NOT_A_PLACE } from './travel.js';
import { shortTitle } from './calendar.js';
import { bucket } from './insights.js';

export const DEFAULT_CHECKLIST = ['book the cat sitter', 'hold the mail', 'set the thermostat', 'take out the trash'];
export const PREP_DAYS = 3; // trip prep shows from 3 days before departure through the departure day
const NEAR_HOME_MILES = 40;
const CHECKOUT = '10:00'; // assumed hotel checkout on the way home, at the trip's wall clock

/** The overnight trip whose prep window holds `date`, soonest first. */
export function prepTrip(travel, date) {
  if (!travel || !date) return null;
  return travel.trips.filter((t) => t.lodging && date <= t.departDate && diffDays(t.departDate, date) <= PREP_DAYS)
    .sort((a, b) => a.departDate.localeCompare(b.departDate))[0] || null;
}

/** What to send the bridge as `trip`/`tripDate`: an overnight trip departing today, tomorrow or the day after. */
export function bridgeTrip(travel, today) {
  if (!travel || !today) return null;
  const t = travel.trips.filter((x) => x.lodging && x.departDate >= today && diffDays(x.departDate, today) <= 2 && Number.isFinite(x.lat) && Number.isFinite(x.lon))
    .sort((a, b) => a.departDate.localeCompare(b.departDate))[0];
  return t ? { id: t.id, lat: t.lat, lon: t.lon, date: t.departDate } : null;
}

/** "seattle · mar 7–11" */
export function tripSub(trip, fmtRange) {
  return `${trip.city.toLowerCase()} · ${fmtRange(trip.departDate, trip.returnDate)}`;
}

const toF = (v, units) => (v == null ? null : units === 'metric' ? (v * 9) / 5 + 32 : v);

/**
 * Packing suggestions from the trip forecast (`model` = the forecast at the trip's place) and its park days.
 * Thresholds are °F: a night under 55, a high over 80, rain 30% or more, UV 6 or more.
 */
export function packingList({ model = null, trip, parkDates = [], units = 'imperial' }) {
  const out = [];
  if (model && trip) {
    const days = [];
    const nights = [];
    for (let d = trip.departDate, n = 0; d <= trip.returnDate && n < 30; d = addDays(d, 1), n++) {
      const day = dayByDate(model, d);
      if (!day) continue;
      days.push(day);
      if (d < trip.returnDate) { const lo = nightLow(model, d); if (lo != null) nights.push(lo); }
    }
    const minLow = nights.length ? Math.min(...nights) : null;
    if (minLow != null && toF(minLow, units) < 55) {
      out.push(units === 'metric' ? `a warm layer for nights near ${Math.round(minLow)}°` : `a warm layer for nights in the ${bucket(Math.round(minLow))}`);
    }
    if (days.some((x) => x.high != null && toF(x.high, units) > 80)) out.push('shorts');
    if (days.some((x) => (x.precipProbMax ?? 0) >= 30)) out.push('a rain jacket or poncho');
    if (days.some((x) => (x.uvMax ?? 0) >= 6)) out.push('sunscreen and hats');
  }
  if (parkDates.length) out.push('comfortable walking shoes', 'a portable charger', 'a refillable water bottle');
  return out;
}

const normKey = (s) => ` ${String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\b(a|an|the|some|your)\b/g, ' ').replace(/\s+/g, ' ').trim()} `;
const lead3 = (k) => { const w = k.trim().split(' '); return w.length >= 3 ? w.slice(0, 3).join(' ') : ''; };
/**
 * On-device items first, then extra ones (e.g. the morning rundown's), lowercased, without repeats or near-repeats
 * (one contains the other, or both start with the same three words: "a warm layer for nights in the low 50s" and "…high 40s").
 */
export function mergePacking(auto, extra) {
  const out = [];
  const keys = [];
  for (const item of [...(auto || []), ...(Array.isArray(extra) ? extra : [])]) {
    if (typeof item !== 'string') continue;
    const s = item.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 90);
    const k = normKey(s);
    if (!k.trim() || keys.some((x) => x.includes(k) || k.includes(x) || (lead3(x) && lead3(x) === lead3(k)))) continue;
    keys.push(k);
    out.push(s);
  }
  return out.slice(0, 12);
}

/** Settings text (one item per line) -> checklist items; empty -> null (use the defaults). */
export function parseChecklist(text) {
  const items = [];
  for (const line of String(text || '').split('\n')) {
    const s = line.replace(/^[-*•\s]+/, '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 80);
    if (s && !items.includes(s)) items.push(s);
  }
  return items.length ? items.slice(0, 20) : null;
}
export const checklistItems = (saved) => (Array.isArray(saved) && saved.length ? saved : DEFAULT_CHECKLIST);

/** localStorage key for one trip's ticks. */
export const checksKey = (tripId) => `hl.trip.${tripId}`;
/** Ticks are kept by item text: {"pack:shorts": true, "todo:hold the mail": true}. */
export function setCheck(state, key, on) {
  const next = { ...(state && typeof state === 'object' ? state : {}) };
  if (on) next[key] = true; else delete next[key];
  return next;
}

/**
 * Timed events near home (within 40 miles) on days you're away, on the way-home day before you could be back,
 * or on the departure day after you planned to leave.
 *   coordsFor(location) -> {lat, lon, city}|null (cache-only geocodes)
 *   homeOffset / tripOffset(trip): UTC offsets (seconds) for wall clocks at home and at the trip
 *   tripDrive: the bridge's drive for the trip in `driveTripId` (otherwise estimated at about a minute per straight-line mile)
 *   now: the home wall clock; events that already started are left out
 */
export function findConflicts({ events, travel, home, coordsFor, today, now = '', days = 14, homeName = '', homeOffset = 0, tripOffset = () => null, tripDrive = null, driveTripId = '' }) {
  if (!travel || !travel.trips || !travel.trips.length || !home || !today) return [];
  const last = addDays(today, days - 1);
  const out = [];
  for (const ev of events || []) {
    if (ev.allDay || !ev.start || !ev.date || ev.date < today || ev.date > last) continue;
    const loc = String(ev.location || '').trim();
    if (!loc || NOT_A_PLACE.test(loc)) continue;
    const info = travel.dayInfo(ev.date);
    const t = info.trip;
    if (!t || !t.lodging || !['away', 'return', 'depart'].includes(info.flag)) continue;
    const g = coordsFor(loc);
    if (!g || !Number.isFinite(g.lat) || !Number.isFinite(g.lon) || haversineMiles(home, g) > NEAR_HOME_MILES) continue;
    const at = toLocal(ev.start, homeOffset); // the event's own wall clock (it's near home)
    if (!at || (now && at < now)) continue; // `now` is the home wall clock: past events are moot
    const city = t.city.toLowerCase();
    const drive = tripDrive && tripDrive.ok && driveTripId === t.id ? { min: tripDrive.minutes, est: false } : { min: Math.max(15, Math.round(haversineMiles(home, t) / 15) * 15), est: true };
    const driveText = `${drive.est ? 'about ' : ''}${fmtMinutes(drive.min)} drive`;
    let why = '';
    if (info.flag === 'away') why = `you're in ${city} that day`;
    else if (info.flag === 'return') {
      const tOff = tripOffset(t);
      const checkoutHome = addMinutes(`${ev.date}T${CHECKOUT}`, tOff == null ? 0 : (homeOffset - tOff) / 60);
      if (at < addMinutes(checkoutHome, drive.min)) why = `you check out in ${city} that morning (${driveText})`;
    } else {
      const dep = tripDrive && tripDrive.ok && driveTripId === t.id && tripDrive.departAt ? toLocal(tripDrive.departAt, homeOffset) : `${ev.date}T08:00`;
      if (dep && dep.slice(0, 10) === ev.date && at > dep) why = `you leave for ${city} at ${fmtClock(dep)}`;
    }
    if (!why) continue;
    const place = String(g.city || homeName || 'home').toLowerCase();
    out.push({ id: ev.id, date: ev.date, tripId: t.id, at, text: `${shortTitle(ev.title, 4)} ${dowShort(ev.date)} ${fmtClock(at)} is in ${place}, but ${why}` });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}
