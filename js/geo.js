// Geocoding: city search (Open-Meteo), addresses & reverse (Nominatim, rate limited + cached forever).
import { getJSON, setJSON } from './store.js';

export const US_STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan',
  MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia',
  WI: 'Wisconsin', WY: 'Wyoming',
};

export function haversineMiles(a, b) {
  const R = 3958.8;
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

async function getJson(url, headers) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await fetch(url, { headers, signal: ctl.signal });
    if (!res.ok) throw Object.assign(new Error(`http ${res.status}`), { kind: 'http', status: res.status });
    return await res.json();
  } finally { clearTimeout(t); }
}

/** "Springfield, IL" -> search "Springfield", rank results matching "IL"/"Illinois" first. */
export async function searchCities(query) {
  const q = (query || '').trim();
  if (q.length < 2) return [];
  const [namePart, ...rest] = q.split(',');
  const remainder = rest.join(',').trim().toLowerCase();
  const j = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(namePart.trim())}&count=8&language=en&format=json`);
  let results = ((j && j.results) || []).map((r) => ({
    name: r.name, region: r.admin1 || '', country: r.country || '', countryCode: r.country_code || '',
    lat: r.latitude, lon: r.longitude, timezone: r.timezone || '',
  }));
  if (remainder) {
    const abbr = US_STATES[remainder.toUpperCase()];
    const want = [remainder, abbr && abbr.toLowerCase()].filter(Boolean);
    const score = (r) => {
      const hay = [r.region, r.country, r.countryCode].map((x) => x.toLowerCase());
      return want.some((w) => hay.some((h) => h === w || h.startsWith(w))) ? 0 : 1;
    };
    results = results.map((r, i) => ({ r, i, s: score(r) })).sort((a, b) => a.s - b.s || a.i - b.i).map((x) => x.r);
  }
  return results;
}

export const placeLabel = (p) => [p.name, p.region && p.countryCode === 'US' ? p.region : p.region || p.country].filter(Boolean).join(', ');

// ---- Nominatim: serialized queue, >=1100ms spacing ----
let chain = Promise.resolve();
let lastAt = 0;
export function nominatimQueue(task) {
  const run = chain.then(async () => {
    const wait = lastAt + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try { return await task(); } finally { lastAt = Date.now(); }
  });
  chain = run.catch(() => {});
  return run;
}

const pickCity = (a = {}) => a.city || a.town || a.village || a.hamlet || a.municipality || a.county || '';
const norm = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();
const geoKey = (s) => `hl.geo.${norm(s)}`;

async function nominatimSearch(text) {
  const arr = await nominatimQueue(() => getJson(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(text)}&format=jsonv2&limit=1&addressdetails=1`));
  const r = Array.isArray(arr) ? arr[0] : null;
  if (!r) return null;
  const a = r.address || {};
  return { lat: parseFloat(r.lat), lon: parseFloat(r.lon), city: pickCity(a), region: a.state || '', countryCode: (a.country_code || '').toUpperCase() };
}

/**
 * Returns geocode(text) -> Promise<{lat,lon,city,region}|null|undefined>.
 * Caches every result forever (misses as null). At most `maxUncached` network lookups per geocoder;
 * beyond that it returns undefined without caching. Make a new geocoder per refresh.
 */
export function makeGeocoder({ maxUncached = 12 } = {}) {
  let used = 0;
  async function lookup(text) {
    const key = geoKey(text);
    const hit = getJSON(key);
    if (hit !== undefined) return hit;
    if (used >= maxUncached) return undefined;
    used += 1;
    try {
      const r = await nominatimSearch(text);
      setJSON(key, r);
      return r;
    } catch { return undefined; }
  }
  return async function geocode(text) {
    const t = String(text || '').trim();
    if (!t) return null;
    let r = await lookup(t);
    if (r === null && t.includes(',')) {
      const rest = t.split(',').slice(1).join(',').trim();
      if (rest) r = await lookup(rest);
    }
    return r;
  };
}

export async function reverseGeocode(lat, lon) {
  try {
    const j = await nominatimQueue(() => getJson(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=jsonv2&zoom=10`));
    const a = (j && j.address) || {};
    return { city: pickCity(a), region: a.state || '', countryCode: (a.country_code || '').toUpperCase() };
  } catch { return null; }
}

export function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(Object.assign(new Error('unsupported'), { code: 'unsupported' }));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      (e) => reject(Object.assign(new Error(e.message), { code: e.code === 1 ? 'denied' : 'failed' })),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 },
    );
  });
}
