// Optional Claude writer. Runs only when the user turns it on and adds an API key.
// The official Anthropic SDK is loaded lazily from jsDelivr, pinned, and called straight from the browser.
import { addDays, datePart, hourKey, addHours, dowShort, fmtClock } from './time.js';
import { dayByDate, hoursBetween, nightLow } from './weather.js';
import { skyWord, modelForDate } from './insights.js';
import { travelLine } from './travel.js';

export const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.6.0/+esm';
export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5 · best writing' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5 · cheapest' },
];
export const DEFAULT_MODEL = 'claude-opus-5-5';

const str = { type: 'string' };
export const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['condition', 'headline_lead', 'headline_accent', 'narrative', 'umbrella', 'wear', 'best_window', 'body_note', 'day_notes', 'event_notes'],
  properties: {
    condition: str, headline_lead: str, headline_accent: str, narrative: str, umbrella: str, wear: str, best_window: str, body_note: str,
    day_notes: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['date', 'note'], properties: { date: str, note: str } } },
    event_notes: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'note'], properties: { id: str, note: str } } },
  },
};

export const SYSTEM_PROMPT = `you write the morning weather report for one person's home screen. the report is a small set of text fields. you are a friend who checked the forecast for them: warm, plain, specific, a little dry. never a press release, never chirpy.

voice
- all lowercase. no exclamation points, no emoji.
- concrete numbers from the facts, never vague. plain words over weather jargon.
- the degree sign appears only in headline_lead. everywhere else write bare numbers ("about 43 & clear at 7, feels 39").
- times read like "9am", "4:35", "noon". units follow facts.units (imperial = °F and mph, metric = °C and km/h).
- use only the numbers, places, times and events in the facts. never invent weather, events or places. if something isn't in the facts, leave it out.
- you may refer to events naturally ("the 9am gym walk") and to trips ("the morning you fly", "the day you head to santa barbara").
- one short phrase may be wrapped in *asterisks* to render italic, in narrative and day notes only.

fields
- condition: two or three words like "clear & still", "overcast & breezy", "sunny & mild".
- headline_lead: the high and the sky, ending in a comma, e.g. "62° & sunny,".
- headline_accent: a short italic continuation of the headline, e.g. "another clean blue day". it completes the sentence begun by headline_lead.
- narrative: 60 to 110 words. what it's like now, rain or no rain, wind, how the temperature moves through the day, sundown and the night low, then an italic outlook for the next few days.
- umbrella: at most 60 characters. starts with yes, no, or probably not, then the percent and when.
- wear: at most 60 characters. what to put on, tied to the first morning event if there is one.
- best_window: at most 60 characters, the best stretch outside, like "12 to 4pm, 59 to 62°".
- body_note: at most 140 characters, empty string when facts.oura is null. one or two plain sentences about last night from facts.oura: readiness, how long they slept, and how that compares with their usual (the week averages). readiness 85 or more reads as primed; 70 to 84 as about their usual unless it differs from the week average by more than 5; under 70 as lower than usual, keep it easy today. never medical advice, never alarming, no diagnoses. if readiness is under 70, the best_window may end with " · easy pace".
- day_notes: one entry for every date in facts.days, same date strings. each at most 90 characters, one or two clauses, one thing worth knowing about that day. if the person is traveling that day, say where and how it compares to home.
- event_notes: one entry for every event in facts.events that is not all-day, same ids. at most 60 characters: the temperature at the start and what to wear or bring. an event with a travel entry may mention when to leave ("leave by 7:33"), using only travel.leave_by and travel.minutes.

facts.inbox (count and up to 3 items) and facts.packages are things waiting on the person. the narrative may mention a package or something waiting only if it pairs naturally with the weather (a package arriving before the rain, say). otherwise leave them out: the app shows them as chips and a list.

facts.workout (today's proposed session and window), facts.dinner (tonight's meal), facts.birthdays, facts.rundown_note (a note from this morning's rundown) and facts.park_day (a theme park today: hours and showtimes) are optional context, often null. the narrative may use one of them in a short clause when it pairs with the weather (a cool garage for the 6am workout, a chilly night for the 9:30 fireworks). never mention money or amounts. otherwise leave them out: the app shows them elsewhere.

facts.on_device is a plainer version written by a program. use it only as a reference for format and length. improve on its phrasing; do not copy it, and do not contradict its numbers.

style sample (a different day, for tone only)
condition "clear & still"; headline_lead "62° & sunny,"; headline_accent "another clean blue day"; narrative "about 43 & clear at 7, feels 39. central park read 49 at 2:51am. sunny all day, 0% rain every hour, light west wind 6 to 7 mph. warms fast: 48 by 9, 59 by noon, peak 62 around 3, sundown about 4:35, then a mild night near 42. *63 thu, 66 fri, then rain chances creep in sun afternoon into mon, the morning you fly.*"; umbrella "no, 0% all day"; wear "sweater for the 9am gym walk, a shirt by noon"; best_window "12 to 4pm, 59 to 62°".`;

const r1 = (v) => (v == null ? null : Math.round(v));
const mins = (sec) => (sec == null ? null : Math.round(sec / 60));
const clipStr = (v, n) => (String(v ?? '').length > n ? `${String(v).slice(0, n - 1)}…` : String(v ?? ''));

/** Oura facts for the model: scores and durations only (never ids or timestamps). */
function ouraFacts(o) {
  if (!o || !o.ok) return null;
  const w = o.week || {};
  return {
    readiness: o.readiness ? o.readiness.score : null,
    sleep_score: o.sleep ? o.sleep.score : null,
    total_sleep_min: o.sleep ? mins(o.sleep.totalSec) : null,
    temperature_deviation: o.readiness ? o.readiness.temperatureDeviation : null,
    week: { readiness_avg: w.readinessAvg ?? null, sleep_score_avg: w.sleepScoreAvg ?? null, total_sleep_min_avg: mins(w.totalSecAvg) },
  };
}
/** Inbox facts: who and why and the subject, never snippets. */
function inboxFacts(inbox) {
  if (!inbox || !inbox.ok) return null;
  return { count: inbox.waiting.length, items: inbox.waiting.slice(0, 3).map((w) => ({ from: w.from, reason: w.reason, subject: clipStr(w.subject, 60) })) };
}

/** The v3 extras, trimmed for the model: no money, no ids, first names only. */
export function extraFacts(x = {}) {
  const w = x.workout;
  const d = x.dinner;
  const p = x.parkDay;
  return {
    workout: w && w.state ? {
      state: w.state, session: [w.version, w.label].filter(Boolean).join(' · ') || null, minutes: w.min ?? null,
      window: w.window ? `${w.window.start.slice(11)}-${w.window.end.slice(11)}` : null, why: (w.why || []).slice(0, 2),
    } : null,
    dinner: d && d.meals ? { tonight: d.meals.dinner ? d.meals.dinner.name : null, eat_by: d.eatBy || null } : null,
    birthdays: (x.birthdays || []).slice(0, 3),
    rundown_note: typeof x.rundownNote === 'string' ? x.rundownNote.slice(0, 300) : '',
    park_day: p ? { name: p.name, hours: p.hours || null, shows: (p.shows || []).slice(0, 4) } : null,
  };
}

/** Compact facts for the model. Pure. `extras` = {workout, dinner, birthdays, rundownNote, parkDay} (all optional). */
export function buildFacts(ctx, onDevice, extras = {}) {
  const m = ctx.model;
  const today = datePart(ctx.now);
  const home = ctx.homeModel || m;
  const tl = travelLine(ctx.travel, today);
  const info = ctx.travel ? ctx.travel.dayInfo(today) : { where: 'home', flag: null, trip: null };
  const y = dayByDate(m, addDays(today, -1));
  const d = dayByDate(m, today) || {};
  const nowH = hourKey(ctx.now);
  const next18 = hoursBetween(m, nowH, addHours(nowH, 18)).map((h) => ({
    time: h.time.slice(11), temp: r1(h.temp), feels: r1(h.feels), precip: h.precipProb, sky: skyWord(h.code ?? 0, h.isDay ?? 1).word,
    wind: r1(h.wind), gust: r1(h.gust),
  }));
  const days = Array.from({ length: 10 }, (_, i) => {
    const date = addDays(today, i);
    const mm = modelForDate(ctx, date);
    const dd = dayByDate(mm, date) || {};
    const di = ctx.travel ? ctx.travel.dayInfo(date) : null;
    return {
      date, dow: dowShort(date), high: r1(dd.high), night_low: r1(nightLow(mm, date)), precip_max: dd.precipProbMax,
      sky: skyWord(dd.code ?? 0, 1).head, wind_max: r1(dd.windMax), gust_max: r1(dd.gustMax),
      away_city: di && di.where === 'away' && di.trip ? di.trip.city : null, trip_flag: di ? di.flag : null,
    };
  });
  const evs = (ctx.events || []).filter((e) => e.dates ? e.dates.some((x) => x === today || x === addDays(today, 1)) : e.date === today || e.date === addDays(today, 1));
  return {
    now_local: ctx.now,
    units: ctx.units,
    primary_place: m.place.name,
    home_place: home.place.name,
    travel: {
      line: tl,
      today_flag: info.flag,
      trips: ctx.travel ? ctx.travel.trips.map((t) => ({ city: t.city, depart: t.departDate, return: t.returnDate, lodging: t.lodging })) : [],
    },
    current: { temp: r1(m.current.temp), feels: r1(m.current.feels), sky: skyWord(m.current.code ?? 0, m.current.isDay ?? 1).word, wind: r1(m.current.wind), humidity: m.current.humidity },
    today: {
      high: r1(d.high), night_low: r1(nightLow(m, today)), sunrise: d.sunrise ? fmtClock(d.sunrise) : null,
      sunset: d.sunset ? fmtClock(d.sunset) : null, uv_max: r1(d.uvMax), aqi: m.aqi ? m.aqi.value : null,
    },
    yesterday: y ? { high: r1(y.high), sky: skyWord(y.code ?? 0, 1).word } : null,
    next_18_hours: next18,
    days,
    events: evs.map((e) => ({
      id: e.id, title: e.title, start: e.allDay ? e.start : e.ls, end: e.allDay ? e.end : e.le, all_day: e.allDay, location: e.location || '',
      away_city: (() => { const di = ctx.travel && ctx.travel.dayInfo(e.date); return di && di.where === 'away' && di.trip ? di.trip.city : null; })(),
      ...(e.travel ? { travel: { minutes: e.travel.minutes, leave_by: e.travel.leaveBy } } : {}),
    })),
    inbox: inboxFacts(ctx.inbox),
    packages: ctx.inbox && ctx.inbox.ok ? ctx.inbox.packages.map((p) => ({ merchant: p.merchant, status: p.status })) : [],
    oura: ouraFacts(ctx.oura),
    alerts: (m.alerts || []).map((a) => ({ event: a.event, ends: a.ends })),
    ...extraFacts(extras),
    on_device: stripFine(onDevice),
  };
}
const stripFine = (w) => { const { fine, ...rest } = w || {}; return rest; };

/** Cache fingerprint: stable inside a 3-hour block so we never rewrite more than that often. */
export function fingerprint(ctx, extras = {}) {
  const today = datePart(ctx.now);
  const block = Math.floor(parseInt(ctx.now.slice(11, 13), 10) / 3) * 3;
  const start = `${today}T${String(block).padStart(2, '0')}:00`;
  const hs = hoursBetween(ctx.model, start, addHours(start, 18)).map((h) => `${Math.round((h.temp ?? 0) / 5) * 5}/${Math.round((h.precipProb ?? 0) / 20) * 20}`);
  const evs = (ctx.events || []).filter((e) => e.date === today || e.date === addDays(today, 1)).map((e) => `${e.id}@${e.start}`).sort();
  const o = ctx.oura && ctx.oura.ok ? `${ctx.oura.readiness ? ctx.oura.readiness.score : ''}/${ctx.oura.sleep ? `${ctx.oura.sleep.score}/${ctx.oura.sleep.totalSec}` : ''}` : '';
  const waiting = ctx.inbox && ctx.inbox.ok ? ctx.inbox.waiting.map((w) => w.id).join(',') : '';
  const pk = ctx.inbox && ctx.inbox.ok ? ctx.inbox.packages.map((p) => `${p.merchant}:${p.status}`).join(',') : '';
  const x = extraFacts(extras);
  const more = [x.workout ? `${x.workout.session}@${x.workout.window}` : '', x.dinner ? x.dinner.tonight : '', x.birthdays.length, x.rundown_note ? x.rundown_note.length : 0, x.park_day ? x.park_day.name : ''].join(',');
  return [today, block, ctx.model.place.name, ctx.units, hs.join(','), evs.join(','), o, waiting, pk, more].join('|');
}

export function friendlyAiError(e) {
  switch (e && e.kind) {
    case 'auth': return 'check your api key in settings';
    case 'rate': return 'rate limited, try later';
    case 'connection': return "couldn't reach claude";
    case 'load': return "couldn't load the claude library";
    case 'refusal': return 'claude declined, showing on-device text';
    case 'truncated': return 'claude ran long, showing on-device text';
    case 'bad-output': return "claude's answer wasn't usable";
    case 'api': return `claude error ${e.status || ''} ${e.message || ''}`.trim();
    default: return 'claude had a problem';
  }
}

/** Calls Claude once. Throws {kind, status?, message?}. */
export async function writeWithClaude({ apiKey, model = DEFAULT_MODEL, facts, sdkUrl = SDK_URL }) {
  let Anthropic;
  try {
    ({ default: Anthropic } = await import(sdkUrl));
  } catch (e) {
    throw { kind: 'load', message: String(e && e.message || e) };
  }
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const params = {
    model,
    max_tokens: 8000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: JSON.stringify(facts) }],
  };
  // Server-side refusal fallback: Opus 5.5 and Sonnet 5.5 only (not available for Haiku 5.5).
  if (model !== 'claude-haiku-5-5') {
    params.betas = ['server-side-fallback-2026-07-01'];
    params.fallbacks = 'default';
  }
  let response;
  try {
    response = await client.beta.messages.create(params);
  } catch (e) {
    if (Anthropic.AuthenticationError && e instanceof Anthropic.AuthenticationError) throw { kind: 'auth', status: e.status };
    if (Anthropic.RateLimitError && e instanceof Anthropic.RateLimitError) throw { kind: 'rate', status: e.status };
    if (Anthropic.APIConnectionError && e instanceof Anthropic.APIConnectionError) throw { kind: 'connection' };
    if (Anthropic.APIError && e instanceof Anthropic.APIError) throw { kind: 'api', status: e.status, message: e.message };
    throw { kind: 'api', message: String(e && e.message || e) };
  }
  if (response.stop_reason === 'refusal') throw { kind: 'refusal' };
  if (response.stop_reason === 'max_tokens') throw { kind: 'truncated' };
  const text = (response.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  try {
    return JSON.parse(text);
  } catch {
    throw { kind: 'bad-output' };
  }
}

/** Overlay Claude's fields on the on-device output; anything missing or malformed keeps the on-device text. */
export function mergeWritten(onDevice, ai) {
  if (!ai || typeof ai !== 'object') return onDevice;
  const pick = (k) => (typeof ai[k] === 'string' && ai[k].trim() ? ai[k].trim() : onDevice[k]);
  const dayMap = new Map((Array.isArray(ai.day_notes) ? ai.day_notes : []).filter((x) => x && x.date && typeof x.note === 'string').map((x) => [x.date, x.note]));
  const evMap = new Map((Array.isArray(ai.event_notes) ? ai.event_notes : []).filter((x) => x && x.id && typeof x.note === 'string').map((x) => [x.id, x.note]));
  return {
    ...onDevice,
    condition: pick('condition'), headline_lead: pick('headline_lead'), headline_accent: pick('headline_accent'),
    narrative: pick('narrative'), umbrella: pick('umbrella'), wear: pick('wear'), best_window: pick('best_window'),
    // only when there is Oura data to talk about; otherwise the field stays empty whatever the model said
    body_note: onDevice.body_note ? pick('body_note') : '',
    day_notes: onDevice.day_notes.map((n) => ({ date: n.date, note: dayMap.get(n.date) || n.note })),
    event_notes: onDevice.event_notes.map((n) => ({ id: n.id, note: evMap.get(n.id) || n.note })),
  };
}
