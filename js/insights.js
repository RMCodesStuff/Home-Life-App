// The built-in writer. Pure, deterministic functions: no DOM, no network, no Date.now().
// Everything takes an explicit `ctx`:
//   { now: 'YYYY-MM-DDTHH:mm' (wall clock at the primary location), units, model (primary), homeModel,
//     tripModels: {tripId: model}, travel: {trips, dayInfo}|null, events: localized events }
// Temperatures are shown in the user's units; thresholds are evaluated in °F / mph internally.
import { addDays, datePart, hourOf, hourKey, addHours, dowShort, fmtClock, fmtHourPlain, meridiem, fmtDuration, fmtMinutes, diffMinutes, hashStr } from './time.js';
import { dayByDate, hoursBetween, nightLow, hourAt } from './weather.js';
import { EMPTY_TRAVEL } from './travel.js';
import { shortTitle } from './calendar.js';

// ---------- units ----------
const toF = (v, units) => (v == null ? null : units === 'metric' ? (v * 9) / 5 + 32 : v);
const toMph = (v, units) => (v == null ? null : units === 'metric' ? v / 1.609344 : v);
const dF = (d, units) => (units === 'metric' ? (d * 5) / 9 : d); // convert a °F *difference* for display
const r = (v) => Math.round(v);
const speedUnit = (units) => (units === 'metric' ? 'km/h' : 'mph');

// ---------- words ----------
const SKY = {
  0: ['clear', 'sunny', 'clear'], 1: ['mostly clear', 'mostly sunny', 'clear'], 2: ['partly cloudy', 'partly cloudy', 'partly'],
  3: ['overcast', 'overcast', 'overcast'], 45: ['foggy', 'foggy', 'fog'], 48: ['foggy', 'foggy', 'fog'],
  51: ['drizzly', 'drizzly', 'rain'], 53: ['drizzly', 'drizzly', 'rain'], 55: ['drizzly', 'drizzly', 'rain'],
  56: ['freezing drizzle', 'freezing drizzle', 'rain'], 57: ['freezing drizzle', 'freezing drizzle', 'rain'],
  61: ['light rain', 'light rain', 'rain'], 63: ['rainy', 'rainy', 'rain'], 65: ['heavy rain', 'heavy rain', 'rain'],
  66: ['freezing rain', 'freezing rain', 'rain'], 67: ['freezing rain', 'freezing rain', 'rain'],
  71: ['light snow', 'light snow', 'snow'], 73: ['snowy', 'snowy', 'snow'], 75: ['heavy snow', 'heavy snow', 'snow'],
  77: ['snow grains', 'snow grains', 'snow'], 80: ['passing showers', 'passing showers', 'rain'], 81: ['showers', 'showers', 'rain'],
  82: ['downpours', 'downpours', 'rain'], 85: ['snow showers', 'snow showers', 'snow'], 86: ['snow showers', 'snow showers', 'snow'],
  95: ['thunderstorms', 'thunderstorms', 'storm'], 96: ['storms with hail', 'storms with hail', 'storm'], 99: ['storms with hail', 'storms with hail', 'storm'],
};
/** {word, head, cat}: `word` for prose ("clear"), `head` for headlines/notes ("sunny" by day). */
export function skyWord(code, isDay = 1) {
  const e = SKY[code] || ['cloudy', 'cloudy', 'overcast'];
  const night = isDay === 0;
  const head = night && code === 1 ? 'mostly clear' : night && code === 0 ? 'clear' : e[1];
  return { word: e[0], head, cat: e[2] };
}

export function tempWord(feelsF) {
  if (feelsF <= 32) return 'frigid';
  if (feelsF <= 44) return 'cold';
  if (feelsF <= 54) return 'crisp';
  if (feelsF <= 64) return 'cool';
  if (feelsF <= 79) return 'mild';
  if (feelsF <= 94) return 'warm';
  return 'hot';
}
export function windWord(mph, feelsF) {
  if (mph < 5) return 'still';
  if (mph <= 12) return tempWord(feelsF);
  if (mph <= 20) return 'breezy';
  return 'windy';
}
const DIRS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
const DIR_ABBR = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const dirWord = (deg) => (deg == null ? '' : DIRS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]);
export const dirAbbr = (deg) => (deg == null ? '' : DIR_ABBR[Math.round((((deg % 360) + 360) % 360) / 45) % 8]);

const WEAR = [
  [20, 'your heaviest coat', 'coat'], [32, 'a winter coat', 'coat'], [44, 'a warm jacket', 'coat'], [54, 'a jacket', 'jacket'],
  [62, 'a sweater', 'sweater'], [70, 'a light layer', 'light layer'], [84, 'a t-shirt', 't-shirt'], [94, 'shorts & a t-shirt', 'shorts'],
  [Infinity, 'the lightest thing you own', 'light clothes'],
];
const wearFor = (feelsF) => WEAR.find((w) => feelsF <= w[0]);

// ---------- model plumbing ----------
export function modelForDate(ctx, date) {
  const info = (ctx.travel || EMPTY_TRAVEL).dayInfo(date);
  if (info.where === 'away' && info.trip) {
    const m = ctx.tripModels && ctx.tripModels[info.trip.id];
    if (m && dayByDate(m, date)) return m;
  }
  return ctx.homeModel || ctx.model;
}
const tripModelFor = (ctx, trip, date) => {
  const m = ctx.tripModels && ctx.tripModels[trip.id];
  return m && dayByDate(m, date) ? m : null;
};
const infoFor = (ctx, date) => (ctx.travel || EMPTY_TRAVEL).dayInfo(date);
const numsOf = (arr, key) => arr.map((h) => h[key]).filter((v) => v != null);
const maxOf = (a) => (a.length ? Math.max(...a) : null);
const minOf = (a) => (a.length ? Math.min(...a) : null);
const hr = (time) => hourOf(time);
const lc = (s) => String(s || '').toLowerCase();

function sunTimes(model, date) {
  const d = dayByDate(model, date);
  return { sr: d && d.sunrise, ss: d && d.sunset, day: d };
}

// ---------- condition / headline ----------
export function condition(ctx) {
  const c = ctx.model.current;
  const sky = skyWord(c.code ?? 0, c.isDay ?? 1).word;
  const feels = toF(c.feels ?? c.temp ?? 60, ctx.units);
  return `${sky} & ${windWord(toMph(c.wind ?? 0, ctx.units), feels)}`;
}

const ACCENT = {
  clear: ['a clean blue day', 'not a cloud to speak of', 'blue sky all the way'],
  partly: ['sun with a few clouds for company', 'mostly bright, a little texture'],
  overcast: ['a soft gray one', 'low light all day'],
  fog: ['slow to clear'],
  rain: ['bring the umbrella', 'a wet one'],
  snow: ['snow on the way'],
  storm: ['watch the sky'],
};
export function headline(ctx) {
  const today = datePart(ctx.now);
  const m = ctx.model;
  const d = dayByDate(m, today);
  const high = d && d.high != null ? d.high : m.current.temp;
  const code = d && d.code != null ? d.code : m.current.code ?? 0;
  const sky = skyWord(code, 1);
  const hf = toF(high, ctx.units);
  const lead = `${r(high)}° & ${sky.head},`;
  let accent;
  if (hf >= 100) accent = 'a scorcher, stay in the shade';
  else if (hf <= 35) accent = 'bundle up';
  else {
    const y = dayByDate(m, addDays(today, -1));
    const ycat = y && y.code != null ? skyWord(y.code, 1).cat : null;
    if (sky.cat === 'clear' && (ycat === 'clear' || ycat === 'partly')) accent = 'another clean blue day';
    else {
      const list = ACCENT[sky.cat] || ACCENT.overcast;
      accent = list[hashStr(today) % list.length];
    }
  }
  return { lead, accent };
}

// ---------- day windows ----------
/** The part of "today" the prose talks about. */
function remaining(ctx) {
  const today = datePart(ctx.now);
  const { sr, ss } = sunTimes(ctx.model, today);
  const nowH = hourKey(ctx.now);
  const sunset = ss || `${today}T18:00`;
  const sunrise = sr || `${today}T06:00`;
  if (ctx.now >= sunset) {
    const hours = hoursBetween(ctx.model, nowH, addHours(nowH, 10));
    return { mode: 'night', hours, today, sunset, sunrise };
  }
  const start = nowH > hourKey(sunrise) ? nowH : hourKey(sunrise);
  return { mode: 'day', hours: hoursBetween(ctx.model, start, sunset), today, sunset, sunrise };
}
const plainClock = (time) => fmtClock(time).replace(/(am|pm)$/, '');

function rainClause(ctx, rem) {
  const probs = rem.hours.map((h) => h.precipProb ?? 0);
  if (!probs.length) return '';
  const max = Math.max(...probs);
  const label = rem.mode === 'night' ? 'overnight' : 'all day';
  const cat = skyWord(dayByDate(ctx.model, rem.today)?.code ?? 0, 1).cat;
  if (max <= 10) {
    const dry = rem.mode === 'day' && (cat === 'clear' || cat === 'partly') ? `${skyWord(dayByDate(ctx.model, rem.today).code, 1).head} all day` : `dry ${label}`;
    return `${dry}, ${max === 0 ? '0% rain every hour' : `${max}% rain at most`}`;
  }
  const peak = rem.hours[probs.indexOf(max)];
  let s = `rain chances peak at ${max}% around ${fmtClock(hr(peak.time))}`;
  // longest stretch >= 40%
  let best = null; let cur = null;
  rem.hours.forEach((h, i) => {
    if ((h.precipProb ?? 0) >= 40) { cur = cur ? { ...cur, b: i } : { a: i, b: i }; if (!best || cur.b - cur.a > best.b - best.a) best = cur; } else cur = null;
  });
  if (best) {
    const a = hr(rem.hours[best.a].time); const b = hr(rem.hours[best.b].time) + 1;
    s += best.a === best.b ? `, wettest around ${fmtClock(a)}` : `, wettest ${meridiem(a) === meridiem(b) ? fmtHourPlain(a) : fmtClock(a)} to ${fmtClock(b)}`;
  }
  return s;
}

function windClause(ctx, rem) {
  const hs = rem.hours.filter((h) => h.wind != null);
  if (!hs.length) return '';
  const lo = r(minOf(numsOf(hs, 'wind'))); const hi = r(maxOf(numsOf(hs, 'wind')));
  const gust = maxOf(numsOf(hs, 'gust'));
  const dir = dirWord(ctx.model.current.windDir ?? hs[0].windDir);
  const u = speedUnit(ctx.units);
  const hiMph = toMph(hi, ctx.units);
  const range = lo === hi ? `about ${hi}` : `${lo} to ${hi}`;
  if (hiMph < 3) return 'winds stay calm';
  if (hiMph >= 13) return `breezy, ${dir} ${range} ${u}${gust != null && toMph(gust, ctx.units) >= 20 ? `, gusts to ${r(gust)}` : ''}`;
  return `light ${dir} wind ${range} ${u}`;
}

function trajectoryClause(ctx, rem) {
  const m = ctx.model;
  const nowH = hourKey(ctx.now);
  const today = rem.today;
  const cur = m.current.temp ?? hourAt(m, ctx.now)?.temp;
  if (cur == null) return '';
  if (rem.mode === 'night') return '';
  const dayHours = hoursBetween(m, `${today}T06:00`, rem.sunset).filter((h) => h.temp != null);
  const ahead = dayHours.filter((h) => h.time >= nowH);
  if (!dayHours.length) return '';
  const peakAll = dayHours.reduce((a, b) => (b.temp > a.temp ? b : a));
  const peakAhead = ahead.length ? ahead.reduce((a, b) => (b.temp > a.temp ? b : a)) : null;
  const nowHr = hr(nowH);
  if (peakAhead && hr(peakAhead.time) > nowHr && toF(peakAhead.temp, ctx.units) - toF(cur, ctx.units) >= 2) {
    const within5 = maxOf(numsOf(hoursBetween(m, nowH, addHours(nowH, 6)), 'temp'));
    const fast = within5 != null && toF(within5, ctx.units) - toF(cur, ctx.units) >= 15 ? ' fast' : '';
    const pk = hr(peakAhead.time);
    const cps = [9, 12, 15, 18].filter((h) => h > nowHr && h < pk - 0).slice(0, 2).map((h) => {
      const e = hourAt(m, `${today}T${String(h).padStart(2, '0')}:00`);
      return e && e.temp != null ? `${r(e.temp)} by ${fmtHourPlain(h)}` : null;
    }).filter(Boolean);
    return `warms${fast}: ${[...cps, `peak ${r(peakAhead.temp)} around ${fmtHourPlain(pk)}`].join(', ')}`;
  }
  if (nowHr > hr(peakAll.time) + 0) {
    const targetHr = Math.min(nowHr + 3, hr(rem.sunset));
    const e = hourAt(m, `${today}T${String(targetHr).padStart(2, '0')}:00`);
    if (e && e.temp != null && toF(cur, ctx.units) - toF(e.temp, ctx.units) >= 2 && targetHr > nowHr) return `cooling now, ${r(e.temp)} by ${fmtHourPlain(targetHr)}`;
    return `holding near ${r(cur)}`;
  }
  return `topping out near ${r(Math.max(cur, peakAll.temp))}`;
}

function nightWord(lowF) {
  return lowF >= 65 ? 'warm' : lowF >= 50 ? 'mild' : lowF >= 35 ? 'cool' : 'cold';
}

function bucket(v) {
  const dec = Math.floor(v / 10) * 10; const rem = v - dec;
  return `${rem <= 3 ? 'low' : rem <= 6 ? 'mid' : 'high'} ${dec}s`;
}

function rainPart(hours) {
  const first = hours.find((h) => (h.precipProb ?? 0) >= 30);
  if (!first) return 'afternoon';
  const h = hr(first.time);
  return h < 5 ? 'overnight' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}

const FLY = /\b(fly|flight|flying|airport)\b/i;
function tripPhrase(ctx, dep, lead) {
  const city = lc(dep.trip.city);
  const when = dep.i === 1 ? 'tomorrow' : dowShort(dep.date);
  const firstAway = addDays(dep.date, 1);
  const tm = tripModelFor(ctx, dep.trip, firstAway) || tripModelFor(ctx, dep.trip, dep.date);
  const td = tm && (dayByDate(tm, firstAway) || dayByDate(tm, dep.date));
  const there = td && td.high != null ? `, ${bucket(r(td.high))} & ${skyWord(td.code ?? 0, 1).head} there` : '';
  const fly = (ctx.events || []).find((e) => !e.allDay && e.date === dep.date && FLY.test(`${e.title} ${e.location || ''}`));
  if (fly) {
    const h = hr(fly.ls);
    return `${lead ? 'then ' : ''}you fly to ${city} ${when} ${h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'}${there}`;
  }
  return `${lead ? 'then ' : ''}${city} from ${when}${there}`;
}

function outlook(ctx) {
  const today = datePart(ctx.now);
  const hi = (date) => { const d = dayByDate(modelForDate(ctx, date), date); return d ? d.high : null; };
  let dep = null;
  for (let i = 1; i <= 6 && !dep; i++) {
    const date = addDays(today, i);
    const info = infoFor(ctx, date);
    if (info.flag === 'depart' && info.trip) dep = { i, date, trip: info.trip };
  }
  const awayNow = infoFor(ctx, today).where === 'away';
  let ret = null;
  for (let i = 1; i <= 6 && awayNow && !ret; i++) if (infoFor(ctx, addDays(today, i)).flag === 'return') ret = i;
  const parts = [];
  const nHighs = Math.min(2, dep ? dep.i - 1 : 2, ret ? ret - 1 : 2);
  for (let i = 1; i <= nHighs; i++) {
    const date = addDays(today, i); const h = hi(date);
    if (h != null) parts.push(`${r(h)} ${dowShort(date)}`);
  }
  let notable = null;
  for (let i = 1; i <= (dep ? dep.i - 1 : 6) && !notable; i++) {
    const date = addDays(today, i);
    const dow = i === 1 ? 'tomorrow' : dowShort(date);
    const info = infoFor(ctx, date);
    if (awayNow && info.flag === 'return') {
      const hd = dayByDate(ctx.homeModel || ctx.model, date);
      notable = `then home ${dow}${hd && hd.high != null ? `, ${r(hd.high)} & ${skyWord(hd.code ?? 0, 1).head} there` : ''}`;
      break;
    }
    const m = modelForDate(ctx, date);
    const d = dayByDate(m, date);
    if (!d) continue;
    if ((d.precipProbMax ?? 0) >= 30) {
      const what = skyWord(d.code ?? 61, 1).cat === 'snow' ? 'snow' : 'rain';
      const part = rainPart(hoursBetween(m, `${date}T06:00`, `${addDays(date, 1)}T06:00`));
      notable = (d.precipProbMax ?? 0) >= 60 ? `then ${what} ${dow} ${part}` : `then ${what} chances creep in ${dow} ${part}`;
      if (dep && dep.i === i + 1) notable += `, the day before you head to ${lc(dep.trip.city)}`;
      break;
    }
    const prev = hi(addDays(date, -1));
    if (prev != null && d.high != null) {
      const diff = toF(d.high, ctx.units) - toF(prev, ctx.units);
      if (diff <= -10) notable = `then a cool-down ${dow}`;
      else if (diff >= 10) notable = `then a warm-up ${dow}`;
    }
  }
  if (!notable && dep) notable = tripPhrase(ctx, dep, parts.length > 0);
  if (!notable) notable = `then nothing dramatic through ${dowShort(addDays(today, 6))}`;
  return `*${[...parts, notable].join(', ')}.*`;
}

export function narrative(ctx) {
  const m = ctx.model;
  const c = m.current;
  const rem = remaining(ctx);
  const nowHr = hr(ctx.now);
  const sky = skyWord(c.code ?? 0, c.isDay ?? 1).word;
  const out = [];
  if (c.temp != null) {
    let s = `about ${r(c.temp)} & ${sky} at ${nowHr >= 5 && nowHr < 18 ? fmtHourPlain(nowHr) : fmtClock(nowHr)}`;
    if (c.feels != null && Math.abs(dF(toF(c.feels, ctx.units) - toF(c.temp, ctx.units), ctx.units)) > 2.01 && Math.abs(c.feels - c.temp) > (ctx.units === 'metric' ? 1 : 2)) s += `, feels ${r(c.feels)}`;
    out.push(`${s}.`);
  }
  const rw = [rainClause(ctx, rem), windClause(ctx, rem)].filter(Boolean);
  if (rw.length) out.push(`${rw.join(', ')}.`);
  const tail = [];
  const traj = trajectoryClause(ctx, rem);
  if (traj) tail.push(traj);
  const today = rem.today;
  const nl = nightLow(m, today);
  const nlF = nl != null ? toF(nl, ctx.units) : null;
  if (rem.mode === 'day') {
    tail.push(`sundown about ${plainClock(rem.sunset)}`);
    if (nl != null) tail.push(`then a ${nightWord(nlF)} night near ${r(nl)}`);
  } else if (nl != null) {
    const tomorrow = dayByDate(m, addDays(today, 1));
    tail.push(`a ${nightWord(nlF)} night near ${r(nl)}${tomorrow && tomorrow.sunrise ? `, sunrise about ${plainClock(tomorrow.sunrise)}` : ''}`);
  }
  if (tail.length) out.push(`${tail.join(', ')}.`);
  out.push(outlook(ctx));
  return out.join(' ');
}

// ---------- chips ----------
export function umbrella(ctx) {
  const m = ctx.model;
  const today = datePart(ctx.now);
  const end = ctx.now >= `${today}T22:00` ? addHours(hourKey(ctx.now), 8) : `${today}T23:00`;
  const hs = hoursBetween(m, hourKey(ctx.now), end);
  const probs = hs.map((h) => h.precipProb ?? 0);
  if (!probs.length) return 'no, nothing in the forecast';
  const p = Math.max(...probs);
  const at = hs[probs.indexOf(p)];
  if (p <= 10) return `no, ${p}% all day`;
  if (p <= 39) return `probably not, ${p}% around ${fmtClock(hr(at.time))}`;
  if (p <= 69) return `yes, ${p}% around ${fmtClock(hr(at.time))}`;
  const from = hs.find((h) => (h.precipProb ?? 0) >= 70);
  return `yes, ${p}% from ${fmtClock(hr(from.time))}`;
}

export function wear(ctx) {
  const m = ctx.model;
  const today = datePart(ctx.now);
  const { sunset } = remaining(ctx);
  const feelsAt = (h) => {
    const e = hourAt(m, `${today}T${String(h).padStart(2, '0')}:00`);
    const v = e && (e.feels ?? e.temp);
    return v == null ? null : toF(v, ctx.units);
  };
  const nowHr = hr(ctx.now);
  const nowF = toF(m.current.feels ?? m.current.temp ?? 60, ctx.units);
  const day = hoursBetween(m, hourKey(ctx.now), sunset).filter((h) => (h.feels ?? h.temp) != null);
  if (nowHr >= 12 || !day.length) {
    const eveHr = Math.min(22, Math.max(nowHr + 1, hr(sunset)));
    const eve = feelsAt(eveHr) ?? nowF;
    const a = wearFor(nowF); const b = wearFor(eve);
    if (a === b || !day.length) return `${a[1]} for the rest of the day`;
    return `${a[1]} this afternoon, ${b[1]} tonight`;
  }
  const timed = (ctx.events || []).filter((e) => !e.allDay && e.date === today && hr(e.ls) < 12 && e.le > ctx.now).sort((x, y) => x.ls.localeCompare(y.ls))[0];
  const peak = day.reduce((a, b) => ((b.feels ?? b.temp) > (a.feels ?? a.temp) ? b : a));
  const peakHr = hr(peak.time);
  const morningHr = timed ? hr(timed.ls) : Math.max(8, nowHr);
  const mF = feelsAt(morningHr) ?? nowF;
  const aF = toF(peak.feels ?? peak.temp, ctx.units);
  const mi = wearFor(mF); const ai = wearFor(aF);
  if (mi === ai) return `${mi[1]} all day`;
  const anchor = timed ? `for the ${fmtClock(timed.ls)} ${shortTitle(timed.title)}` : 'this morning';
  return `${mi[1]} ${anchor}, ${ai[1]} by ${fmtHourPlain(peakHr)}`;
}

function windowFor(model, units, date, fromKey) {
  const { sr, ss } = sunTimes(model, date);
  const start = fromKey > `${date}T${sr ? sr.slice(11) : '07:00'}` ? fromKey : hourKey(sr || `${date}T07:00`);
  const hs = hoursBetween(model, start, ss || `${date}T17:00`).filter((h) => h.temp != null);
  const score = (h) => {
    const f = toF(h.feels ?? h.temp, units); const w = toMph(h.wind ?? 0, units); const uv = h.uv ?? 0;
    return -Math.abs(f - 70) - 0.4 * (h.precipProb ?? 0) - 1.5 * Math.max(0, w - 12) - (uv > 7 ? 2 * (uv - 7) : 0);
  };
  let best = null;
  for (let i = 0; i < hs.length; i++) {
    for (let len = 2; len <= 4 && i + len <= hs.length; len++) {
      const blk = hs.slice(i, i + len);
      if (blk.some((h) => (h.precipProb ?? 0) >= 40)) break;
      if (blk.some((h, k) => k && hs[i + k].time !== addHours(blk[k - 1].time, 1))) break;
      const mean = blk.reduce((s, h) => s + score(h), 0) / len;
      if (!best || mean > best.mean + 1e-9) best = { mean, blk };
    }
  }
  return best;
}
export function bestWindow(ctx) {
  const today = datePart(ctx.now);
  let prefix = '';
  let best = windowFor(ctx.model, ctx.units, today, hourKey(ctx.now));
  if (!best) {
    const tm = addDays(today, 1);
    best = windowFor(modelForDate(ctx, tm), ctx.units, tm, `${tm}T00:00`);
    prefix = 'tomorrow ';
  }
  if (!best) return 'no clean window today';
  const a = hr(best.blk[0].time); const b = hr(best.blk[best.blk.length - 1].time) + 1;
  const temps = best.blk.map((h) => r(h.temp));
  const lo = Math.min(...temps); const hi = Math.max(...temps);
  const start = meridiem(a) === meridiem(b) ? String(a % 12 || 12) : fmtClock(a);
  return withEasyPace(`${prefix}${start} to ${fmtClock(b)}, ${lo === hi ? `${lo}°` : `${lo} to ${hi}°`}`, ctx.oura);
}

// ---------- week notes ----------
function meanCloud(model, from, to) {
  const v = numsOf(hoursBetween(model, from, to), 'cloud');
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export function dayNote(ctx, date) {
  const today = datePart(ctx.now);
  const info = infoFor(ctx, date);
  const home = ctx.homeModel || ctx.model;
  const homeDay = dayByDate(home, date);
  const homeSky = homeDay ? skyWord(homeDay.code ?? 0, 1).head : '';
  const tripDay = (t, d) => { const m = tripModelFor(ctx, t, d); return m ? dayByDate(m, d) : null; };
  const there = (d) => (d && d.high != null ? `${r(d.high)} & ${skyWord(d.code ?? 0, 1).head} there` : '');
  // 1. travel
  if (info.trip) {
    const city = lc(info.trip.city);
    if (info.flag === 'depart') {
      const t = there(tripDay(info.trip, addDays(date, 1)) || tripDay(info.trip, date));
      return `you head to ${city}.${t ? ` ${t}.` : ''}`;
    }
    if (info.flag === 'daytrip') {
      const t = there(tripDay(info.trip, date));
      return `day trip to ${city}.${t ? ` ${t}.` : ''}`;
    }
    if (info.flag === 'away') return `in ${city}.${homeDay && homeDay.high != null ? ` home is ${r(homeDay.high)} & ${homeSky}.` : ''}`;
    if (info.flag === 'return') return `heading home${homeDay && homeDay.high != null ? `, ${r(homeDay.high)} & ${homeSky} there` : ''}.`;
  }
  const m = modelForDate(ctx, date);
  const d = dayByDate(m, date);
  if (!d) return '';
  const next = addDays(date, 1);
  const dayHrs = hoursBetween(m, `${date}T06:00`, `${date}T18:00`);
  const nightHrs = hoursBetween(m, `${date}T18:00`, `${next}T06:00`);
  const dow = dowShort(date);
  const word = skyWord(d.code ?? 61, 1).cat === 'snow' ? ' snow' : '';
  // 2. rain
  const dayMax = maxOf(numsOf(dayHrs, 'precipProb')) ?? 0;
  const nightMax = maxOf(numsOf(nightHrs, 'precipProb')) ?? 0;
  if (dayMax >= 20 || nightMax >= 20 || (d.precipProbMax ?? 0) >= 20) {
    const night = nightMax >= 20 ? `*${nightMax}%${word} ${dow} night*` : '';
    if (dayMax >= 20) {
      const first = dayHrs.find((h) => (h.precipProb ?? 0) >= 20);
      const fh = hr(first.time);
      const lastWet = [...dayHrs].reverse().find((h) => (h.precipProb ?? 0) >= 20);
      const when = fh <= 7 && hr(lastWet.time) >= 15 ? 'on and off' : fh < 10 ? 'in the morning' : `after ${fmtClock(fh)}`;
      return `${dayMax}%${word} ${when}${night ? `, ${night}` : ''}.`;
    }
    if (night) return `dry day, ${night}.`;
  }
  // 3. big change vs the previous day's high
  const pm = modelForDate(ctx, addDays(date, -1));
  const pd = dayByDate(pm, addDays(date, -1));
  if (pd && pd.high != null && d.high != null) {
    const diff = toF(d.high, ctx.units) - toF(pd.high, ctx.units);
    if (diff <= -8) return `big drop, high near ${r(d.high)}.`;
    if (diff >= 8) return `warming up, ${r(dF(diff, ctx.units))}° above ${date === today ? 'yesterday' : dowShort(addDays(date, -1))}.`;
  }
  // 4. wind
  const gustMph = toMph(d.gustMax ?? 0, ctx.units);
  const windMph = toMph(d.windMax ?? 0, ctx.units);
  if (gustMph >= 25) return `gusty, to ${r(d.gustMax)} ${speedUnit(ctx.units)}.`;
  if (windMph >= 15) return `breezy, ${dirWord(d.windDir)} ${r(d.windMax)} ${speedUnit(ctx.units)}.`;
  // 5. night sky change
  const dc = meanCloud(m, `${date}T08:00`, `${date}T18:00`);
  const nc = meanCloud(m, `${date}T20:00`, `${next}T06:00`);
  if (dc != null && nc != null) {
    if (nc - dc >= 35) return `clouds thicken ${dow} night.`;
    if (dc - nc >= 35) return `clears out ${dow} night.`;
  }
  // 6. default
  const dayWind = numsOf(hoursBetween(m, `${date}T08:00`, `${date}T18:00`), 'wind');
  const meanWind = dayWind.length ? dayWind.reduce((a, b) => a + b, 0) / dayWind.length : null;
  if (meanWind != null && toMph(meanWind, ctx.units) >= 6) return `${dirWord(d.windDir)} wind about ${r(meanWind)} ${speedUnit(ctx.units)}.`;
  const sky = skyWord(d.code ?? 0, 1).head;
  return `${sky} and ${tempWord(toF(d.high ?? 60, ctx.units))}.`;
}

// ---------- events ----------
export function eventNote(ctx, ev) {
  if (!ev || ev.allDay) return '';
  const m = modelForDate(ctx, ev.date);
  const h = hourAt(m, ev.ls);
  if (!h || h.temp == null) return '';
  const sky = skyWord(h.code ?? 0, h.isDay ?? 1).head;
  let s = `${r(h.temp)}° & ${sky}`;
  if ((h.precipProb ?? 0) >= 30) s += `, ${h.precipProb}% rain`;
  const w = wearFor(toF(h.feels ?? h.temp, ctx.units));
  return `${s} · ${w[2]}`;
}

// ---------- leave-by, inbox, packages, last night ----------
/** "7:33" when the departure shares am/pm with the event, else "7:33am"; noon and midnight stay words. */
export function leaveClock(leaveLs, eventLs) {
  const c = fmtClock(leaveLs);
  if (c === 'noon' || c === 'midnight' || !eventLs) return c;
  return meridiem(hr(leaveLs)) === meridiem(hr(eventLs)) ? c.replace(/(am|pm)$/, '') : c;
}

/** "leave by 7:33 · 22 min drive", plus a wet-roads nudge at 40% rain or more when leaving. `hours` = that day's model hours. */
export function leaveNote(event, hours) {
  const t = event && event.travel;
  if (!t || !t.leaveBy) return '';
  let s = `leave by ${leaveClock(t.leaveBy, event.ls)} · ${fmtMinutes(t.minutes)} drive`;
  const h = (hours || []).find((x) => x.time === hourKey(t.leaveBy));
  if (h && (h.precipProb ?? 0) >= 40) s += ' · wet roads, add a few minutes';
  return s;
}

/** Hero chip: the next timed event with a drive, when it starts within 4 hours. */
export function leaveChip(ctx) {
  const ev = (ctx.events || []).filter((e) => !e.allDay && e.travel && e.travel.leaveBy && e.ls >= ctx.now).sort((a, b) => a.ls.localeCompare(b.ls))[0];
  if (!ev || diffMinutes(ctx.now, ev.ls) > 240) return '';
  const when = ev.travel.leaveBy > ctx.now ? leaveClock(ev.travel.leaveBy, ev.ls) : 'now';
  return `leave ${when} for ${shortTitle(ev.title)}, ${ev.travel.minutes} min`;
}

const clip = (s, n) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);
/** Hero chip: "2 waiting on you · little shop asks you to confirm" (60 characters at most). */
export function inboxChip(inbox) {
  if (!inbox || !inbox.ok || !inbox.waiting || !inbox.waiting.length) return '';
  const first = inbox.waiting[0];
  return clip(`${inbox.waiting.length} waiting on you · ${lc(first.from)} ${lc(first.reason)}`, 60);
}

/** "northwind package out for delivery", paired with the day's weather when it is on its way today. */
export function packageNote(pkg, ctx) {
  let s = `${lc(pkg.merchant) || 'a'} package ${pkg.status}`;
  if (pkg.status !== 'arriving today' && pkg.status !== 'out for delivery') return s;
  const today = datePart(ctx.now);
  const m = ctx.model;
  const from = ctx.now > `${today}T10:00` ? hourKey(ctx.now) : `${today}T10:00`;
  const hs = hoursBetween(m, from, `${today}T18:00`);
  const wet = hs.find((h) => (h.precipProb ?? 0) >= 40);
  if (wet) return `${s}, rain after ${fmtClock(hr(wet.time))}, grab it early`;
  const feels = hs.map((h) => h.feels ?? h.temp).filter((v) => v != null);
  const hi = maxOf(feels);
  if (hi != null && toF(hi, ctx.units) >= 100) return `${s}, porch hits ${r(hi)}, bring it in early`;
  const night = nightLow(m, today);
  if (night != null && toF(night, ctx.units) <= 32) return `${s}, below freezing tonight`;
  return s;
}

export const easyPace = (oura) => !!(oura && oura.ok && oura.readiness && oura.readiness.score != null && oura.readiness.score < 70);
export const withEasyPace = (text, oura) => (easyPace(oura) && text && !/easy pace/.test(text) && !/^no clean window/.test(text) ? `${text} · easy pace` : text);

/** One or two lowercase sentences about last night, from the Oura data. `weather` and `events` are accepted for future tailoring. */
export function bodyNote(oura, weather, events) { // eslint-disable-line no-unused-vars
  if (!oura || !oura.ok) return '';
  const score = oura.readiness && oura.readiness.score;
  const avg = oura.week && oura.week.readinessAvg;
  const out = [];
  if (score != null) {
    if (score >= 85) out.push(`readiness ${score}, you're primed. good day to push it.`);
    else if (score >= 70) {
      if (avg == null) out.push(`readiness ${score}, steady enough.`);
      else if (Math.abs(score - avg) <= 5) out.push(`readiness ${score}, about your usual.`);
      else out.push(`readiness ${score}, ${score > avg ? 'up' : 'down'} from your usual ${avg}.`);
    } else out.push(avg == null ? `readiness ${score}, on the low side. keep it easy today.` : `readiness ${score}, lower than your usual ${avg}. keep it easy today.`);
  }
  const total = oura.sleep && oura.sleep.totalSec;
  let diff = '';
  if (total != null) {
    const usual = oura.week && oura.week.totalSecAvg;
    const dm = usual != null ? (total - usual) / 60 : 0;
    if (Math.abs(dm) >= 30) diff = `, ${fmtMinutes(dm)} ${dm > 0 ? 'more' : 'less'} than usual`;
  }
  const sleepClause = (withDiff) => `slept ${fmtDuration(total)}${withDiff ? diff : ''}.`;
  let text = [...out, ...(total != null ? [sleepClause(true)] : [])].join(' ');
  if (text.length > 140 && total != null) text = [...out, sleepClause(false)].join(' ');
  return text.length > 140 ? clip(text, 140) : text;
}

// ---------- fine print ----------
const uvBand = (u) => (u < 3 ? 'low' : u < 6 ? 'moderate' : u < 8 ? 'high' : u < 11 ? 'very high' : 'extreme');
const dewNote = (f) => (f < 40 ? 'dry & crisp' : f < 55 ? 'comfortable' : f < 65 ? 'a little sticky' : f < 70 ? 'humid' : 'muggy');
const AQ_NOTE = {
  good: 'good, clean air', moderate: 'moderate, fine for most people', 'unhealthy for sensitive groups': 'sensitive groups should take it easy',
  unhealthy: 'unhealthy, limit time outside', 'very unhealthy': 'very unhealthy, stay in if you can', hazardous: 'hazardous, stay indoors',
};

export function finePrint(ctx) {
  const m = ctx.model;
  const today = datePart(ctx.now);
  const tomorrow = addDays(today, 1);
  const d = dayByDate(m, today) || {};
  const dt = dayByDate(m, tomorrow);
  const c = m.current;
  const u = speedUnit(ctx.units);
  const nowH = hourKey(ctx.now);
  const out = [];
  // sunrise
  out.push({ key: 'sunrise', label: 'sunrise', value: d.sunrise ? fmtClock(d.sunrise) : '—', note: d.sunset ? `sunset ${fmtClock(d.sunset)}` : '' });
  // daylight
  let dnote = '';
  if (d.daylight != null && dt && dt.daylight != null) {
    const mins = Math.round((dt.daylight - d.daylight) / 60);
    dnote = mins === 0 ? 'about the same tomorrow' : `${Math.abs(mins)} min ${mins < 0 ? 'shorter' : 'longer'} tomorrow`;
  }
  out.push({ key: 'daylight', label: 'daylight', value: d.daylight != null ? fmtDuration(d.daylight) : '—', note: dnote });
  // wind
  const wh = hoursBetween(m, `${today}T07:00`, `${today}T19:00`);
  const wv = numsOf(wh, 'wind');
  const gust = maxOf(numsOf(wh, 'gust'));
  let wnote = '';
  if (gust != null && toMph(gust, ctx.units) >= 20) {
    const gh = wh.find((h) => h.gust === gust);
    wnote = `gusts to ${r(gust)} ${gh && hr(gh.time) >= 12 ? 'this afternoon' : hr(gh.time) < 10 ? 'this morning' : 'midday'}`;
  } else if (wv.length) {
    const lo = r(Math.min(...wv)); const hi = r(Math.max(...wv));
    wnote = `${dirWord(c.windDir)} ${lo === hi ? lo : `${lo} to ${hi}`} ${u} all day`;
  }
  out.push({ key: 'wind', label: 'wind', value: c.wind != null ? `${dirAbbr(c.windDir)} ${r(c.wind)} ${u}`.trim() : '—', note: wnote });
  // humidity
  let hnote = '';
  if (c.humidity != null) {
    const rest = hoursBetween(m, nowH, `${today}T23:59`).filter((h) => h.humidity != null);
    const night = hoursBetween(m, nowH, addHours(nowH, 16)).filter((h) => h.humidity != null);
    const lo = rest.length ? rest.reduce((a, b) => (b.humidity < a.humidity ? b : a)) : null;
    const hi = night.length ? night.reduce((a, b) => (b.humidity > a.humidity ? b : a)) : null;
    if (lo && c.humidity - lo.humidity >= 8) hnote = `drops to ${r(lo.humidity)}% by ${fmtClock(hr(lo.time))}`;
    else if (hi && hi.humidity - c.humidity >= 8) hnote = `climbs to ${r(hi.humidity)}% ${hr(hi.time) >= 18 || hr(hi.time) < 6 ? 'overnight' : `by ${fmtClock(hr(hi.time))}`}`;
    else hnote = `holds near ${r(c.humidity)}%`;
  }
  out.push({ key: 'humidity', label: 'humidity', value: c.humidity != null ? `${r(c.humidity)}%` : '—', note: hnote });
  // dew point
  out.push({ key: 'dew', label: 'dew point', value: c.dew != null ? `${r(c.dew)}°` : '—', note: c.dew != null ? dewNote(toF(c.dew, ctx.units)) : '' });
  // pressure
  let pnote = '';
  if (c.pressure != null) {
    const later = hourAt(m, addHours(nowH, 6));
    const delta = later && later.pressure != null ? later.pressure - c.pressure : 0;
    pnote = delta >= 1.5 ? 'rising, fair weather building' : delta <= -1.5 ? 'falling, change on the way' : 'steady';
    if (c.pressure > 1022) pnote = `strong high, ${pnote}`;
  }
  out.push({ key: 'pressure', label: 'pressure', value: c.pressure != null ? (ctx.units === 'metric' ? `${r(c.pressure)} hPa` : `${(c.pressure * 0.02953).toFixed(2)} in`) : '—', note: pnote });
  // uv
  const uv = d.uvMax;
  let unote = '';
  if (uv != null) {
    const uvh = hoursBetween(m, `${today}T00:00`, `${tomorrow}T00:00`).filter((h) => h.uv != null);
    const pk = uvh.length ? uvh.reduce((a, b) => (b.uv > a.uv ? b : a)) : null;
    unote = pk && pk.uv >= 1 ? `${uvBand(uv)}, peaks around ${fmtClock(hr(pk.time))}` : `${uvBand(uv)}, barely registers`;
  }
  out.push({ key: 'uv', label: 'uv index', value: uv != null ? String(r(uv)) : '—', note: unote });
  // air quality
  out.push({ key: 'aqi', label: 'air quality', value: m.aqi ? String(m.aqi.value) : '—', note: m.aqi ? AQ_NOTE[m.aqi.category] || m.aqi.category : 'no reading right now' });
  return out;
}

// ---------- everything at once ----------
export function writeAll(ctx) {
  const today = datePart(ctx.now);
  const h = headline(ctx);
  const dates = Array.from({ length: 10 }, (_, i) => addDays(today, i));
  const evs = (ctx.events || []).filter((e) => !e.allDay && (e.date === today || e.date === addDays(today, 1)));
  return {
    condition: condition(ctx),
    headline_lead: h.lead,
    headline_accent: h.accent,
    narrative: narrative(ctx),
    umbrella: umbrella(ctx),
    wear: wear(ctx),
    best_window: bestWindow(ctx),
    leave_chip: leaveChip(ctx),
    inbox_chip: inboxChip(ctx.inbox),
    body_note: bodyNote(ctx.oura, ctx.model, ctx.events),
    package_notes: ((ctx.inbox && ctx.inbox.ok && ctx.inbox.packages) || []).map((p) => ({ id: p.id, note: packageNote(p, ctx) })),
    leave_notes: evs.filter((e) => e.travel).map((e) => ({ id: e.id, note: leaveNote(e, modelForDate(ctx, e.date).hours) })),
    day_notes: dates.map((date) => ({ date, note: dayNote(ctx, date) })),
    event_notes: evs.map((e) => ({ id: e.id, note: eventNote(ctx, e) })),
    fine: finePrint(ctx),
  };
}
