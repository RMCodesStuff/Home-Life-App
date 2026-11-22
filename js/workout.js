// Workout of the day, from the rack session timer's summary (contract v1: localStorage 'rst.homelife' and Firestore
// users/{uid}.homelife). Pure: pick the summary, propose today's (or tomorrow's) session and a window that fits the calendar.
import { addDays, dowIndex, hourKey, fmtClock, addMinutes, diffMinutes } from './time.js';
import { isWorkCalendar } from './calendars.js';
import { LINKS } from './connections.js';

const VERSIONS = ['full', 'workday', 'evening', 'circuit', 'kb'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v, n = 80) => (typeof v === 'string' ? v.slice(0, n) : '');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Guarded copy of a summary (any field may be missing in older timers); null when it isn't one. */
export function normalizeSummary(s) {
  if (!s || typeof s !== 'object' || s.app !== 'rack-session-timer') return null;
  const next = {};
  for (const v of VERSIONS) {
    const n = s.next && s.next[v];
    if (!n || typeof n !== 'object' || !str(n.day, 8)) continue;
    next[v] = {
      day: str(n.day, 8), label: str(n.label, 40) || `Day ${str(n.day, 8)}`, title: str(n.title, 80), min: num(n.min),
      lift: n.lift && typeof n.lift === 'object' && str(n.lift.name) ? { key: str(n.lift.key, 20), name: str(n.lift.name), lb: num(n.lift.lb) } : null,
      kit: str(n.kit, 120),
    };
  }
  const rec = (x) => (x && typeof x === 'object' && ISO_DATE.test(x.date || '') ? {
    date: x.date, version: str(x.version, 12), day: str(x.day, 8), label: str(x.label, 40), status: str(x.status, 16), durationSec: num(x.durationSec) || 0,
  } : null);
  return {
    v: num(s.v) || 1,
    updatedAt: typeof s.updatedAt === 'string' && !Number.isNaN(Date.parse(s.updatedAt)) ? s.updatedAt : '',
    date: ISO_DATE.test(s.date || '') ? s.date : '',
    url: /^https:\/\//.test(s.url || '') ? s.url : '',
    week: s.week && num(s.week.n) && num(s.week.of) ? { n: s.week.n, of: s.week.of } : null,
    next,
    last: rec(s.last),
    recent: (Array.isArray(s.recent) ? s.recent : []).map(rec).filter(Boolean).slice(0, 14),
    inProgress: s.inProgress && typeof s.inProgress === 'object' && str(s.inProgress.day, 8)
      ? { version: str(s.inProgress.version, 12), day: str(s.inProgress.day, 8), label: str(s.inProgress.label, 40), done: num(s.inProgress.done) || 0, total: num(s.inProgress.total) || 0 } : null,
    moveUp: (Array.isArray(s.moveUp) ? s.moveUp : []).filter((x) => typeof x === 'string').slice(0, 4),
  };
}

/** The newer of the device copy and the cloud copy (by updatedAt). */
export function pickSummary(local, remote) {
  const a = normalizeSummary(local); const b = normalizeSummary(remote);
  if (!a || !b) return a || b;
  return Date.parse(b.updatedAt || 0) > Date.parse(a.updatedAt || 0) ? b : a;
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const VNAME = { full: 'full', workday: 'workday', evening: 'evening', circuit: 'circuit', kb: 'kettlebell' };
const GENERIC_MIN = { full: 25, workday: 18, evening: 15, circuit: 20, kb: 20 };
const toF = (v, units) => (v == null ? null : units === 'metric' ? (v * 9) / 5 + 32 : v);

/** Free gaps between timed events from 5:00 to 21:00 on `date` (event ends to the next leave-by or start). */
export function freeGaps(events, date) {
  const busy = (events || []).filter((e) => !e.allDay && e.date === date && e.ls && e.le)
    .map((e) => ({ s: e.travel && e.travel.leaveBy && e.travel.leaveBy < e.ls ? e.travel.leaveBy : e.ls, e: e.le > e.ls ? e.le : e.ls }))
    .sort((a, b) => a.s.localeCompare(b.s));
  const gaps = [];
  let cur = `${date}T05:00`;
  const end = `${date}T21:00`;
  for (const b of busy) {
    if (b.s > cur) gaps.push({ start: cur, end: b.s < end ? b.s : end });
    if (b.e > cur) cur = b.e;
    if (cur >= end) break;
  }
  if (cur < end) gaps.push({ start: cur, end });
  return gaps.filter((g) => g.end > g.start);
}

/**
 * Today's (or tomorrow's) workout.
 *   summary: normalized (or raw) timer summary | null; oura: bridge oura | null; events: filtered, localized
 *   hours: forecast hours for the day (garage temperature); now: local wall clock; today: the date being planned
 *   away: not home that day; parkDay: a theme-park day; settings: {workCalendars, window: morning|midday|evening|any}
 * -> {state: resume|done|rest|propose, version, day, label, title, min, lift, week, window: {start, end, temp}|null, why: [..], link}
 */
export function proposeWorkout({ summary, oura = null, events = [], hours = [], now = '', today, away = false, parkDay = false, settings = {}, units = 'imperial' }) {
  const s = summary && summary.app ? normalizeSummary(summary) : summary;
  const base = (s && s.url) || LINKS.rackTimer;
  const linkFor = (v, d) => `${base}?ver=${v}${d ? `&day=${encodeURIComponent(d)}` : ''}&from=homelife`;
  const readiness = oura && oura.ok && oura.readiness && oura.readiness.score != null ? Math.round(oura.readiness.score) : null;
  const out = (o) => ({ version: null, day: null, label: '', title: '', min: null, lift: null, week: s && s.week, window: null, why: [], link: base, ...o });

  if (s && s.date === today && s.inProgress && s.inProgress.total > s.inProgress.done) {
    const ip = s.inProgress;
    const left = ip.total - ip.done;
    return out({ state: 'resume', version: ip.version, day: ip.day, label: ip.label, why: [`finish ${(ip.label || `day ${ip.day}`).toLowerCase()}: ${left} set${left === 1 ? '' : 's'} left`], link: base });
  }
  const doneToday = s && [s.last, ...s.recent].find((x) => x && x.date === today && x.status === 'done');
  if (doneToday) {
    const min = Math.round(doneToday.durationSec / 60);
    return out({ state: 'done', version: doneToday.version, day: doneToday.day, label: doneToday.label, why: [`done: ${VNAME[doneToday.version] || doneToday.version} · ${(doneToday.label || `day ${doneToday.day}`).toLowerCase()}${min ? `, ${min} min` : ''}`] });
  }
  if (parkDay) return out({ state: 'rest', why: ['rest: a park day is 8+ miles of walking'] });

  const next = (s && s.next) || {};
  const why = [];
  let version;
  if (away) {
    if (s && next.circuit) {
      const c = next.circuit;
      return out({ state: 'propose', version: 'circuit', day: c.day, label: c.label, title: c.title, min: c.min, why: [`${c.min || 20}-min circuit in the hotel room`], link: linkFor('circuit', c.day) });
    }
    return out({ state: 'rest', why: ['away from the garage: a long walk counts today'] });
  }
  const trainedStreak = s && [1, 2, 3].every((i) => s.recent.some((x) => x.date === addDays(today, -i) && x.status !== 'in-progress'));
  const weekday = dowIndex(today) >= 1 && dowIndex(today) <= 5;
  const workEvent = weekday && (events || []).some((e) => e.date === today && !e.allDay && isWorkCalendar(e.calendar, settings.workCalendars));
  if (readiness != null && readiness < 65) { version = 'evening'; why.push(`readiness ${readiness}, keep it light`); }
  else if (trainedStreak) { version = 'workday'; why.push('three days running, keep it short'); }
  else if (workEvent) { version = 'workday'; why.push('a workday, the short version'); }
  else version = 'full';
  if (s) {
    const order = [version, 'full', 'workday', 'evening', 'circuit', 'kb'];
    version = order.find((v) => next[v]) || version;
  }
  const n = s ? next[version] : null;
  const min = n && n.min ? n.min : GENERIC_MIN[version];
  if (version === 'full' && readiness != null && readiness >= 85) why.push(s && s.moveUp.length ? `primed: ready to move up on ${s.moveUp.map((x) => x.toLowerCase()).join(', ')}` : 'primed: add 5 lb if last time was clean');

  const win = bestWindow({ events, hours, date: today, now, need: min + 10, pref: settings.window || 'any', units });
  if (win && win.note) why.push(win.note);
  return out({
    state: 'propose', version, day: n ? n.day : null, label: n ? n.label : cap(VNAME[version]), title: n ? n.title : '', min, lift: n ? n.lift : null,
    window: win ? { start: win.start, end: win.end, temp: win.temp } : null, why, link: n ? linkFor(version, n.day) : linkFor(version, null),
  });
}

/** The window to train: a free gap that fits `need` minutes, by preference, steering around garage heat. */
export function bestWindow({ events, hours, date, now = '', need, pref = 'any', units = 'imperial' }) {
  const tempAt = (t) => { const h = (hours || []).find((x) => x.time === hourKey(t)); return h && h.temp != null ? h.temp : null; };
  const after = now && now.slice(0, 10) === date ? now : '';
  const cands = freeGaps(events, date).map((g) => {
    const from = after && g.start < after ? after : g.start; // never in the past
    if (diffMinutes(from, g.end) < need) return null;
    // the gap before the first event starts at 5am: start at 6 when that still fits
    const six = `${date}T06:00`;
    const start = from < six && diffMinutes(six, g.end) >= need ? six : from;
    const end = diffMinutes(start, g.end) > 90 ? addMinutes(start, 90) : g.end;
    const h = +start.slice(11, 13);
    const part = h < 11 ? 'morning' : h < 15 ? 'midday' : 'evening';
    return { start, end, part, first: g.start === `${date}T05:00`, temp: tempAt(start) };
  }).filter(Boolean);
  if (!cands.length) return null;
  const rank = (c) => (pref !== 'any' ? (c.part === pref ? 0 : 1) : c.first ? 0 : c.part === 'midday' ? 1 : c.part === 'evening' ? 2 : 3);
  const sorted = [...cands].sort((a, b) => rank(a) - rank(b) || a.start.localeCompare(b.start));
  let pick = sorted[0];
  let note = '';
  if (pick.temp != null && toF(pick.temp, units) >= 90) {
    const cool = [...cands].sort((a, b) => a.start.localeCompare(b.start)).find((c) => c.temp != null && toF(c.temp, units) < 85);
    if (cool) { pick = cool; note = `garage ${Math.round(cool.temp)}° at ${fmtClock(cool.start).replace(/(am|pm)$/, '')}`; }
  }
  if (pick.temp != null && toF(pick.temp, units) <= 40) note = 'cold garage, take the long warm-up';
  return { start: pick.start, end: pick.end, temp: pick.temp, note };
}

/** "6:15" for mornings ("6am" on the hour), "5:30pm" otherwise. */
export const trainClock = (t) => { const c = fmtClock(t); return +t.slice(11, 13) < 12 && t.slice(14, 16) !== '00' ? c.replace(/am$/, '') : c; };
/** Hero chip: "train 6:15 · full b, 24 min" ('' unless there's a proposal with a window). */
export function trainChip(p) {
  if (!p || p.state !== 'propose' || !p.window) return '';
  const what = `${VNAME[p.version] || p.version}${p.day ? ` ${p.day.toLowerCase()}` : ''}`;
  return `${trainClock(p.window.start)} · ${what}${p.min ? `, ${p.min} min` : ''}`;
}
/** "Full · Day B" */
export const workoutTitle = (p) => (p && p.version ? `${cap(VNAME[p.version] || p.version)}${p.label && p.label.toLowerCase() !== (VNAME[p.version] || '') ? ` · ${p.label}` : ''}` : '');
/** "romanian deadlift 135 lb · ~24 min · week 3 of 6" */
export function workoutDetail(p) {
  if (!p || p.state !== 'propose') return '';
  return [p.lift ? `${p.lift.name.toLowerCase()}${p.lift.lb ? ` ${p.lift.lb} lb` : ''}` : '', p.min ? `~${p.min} min` : '', p.week ? `week ${p.week.n} of ${p.week.of}` : ''].filter(Boolean).join(' · ');
}
/** "best window 6:15–7:45 · garage 48°" */
export function windowLine(p) {
  if (!p || !p.window) return '';
  const w = p.window;
  return `best window ${trainClock(w.start).replace(/(am|pm)$/, '')}–${fmtClock(w.end).replace(/(am|pm)$/, '')}${w.temp != null ? ` · garage ${Math.round(w.temp)}°` : ''}`;
}
