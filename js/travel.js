// Trip detection from calendar events. geocode(text) is injected (cached + rate limited elsewhere).
import { haversineMiles } from './geo.js';
import { addDays, diffDays, fmtMonthDay, fmtDateRange, dowShort } from './time.js';
import { eventDates } from './calendar.js';

export const NOT_A_PLACE = /^https?:|zoom\.us|meet\.google|teams\.microsoft|webex|^online$/i;
const AWAY_MILES = 75;
const CLUSTER_MILES = 50;

const span = (ev) => {
  const dates = eventDates(ev);
  return { start: dates[0], last: dates[dates.length - 1], end: ev.allDay ? ev.end.slice(0, 10) : dates[0], n: dates.length };
};

export async function detectTrips({ events, home, today, geocode, windowDays = 14 }) {
  const lastDay = addDays(today, windowDays - 1);
  const cands = [];
  for (const ev of events || []) {
    const loc = (ev.location || '').trim();
    if (!loc || NOT_A_PLACE.test(loc)) continue;
    const sp = span(ev);
    if (sp.last < today || sp.start > lastDay) continue;
    cands.push({ ev, loc, sp });
  }
  // multi-day all-day events first, then soonest
  const byLoc = new Map();
  for (const c of cands) {
    const rank = (c.ev.allDay && c.sp.n >= 2 ? 0 : 1) * 1e6 + diffDays(c.sp.start, today) + 1000;
    const cur = byLoc.get(c.loc);
    if (cur === undefined || rank < cur) byLoc.set(c.loc, rank);
  }
  const locs = [...byLoc.entries()].sort((a, b) => a[1] - b[1]).map((x) => x[0]);
  const coords = new Map();
  for (const loc of locs) {
    let g = null;
    try { g = await geocode(loc); } catch { g = null; }
    coords.set(loc, g || null);
  }
  const away = [];
  for (const c of cands) {
    const g = coords.get(c.loc);
    if (!g || !Number.isFinite(g.lat)) continue;
    if (haversineMiles(home, g) > AWAY_MILES) away.push({ ...c, g });
  }
  away.sort((a, b) => a.sp.start.localeCompare(b.sp.start));

  // union-find clustering: nearby locations with touching/overlapping dates
  const parent = away.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < away.length; i++) {
    for (let j = i + 1; j < away.length; j++) {
      const a = away[i]; const b = away[j];
      const touch = a.sp.start <= b.sp.end && b.sp.start <= a.sp.end;
      if (touch && haversineMiles(a.g, b.g) <= CLUSTER_MILES) parent[find(j)] = find(i);
    }
  }
  const groups = new Map();
  away.forEach((x, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(x); });

  const trips = [];
  for (const members of groups.values()) {
    const lodgers = members.filter((m) => m.ev.allDay && m.sp.n >= 2);
    const place = (lodgers[0] || members.find((m) => m.g.city) || members[0]).g;
    if (lodgers.length) {
      const departDate = lodgers.reduce((m, x) => (x.sp.start < m ? x.sp.start : m), lodgers[0].sp.start);
      const returnDate = lodgers.reduce((m, x) => (x.sp.end > m ? x.sp.end : m), lodgers[0].sp.end);
      trips.push(mkTrip(place, departDate, returnDate, true));
    } else {
      const dates = new Set();
      members.forEach((m) => eventDates(m.ev).forEach((d) => { if (d >= today && d <= lastDay) dates.add(d); }));
      [...dates].sort().forEach((d) => trips.push(mkTrip(place, d, d, false)));
    }
  }
  trips.sort((a, b) => a.departDate.localeCompare(b.departDate));
  return buildResult(trips);
}

function mkTrip(place, departDate, returnDate, lodging) {
  const city = place.city || 'away';
  return { id: `${city.toLowerCase()}|${departDate}`, city, region: place.region || '', lat: place.lat, lon: place.lon, departDate, returnDate, lodging };
}

export function buildResult(trips) {
  function dayInfo(date) {
    for (const t of trips) {
      if (t.lodging) {
        if (date === t.returnDate) return { where: 'away', trip: t, flag: 'return' };
        if (date > t.departDate && date < t.returnDate) return { where: 'away', trip: t, flag: 'away' };
      } else if (date === t.departDate) return { where: 'away', trip: t, flag: 'daytrip' };
    }
    for (const t of trips) if (t.lodging && date === t.departDate) return { where: 'home', trip: t, flag: 'depart' };
    return { where: 'home', trip: null, flag: null };
  }
  return { trips, dayInfo };
}

export const EMPTY_TRAVEL = buildResult([]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A trip typed in settings, as a trip object (or null when incomplete). Same id format as detected trips. */
export function manualTrip(m) {
  if (!m || !m.city || !Number.isFinite(m.lat) || !Number.isFinite(m.lon) || !ISO_DATE.test(m.departDate || '') || !ISO_DATE.test(m.returnDate || '')) return null;
  if (m.returnDate < m.departDate) return null;
  return { ...mkTrip({ city: m.city, region: m.region || '', lat: m.lat, lon: m.lon }, m.departDate, m.returnDate, m.returnDate > m.departDate), manual: true };
}

/** Adds the manual trip to detected trips (or to none). Detected trips whose dates overlap it give way to it. Idempotent. */
export function withManualTrip(result, manual) {
  const trips = ((result && result.trips) || []).filter((t) => !t.manual);
  const mt = manualTrip(manual);
  if (!mt) return result && result.trips && result.trips.some((t) => t.manual) ? buildResult(trips) : result;
  const kept = trips.filter((t) => t.returnDate < mt.departDate || t.departDate > mt.returnDate);
  return buildResult([...kept, mt].sort((a, b) => a.departDate.localeCompare(b.departDate)));
}

/** The lowercase travel line shown under the hero's date row. */
export function travelLine(travel, today) {
  if (!travel) return null;
  const info = travel.dayInfo(today);
  const t = info.trip;
  const city = t ? t.city.toLowerCase() : '';
  if (info.where === 'away') {
    if (info.flag === 'return') return 'heading home today';
    if (info.flag === 'daytrip') return `day trip to ${city} today`;
    const n = diffDays(today, t.departDate) + 1;
    return `day ${n} in ${city} · home ${dowShort(t.returnDate)}, ${fmtMonthDay(t.returnDate)}`;
  }
  if (info.flag === 'depart') return `travel day · ${city} tonight, back ${fmtMonthDay(t.returnDate)}`;
  const next = travel.trips.filter((x) => x.departDate > today).sort((a, b) => a.departDate.localeCompare(b.departDate))[0];
  if (next && diffDays(next.departDate, today) <= 14) {
    const c = next.city.toLowerCase();
    if (next.departDate === addDays(today, 1)) return next.lodging ? `${c} trip starts tomorrow` : `day trip to ${c} tomorrow`;
    return next.lodging ? `next trip: ${c}, ${fmtDateRange(next.departDate, next.returnDate)}` : `next trip: ${c}, ${fmtMonthDay(next.departDate)} (day trip)`;
  }
  return 'no travel on your calendar for two weeks';
}

export const placeKey = (t) => `${(+t.lat).toFixed(1)},${(+t.lon).toFixed(1)}`;

/** Trips overlapping the 10-day forecast window, limited to the first n distinct places. */
export function tripsToForecast(travel, today, n = 2) {
  const last = addDays(today, 9);
  const places = [];
  const out = [];
  for (const t of travel.trips) {
    if (t.returnDate < today || t.departDate > last) continue;
    const k = placeKey(t);
    if (!places.includes(k)) {
      if (places.length >= n) continue;
      places.push(k);
    }
    out.push(t);
  }
  return out;
}
