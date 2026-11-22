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
    ai: { ...DEFAULT_SETTINGS.ai, ...(saved.ai || {}) },
  };
  if (!s.calendar.secret) {
    s.calendar.secret = makeSecret();
    saveSettings(s);
  }
  return s;
}
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
