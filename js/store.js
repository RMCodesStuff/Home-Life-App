// localStorage helpers. Everything is wrapped: storage can be blocked, full, or absent.

export const KEYS = { settings: 'hl.settings', cal: 'hl.cal', ai: 'hl.ai' };

export function getRaw(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function setRaw(key, value) {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}
export function remove(key) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}
/** Returns undefined when the key is missing or unreadable (so a stored `null` is distinguishable). */
export function getJSON(key) {
  const raw = getRaw(key);
  if (raw == null) return undefined;
  try { return JSON.parse(raw); } catch { return undefined; }
}
export function setJSON(key, value) {
  return setRaw(key, JSON.stringify(value));
}

export const DEFAULT_SETTINGS = {
  home: null, // {name, region, lat, lon, countryCode, timezone}
  homeLabel: 'home',
  units: 'imperial',
  theme: 'auto',
  calendar: { url: '', secret: '' },
  // app-side switches for the extras
  show: {
    inbox: true, leaveBy: true, oura: true, tripPrep: true, parks: true,
    rundown: true, birthdays: true, speak: true, dinner: true, workout: true, kidTips: true, radar: true, dust: true,
  },
  calendars: {}, // per calendar name: {label?, color?, show?} (see calendars.js)
  evening: { enabled: true, start: '18:00' }, // after `start`, the hero shows tomorrow's edition
  // manual: a trip typed in settings ({city, region, lat, lon, departDate, returnDate}); works without the Google bridge.
  // checklist: the "before you go" list in trip prep (empty = the defaults in tripprep.js).
  trip: { manual: null, checklist: null },
  // phoenix home pack (both off by default): power peak windows, watering days
  phoenix: {
    power: { enabled: false, windows: [{ days: [1, 2, 3, 4, 5], start: '16:00', end: '19:00' }], months: [5, 6, 7, 8, 9, 10], mode: 'months', hotAt: 90 },
    watering: { enabled: false, days: [] },
  },
  chores: [], // [{id, name, kind: 'bin'|'task', rule: {type:'weekly', day} | {type:'weeks', n, start} | {type:'days', n}, holiday, last, start}]
  workout: { workCalendars: null, window: 'any' }, // workCalendars null = auto (names with "work", company emails)
  ai: { enabled: false, key: '', model: 'claude-opus-5-5' },
};

export function makeSecret() {
  const bytes = new Uint8Array(24);
  (globalThis.crypto || {}).getRandomValues?.(bytes);
  if (!bytes.some(Boolean)) for (let i = 0; i < 24; i++) bytes[i] = Math.floor(Math.random() * 256);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function loadSettings() {
  const saved = getJSON(KEYS.settings) || {};
  const s = {
    ...DEFAULT_SETTINGS,
    ...saved,
    calendar: { ...DEFAULT_SETTINGS.calendar, ...(saved.calendar || {}) },
    show: { ...DEFAULT_SETTINGS.show, ...(saved.show || {}) },
    ai: { ...DEFAULT_SETTINGS.ai, ...(saved.ai || {}) },
    evening: { ...DEFAULT_SETTINGS.evening, ...(saved.evening || {}) },
    trip: { ...DEFAULT_SETTINGS.trip, ...(saved.trip || {}) },
    calendars: saved.calendars && typeof saved.calendars === 'object' ? saved.calendars : {},
    phoenix: {
      power: { ...DEFAULT_SETTINGS.phoenix.power, ...((saved.phoenix && saved.phoenix.power) || {}) },
      watering: { ...DEFAULT_SETTINGS.phoenix.watering, ...((saved.phoenix && saved.phoenix.watering) || {}) },
    },
    chores: Array.isArray(saved.chores) ? saved.chores : [],
    workout: { ...DEFAULT_SETTINGS.workout, ...(saved.workout || {}) },
  };
  if (!s.calendar.secret) {
    s.calendar.secret = makeSecret();
    saveSettings(s);
  }
  return s;
}
/** Deep copy (settings are plain JSON). */
export const cloneSettings = (s) => JSON.parse(JSON.stringify(s));
export function saveSettings(s) {
  return setJSON(KEYS.settings, s);
}

export const wxKey = (lat, lon, units) => `hl.wx.${(+lat).toFixed(3)},${(+lon).toFixed(3)},${units}`;
export const aqKey = (lat, lon) => `hl.aq.${(+lat).toFixed(3)},${(+lon).toFixed(3)}`;
export const alKey = (lat, lon) => `hl.al.${(+lat).toFixed(3)},${(+lon).toFixed(3)}`;

/** Drop old forecast caches so localStorage never fills up. */
export function pruneCaches(keep) {
  try {
    const drop = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (/^hl\.(wx|aq|al)\./.test(k) && !keep.includes(k)) drop.push(k);
    }
    drop.forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
}
