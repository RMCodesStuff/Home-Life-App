// Open-Meteo forecast + air quality + NWS alerts: fetch and normalize.

const CURRENT = 'temperature_2m,apparent_temperature,relative_humidity_2m,dew_point_2m,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,is_day,precipitation';
const HOURLY = 'temperature_2m,apparent_temperature,relative_humidity_2m,dew_point_2m,precipitation_probability,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,uv_index,is_day';
const DAILY = 'weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_probability_max,precipitation_sum,sunrise,sunset,daylight_duration,uv_index_max,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant';

export function forecastUrl(lat, lon, units = 'imperial') {
  const imp = units === 'imperial';
  return `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
    + `&current=${CURRENT}&hourly=${HOURLY}&daily=${DAILY}`
    + `&temperature_unit=${imp ? 'fahrenheit' : 'celsius'}&wind_speed_unit=${imp ? 'mph' : 'kmh'}`
    + `&precipitation_unit=${imp ? 'inch' : 'mm'}&timezone=auto&forecast_days=10&past_days=1`;
}

async function getJson(url, opts = {}, timeoutMs = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctl.signal });
    if (!res.ok) throw Object.assign(new Error(`http ${res.status}`), { kind: 'http', status: res.status });
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

export const fetchRawForecast = (lat, lon, units) => getJson(forecastUrl(lat, lon, units));

export async function fetchAirQuality(lat, lon) {
  const j = await getJson(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=us_aqi,pm2_5&timezone=auto`);
  return j && j.current ? { us_aqi: j.current.us_aqi ?? null, pm2_5: j.current.pm2_5 ?? null } : null;
}

export async function fetchAlerts(lat, lon, countryCode) {
  if (countryCode && String(countryCode).toUpperCase() !== 'US') return [];
  try {
    const j = await getJson(`https://api.weather.gov/alerts/active?point=${(+lat).toFixed(4)},${(+lon).toFixed(4)}`,
      { headers: { Accept: 'application/geo+json' } }, 10000);
    return normalizeAlerts(j);
  } catch { return []; }
}

export function normalizeAlerts(j) {
  const feats = (j && j.features) || [];
  return feats.map((f) => f.properties || {}).filter((p) => p.event).map((p) => ({
    event: p.event, headline: p.headline || '', severity: p.severity || '', ends: p.ends || p.expires || null,
    description: (p.description || '').slice(0, 900),
  }));
}

export function aqiCategory(v) {
  if (v == null) return null;
  if (v <= 50) return 'good';
  if (v <= 100) return 'moderate';
  if (v <= 150) return 'unhealthy for sensitive groups';
  if (v <= 200) return 'unhealthy';
  if (v <= 300) return 'very unhealthy';
  return 'hazardous';
}

const col = (obj, key, i) => {
  const a = obj && obj[key];
  const v = a ? a[i] : null;
  return v === undefined ? null : v;
};

/** Raw Open-Meteo response -> normalized model (see spec 4.2). Every value may be null. */
export function normalize(raw, place = {}, units = 'imperial', extras = {}) {
  const h = raw.hourly || {};
  const d = raw.daily || {};
  const c = raw.current || {};
  const times = h.time || [];
  const hours = times.map((time, i) => ({
    time,
    temp: col(h, 'temperature_2m', i), feels: col(h, 'apparent_temperature', i),
    humidity: col(h, 'relative_humidity_2m', i), dew: col(h, 'dew_point_2m', i),
    precipProb: col(h, 'precipitation_probability', i), precip: col(h, 'precipitation', i),
    code: col(h, 'weather_code', i), cloud: col(h, 'cloud_cover', i), pressure: col(h, 'pressure_msl', i),
    wind: col(h, 'wind_speed_10m', i), windDir: col(h, 'wind_direction_10m', i), gust: col(h, 'wind_gusts_10m', i),
    uv: col(h, 'uv_index', i), isDay: col(h, 'is_day', i),
  }));
  const dts = d.time || [];
  const days = dts.map((date, i) => ({
    date,
    code: col(d, 'weather_code', i), high: col(d, 'temperature_2m_max', i), low: col(d, 'temperature_2m_min', i),
    feelsHigh: col(d, 'apparent_temperature_max', i), feelsLow: col(d, 'apparent_temperature_min', i),
    precipProbMax: col(d, 'precipitation_probability_max', i), precipSum: col(d, 'precipitation_sum', i),
    sunrise: col(d, 'sunrise', i), sunset: col(d, 'sunset', i), daylight: col(d, 'daylight_duration', i),
    uvMax: col(d, 'uv_index_max', i), windMax: col(d, 'wind_speed_10m_max', i), gustMax: col(d, 'wind_gusts_10m_max', i),
    windDir: col(d, 'wind_direction_10m_dominant', i),
  }));
  const aq = extras.aq || null;
  return {
    place: {
      name: place.name || '', region: place.region || '', lat: raw.latitude ?? place.lat, lon: raw.longitude ?? place.lon,
      countryCode: place.countryCode || '',
    },
    units,
    tz: raw.timezone || '', offset: raw.utc_offset_seconds || 0, fetchedAt: extras.fetchedAt || null,
    current: {
      time: c.time || null, temp: c.temperature_2m ?? null, feels: c.apparent_temperature ?? null,
      humidity: c.relative_humidity_2m ?? null, dew: c.dew_point_2m ?? null, code: c.weather_code ?? null,
      cloud: c.cloud_cover ?? null, pressure: c.pressure_msl ?? null, wind: c.wind_speed_10m ?? null,
      windDir: c.wind_direction_10m ?? null, gust: c.wind_gusts_10m ?? null, isDay: c.is_day ?? null,
    },
    hours, days,
    aqi: aq && aq.us_aqi != null ? { value: Math.round(aq.us_aqi), pm25: aq.pm2_5 ?? null, category: aqiCategory(aq.us_aqi) } : null,
    alerts: extras.alerts || [],
  };
}

/** Hours with from <= time < to (wall-clock strings compare lexicographically). */
export function hoursBetween(model, from, to) {
  return model.hours.filter((x) => x.time >= from && x.time < to);
}
export function dayByDate(model, date) {
  return model.days.find((x) => x.date === date) || null;
}
function nextDate(date) {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return dt.toISOString().slice(0, 10);
}
/** Overnight low: min hourly temp from date 18:00 to next day 08:00; falls back to daily lows. */
export function nightLow(model, date) {
  const next = nextDate(date);
  const vals = hoursBetween(model, `${date}T18:00`, `${next}T08:00`).map((x) => x.temp).filter((v) => v != null);
  if (vals.length >= 10) return Math.min(...vals);
  const n = dayByDate(model, next);
  if (n && n.low != null) return n.low;
  const t = dayByDate(model, date);
  return t ? t.low : null;
}
export function hourAt(model, local) {
  const key = `${local.slice(0, 13)}:00`;
  return model.hours.find((x) => x.time === key) || null;
}
