// Apps Script calendar bridge: fetch, normalize, localize, and build the "your day" view.
import { toLocal, datePart, addDays } from './time.js';

export async function fetchCalendar(url, secret, days = 14) {
  if (!url) throw { kind: 'network', status: 0, message: 'no url' };
  const full = `${url}${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(secret)}&days=${days}`;
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
  return { events: normalizeEvents(j.events), timeZone: j.timeZone || '', fetchedAt: Date.now() };
}

export function normalizeEvents(list) {
  return (Array.isArray(list) ? list : []).filter((e) => e && e.start).map((e, i) => ({
    id: String(e.id ?? `ev${i}`), title: String(e.title || '(no title)'), calendar: String(e.calendar || ''),
    allDay: !!e.allDay, start: String(e.start), end: String(e.end || e.start),
    location: String(e.location || ''), myStatus: String(e.myStatus || ''),
  }));
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
    return { ...ev, date: datePart(ls), dates: [datePart(ls)], ls, le };
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
