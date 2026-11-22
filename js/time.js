// Location-local time helpers. Every forecast is wall-clock time at its own location;
// nothing here ever reads the browser's time zone.

const DOW = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const p2 = (n) => String(n).padStart(2, '0');

function fromUtcDate(d) {
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}T${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}

/** Current wall-clock "YYYY-MM-DDTHH:mm" at a place with the given UTC offset (seconds). */
export function localNow(offsetSeconds = 0, nowMs = Date.now()) {
  return fromUtcDate(new Date(nowMs + offsetSeconds * 1000));
}

/** Convert an absolute ISO timestamp (with offset or Z) to wall-clock at the given offset. */
export function toLocal(iso, offsetSeconds = 0) {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return fromUtcDate(new Date(ms + offsetSeconds * 1000));
}

export const datePart = (local) => (local || '').slice(0, 10);
export const hourOf = (local) => parseInt(local.slice(11, 13), 10);
export const minuteOf = (local) => parseInt(local.slice(14, 16), 10) || 0;
export const minutesOfDay = (local) => hourOf(local) * 60 + minuteOf(local);
export const hourKey = (local) => `${local.slice(0, 13)}:00`;

const utc = (date) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
export function addDays(date, n) {
  const d = utc(date);
  d.setUTCDate(d.getUTCDate() + n);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
}
export function diffDays(a, b) {
  return Math.round((utc(a) - utc(b)) / 86400000);
}
/** local "YYYY-MM-DDTHH:mm" plus n hours (pure string math). */
export function addHours(local, n) {
  const [y, mo, d] = local.slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d, hourOf(local), minuteOf(local)));
  dt.setUTCHours(dt.getUTCHours() + n);
  return fromUtcDate(dt);
}
/** local "YYYY-MM-DDTHH:mm" plus n minutes (pure string math, n may be negative). */
export function addMinutes(local, n) {
  const [y, mo, d] = local.slice(0, 10).split('-').map(Number);
  return fromUtcDate(new Date(Date.UTC(y, mo - 1, d, hourOf(local), minuteOf(local)) + Math.round(n) * 60000));
}
export const dowIndex = (date) => utc(date).getUTCDay();
export const dowLong = (date) => DOW[dowIndex(date)];
export const dowShort = (date) => DOW[dowIndex(date)].slice(0, 3);
export const monthShort = (date) => MON[parseInt(date.slice(5, 7), 10) - 1];
export const dayNum = (date) => parseInt(date.slice(8, 10), 10);

/** "7a" / "12p" for chart labels. */
export function fmtHourShort(h) {
  const hh = ((h % 24) + 24) % 24;
  const x = hh % 12 === 0 ? 12 : hh % 12;
  return `${x}${hh < 12 ? 'a' : 'p'}`;
}
/** "9am", "4:35pm", "noon", "midnight" from an hour number or a local/time string. */
export function fmtClock(input, { noonWord = true } = {}) {
  let h;
  let m = 0;
  if (typeof input === 'number') {
    h = Math.floor(input);
    m = Math.round((input - h) * 60);
  } else {
    const t = input.includes('T') ? input.slice(11) : input;
    h = parseInt(t.slice(0, 2), 10);
    m = parseInt(t.slice(3, 5), 10) || 0;
  }
  if (m === 60) { h += 1; m = 0; }
  h = ((h % 24) + 24) % 24;
  if (noonWord && m === 0 && h === 12) return 'noon';
  if (noonWord && m === 0 && h === 0) return 'midnight';
  const x = h % 12 === 0 ? 12 : h % 12;
  return `${x}${m ? ':' + p2(m) : ''}${h < 12 ? 'am' : 'pm'}`;
}
/** Plain 12-hour number for prose ("by 9", "around 3"); noon/midnight words. */
export function fmtHourPlain(h) {
  const hh = ((h % 24) + 24) % 24;
  if (hh === 12) return 'noon';
  if (hh === 0) return 'midnight';
  return String(hh % 12);
}
export const meridiem = (h) => (((h % 24) + 24) % 24 < 12 ? 'am' : 'pm');

export const fmtDateLong = (date) => `${dowLong(date)}, ${monthShort(date)} ${dayNum(date)}`;
export const fmtMonthDay = (date) => `${monthShort(date)} ${dayNum(date)}`;
export function fmtDateRange(a, b) {
  if (a === b) return fmtMonthDay(a);
  if (monthShort(a) === monthShort(b)) return `${monthShort(a)} ${dayNum(a)}–${dayNum(b)}`;
  return `${fmtMonthDay(a)}–${fmtMonthDay(b)}`;
}
/** "10h 25m" from seconds. */
export function fmtDuration(sec) {
  if (sec == null || Number.isNaN(sec)) return '—';
  const total = Math.round(sec / 60);
  return `${Math.floor(total / 60)}h ${total % 60}m`;
}
/** Deterministic small hash of a string. */
export function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Minutes from wall-clock string `a` to `b` ("YYYY-MM-DDTHH:mm"). Both are read as UTC, so DST never skews it. */
export function diffMinutes(a, b) {
  const ms = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), hourOf(s), minuteOf(s));
  return Math.round((ms(b) - ms(a)) / 60000);
}
/** "just now", "12m ago", "3h ago", "2d ago" for an ISO timestamp, given the current epoch ms. */
export function relTime(iso, nowMs) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const min = Math.floor((nowMs - t) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  if (min < 48 * 60) return min < 24 * 60 ? `${Math.floor(min / 60)}h ago` : '1d ago';
  return `${Math.floor(min / 1440)}d ago`;
}
/** "40 min" or "1h 5m" for a duration in minutes. */
export function fmtMinutes(min) {
  const m = Math.round(Math.abs(min));
  if (m < 60) return `${m} min`;
  return m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 60)}h`;
}
