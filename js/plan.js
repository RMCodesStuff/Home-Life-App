// Trip plan (itinerary): a hand-made day-by-day plan that arrives as a link (#plan=…) and lives only in this browser.
// Pure logic, no DOM. The plan comes from a URL, so everything is validated and capped here.
import { getJSON, setJSON, remove } from './store.js';
import { addDays, diffDays, fmtClock, fmtDateRange } from './time.js';

export const PLAN_PREFIX = '#plan=';
export const PLAN_KEY = 'hl.plan';
export const doneKey = (planId) => `hl.plan.done.${planId}`;
export const MAX_JSON = 200 * 1024; // decoded JSON, bytes of text
export const MAX_ENCODED = 120000; // characters of payload
export const TAGS = { reserved: 'reserved', phone: 'phone task', multipass: 'multi pass', switch: 'rider switch', food: 'food', show: 'show' };

const ID_RE = /^[a-z0-9-]{1,40}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const str = (v, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const arr = (v) => (Array.isArray(v) ? v : []);
const realDate = (s) => {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const validTz = (tz) => {
  if (typeof tz !== 'string' || !tz || tz.length > 60) return false;
  try { new Intl.DateTimeFormat(undefined, { timeZone: tz }); return true; } catch { return false; }
};
const httpsOnly = (v) => {
  if (typeof v !== 'string') return '';
  try { const u = new URL(v.trim()); return u.protocol === 'https:' ? u.href.slice(0, 500) : ''; } catch { return ''; }
};

// ---------- validation ----------
/** -> {ok:true, plan} | {ok:false, error}. */
export function validatePlan(raw) {
  const bad = (error) => ({ ok: false, error });
  if (!isObj(raw)) return bad("that isn't a trip plan.");
  if (raw.v !== 1) return bad("this plan is a version this app can't read.");
  if (raw.kind !== 'home-life-plan') return bad("that isn't a home life trip plan.");
  if (typeof raw.id !== 'string' || !ID_RE.test(raw.id)) return bad('the plan needs an id of lowercase letters, numbers and dashes.');
  const title = str(raw.title, 140);
  if (!title) return bad('the plan needs a title.');
  if (!validTz(raw.tz)) return bad("the plan's time zone isn't one this browser knows.");
  try { if (JSON.stringify(raw).length > MAX_JSON) return bad('that plan is too big.'); } catch { return bad("that isn't a trip plan."); }
  if (!Array.isArray(raw.days) || raw.days.length < 1 || raw.days.length > 31) return bad('the plan needs 1 to 31 days.');

  const ids = new Set();
  const takeId = (id) => {
    if (typeof id !== 'string' || !ID_RE.test(id)) return false;
    if (ids.has(id)) return false;
    ids.add(id);
    return true;
  };
  const dates = new Set();
  const days = [];
  for (const d of raw.days) {
    if (!isObj(d) || !realDate(d.date)) return bad('every day needs a date like 2027-03-06.');
    if (dates.has(d.date)) return bad(`${d.date} appears twice.`);
    dates.add(d.date);
    const rawItems = arr(d.items);
    if (rawItems.length > 60) return bad(`${d.date} has more than 60 stops.`);
    const items = [];
    for (const it of rawItems) {
      if (!isObj(it)) return bad(`a stop on ${d.date} is malformed.`);
      if (!takeId(it.id)) return bad(`a stop on ${d.date} has a missing or repeated id.`);
      if (typeof it.time !== 'string' || !TIME_RE.test(it.time)) return bad(`stop ${it.id} needs a time like 09:00.`);
      const t = str(it.title, 140);
      if (!t) return bad(`stop ${it.id} needs a title.`);
      items.push({
        id: it.id, time: it.time, title: t, where: str(it.where), note: str(it.note, 700), who: str(it.who),
        tags: [...new Set(arr(it.tags).filter((x) => typeof x === 'string' && Object.hasOwn(TAGS, x)))],
        rides: arr(it.rides).map((x) => str(x, 60)).filter(Boolean).slice(0, 8),
        family: str(it.family),
      });
    }
    // Array.prototype.sort is stable, so equal times keep their written order
    items.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
    days.push({ date: d.date, title: str(d.title, 140), hours: str(d.hours), summary: str(d.summary), items, tips: arr(d.tips).map((x) => str(x)).filter(Boolean).slice(0, 20) });
  }
  days.sort((a, b) => (a.date < b.date ? -1 : 1));

  const checklist = [];
  for (const c of arr(raw.checklist).slice(0, 40)) {
    if (!isObj(c)) continue;
    const text = str(c.text);
    if (!text) continue;
    if (!takeId(c.id)) return bad('a checklist entry has a missing or repeated id.');
    checklist.push({ id: c.id, text, due: realDate(c.due) ? c.due : '' });
  }
  const heights = [];
  for (const h of arr(raw.heights).slice(0, 80)) {
    if (!isObj(h) || !str(h.ride)) continue;
    if (!Number.isInteger(h.min) || h.min < 0 || h.min > 60) continue;
    heights.push({ park: str(h.park, 80), ride: str(h.ride, 80), min: h.min, call: str(h.call) });
  }
  return {
    ok: true,
    plan: {
      v: 1, kind: 'home-life-plan', id: raw.id, title, tz: raw.tz, source: httpsOnly(raw.source), intro: str(raw.intro, 700),
      days, checklist, tips: arr(raw.tips).map((x) => str(x)).filter(Boolean).slice(0, 20), heights,
    },
  };
}
export const normalizePlan = (raw) => { const r = validatePlan(raw); return r.ok ? r.plan : null; };

// ---------- link payload ----------
function b64uEncode(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64uDecode(s) {
  const clean = s.replace(/=+$/, '');
  if (!/^[A-Za-z0-9_-]*$/.test(clean)) throw new Error('not base64url');
  const b64 = clean.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function pipe(bytes, stream, cap) {
  const writer = stream.writable.getWriter();
  writer.write(bytes).catch(() => {});
  writer.close().catch(() => {});
  const reader = stream.readable.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > cap) { reader.cancel().catch(() => {}); throw new Error('too big'); }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

/** Plan -> payload (without `#plan=`): `z.` deflate-raw when the browser can, else `j.` plain. */
export async function encodePlan(plan) {
  const bytes = new TextEncoder().encode(JSON.stringify(plan));
  if (typeof CompressionStream === 'function') {
    try { return `z.${b64uEncode(await pipe(bytes, new CompressionStream('deflate-raw'), MAX_ENCODED * 2))}`; } catch { /* fall back */ }
  }
  return `j.${b64uEncode(bytes)}`;
}

/** Payload -> {ok, plan} | {ok:false, error}. Accepts the payload with or without a leading `#plan=`. */
export async function decodePlan(payload) {
  const fail = (error) => ({ ok: false, error });
  let p = String(payload == null ? '' : payload).trim();
  if (p.startsWith(PLAN_PREFIX)) p = p.slice(PLAN_PREFIX.length);
  if (!p) return fail("that link doesn't have a plan in it.");
  if (p.length > MAX_ENCODED) return fail('that plan link is too big.');
  const kind = p.slice(0, 2);
  if (kind !== 'z.' && kind !== 'j.') return fail("that doesn't look like a trip plan link.");
  let text;
  try {
    let bytes = b64uDecode(p.slice(2));
    if (kind === 'z.') {
      if (typeof DecompressionStream !== 'function') return fail("this browser can't open compressed plan links.");
      bytes = await pipe(bytes, new DecompressionStream('deflate-raw'), MAX_JSON * 4);
    }
    if (bytes.length > MAX_JSON) return fail('that plan is too big.');
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch { return fail("couldn't read that plan link. it may be cut off."); }
  let raw;
  try { raw = JSON.parse(text); } catch { return fail("couldn't read that plan link. it may be cut off."); }
  const r = validatePlan(raw);
  return r.ok ? { ok: true, plan: r.plan } : fail(r.error);
}

/** What someone pastes in settings: a full link, a bare payload, or the plan's raw JSON. */
export async function parsePlanInput(text) {
  const t = String(text == null ? '' : text).trim();
  if (!t) return { ok: false, error: 'paste a plan link first.' };
  if (t.startsWith('{')) {
    if (t.length > MAX_JSON) return { ok: false, error: 'that plan is too big.' };
    let raw;
    try { raw = JSON.parse(t); } catch { return { ok: false, error: "that isn't valid plan json." }; }
    const r = validatePlan(raw);
    return r.ok ? { ok: true, plan: r.plan } : { ok: false, error: r.error };
  }
  const at = t.indexOf(PLAN_PREFIX);
  return decodePlan(at >= 0 ? t.slice(at + PLAN_PREFIX.length) : t);
}

// ---------- storage ----------
export function loadPlan() {
  const raw = getJSON(PLAN_KEY);
  return raw ? normalizePlan(raw) : null;
}
export const savePlan = (plan) => setJSON(PLAN_KEY, plan);
export function clearPlan(planId) {
  remove(PLAN_KEY);
  if (planId) remove(doneKey(planId));
}
export function loadDone(planId) {
  const d = planId ? getJSON(doneKey(planId)) : null;
  return isObj(d) ? d : {};
}
export const saveDone = (planId, done) => setJSON(doneKey(planId), done);
/** New done map with `id` ticked or unticked (unticked ids are dropped). */
export function setDone(done, id, on) {
  const next = { ...(isObj(done) ? done : {}) };
  if (on) next[id] = true; else delete next[id];
  return next;
}

// ---------- time ----------
/** "Now" as wall clock in the plan's zone: {date:'YYYY-MM-DD', minutes}. Independent of the device's zone. */
export function planNow(nowMs, tz) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(nowMs));
  const g = (t) => parts.find((x) => x.type === t).value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, minutes: (parseInt(g('hour'), 10) % 24) * 60 + parseInt(g('minute'), 10) };
}
const toMin = (hhmm) => parseInt(hhmm.slice(0, 2), 10) * 60 + parseInt(hhmm.slice(3, 5), 10);

/** "in 25 min", "in 1 h 10 min". */
export function inText(min) {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `in ${m} min`;
  return m % 60 ? `in ${Math.floor(m / 60)} h ${m % 60} min` : `in ${Math.floor(m / 60)} h`;
}

// ---------- live waits ----------
export function normName(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ')
    .replace(/['’‘"“”`]/g, '').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}
/** For each ride key, the shortest-named wait whose name contains it (single-rider lines skipped). -> [{name, minutes}] */
export function matchWaits(rides, waits) {
  const pool = arr(waits).filter((w) => w && w.name && Number.isFinite(w.minutes)).map((w) => ({ w, n: normName(w.name) })).filter((x) => !x.n.includes('single rider'));
  const out = [];
  for (const ride of arr(rides)) {
    const key = normName(ride);
    if (!key) continue;
    const hit = pool.filter((x) => x.n.includes(key)).sort((a, b) => a.n.length - b.n.length)[0];
    if (hit && !out.some((o) => o.name === hit.w.name)) out.push({ name: hit.w.name, minutes: hit.w.minutes });
  }
  return out;
}

// ---------- the card ----------
export const rowOf = (it, done, waits) => ({
  id: it.id, time: it.time, clock: fmtClock(`2000-01-01T${it.time}`), title: it.title, where: it.where, note: it.note, who: it.who, family: it.family,
  tags: it.tags.map((k) => ({ key: k, label: TAGS[k] })), done: !!(done && done[it.id]), waits: waits ? matchWaits(it.rides, waits) : [],
});
const dayOf = (d) => ({ date: d.date, title: d.title, hours: d.hours, summary: d.summary });
const todoFor = (plan, date, done) => plan.checklist.filter((c) => (!c.due || c.due <= date) && !done[c.id]);

/**
 * What the plan card shows right now, or null (hidden).
 * mode: 'today' (status before/during/after/empty), 'tomorrow', 'soon'. `evening` = the hero is showing tomorrow's edition.
 */
export function composePlan(plan, { nowMs = Date.now(), evening = false, waits = [], done = {} } = {}) {
  if (!plan || !Array.isArray(plan.days) || !plan.days.length) return null;
  const P = planNow(nowMs, plan.tz);
  const head = { id: plan.id, title: plan.title, source: plan.source };
  const today = plan.days.find((d) => d.date === P.date);
  const tomorrow = plan.days.find((d) => d.date === addDays(P.date, 1));
  const last = today && today.items.length ? toMin(today.items[today.items.length - 1].time) : -1;
  const tomorrowMode = () => {
    const items = tomorrow.items.map((it) => rowOf(it, done));
    return { mode: 'tomorrow', plan: head, day: dayOf(tomorrow), first: items[0] || null, todo: todoFor(plan, tomorrow.date, done), items: items.slice(0, 5), more: Math.max(0, items.length - 5) };
  };

  if (!today && tomorrow && evening) return tomorrowMode(); // the night before a plan day
  if (today) {
    const items = today.items;
    let cur = -1;
    items.forEach((it, i) => { if (toMin(it.time) <= P.minutes) cur = i; });
    const rows = items.map((it, i) => rowOf(it, done, i >= cur ? waits : null));
    const after = cur >= 0 && cur === items.length - 1 && P.minutes - last >= 30;
    const status = !items.length ? 'empty' : cur < 0 ? 'before' : after ? 'after' : 'during';
    if (tomorrow && (status === 'after' || status === 'empty') && (evening || P.minutes - last > 90)) return tomorrowMode();
    const nextRow = status === 'before' ? rows[0] : status === 'during' ? rows[cur + 1] || null : null;
    const nextIn = nextRow ? inText(toMin(nextRow.time) - P.minutes) : '';
    const tmrFirst = tomorrow && tomorrow.items[0];
    return {
      mode: 'today', status, plan: head, day: dayOf(today),
      current: status === 'during' ? rows[cur] : null,
      next: nextRow, nextIn,
      todo: todoFor(plan, P.date, done),
      earlier: status === 'after' ? rows : cur > 0 ? rows.slice(0, cur) : [],
      upcoming: status === 'after' ? [] : rows.slice(Math.max(cur, 0)),
      tomorrow: tomorrow ? { title: tomorrow.title, first: tmrFirst ? fmtClock(`2000-01-01T${tmrFirst.time}`) : '' } : null,
    };
  }
  const first = plan.days[0];
  const away = diffDays(first.date, P.date);
  if (away >= 1 && away <= 3) {
    return { mode: 'soon', plan: head, label: away === 1 ? 'starts tomorrow' : `starts in ${away} days`, day: dayOf(first), todo: todoFor(plan, first.date, done) };
  }
  return null;
}

/** "mar 6–8" for the plan's days. */
export const planRange = (plan) => fmtDateRange(plan.days[0].date, plan.days[plan.days.length - 1].date);
export const planStops = (plan) => plan.days.reduce((n, d) => n + d.items.length, 0);
