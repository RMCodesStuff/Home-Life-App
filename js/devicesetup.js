// Multi-device setup: pure helpers (no DOM, no storage). A "setup link" carries the portable settings
// as base64url(JSON) in the URL fragment, so it never reaches a server. The UI is in setupui.js.
import { DEFAULT_SETTINGS, normalizeSettings } from './store.js';

export const SETUP_VERSION = 1;
export const SETUP_APP = 'home-life';
export const SETUP_PREFIX = '#setup=';
export const MAX_ENCODED = 60000; // characters of base64url; real setups are 1-4 KB
export const KEY_RE = /^[A-Za-z0-9_-]{16,}$/;

export const isValidKey = (k) => typeof k === 'string' && KEY_RE.test(k);

// ---------- base64url (UTF-8 safe) ----------
export function toBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromBase64Url(s) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('not base64url');
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

// ---------- a url with the key on it ----------
/**
 * Pastes like https://script.google.com/macros/s/…/exec?key=abc… are common. Returns
 * {url, key, found}: `found` is true when a `key` parameter was present; then `url` is the bare
 * origin + path (every other parameter and the hash dropped) and `key` its trimmed value (may be invalid: check isValidKey).
 * Anything that is not a parseable http(s) url comes back unchanged with found false.
 */
export function extractKeyFromUrl(text) {
  const raw = String(text == null ? '' : text).trim();
  let u;
  try { u = new URL(raw); } catch { return { url: raw, key: null, found: false }; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { url: raw, key: null, found: false };
  if (!u.searchParams.has('key')) return { url: raw, key: null, found: false };
  return { url: u.origin + u.pathname, key: (u.searchParams.get('key') || '').trim(), found: true };
}

// ---------- portable settings ----------
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const date = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const hhmm = (v, dflt) => (typeof v === 'string' && /^\d{2}:\d{2}$/.test(v) ? v : dflt);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const ints = (v, lo, hi) => (Array.isArray(v) ? [...new Set(v.filter((n) => Number.isInteger(n) && n >= lo && n <= hi))] : []);

function cleanHome(h) {
  if (!isObj(h) || num(h.lat) == null || num(h.lon) == null) return null;
  return { name: str(h.name, 80), region: str(h.region, 80), lat: h.lat, lon: h.lon, countryCode: str(h.countryCode, 3), timezone: str(h.timezone, 60) };
}
function cleanTripManual(m) {
  if (!isObj(m) || num(m.lat) == null || num(m.lon) == null || !date(m.departDate) || !date(m.returnDate) || !str(m.city, 80)) return null;
  return { city: str(m.city, 80), region: str(m.region, 80), countryCode: str(m.countryCode, 3), lat: m.lat, lon: m.lon, departDate: m.departDate, returnDate: m.returnDate };
}
function cleanChore(c) {
  if (!isObj(c) || !str(c.id, 40) || !str(c.name, 30) || !isObj(c.rule)) return null;
  const r = c.rule;
  let rule;
  if (r.type === 'weekly') rule = { type: 'weekly', day: Number.isInteger(r.day) && r.day >= 0 && r.day <= 6 ? r.day : 4 };
  else if (r.type === 'weeks') rule = { type: 'weeks', n: Math.max(2, Math.min(8, Math.trunc(num(r.n) || 2))), start: date(r.start) };
  else if (r.type === 'days') rule = { type: 'days', n: Math.max(1, Math.min(365, Math.trunc(num(r.n) || 30))) };
  else return null;
  return { id: str(c.id, 40), name: str(c.name, 30), kind: c.kind === 'bin' ? 'bin' : 'task', rule, holiday: !!c.holiday, last: date(c.last), start: date(c.start) };
}
function cleanPhoenix(p) {
  const d = DEFAULT_SETTINGS.phoenix;
  const pw = isObj(p) && isObj(p.power) ? p.power : {};
  const wt = isObj(p) && isObj(p.watering) ? p.watering : {};
  const windows = Array.isArray(pw.windows)
    ? pw.windows.slice(0, 8).filter(isObj).map((w) => ({ days: ints(w.days, 0, 6), start: hhmm(w.start, '16:00'), end: hhmm(w.end, '19:00') })) : d.power.windows;
  return {
    power: {
      enabled: !!pw.enabled, windows, months: Array.isArray(pw.months) ? ints(pw.months, 1, 12) : d.power.months,
      mode: pw.mode === 'hot' ? 'hot' : 'months', hotAt: num(pw.hotAt) != null ? Math.max(50, Math.min(130, pw.hotAt)) : d.power.hotAt,
    },
    watering: { enabled: !!wt.enabled, days: ints(wt.days, 0, 6) },
  };
}
const COLOR_RE = /^[a-z]{2,12}$/;
function cleanCalendars(c) {
  const out = {};
  if (!isObj(c)) return out;
  for (const [name, v] of Object.entries(c).slice(0, 60)) {
    if (!isObj(v) || name.length > 200) continue;
    const e = {};
    if (typeof v.label === 'string') e.label = v.label.slice(0, 14);
    if (typeof v.color === 'string' && COLOR_RE.test(v.color)) e.color = v.color;
    if (typeof v.show === 'boolean') e.show = v.show;
    out[name] = e;
  }
  return out;
}

/** Whitelists and type-checks an incoming `settings` object (anything unknown or malformed is dropped). Never contains `ai.key`. */
export function sanitizePortable(src) {
  const s = isObj(src) ? src : {};
  const out = {};
  if ('home' in s) out.home = cleanHome(s.home);
  if (typeof s.homeLabel === 'string') out.homeLabel = s.homeLabel.slice(0, 24) || 'home';
  if (s.units === 'imperial' || s.units === 'metric') out.units = s.units;
  if (['auto', 'dark', 'light'].includes(s.theme)) out.theme = s.theme;
  if (isObj(s.calendar)) {
    const url = typeof s.calendar.url === 'string' && /^https:\/\//.test(s.calendar.url.trim()) ? extractKeyFromUrl(s.calendar.url).url.slice(0, 500) : '';
    out.calendar = { url, secret: isValidKey(s.calendar.secret) ? s.calendar.secret : '' };
  }
  if (isObj(s.show)) {
    out.show = {};
    for (const k of Object.keys(DEFAULT_SETTINGS.show)) if (typeof s.show[k] === 'boolean') out.show[k] = s.show[k];
  }
  if (isObj(s.calendars)) out.calendars = cleanCalendars(s.calendars);
  if (isObj(s.evening)) out.evening = { enabled: s.evening.enabled !== false, start: hhmm(s.evening.start, '18:00') };
  if (isObj(s.trip)) {
    const cl = Array.isArray(s.trip.checklist) ? s.trip.checklist.filter((x) => typeof x === 'string').map((x) => x.slice(0, 80)).slice(0, 20) : [];
    out.trip = { manual: cleanTripManual(s.trip.manual), checklist: cl.length ? cl : null };
  }
  if (isObj(s.phoenix)) out.phoenix = cleanPhoenix(s.phoenix);
  if (Array.isArray(s.chores)) out.chores = s.chores.slice(0, 40).map(cleanChore).filter(Boolean);
  if (isObj(s.workout)) {
    const wc = Array.isArray(s.workout.workCalendars) ? s.workout.workCalendars.filter((x) => typeof x === 'string').map((x) => x.slice(0, 200)).slice(0, 60) : null;
    out.workout = { workCalendars: wc, window: ['any', 'morning', 'midday', 'evening'].includes(s.workout.window) ? s.workout.window : 'any' };
  }
  if (isObj(s.ai) && typeof s.ai.key === 'string' && s.ai.key.trim()) {
    out.ai = { enabled: !!s.ai.enabled, key: s.ai.key.trim().slice(0, 300), model: str(s.ai.model, 60) || DEFAULT_SETTINGS.ai.model };
  }
  return out;
}

const sameJSON = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The settings that travel to another device. Caches, Firebase sign-in and AI caches live outside settings and are never included.
 * The Claude API key (and the ai switch and model with it) only when `includeClaudeKey`. Values equal to the defaults are left out
 * to keep the link short; applying fills them back in.
 */
export function pickPortable(settings, { includeClaudeKey = false } = {}) {
  const clean = sanitizePortable({ ...(settings || {}), ai: includeClaudeKey ? (settings || {}).ai : undefined });
  const out = {};
  for (const [k, v] of Object.entries(clean)) {
    if (k === 'calendar' && !v.url && !v.secret) continue;
    if (k !== 'ai' && sameJSON(v, DEFAULT_SETTINGS[k])) continue;
    out[k] = v;
  }
  return out;
}

// ---------- payload ----------
export function buildPayload(settings, { includeClaudeKey = false, now = Date.now() } = {}) {
  return { v: SETUP_VERSION, app: SETUP_APP, exportedAt: new Date(now).toISOString(), settings: pickPortable(settings, { includeClaudeKey }) };
}
export const encodePayload = (settings, opts) => toBase64Url(JSON.stringify(buildPayload(settings, opts)));

/** @returns {{ok: true, payload, settings} | {ok: false, error: string}} settings is sanitized. */
export function decodePayload(encoded) {
  const bad = (error) => ({ ok: false, error });
  if (typeof encoded !== 'string' || !encoded) return bad("that setup link is empty.");
  if (encoded.length > MAX_ENCODED) return bad('that setup link is too big to be one of mine.');
  let p;
  try { p = JSON.parse(fromBase64Url(encoded)); } catch { return bad("that setup link is damaged or cut off. copy it again."); }
  if (!isObj(p) || p.app !== SETUP_APP) return bad("that link isn't from home life.");
  if (p.v !== SETUP_VERSION) return bad('that link is from a different version of home life.');
  if (!isObj(p.settings)) return bad('that setup link has no settings in it.');
  return { ok: true, payload: p, settings: sanitizePortable(p.settings) };
}

/** `base` is location.origin + location.pathname. */
export const buildSetupLink = (base, settings, opts) => `${base}${SETUP_PREFIX}${encodePayload(settings, opts)}`;

/** null when the hash is not a setup hash; otherwise the decodePayload result. */
export function parseSetupHash(hash) {
  const h = String(hash || '');
  if (!h.startsWith(SETUP_PREFIX)) return null;
  return decodePayload(h.slice(SETUP_PREFIX.length));
}

/**
 * Applies imported settings to a device: portable settings are replaced (anything left out goes back to its default), the rest
 * of this device's settings stay. The Claude key stays unless the link carried one. If the link had no usable key, this device keeps its own.
 */
export function applySetup(current, incoming) {
  const cur = current || {};
  const inc = sanitizePortable(incoming);
  const base = { ...inc };
  if (!inc.ai) base.ai = cur.ai;
  const merged = normalizeSettings(base);
  if (!merged.calendar.secret) merged.calendar.secret = (cur.calendar && cur.calendar.secret) || '';
  return merged;
}

/** Plain-words lines for the confirm sheet (about a merged settings object). */
export function summarizeSetup(merged, { includesClaudeKey = false } = {}) {
  const m = merged;
  const lines = [];
  const h = m.home;
  lines.push(`home: ${h ? [h.name, h.region].filter(Boolean).join(', ').toLowerCase() : 'not set'}${m.homeLabel && m.homeLabel !== 'home' ? ` (called "${m.homeLabel}")` : ''}`);
  lines.push(`google: ${m.calendar.url ? 'connected (your script link and key)' : 'not connected'}`);
  const t = m.trip && m.trip.manual;
  lines.push(`trip: ${t ? `${t.city.toLowerCase()}, ${t.departDate} to ${t.returnDate}` : 'none'}`);
  const n = (m.chores || []).length;
  lines.push(`chores: ${n}`);
  const labeled = Object.values(m.calendars || {}).filter((c) => c.label || c.show === false).length;
  if (labeled) lines.push(`calendar labels and filters: ${labeled}`);
  lines.push(`units and theme: ${m.units === 'metric' ? '°C' : '°F'}, ${m.theme}`);
  lines.push(`claude api key: ${includesClaudeKey ? 'included' : 'not included'}`);
  return lines;
}
