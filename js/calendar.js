// Apps Script calendar bridge: fetch, normalize, localize, and build the "your day" view.
import { toLocal, datePart, addDays } from './time.js';

/**
 * `from` ({lat, lon}) is today's primary location; the v2 bridge uses it for leave-by drive times.
 * A v1 bridge ignores it (and answers without `version`).
 */
export async function fetchCalendar(url, secret, days = 14, { from = null } = {}) {
  if (!url) throw { kind: 'network', status: 0, message: 'no url' };
  const fromQ = from && Number.isFinite(from.lat) && Number.isFinite(from.lon) ? `&from=${from.lat.toFixed(4)},${from.lon.toFixed(4)}` : '';
  const full = `${url}${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(secret)}&days=${days}${fromQ}`;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 25000);
  let res;
  try {
    res = await fetch(full, { signal: ctl.signal });
  } catch {
    throw { kind: 'network', status: 0, message: 'network' };
  } finally { clearTimeout(t); }
  if (res.status === 401 || res.status === 403) throw { kind: 'http', status: res.status, message: `http ${res.status}` };
  if (!res.ok) throw { kind: 'http', status: res.status, message: `http ${res.status}` };
  let j;
  try { j = await res.json(); } catch { throw { kind: 'bad-json', status: res.status, message: 'bad json' }; }
  if (!j || typeof j !== 'object') throw { kind: 'bad-json', status: res.status, message: 'bad json' };
  if (j.ok === false) throw { kind: j.error === 'unauthorized' ? 'unauthorized' : 'bad-json', status: res.status, message: j.error || 'error' };
  return { events: normalizeEvents(j.events), timeZone: j.timeZone || '', fetchedAt: Date.now(), ...normalizeBridge(j) };
}

const str = (v, max = 200) => String(v ?? '').slice(0, max);
const numOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The v2 extras. A response without `version` is a v1 bridge: no inbox, no oura, no leave-by. */
export function normalizeBridge(j) {
  const version = Number(j && j.version) >= 2 ? Number(j.version) : 1;
  if (version < 2) return { version: 1, features: { gmail: false, leaveBy: false, oura: false }, inbox: null, oura: null };
  const f = (j.features && typeof j.features === 'object') ? j.features : {};
  return {
    version,
    features: { gmail: !!f.gmail, leaveBy: !!f.leaveBy, oura: !!f.oura },
    inbox: normalizeInbox(j.inbox),
    oura: normalizeOura(j.oura),
  };
}

export function normalizeInbox(x) {
  if (!x || typeof x !== 'object') return null;
  if (!x.ok) return { ok: false, error: str(x.error || 'unavailable', 120), waiting: [], packages: [] };
  return {
    ok: true,
    waiting: (Array.isArray(x.waiting) ? x.waiting : []).filter((w) => w && w.id).slice(0, 5).map((w) => ({
      id: str(w.id, 80), from: str(w.from, 60), subject: str(w.subject, 120), snippet: str(w.snippet, 120),
      date: str(w.date, 40), reason: str(w.reason, 40), url: safeUrl(w.url),
    })),
    packages: (Array.isArray(x.packages) ? x.packages : []).filter((p) => p && p.id).slice(0, 4).map((p) => ({
      id: str(p.id, 80), merchant: str(p.merchant, 40), status: str(p.status, 30), subject: str(p.subject, 120), date: str(p.date, 40), url: safeUrl(p.url),
    })),
  };
}
/** Only ever link out to Gmail. Anything else becomes a plain row. */
const safeUrl = (u) => (/^https:\/\/mail\.google\.com\//.test(String(u || '')) ? String(u) : '');

export function normalizeOura(x) {
  if (!x || typeof x !== 'object') return null;
  if (!x.ok) return { ok: false, error: str(x.error || 'unavailable', 80), message: x.message ? str(x.message, 120) : '' };
  const rd = x.readiness && typeof x.readiness === 'object' ? { score: numOrNull(x.readiness.score), temperatureDeviation: numOrNull(x.readiness.temperatureDeviation) } : null;
  const sl = x.sleep && typeof x.sleep === 'object' ? Object.fromEntries(['score', 'totalSec', 'deepSec', 'remSec', 'efficiency', 'avgHrv', 'lowestHr'].map((k) => [k, numOrNull(x.sleep[k])])) : null;
  const wk = x.week && typeof x.week === 'object' ? { readinessAvg: numOrNull(x.week.readinessAvg), sleepScoreAvg: numOrNull(x.week.sleepScoreAvg), totalSecAvg: numOrNull(x.week.totalSecAvg) } : { readinessAvg: null, sleepScoreAvg: null, totalSecAvg: null };
  return { ok: true, day: str(x.day, 10), readiness: rd, sleep: sl && { ...sl, bedtimeStart: str(x.sleep.bedtimeStart, 40), bedtimeEnd: str(x.sleep.bedtimeEnd, 40) }, week: wk };
}

export function normalizeEvents(list) {
  return (Array.isArray(list) ? list : []).filter((e) => e && e.start).map((e, i) => ({
    id: String(e.id ?? `ev${i}`), title: String(e.title || '(no title)'), calendar: String(e.calendar || ''),
    allDay: !!e.allDay, start: String(e.start), end: String(e.end || e.start),
    location: String(e.location || ''), myStatus: String(e.myStatus || ''),
    ...(normalizeTravel(e.travel) ? { travel: normalizeTravel(e.travel) } : {}),
  }));
}
function normalizeTravel(t) {
  if (!t || typeof t !== 'object' || !Number.isFinite(t.minutes) || t.minutes < 0 || !t.leaveBy || Number.isNaN(Date.parse(t.leaveBy))) return null;
  return { minutes: Math.round(t.minutes), miles: Number.isFinite(t.miles) ? t.miles : null, leaveBy: String(t.leaveBy) };
}

/** Plain-language explanation of a typed calendar error. */
export function describeCalendarError(err) {
  if (!err) return 'something went wrong';
  switch (err.kind) {
    case 'unauthorized': return "the calendar link answered, but the key didn't match. copy the script again from settings and redeploy.";
    case 'http':
      if (err.status === 401 || err.status === 403) return `the calendar link answered ${err.status}. redeploy the web app with "who has access" set to anyone.`;
      if (err.status === 404) return 'the calendar link answered 404. check that you pasted the full web app url (it ends in /exec).';
      return `the calendar link answered ${err.status}. check the url and redeploy.`;
    case 'bad-json': return "the calendar link didn't return calendar data. check that you pasted the web app url (ends in /exec).";
    case 'network': return "couldn't reach the calendar link. check your connection and the url.";
    default: return 'something went wrong reaching your calendar.';
  }
}

/** Date list an event touches (all-day: start..end-1; timed: its start date). Uses the event's own date strings. */
export function eventDates(ev) {
  const s = ev.start.slice(0, 10);
  if (!ev.allDay) return [s];
  const e = ev.end.slice(0, 10);
  const out = [];
  for (let d = s, n = 0; d < e && n < 60; d = addDays(d, 1), n++) out.push(d);
  return out.length ? out : [s];
}

/**
 * Add wall-clock fields for a place: `date`, `ls`, `le` (YYYY-MM-DDTHH:mm), `dates` for all-day.
 * offsetFor(date) returns the UTC offset (seconds) of the location you're at on that date.
 */
export function localizeEvents(events, offsetFor) {
  return events.map((ev) => {
    if (ev.allDay) {
      const dates = eventDates(ev);
      return { ...ev, date: dates[0], dates, ls: `${dates[0]}T00:00`, le: `${ev.end.slice(0, 10)}T00:00` };
    }
    const off = offsetFor(ev.start.slice(0, 10));
    const ls = toLocal(ev.start, off) || `${ev.start.slice(0, 10)}T00:00`;
    const le = toLocal(ev.end, off) || ls;
    const out = { ...ev, date: datePart(ls), dates: [datePart(ls)], ls, le };
    if (ev.travel) out.travel = { ...ev.travel, leaveBy: toLocal(ev.travel.leaveBy, off) }; // same wall clock as ls/le
    return out;
  });
}

/** Shorten a title for use in prose ("the 9am gym"). */
export function shortTitle(title, words = 3) {
  const t = String(title).toLowerCase().replace(/[\p{Extended_Pictographic}]/gu, '').replace(/\s+/g, ' ').trim();
  return t.split(' ').slice(0, words).join(' ');
}

/** What the "your day" card shows. `events` must already be localized. */
export function yourDay(events, now) {
  const today = datePart(now);
  const tomorrowD = addDays(today, 1);
  const chips = events.filter((e) => e.allDay && e.dates.includes(today));
  const timedToday = events.filter((e) => !e.allDay && e.date === today).sort((a, b) => a.ls.localeCompare(b.ls));
  const upcoming = timedToday.filter((e) => e.le > now || (e.le === e.ls && e.ls >= now));
  const earlier = timedToday.length - upcoming.length;
  let tomorrow = [];
  if (upcoming.length < 2) tomorrow = events.filter((e) => !e.allDay && e.date === tomorrowD).sort((a, b) => a.ls.localeCompare(b.ls));
  const next = upcoming.find((e) => e.ls >= now) || upcoming[0] || null;
  return { chips, upcoming, earlier, tomorrow, next };
}
