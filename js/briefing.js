// The morning rundown (bridge v3 `briefing`, a file the daily Claude run writes) and birthdays (`birthdays`).
// Pure: normalizers and view builders. Every field is optional; anything malformed is dropped, never shown raw.
import { addDays, diffDays, dowShort, dowLong, fmtMonthDay, fmtClock } from './time.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v, max = 200) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const arr = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
const strs = (v, max, len = 160) => arr(v, max).map((x) => str(x, len)).filter(Boolean);
const section = (v) => (v && typeof v === 'object' && !Array.isArray(v) && !v.error ? v : null);

/** "$1,234.56" (and "-$12.00"). Deterministic, no Intl. */
export function fmtMoney(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  const [int, dec] = Math.abs(n).toFixed(2).split('.');
  return `${n < 0 ? '-' : ''}$${int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${dec}`;
}

/** Only Spotify links open from the rundown. */
export function safeSpotify(u) {
  const s = String(u || '').trim();
  return /^(https:\/\/(open\.spotify\.com|spotify\.link)\/|spotify:)/i.test(s) && !/\s/.test(s) ? s : '';
}

/** Bridge `briefing` -> {ok, file, forDate, stale, data} | {ok:false, error} | null. Errors: disabled, not_found, too_big, bad_json, or a short message. */
export function normalizeBriefing(x) {
  if (!x || typeof x !== 'object') return null;
  if (!x.ok) return { ok: false, error: str(x.error, 80) || 'unavailable' };
  const d = x.data && typeof x.data === 'object' && !Array.isArray(x.data) ? x.data : null;
  if (!d) return { ok: false, error: 'bad_json' };
  const forDate = ISO_DATE.test(x.forDate || '') ? x.forDate : ISO_DATE.test(d.forDate || '') ? d.forDate : '';
  if (!forDate) return { ok: false, error: 'bad_json' };
  const money = section(d.money);
  const fantasy = section(d.fantasy);
  const playlist = section(d.playlist);
  const trip = section(d.trip);
  const dated = (list, max, keys) => arr(list, max).filter((r) => r && typeof r === 'object').map((r) => keys(r)).filter(Boolean);
  return {
    ok: true,
    file: str(x.file, 80),
    forDate,
    stale: !!x.stale,
    data: {
      generatedAt: typeof d.generatedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(d.generatedAt) ? d.generatedAt : '',
      note: str(d.note, 400),
      money: money ? {
        line: str(money.line, 140),
        billsDue: dated(money.billsDue, 6, (r) => (str(r.name, 40) && num(r.amount) != null ? { name: str(r.name, 40), amount: num(r.amount), date: ISO_DATE.test(r.date || '') ? r.date : '' } : null)),
        budget: money.budget && typeof money.budget === 'object' && num(money.budget.spent) != null && num(money.budget.budgeted) > 0
          ? { month: str(money.budget.month, 7), spent: num(money.budget.spent), budgeted: num(money.budget.budgeted), pctOfMonth: num(money.budget.pctOfMonth) } : null,
        overBudget: dated(money.overBudget, 4, (r) => (str(r.category, 40) && num(r.spent) != null && num(r.budgeted) != null ? { category: str(r.category, 40), spent: num(r.spent), budgeted: num(r.budgeted) } : null)),
        notable: dated(money.notable, 4, (r) => (str(r.merchant, 40) && num(r.amount) != null ? { merchant: str(r.merchant, 40), amount: num(r.amount), date: ISO_DATE.test(r.date || '') ? r.date : '' } : null)),
      } : null,
      fantasy: fantasy ? {
        line: str(fantasy.line, 140), gameDay: !!fantasy.gameDay, lockLocal: str(fantasy.lockLocal, 20), matchup: str(fantasy.matchup, 120),
        alerts: strs(fantasy.alerts, 4), swaps: strs(fantasy.swaps, 4), waivers: strs(fantasy.waivers, 4),
      } : null,
      playlist: playlist && str(playlist.name, 80) ? { name: str(playlist.name, 80), url: safeSpotify(playlist.url), why: str(playlist.why, 120) } : null,
      trip: trip ? { city: str(trip.city, 60), packing: strs(trip.packing, 8, 90), note: str(trip.note, 200) } : null,
    },
  };
}

/** "5:41am" from the run's own timestamp (its wall clock). */
export const runClock = (iso) => (iso ? fmtClock(iso.slice(0, 16)) : '');

/**
 * What the rundown card shows, or null when it's hidden (bridge failed, or older than yesterday).
 * {sub, stale, clock, note, money, fantasy, playlist}
 */
export function rundownView(b, today) {
  if (!b || !b.ok || !b.data || !today) return null;
  if (b.forDate < addDays(today, -1) || b.forDate > addDays(today, 1)) return null;
  const d = b.data;
  const stale = b.forDate < today;
  const clock = runClock(d.generatedAt);
  const sub = [clock ? `from claude at ${clock}` : 'from claude', stale ? 'from yesterday' : ''].filter(Boolean).join(' · ');
  const m = d.money;
  const money = m && (m.line || m.billsDue.length || m.budget || m.overBudget.length || m.notable.length) ? {
    line: m.line,
    bills: m.billsDue.map((x) => ({ text: [x.name.toLowerCase(), fmtMoney(x.amount), x.date ? dowShort(x.date) : ''].filter(Boolean).join(' · ') })),
    budget: m.budget ? budgetPace(m.budget) : null,
    over: m.overBudget.map((x) => `${x.category.toLowerCase()} · ${fmtMoney(x.spent)} of ${fmtMoney(x.budgeted)}`),
    notable: m.notable.map((x) => [x.merchant.toLowerCase(), fmtMoney(x.amount), x.date ? dowShort(x.date) : ''].filter(Boolean).join(' · ')),
  } : null;
  const f = d.fantasy;
  const fantasy = f && (f.gameDay || f.waivers.length) ? { line: f.line, alerts: f.alerts, swaps: f.swaps, waivers: f.waivers } : null;
  const playlist = d.playlist ? { name: d.playlist.name, why: d.playlist.why, url: d.playlist.url } : null;
  if (!d.note && !money && !fantasy && !playlist) return null;
  return { sub, stale, clock, note: d.note, money, fantasy, playlist };
}

/** Budget pace: how much of the budget is spent vs how far through the month. */
export function budgetPace(b) {
  const spent = b.spent / b.budgeted;
  const month = b.pctOfMonth != null ? Math.max(0, Math.min(1, b.pctOfMonth)) : null;
  let status = 'on pace';
  if (spent > 1) status = 'over budget';
  else if (month != null && spent - month > 0.05) status = 'ahead of pace';
  else if (month != null && month - spent > 0.05) status = 'under pace';
  return {
    spentPct: Math.round(spent * 100),
    fill: Math.max(0, Math.min(1, spent)),
    marker: month,
    status,
    text: `${fmtMoney(b.spent)} of ${fmtMoney(b.budgeted)}${month != null ? ` · ${Math.round(month * 100)}% through the month` : ''}`,
  };
}

// ---------------------------------------------------------------- birthdays

/** Bridge `birthdays` -> {ok, upcoming:[{name, date, daysAway, turning}]} | {ok:false, error} | null. */
export function normalizeBirthdays(x) {
  if (!x || typeof x !== 'object') return null;
  if (!x.ok) return { ok: false, error: str(x.error, 80) || 'unavailable' };
  return {
    ok: true,
    upcoming: arr(x.upcoming, 30).filter((p) => p && str(p.name, 60) && ISO_DATE.test(p.date || '')).map((p) => ({
      name: str(p.name, 60), date: p.date, daysAway: num(p.daysAway), turning: num(p.turning) != null && p.turning > 0 && p.turning < 130 ? Math.round(p.turning) : null,
    })),
  };
}

const firstName = (name) => String(name).trim().split(/\s+/)[0].toLowerCase();
const possessive = (n) => `${n}'s`;

/** Gift rows for Your day: within `within` days of `today` (recomputed from the date), soonest first. */
export function birthdayLines(b, today, within = 14) {
  if (!b || !b.ok || !today) return [];
  return b.upcoming.map((p) => ({ p, days: diffDays(p.date, today) })).filter((x) => x.days >= 0 && x.days <= within)
    .sort((a, b2) => a.days - b2.days || a.p.name.localeCompare(b2.p.name))
    .map(({ p, days }) => {
      const who = possessive(firstName(p.name));
      const turning = p.turning ? ` · turning ${p.turning}` : '';
      if (days === 0) return { date: p.date, days, text: `today: ${who} birthday${turning}` };
      const when = days === 1 ? 'tomorrow' : days <= 6 ? dowLong(p.date) : `${dowShort(p.date)}, ${fmtMonthDay(p.date)}`;
      return { date: p.date, days, text: `${who} birthday ${when}${turning}` };
    });
}

/** Evening chip: "tomorrow is pat's birthday" ('' when nobody). */
export function birthdayTomorrow(b, today) {
  if (!b || !b.ok || !today) return '';
  const names = b.upcoming.filter((p) => p.date === addDays(today, 1)).map((p) => possessive(firstName(p.name)));
  if (!names.length) return '';
  return `tomorrow is ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`} birthday`;
}
