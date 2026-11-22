// Evening mode: after the evening start time the hero becomes tomorrow's edition. Pure, deterministic, like insights.js:
// it reuses the built-in writer by pointing a copy of ctx at 7am tomorrow (in tomorrow's forecast).
import { addDays, datePart, hourKey, fmtClock, dowShort } from './time.js';
import { dayByDate, hoursBetween, hourAt, nightLow } from './weather.js';
import { modelForDate, headline, narrative, wear, umbrella, leaveClock, skyWord, windWord } from './insights.js';
import { shortTitle } from './calendar.js';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Evening start as "HH:MM" (bad input falls back to 18:00). */
export const eveningStart = (ev) => (ev && TIME.test(ev.start || '') ? ev.start : '18:00');

/** True from the evening start time until midnight, when evening mode is on. `now` is local wall clock. */
export function eveningOn(now, ev) {
  if (!now || !ev || ev.enabled === false) return false;
  return now.slice(11, 16) >= eveningStart(ev);
}

/** The model with `current` filled from its hour at `local` (so the writer can speak as of then). */
export function modelAt(model, local) {
  const h = hourAt(model, local);
  if (!h) return model;
  return {
    ...model,
    current: {
      ...model.current, time: local, temp: h.temp, feels: h.feels, humidity: h.humidity, dew: h.dew, code: h.code, cloud: h.cloud,
      pressure: h.pressure, wind: h.wind, windDir: h.windDir, gust: h.gust, isDay: h.isDay,
    },
  };
}

const toF = (v, units) => (v == null ? null : units === 'metric' ? (v * 9) / 5 + 32 : v);
const toMph = (v, units) => (v == null ? null : units === 'metric' ? v / 1.609344 : v);
const r = (v) => Math.round(v);

/** "clear & mild": the day's sky and how the daytime wind feels. */
export function dayCondition(model, date, units) {
  const d = dayByDate(model, date);
  if (!d) return '';
  const hs = hoursBetween(model, `${date}T10:00`, `${date}T17:00`).filter((h) => h.wind != null);
  const wind = hs.length ? hs.reduce((s, h) => s + h.wind, 0) / hs.length : (d.windMax ?? 0);
  const feels = toF(d.feelsHigh ?? d.high ?? 60, units);
  return `${skyWord(d.code ?? 0, 1).word} & ${windWord(toMph(wind, units), feels)}`;
}

/** "8am church service · leave 7:33" for the first timed event on `date`. */
export function firstUp(events, date) {
  const ev = (events || []).filter((e) => !e.allDay && e.date === date).sort((a, b) => a.ls.localeCompare(b.ls))[0];
  if (!ev) return '';
  let s = `${fmtClock(ev.ls)} ${shortTitle(ev.title)}`;
  if (ev.travel && ev.travel.leaveBy && ev.travel.leaveBy.slice(0, 10) === date) s += ` · leave ${leaveClock(ev.travel.leaveBy, ev.ls)}`;
  return s;
}

/** "low 47 & clear": tonight's coldest hour (from now until 8am) and the sky then. */
export function tonightLow(ctx) {
  const today = datePart(ctx.now);
  const hs = hoursBetween(ctx.model, hourKey(ctx.now), `${addDays(today, 1)}T08:00`).filter((h) => h.temp != null);
  if (!hs.length) {
    const lo = nightLow(ctx.model, today);
    return lo == null ? '' : `low ${r(lo)}`;
  }
  const cold = hs.reduce((a, b) => (b.temp < a.temp ? b : a));
  return `low ${r(cold.temp)} & ${skyWord(cold.code ?? 0, 0).word}`;
}

/**
 * Tomorrow's edition for the hero, or null when tomorrow isn't in the forecast.
 * {date, model, away, high, low, code, sunrise, condition, headline_lead, headline_accent, narrative, chips:[{key, label, text}]}
 */
export function tomorrowEdition(ctx) {
  const today = datePart(ctx.now);
  const date = addDays(today, 1);
  const m = modelForDate(ctx, date);
  const d = m && dayByDate(m, date);
  if (!d) return null;
  const at7 = `${date}T07:00`;
  const t = { ...ctx, now: at7, model: modelAt(m, at7) };
  const h = headline(t);
  const chips = [];
  const first = firstUp(ctx.events, date);
  if (first) chips.push({ key: 'first', label: 'first up', text: first });
  chips.push({ key: 'wear', label: 'wear', text: wear(t) });
  if ((d.precipProbMax ?? 0) >= 30) chips.push({ key: 'umbrella', label: 'umbrella', text: umbrella(t) });
  const tl = tonightLow(ctx);
  if (tl) chips.push({ key: 'tonight', label: 'tonight', text: tl });
  const info = ctx.travel ? ctx.travel.dayInfo(date) : null;
  return {
    date,
    model: m,
    away: !!(info && info.where === 'away' && m !== (ctx.homeModel || ctx.model)),
    high: d.high,
    low: d.low,
    code: d.code,
    sunrise: d.sunrise,
    condition: dayCondition(m, date, ctx.units),
    headline_lead: h.lead,
    headline_accent: h.accent,
    narrative: narrative(t, { opener: 'starts around' }),
    chips,
    dow: dowShort(date),
  };
}
