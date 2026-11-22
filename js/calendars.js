// Whose event: per-calendar labels, tag colors and a "show in this app" filter (settings.calendars, keyed by calendar name).
// Pure. Auto rule: your own calendar (the one with the most events) has no tag; others get their name, lowercased.

export const TAG_COLORS = ['sage', 'sky', 'plum', 'gold', 'clay']; // clay last: it's closest to the accent
const PERSONAL_DOMAINS = /^(gmail|googlemail|icloud|me|mac|outlook|hotmail|live|msn|yahoo|ymail|aol|proton|protonmail|pm|fastmail|hey)\./i;

/** "sam" from "sam.doe@example.com", "family" from "Family", "holidays" from "Holidays in United States". */
export function autoLabel(name) {
  const s = String(name || '').trim().toLowerCase();
  const base = s.includes('@') ? s.split('@')[0].split(/[._+-]/)[0] : s.split(/\s+/)[0];
  return base.replace(/[^\p{L}\p{N}'-]/gu, '').slice(0, 14);
}

/** Calendar names seen in the events, busiest first: [{name, count}]. */
export function calendarNames(events) {
  const counts = new Map();
  for (const e of events || []) {
    const n = String(e.calendar || '');
    if (n) counts.set(n, (counts.get(n) || 0) + 1);
  }
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * Every calendar with what the app will do with it: [{name, count, own, label, color, show, autoLabel, autoColor}].
 * cfg[name] = {label?: string ('' = no tag), color?: one of TAG_COLORS | '', show?: boolean}
 */
export function calendarList(events, cfg = {}) {
  const names = calendarNames(events);
  const own = names.length ? names[0].name : '';
  let k = 0;
  return names.map(({ name, count }) => {
    const c = (cfg && cfg[name]) || {};
    const isOwn = name === own;
    const auto = isOwn ? '' : autoLabel(name);
    const autoColor = isOwn ? '' : TAG_COLORS[k++ % TAG_COLORS.length];
    const label = typeof c.label === 'string' ? c.label.trim().toLowerCase().slice(0, 14) : auto;
    const color = typeof c.color === 'string' && (c.color === '' || TAG_COLORS.includes(c.color)) ? c.color : autoColor;
    return { name, count, own: isOwn, label, color: label ? color || TAG_COLORS[0] : '', show: c.show !== false, autoLabel: auto, autoColor };
  });
}

/** Map name -> {label, color} for tagged calendars only. */
export function tagMap(list) {
  const m = new Map();
  for (const c of list || []) if (c.label) m.set(c.name, { label: c.label, color: c.color || TAG_COLORS[0] });
  return m;
}

/** Events from calendars switched on in settings (everything when nothing is configured). */
export function filterEvents(events, cfg = {}) {
  if (!cfg || !Object.keys(cfg).length) return events || [];
  return (events || []).filter((e) => !(cfg[e.calendar] && cfg[e.calendar].show === false));
}

/**
 * Does this calendar count as work (for the workout's workday call)? `chosen` (settings) wins when set;
 * otherwise a name containing "work", or a company email (not a personal mail domain).
 */
export function isWorkCalendar(name, chosen = null) {
  if (Array.isArray(chosen) && chosen.length) return chosen.includes(name);
  const s = String(name || '').toLowerCase();
  if (/\bwork\b|\bwork[a-z]*@|office/.test(s)) return true;
  const at = s.indexOf('@');
  return at > 0 && !PERSONAL_DOMAINS.test(s.slice(at + 1)) && !/group\.calendar\.google\.com|holiday|calendar\.google\.com/.test(s);
}
