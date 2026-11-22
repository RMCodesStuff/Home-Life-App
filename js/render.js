// DOM rendering for every card. Takes a prepared `view` (see app.js buildView) and writes HTML.
import { icon, weatherIcon } from './icons.js';
import {
  datePart, hourKey, hourOf, addDays, addHours, dowShort, fmtDateLong, fmtMonthDay, fmtHourShort, fmtClock, toLocal, minutesOfDay, fmtDuration, relTime,
} from './time.js';
import { dayByDate, hoursBetween, nightLow } from './weather.js';
import { modelForDate } from './insights.js';
import { yourDay } from './calendar.js';
import { workoutTitle, workoutDetail, windowLine } from './workout.js';
import { osmTile, radarTile } from './phoenix.js';
import { LINKS } from './connections.js';
import { planCardHTML } from './planui.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** Escape, then turn *one phrase* into <em>. */
export const prose = (s) => esc(s).replace(/\*([^*]+)\*/g, '<em>$1</em>');
const r = (v) => (v == null ? '—' : Math.round(v));
const deg = (v) => (v == null ? '—' : `${Math.round(v)}°`);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Wall-clock time at the place with `offset` for an epoch ms. */
export function clockAt(ms, offset) {
  if (!ms) return '';
  return fmtClock(toLocal(new Date(ms).toISOString(), offset));
}

// ---------- temperature colors for range bars (°F stops) ----------
const STOPS = [[30, [0x86, 0xae, 0xe0]], [50, [0xa9, 0xb8, 0xc4]], [65, [0xd9, 0xa5, 0x8a]], [85, [0xe0, 0x7a, 0x52]], [100, [0xd6, 0x5a, 0x3a]]];
export function tempColor(f) {
  if (f <= STOPS[0][0]) return rgb(STOPS[0][1]);
  for (let i = 1; i < STOPS.length; i++) {
    if (f <= STOPS[i][0]) {
      const [a, ca] = STOPS[i - 1]; const [b, cb] = STOPS[i];
      const t = (f - a) / (b - a);
      return rgb(ca.map((v, k) => Math.round(v + (cb[k] - v) * t)));
    }
  }
  return rgb(STOPS[STOPS.length - 1][1]);
}
const rgb = (c) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

// ---------- last night (oura) ----------
const signed = (n, unit = '') => `${n > 0 ? '+' : '\u2212'}${Math.abs(Math.round(n))}${unit}`;
/** Three stats and a note, only when the bridge returned Oura data (view.ctx.oura is null otherwise). */
export function lastNightHTML(view) {
  const o = view.ctx.oura;
  if (!o) return '';
  const wk = o.week || {};
  const slept = o.sleep && o.sleep.totalSec;
  const sleepScore = o.sleep && o.sleep.score;
  const ready = o.readiness && o.readiness.score;
  const delta = (v, avg, unit = '', scale = 1) => {
    if (v == null || avg == null) return '';
    const d = Math.round((v - avg) / scale);
    return d ? `<span class="ln-d">${signed(d, unit)}</span>` : '';
  };
  const stat = (label, value, d) => `<div class="ln-stat"><span class="ln-l">${label}</span><span class="ln-v">${value}</span>${d || ''}</div>`;
  if (slept == null && sleepScore == null && ready == null) return '';
  const note = view.written.body_note;
  return `<div class="lastnight" aria-label="last night, from oura">
    <p class="ln-head">${icon('moon-sleep', { size: 15 })}<span>last night</span></p>
    <div class="ln-stats">
      ${stat('slept', slept != null ? esc(fmtDuration(slept)) : '—', delta(slept, wk.totalSecAvg, 'm', 60))}
      ${stat('sleep', sleepScore != null ? Math.round(sleepScore) : '—', delta(sleepScore, wk.sleepScoreAvg))}
      ${stat('readiness', ready != null ? Math.round(ready) : '—', delta(ready, wk.readinessAvg))}
    </div>
    ${note ? `<p class="ln-note${view.fade ? ' fade-in' : ''}">${esc(note)}</p>` : ''}
  </div>`;
}

// ---------- hero ----------
const chipHTML = (c) => `<li class="chip${c.accent ? ' chip-accent' : ''}">${icon(c.icon || 'calendar', { size: 16 })}<b>${esc(c.label)}</b><span>${esc(c.text)}</span></li>`;
/** Footer buttons: read it to me (when the browser can) and refresh. */
function footButtons(view) {
  const speak = view.canSpeak && view.settings.show.speak !== false
    ? `<button class="icon-btn speak${view.speaking ? ' on' : ''}" type="button" data-action="speak" aria-pressed="${view.speaking ? 'true' : 'false'}" aria-label="${view.speaking ? 'stop reading' : 'read it to me'}">${icon(view.speaking ? 'stop' : 'speaker', { size: 18 })}</button>` : '';
  return `<span class="foot-btns">${speak}<button class="icon-btn refresh${view.loading ? ' spinning' : ''}" type="button" data-action="refresh" aria-label="refresh">${icon('refresh', { size: 18 })}</button></span>`;
}
const rundownFoot = (view) => (view.home && view.home.rundown && view.home.rundown.clock ? [`rundown by claude ${esc(view.home.rundown.clock)}`] : []);

export function heroHTML(view) {
  const { status } = view;
  if (status === 'onboarding') {
    return `
      <div class="eyebrow"><span class="eb-icon">${icon('sun', { size: 16 })}</span><span class="eb-text">home life</span>
        <button class="icon-btn gear" type="button" data-action="open-settings" aria-label="settings">${icon('gear', { size: 20 })}</button></div>
      <h1 class="hello">Good morning.</h1>
      <p class="hello-sub">tell me where home is and i'll read the sky for you every morning, and line it up with your day.</p>
      <div class="picker" id="ob-picker"></div>`;
  }
  const s = view.settings;
  const homeName = (s.home && s.home.name || '').toLowerCase();
  if (status === 'loading') {
    return `
      <div class="eyebrow"><span class="eb-icon">${icon('sun', { size: 16 })}</span><span class="eb-text">${esc(s.homeLabel || 'home')}, ${esc(homeName)}</span>
        <button class="icon-btn gear" type="button" data-action="open-settings" aria-label="settings">${icon('gear', { size: 20 })}</button></div>
      <div class="skeleton" aria-hidden="true"><div class="sk t"></div><div class="sk h"></div><div class="sk s"></div><div class="sk"></div><div class="sk xs"></div></div>
      <p class="reading">reading the sky over ${esc(homeName)}…</p>`;
  }
  if (status === 'error') {
    return `
      <div class="eyebrow"><span class="eb-icon">${icon('sun', { size: 16 })}</span><span class="eb-text">${esc(s.homeLabel || 'home')}, ${esc(homeName)}</span>
        <button class="icon-btn gear" type="button" data-action="open-settings" aria-label="settings">${icon('gear', { size: 20 })}</button></div>
      <div class="err-box"><p>couldn't reach the forecast for ${esc(homeName)}. ${esc(view.wxErrorText || 'check your connection.')}</p>
      <button class="btn btn-accent" type="button" data-action="retry">${icon('refresh', { size: 16 })} try again</button></div>`;
  }

  if (view.tomorrow) return tomorrowHeroHTML(view);
  const { ctx, written: w } = view;
  const m = ctx.model;
  const today = datePart(ctx.now);
  const d = dayByDate(m, today) || {};
  const isDay = m.current.isDay !== 0;
  const away = view.awayToday;
  const placeText = away ? `away, ${esc(m.place.name.toLowerCase())}` : `${esc(s.homeLabel || 'home')}, ${esc(homeName)}`;
  const unit = ctx.units === 'metric' ? '°C' : '°F';
  const travel = (view.travelLine ? `<p class="travel">${esc(view.travelLine)}</p>`
    : view.calendarConnected
      ? (view.calErrorText && !view.hasCalendarData ? '<p class="travel"><button class="text-btn" type="button" data-action="open-settings-calendar">your calendar link needs attention</button></p>' : '')
      : '<p class="travel"><button class="text-btn" type="button" data-action="open-settings-calendar">connect your calendar for travel &amp; your day</button></p>')
    + (view.evening ? '<p class="travel"><button class="text-btn" type="button" data-action="show-tomorrow">tomorrow\'s edition</button></p>' : '');
  const alerts = (m.alerts || []).slice(0, 3).map((a) => {
    let until = '';
    if (a.ends) {
      const loc = toLocal(a.ends, m.offset);
      if (loc) until = ` until ${datePart(loc) === today ? fmtClock(loc) : `${dowShort(datePart(loc))} ${fmtClock(loc)}`}`;
    }
    return `<details class="alert"${view.alertOpen ? ' open' : ''}><summary>${icon('alert', { size: 18 })}<span>${esc(a.event.toLowerCase())}${esc(until)}</span><span class="more">details</span></summary>
      <div class="alert-body">${esc(a.headline ? `${a.headline}\n\n` : '')}${esc(a.description)}</div></details>`;
  }).join('');
  const fade = view.fade ? ' fade-in' : '';
  const footParts = [];
  footParts.push(view.wxStale ? `<span class="warn">offline · showing ${esc(clockAt(view.wxFetchedAt, m.offset))}</span>` : `updated ${esc(clockAt(view.wxFetchedAt, m.offset))}`);
  footParts.push(view.writtenBy === 'claude' ? 'written by claude' : 'written on-device');
  footParts.push(...rundownFoot(view));
  if (view.aiNote) footParts.push(`<span class="warn">${esc(view.aiNote)}</span>`);
  const extra = view.home ? view.home.chipsToday : [];

  return `
    <div class="eyebrow">
      <span class="eb-icon">${icon(isDay ? 'sun' : 'moon', { size: 16 })}</span>
      <span class="eb-text">${esc(fmtDateLong(today))}<span class="dot">·</span>${placeText}</span>
      <button class="icon-btn gear" type="button" data-action="open-settings" aria-label="settings">${icon('gear', { size: 20 })}</button>
    </div>
    ${travel}
    <div class="bigtemp" aria-label="${r(m.current.temp)} degrees">${r(m.current.temp)}<span class="deg">${unit}</span></div>
    <div class="cond-row">
      <span class="big-icon">${weatherIcon(m.current.code, m.current.isDay, { size: 56 })}</span>
      <div><p class="cond${fade}">${esc(w.condition)}</p>
      <p class="cond-sub">feels ${deg(m.current.feels)} · high ${deg(d.high)} · low ${deg(d.low)}</p></div>
    </div>
    ${lastNightHTML(view)}
    ${alerts}
    <h1 class="headline${fade}">${esc(w.headline_lead)} <em>${esc(w.headline_accent)}</em></h1>
    <p class="narrative${fade}">${prose(w.narrative)}</p>
    <ul class="chips${fade}">
      <li class="chip">${icon('umbrella', { size: 16 })}<b>umbrella</b><span>${esc(w.umbrella)}</span></li>
      <li class="chip">${icon('shirt', { size: 16 })}<b>wear</b><span>${esc(w.wear)}</span></li>
      ${w.leave_chip ? `<li class="chip">${icon('car', { size: 16 })}<b>leave</b><span>${esc(w.leave_chip.replace(/^leave\s+/, ''))}</span></li>` : ''}
      ${extra.filter((c) => c.after === 'leave').map(chipHTML).join('')}
      <li class="chip chip-accent">${icon('sunwindow', { size: 16 })}<b>best window</b><span>${esc(w.best_window)}</span></li>
      ${w.inbox_chip ? `<li class="chip">${icon('inbox', { size: 16 })}<b>inbox</b><span>${esc(w.inbox_chip)}</span></li>` : ''}
      ${extra.filter((c) => c.after !== 'leave').map(chipHTML).join('')}
    </ul>
    <div class="hero-foot">
      <span>${footParts.join(' · ')}</span>
      ${footButtons(view)}
    </div>`;
}

// ---------- the rundown (the daily claude run) ----------
export function rundownHTML(view) {
  const r0 = view.home && view.home.rundown;
  if (!r0) return '';
  const rows = (list) => (list.length ? `<ul class="rd-rows">${list.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '');
  const m = r0.money;
  const b = m && m.budget;
  const money = m ? `<div class="rd-sec"><h3 class="rd-h">Money</h3>
      ${m.line ? `<p class="rd-line">${esc(m.line)}</p>` : ''}
      ${m.bills.length ? `<p class="rd-label">bills due</p>${rows(m.bills.map((x) => x.text))}` : ''}
      ${b ? `<div class="rd-budget" role="img" aria-label="${esc(`${b.spentPct}% of the budget spent, ${b.status}`)}">
        <div class="rd-bar"><span class="rd-fill${b.status === 'over budget' ? ' over' : ''}" style="width:${(b.fill * 100).toFixed(1)}%"></span>${b.marker != null ? `<span class="rd-mark" style="left:${(b.marker * 100).toFixed(1)}%"></span>` : ''}</div>
        <p class="rd-bud">${esc(b.text)} · <span class="${b.status === 'on pace' || b.status === 'under pace' ? '' : 'warn'}">${esc(b.status)}</span></p></div>` : ''}
      ${m.over.length ? `<p class="rd-label">over budget</p>${rows(m.over)}` : ''}
      ${m.notable.length ? `<p class="rd-label">notable</p>${rows(m.notable)}` : ''}
    </div>` : '';
  const f = r0.fantasy;
  const fantasy = f ? `<div class="rd-sec"><h3 class="rd-h">Fantasy</h3>
      ${f.line ? `<p class="rd-line">${esc(f.line)}</p>` : ''}${rows([...f.alerts, ...f.swaps, ...f.waivers])}</div>` : '';
  const pl = r0.playlist;
  const playlist = pl ? `<div class="rd-sec"><h3 class="rd-h">Playlist</h3>
      <p class="rd-pl">${esc(pl.name)}</p>${pl.why ? `<p class="rd-line">${esc(pl.why)}</p>` : ''}
      ${pl.url ? `<a class="btn btn-accent rd-btn" href="${esc(pl.url)}" target="_blank" rel="noopener">${icon('speaker', { size: 16 })} open in spotify</a>` : ''}</div>` : '';
  return `<div class="card-head"><h2>The rundown</h2><p class="sub">${esc(r0.sub)}</p></div>
    <hr class="rule">
    ${r0.note ? `<p class="rd-note">${esc(r0.note)}</p>` : ''}
    ${money}${fantasy}${playlist}`;
}

// ---------- tomorrow's edition (evening mode) ----------
const TOMORROW_ICONS = { first: 'calendar', wear: 'shirt', umbrella: 'umbrella', tonight: 'moon' };
export function tomorrowHeroHTML(view) {
  const { ctx } = view;
  const t = view.tomorrow;
  const m = ctx.model;
  const unit = ctx.units === 'metric' ? '°C' : '°F';
  const fade = view.fade ? ' fade-in' : '';
  const lines = [
    view.travelLineTarget ? `<p class="travel">${esc(view.travelLineTarget)}</p>` : '',
    `<p class="travel"><button class="text-btn" type="button" data-action="show-today">now ${r(m.current.temp)}° · show today</button></p>`,
  ].join('');
  const chips = [...t.chips.map((c) => ({ ...c, icon: TOMORROW_ICONS[c.key] })), ...(view.home ? view.home.chipsTomorrow : [])].map(chipHTML).join('');
  const foot = [view.wxStale ? `<span class="warn">offline · showing ${esc(clockAt(view.wxFetchedAt, m.offset))}</span>` : `updated ${esc(clockAt(view.wxFetchedAt, m.offset))}`, 'written on-device', ...rundownFoot(view)];
  return `
    <div class="eyebrow">
      <span class="eb-icon">${icon('moon', { size: 16 })}</span>
      <span class="eb-text"><span>tomorrow</span><span class="dot">·</span><span>${esc(fmtDateLong(t.date))}</span></span>
      <button class="icon-btn gear" type="button" data-action="open-settings" aria-label="settings">${icon('gear', { size: 20 })}</button>
    </div>
    ${lines}
    <div class="bigtemp" aria-label="tomorrow's high ${r(t.high)} degrees">${r(t.high)}<span class="deg stack">${unit}<span class="bt-label">high</span></span></div>
    <div class="cond-row">
      <span class="big-icon">${weatherIcon(t.code, 1, { size: 56 })}</span>
      <div><p class="cond${fade}">${esc(t.condition)}</p>
      <p class="cond-sub">low ${deg(t.low)}${t.sunrise ? ` · sunrise ${esc(fmtClock(t.sunrise))}` : ''}</p></div>
    </div>
    <h1 class="headline${fade}">${esc(t.headline_lead)} <em>${esc(t.headline_accent)}</em></h1>
    <p class="narrative${fade}">${prose(t.narrative)}</p>
    <ul class="chips${fade}">${chips}</ul>
    <div class="hero-foot">
      <span>${foot.join(' · ')}</span>
      ${footButtons(view)}
    </div>`;
}

// ---------- trip prep & park day (top of the second card) ----------
const checkRow = (tripId, it) => `<li><label class="check"><input type="checkbox" data-trip="${esc(tripId)}" data-check="${esc(it.key)}"${it.done ? ' checked' : ''}><span>${esc(it.text)}</span></label></li>`;
export function tripPrepHTML(view) {
  const p = view.trip && view.trip.prep;
  if (!p) return '';
  const when = p.departsIn === 0 ? 'leaving today' : p.departsIn === 1 ? 'leaving tomorrow' : `leaving in ${p.departsIn} days`;
  return `<div class="topsec tripprep">
    <div class="card-head"><h2>Trip prep</h2><p class="sub">${esc(p.sub)} · ${when}</p></div>
    ${p.drive ? `<p class="tp-line">${icon('car', { size: 16 })}<span>${esc(p.drive)}</span></p>` : ''}
    ${p.conflicts.map((c) => `<p class="tp-line tp-conflict">${icon('alert', { size: 16 })}<span>${esc(c)}</span></p>`).join('')}
    <div class="tp-cols">
      ${p.packing.length ? `<div class="tp-col"><p class="tp-label">pack</p><ul class="checks">${p.packing.map((it) => checkRow(p.trip.id, it)).join('')}</ul></div>` : ''}
      <div class="tp-col"><p class="tp-label">before you go</p><ul class="checks">${p.todo.map((it) => checkRow(p.trip.id, it)).join('')}</ul></div>
    </div>
    ${p.needsUpdate ? '<p class="cal-note"><button class="text-btn muted" type="button" data-action="open-settings-calendar">update your google script for park hours and the drive time</button></p>' : ''}
  </div>`;
}
export function parkDayHTML(view) {
  const parks = view.trip ? view.trip.park : [];
  if (!parks.length) return '';
  const today = datePart(view.ctx.now);
  const when = parks[0].date === today ? 'today' : 'tomorrow';
  const blocks = parks.map((p) => `<div class="pd">
      <h2 class="pd-name">${esc(p.name)}</h2>
      <p class="pd-hours">${esc(p.hours || 'hours not posted yet')}</p>
      ${p.shows.length ? `<ul class="pd-shows">${p.shows.map((s) => { const i = s.lastIndexOf(' · '); return `<li>${i > 0 ? `${esc(s.slice(0, i))} · <span class="nw">${esc(s.slice(i + 3))}</span>` : esc(s)}</li>`; }).join('')}</ul>` : ''}
      ${p.waits.length ? `<p class="tp-label">waits right now</p><ul class="pd-waits">${p.waits.map((w) => `<li><span class="pw-name">${esc(w.name)}</span><span class="pw-min">${w.minutes} min</span></li>`).join('')}</ul>` : ''}
      ${p.layer ? `<p class="tp-line">${icon('shirt', { size: 16 })}<span>${esc(p.layer)}</span></p>` : ''}
    </div>`).join('');
  return `<div class="topsec parkday">
    <p class="top-eyebrow">${icon('ferris', { size: 16 })}<span>park day · ${when}</span></p>
    ${blocks}
    <p class="pd-credit">park data from <a href="https://themeparks.wiki" target="_blank" rel="noopener">themeparks.wiki</a></p>
  </div>`;
}
/** Park day replaces trip prep. */
export function topHTML(view) {
  const html = parkDayHTML(view) || tripPrepHTML(view);
  return html ? `${html}<hr class="rule top-rule">` : '';
}

// ---------- hour by hour ----------
const COL = 64;
function smoothPath(pts) {
  if (pts.length < 2) return pts.length ? `M${pts[0][0]} ${pts[0][1]}` : '';
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i]; const p1 = pts[i]; const p2 = pts[i + 1]; const p3 = pts[i + 2] || p2;
    const lo = Math.min(p1[1], p2[1]); const hi = Math.max(p1[1], p2[1]);
    const c1y = Math.min(hi, Math.max(lo, p1[1] + (p2[1] - p0[1]) / 6));
    const c2y = Math.min(hi, Math.max(lo, p2[1] - (p3[1] - p1[1]) / 6));
    d += `C${(p1[0] + COL / 3).toFixed(1)} ${c1y.toFixed(1)} ${(p2[0] - COL / 3).toFixed(1)} ${c2y.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

export function hourlyHTML(view) {
  const { ctx } = view;
  const m = ctx.model;
  const nowH = hourKey(ctx.now);
  const hours = hoursBetween(m, nowH, addHours(nowH, 24)).filter((h) => h.temp != null);
  const n = hours.length;
  const W = n * COL; const H = 112; const top = 32; const bottom = 12;
  const temps = hours.map((h) => h.temp);
  const max = Math.max(...temps); const min = Math.min(...temps);
  const y = (t) => (max === min ? (top + H - bottom) / 2 : top + ((max - t) / (max - min)) * (H - top - bottom));
  const pts = hours.map((h, i) => [i * COL + COL / 2, y(h.temp)]);
  const line = smoothPath(pts);
  const area = n ? `${line}L${pts[n - 1][0]} ${H}L${pts[0][0]} ${H}Z` : '';
  // night shading
  let night = '';
  hours.forEach((h, i) => {
    if (h.isDay === 0) {
      const first = i === 0 || hours[i - 1].isDay !== 0; const last = i === n - 1 || hours[i + 1].isDay !== 0;
      night += `<span class="hnight${first ? ' first' : ''}${last ? ' last' : ''}" style="left:${i * COL}px"></span>`;
    }
  });
  // sunrise / sunset markers
  const sunMarks = new Map();
  for (const day of m.days) {
    if (day.sunrise) sunMarks.set(hourKey(day.sunrise), `sunrise ${fmtClock(day.sunrise).replace(/(am|pm)$/, '')}`);
    if (day.sunset) sunMarks.set(hourKey(day.sunset), `sunset ${fmtClock(day.sunset).replace(/(am|pm)$/, '')}`);
  }
  const cols = `grid-template-columns: repeat(${n}, ${COL}px)`;
  const grad = 'hgrad';
  const svg = `
    <svg class="hchart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">
      <defs><linearGradient id="${grad}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="area-top"/><stop offset="1" class="area-bot"/></linearGradient></defs>
      <path d="${area}" fill="url(#${grad})"/>
      <path class="line" d="${line}"/>
      ${pts.map(([x, yy], i) => `<circle class="pt" cx="${x}" cy="${yy.toFixed(1)}" r="3.5"/><text class="tl" x="${x}" y="${(yy - 11).toFixed(1)}">${Math.round(temps[i])}°</text>`).join('')}
    </svg>`;
  const iconsRow = hours.map((h) => `<span>${weatherIcon(h.code, h.isDay, { size: 22 })}</span>`).join('');
  const rainRow = hours.map((h) => `<span class="${(h.precipProb ?? 0) >= 10 ? 'wet' : ''}">${h.precipProb ?? 0}%</span>`).join('');
  const labelRow = hours.map((h, i) => `<span class="${i === 0 ? 'now' : ''}">${fmtHourShort(hourOf(h.time))}</span>`).join('');
  const sunRow = hours.map((h) => `<span>${esc(sunMarks.get(h.time) || '')}</span>`).join('');
  const waiting = waitingHTML(view);
  const sr = `${hours.map((h) => `${fmtHourShort(hourOf(h.time))} ${Math.round(h.temp)} degrees, ${h.precipProb ?? 0}% rain`).join('; ')}`;
  return `
    ${topHTML(view)}
    <div class="card-head"><h2>Hour by hour</h2>
      <p class="sub">open-meteo hourly, ${esc(m.place.name.toLowerCase())}, updated ${esc(clockAt(view.wxFetchedAt, m.offset))}</p></div>
    <hr class="rule">
    <div class="hstrip" tabindex="0" role="group" aria-label="next 24 hours, scroll sideways">
      <p class="vh">${esc(sr)}</p>
      <div class="hinner" style="width:${W}px">
        ${night}
        ${svg}
        <div class="hrow hicons" style="${cols}">${iconsRow}</div>
        <div class="hrow hrain" style="${cols}">${rainRow}</div>
        <div class="hrow hlabels" style="${cols}">${labelRow}</div>
        <div class="hrow hsun" style="${cols}">${sunRow}</div>
      </div>
    </div>
    <p class="foot-note">blue figures are the chance of rain each hour. scroll for more.</p>
    ${radarHTML(view)}
    <div class="yourday">${yourDayHTML(view)}</div>
    ${workoutHTML(view)}
    ${waiting ? `<div class="waiting">${waiting}</div>` : ''}`;
}

// ---------- radar strip ----------
export function radarHTML(view) {
  const rd = view.radar;
  if (!rd || !rd.grid || !rd.frame) return '';
  const { z, tiles, fx, fy } = rd.grid;
  const cell = (t) => `<img class="rt" alt="" loading="lazy" decoding="async" referrerpolicy="strict-origin-when-cross-origin" style="grid-column:${t.col + 1};grid-row:${t.row + 1}" src="${esc(osmTile(t, z))}">`
    + `<img class="rr" alt="" loading="lazy" decoding="async" style="grid-column:${t.col + 1};grid-row:${t.row + 1}" src="${esc(radarTile(rd.frame, t, z))}">`;
  return `<div class="radar" role="img" aria-label="rain radar around ${esc(view.ctx.model.place.name.toLowerCase())}">
      <div class="radar-frame"><div class="radar-grid">${tiles.map(cell).join('')}<span class="radar-dot" style="left:${(((1 + fx) / 3) * 100).toFixed(2)}%;top:${(((1 + fy) / 3) * 100).toFixed(2)}%"></span></div></div>
      <p class="radar-credit">radar${rd.ago ? ` ${esc(rd.ago)}` : ''} · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> · <a href="https://www.rainviewer.com/" target="_blank" rel="noopener">weather data by RainViewer</a></p>
    </div>`;
}

// ---------- today's workout (rack timer) ----------
export function workoutHTML(view) {
  const p = view.home && view.home.workout;
  if (!p) return '';
  const ahead = view.target && view.target !== datePart(view.ctx.now);
  const title = workoutTitle(p);
  const detail = workoutDetail(p);
  const win = windowLine(p);
  const button = p.state === 'propose' || p.state === 'resume'
    ? `<a class="btn btn-accent wo-btn" href="${esc(p.link)}">${icon('dumbbell', { size: 16 })} ${p.state === 'resume' ? 'resume in rack timer' : 'start in rack timer'}</a>` : '';
  return `<div class="workout">
    <div class="sec-head"><h2>${ahead ? "Tomorrow's workout" : "Today's workout"}</h2><span class="sub-right">${view.home.workoutSource ? esc(view.home.workoutSource) : 'rack timer'}</span></div>
    ${title && p.state !== 'done' && p.state !== 'rest' ? `<p class="wo-title">${esc(title)}</p>` : ''}
    ${detail ? `<p class="wo-line wo-detail">${detail.split(' · ').map((x) => `<span class="nw">${esc(x)}</span>`).join(' · ')}</p>` : ''}
    ${win ? `<p class="wo-line">${icon('sunwindow', { size: 16 })}<span>${esc(win)}</span></p>` : ''}
    ${p.why.length ? `<p class="wo-why">${esc(p.why.join(' · '))}</p>` : ''}
    ${button}
  </div>`;
}

// ---------- your day ----------
function firstSegment(loc) {
  return String(loc || '').split(',')[0].trim();
}
function eventRow(view, ev, isNext, notes, extra) {
  const now = view.ctx.now;
  const ongoing = ev.ls <= now && ev.le > now;
  const m = modelForDate(view.ctx, ev.date);
  const h = m.hours.find((x) => x.time === hourKey(ev.ls));
  const note = notes.get(ev.id);
  const leave = extra.leaves.get(ev.id);
  const tag = view.tags ? view.tags.get(ev.calendar) : null;
  const loc = /^https?:|zoom\.us|meet\.google|teams\.microsoft|webex/i.test(ev.location) ? '' : firstSegment(ev.location);
  return `<li class="ev${isNext ? ' next' : ''}${ongoing ? ' now' : ''}">
    <div class="ev-time"><span class="t">${ongoing ? 'now' : esc(fmtClock(ev.ls))}</span><span class="d">${esc(dowShort(ev.date))}</span></div>
    <span class="ev-dot" aria-hidden="true"></span>
    <div class="ev-body"><p class="ev-title">${esc(ev.title)}${tag ? ` <span class="ev-tag c-${esc(tag.color)}"><i aria-hidden="true"></i>${esc(tag.label)}</span>` : ''}</p>${loc ? `<p class="ev-loc">${esc(loc)}</p>` : ''}
    ${note ? `<p class="ev-wx${view.fade ? ' fade-in' : ''}">${h ? weatherIcon(h.code, h.isDay, { size: 16 }) : ''}<span>${esc(note)}</span></p>` : ''}
    ${leave ? `<p class="ev-leave${extra.nextLeaveId === ev.id ? ' soon' : ''}">${icon('car', { size: 16 })}<span>${esc(leave)}</span></p>` : ''}</div>
  </li>`;
}

/** Dinner from the meal plan, at the end of Your day. */
export function dinnerHTML(view) {
  const d = view.home && view.home.dinner;
  if (!d) return '';
  const m = d.meals;
  const more = [m.breakfast ? `breakfast · ${m.breakfast.name.toLowerCase()}` : '', m.lunch ? `lunch · ${m.lunch.name.toLowerCase()}` : ''].filter(Boolean).join('  ·  ');
  return `<div class="dinner">
    <p class="tp-line dn-main">${icon('fork', { size: 16 })}<span><b>dinner</b> · ${esc(m.dinner ? m.dinner.name.toLowerCase() : 'nothing planned yet')}</span></p>
    ${more ? `<p class="dn-more">${esc(more)}</p>` : ''}
    ${d.eatBy ? `<p class="dn-more dn-eat">${esc(d.eatBy)}</p>` : ''}
    <a class="text-btn dn-link" href="${esc(LINKS.mealPlan)}" target="_blank" rel="noopener">open meal plan</a>
  </div>`;
}
/** Lines at the top of Your day: birthdays, then kid-friendly heat tips. */
function dayTopHTML(view) {
  const h = view.home;
  if (!h) return '';
  return [
    ...h.birthdays.map((t) => `<p class="tp-line yd-line">${icon('gift', { size: 16 })}<span>${esc(t)}</span></p>`),
    ...h.kidTips.map((t) => `<p class="tp-line yd-line">${icon('sun', { size: 16 })}<span>${esc(t)}</span></p>`),
  ].join('');
}

export function yourDayHTML(view) {
  const head = (right) => `<div class="sec-head"><h2>Your day</h2>${right}</div>`;
  const top = dayTopHTML(view);
  const dinner = dinnerHTML(view);
  if (!view.calendarConnected) {
    return `${head('<button class="text-btn" type="button" data-action="open-settings-calendar">connect calendar</button>')}${top}
      <div class="day-empty"><p>connect your google calendar and each event shows up here with the weather at that hour. it also spots trips, so the week uses the forecast where you'll be.</p>
      <button class="btn" type="button" data-action="open-settings-calendar">${icon('calendar', { size: 16 })} connect calendar</button></div>${dinner}`;
  }
  const errNote = view.calErrorText ? `<p class="cal-note">${esc(view.calErrorText)}${view.calFetchedAt ? ` · showing ${esc(clockAt(view.calFetchedAt, view.ctx.model.offset))}` : ''}</p>` : '';
  if (!view.hasCalendarData) {
    return `${head('<span class="sub-right">calendar</span>')}${top}<div class="day-empty"><p>${esc(view.calErrorText || 'checking your calendar…')}</p>
      ${view.calErrorText ? `<button class="btn" type="button" data-action="open-settings-calendar">${icon('gear', { size: 16 })} calendar settings</button>` : ''}</div>${dinner}`;
  }
  const ahead = view.target && view.target !== datePart(view.ctx.now);
  const v = yourDay(view.ctx.events, view.ctx.now, { date: ahead ? view.target : null });
  const rightLabel = ahead ? `<span class="sub-right">tomorrow, ${esc(dowShort(view.target))}</span>` : '<span class="sub-right">calendar</span>';
  const conflicts = (view.trip ? view.trip.dayConflicts : []).map((c) => `<p class="tp-line tp-conflict">${icon('alert', { size: 16 })}<span>${esc(c)}</span></p>`).join('');
  const notes = new Map((view.written.event_notes || []).map((x) => [x.id, x.note]));
  const leaves = new Map((view.written.leave_notes || []).filter((x) => x.note).map((x) => [x.id, x.note]));
  // the accent goes to the next departure that is still ahead
  const nextLeave = [...v.upcoming, ...v.tomorrow].find((e) => e.travel && e.travel.leaveBy && e.travel.leaveBy >= view.ctx.now);
  const extra = { leaves, nextLeaveId: nextLeave ? nextLeave.id : null };
  const stale = view.bridge && view.bridge.version < 2
    ? '<p class="cal-note"><button class="text-btn muted" type="button" data-action="open-settings-calendar">update your google script to add inbox &amp; drive times</button></p>' : '';
  const chips = v.chips.length ? `<div class="allday">${v.chips.map((c) => `<span class="ad-chip">${icon('calendar', { size: 14 })}<span>${esc(c.title)}</span></span>`).join('')}</div>` : '';
  const earlier = v.earlier || (!v.upcoming.length && v.tomorrow.length)
    ? `<p class="earlier">${[v.earlier ? `${v.earlier} earlier today` : '', !v.upcoming.length && v.tomorrow.length ? 'nothing else today' : ''].filter(Boolean).join(' · ')}</p>` : '';
  let list = v.upcoming.map((e) => eventRow(view, e, v.next && e.id === v.next.id, notes, extra)).join('');
  if (!v.upcoming.length && !v.tomorrow.length) {
    return `${head(rightLabel)}${top}${chips}${conflicts}${earlier}
      <p class="day-empty">${ahead ? 'nothing on the calendar tomorrow.' : v.earlier ? 'nothing else on the calendar today.' : 'nothing on the calendar today.'}</p>${errNote}${stale}${dinner}`;
  }
  if (v.tomorrow.length) {
    list += `<li class="ev-label">tomorrow</li>${v.tomorrow.slice(0, 4).map((e, i) => eventRow(view, e, !v.upcoming.length && i === 0, notes, extra)).join('')}`;
  }
  return `${head(rightLabel)}${top}${chips}${conflicts}${earlier}<ol class="timeline">${list}</ol>${errNote}${stale}${dinner}`;
}

// ---------- waiting on you (gmail) ----------
export function waitingHTML(view) {
  const b = view.bridge;
  if (!view.calendarConnected || !b || b.version < 2 || !view.settings.show.inbox || !b.inbox) return '';
  const inbox = b.inbox;
  const head = '<div class="sec-head"><h2>Waiting on you</h2><span class="sub-right">gmail</span></div>';
  if (!inbox.ok) {
    if (inbox.error === 'disabled') return '';
    return `${head}<p class="cal-note">couldn't read gmail: ${esc(inbox.error)}</p>`;
  }
  const nowMs = Date.now();
  const pkgNotes = new Map(((view.written && view.written.package_notes) || []).map((x) => [x.id, x.note]));
  const wrap = (url, cls, inner) => (url ? `<a class="${cls}" href="${esc(url)}" target="_blank" rel="noopener">${inner}</a>` : `<div class="${cls}">${inner}</div>`);
  const rows = inbox.waiting.map((w) => `<li>${wrap(w.url, 'wait-row', `
      <span class="wr-main"><span class="wr-top"><b class="wr-from">${esc(w.from || 'someone')}</b><span class="wr-reason">${esc(w.reason)}</span></span>
      <span class="wr-subj">${esc(w.subject || '(no subject)')}</span></span>
      <span class="wr-time">${esc(relTime(w.date, nowMs))}</span>`)}</li>`).join('');
  const pkgs = inbox.packages.map((p) => `<li>${wrap(p.url, 'wait-row pkg', `
      <span class="wr-icon">${icon('box', { size: 18 })}</span>
      <span class="wr-main"><span class="wr-subj pk">${esc(pkgNotes.get(p.id) || `${p.merchant} package ${p.status}`)}</span></span>`)}</li>`).join('');
  const empty = inbox.waiting.length ? '' : '<p class="day-empty">nothing waiting on you. inbox zero, or close to it.</p>';
  return `${head}${empty}${rows || pkgs ? `<ul class="wait-list">${rows}${pkgs}</ul>` : ''}`;
}

// ---------- the week ----------
export function weekHTML(view) {
  const { ctx, written } = view;
  const today = datePart(ctx.now);
  const notes = new Map((written.day_notes || []).map((x) => [x.date, x.note]));
  const toF = (v) => (ctx.units === 'metric' ? (v * 9) / 5 + 32 : v);
  const rows = [];
  for (let i = 0; i < 10; i++) {
    const date = addDays(today, i);
    const m = modelForDate(ctx, date);
    const d = dayByDate(m, date);
    if (!d) continue;
    const lo = nightLow(m, date);
    const info = ctx.travel ? ctx.travel.dayInfo(date) : null;
    const tag = info && info.trip && (info.where === 'away' || info.flag === 'depart') ? info.trip.city.toLowerCase() : '';
    rows.push({ date, d, lo, hi: d.high, info, tag, away: info && info.where === 'away' });
  }
  const vals = rows.flatMap((x) => [x.lo, x.hi]).filter((v) => v != null);
  const gmin = Math.min(...vals); const gmax = Math.max(...vals);
  const pct = (v) => (gmax === gmin ? 50 : ((v - gmin) / (gmax - gmin)) * 100);
  const fade = view.fade ? ' fade-in' : '';
  const html = rows.map((x, i) => {
    const lo = x.lo ?? x.d.low; const hi = x.hi;
    const left = pct(Math.min(lo, hi)); const right = 100 - pct(Math.max(lo, hi));
    const fill = `left:${left.toFixed(1)}%;right:${right.toFixed(1)}%;background:linear-gradient(90deg, ${tempColor(toF(lo))}, ${tempColor(toF(hi))})`;
    const p = x.d.precipProbMax ?? 0;
    const name = i === 0 ? 'Today' : cap(dowShort(x.date));
    const tagText = x.tag ? (x.info.flag === 'depart' ? `→ ${x.tag}` : x.tag) : '';
    const park = view.trip && view.trip.parkTags[x.date];
    return `<li class="wrow${x.away ? ' away' : ''}">
      <div class="wday"><span class="wname">${name}</span><span class="wdate">${esc(fmtMonthDay(x.date))}</span>${tagText ? `<span class="wtag">${esc(tagText)}</span>` : ''}</div>
      <span class="wicon">${weatherIcon(x.d.code, 1, { size: 30 })}</span>
      <span class="wrain">${p >= 20 ? `${p}%` : ''}</span>
      <span class="wlo">${deg(lo)}</span>
      <span class="wbar" aria-hidden="true"><span class="wfill" style="${fill}"></span></span>
      <span class="whi">${deg(hi)}</span>
      ${park ? `<p class="wpark">${icon('ferris', { size: 13 })}<span>${esc(park)}</span></p>` : ''}
      ${notes.get(x.date) ? `<p class="wnote${fade}">${prose(notes.get(x.date))}</p>` : ''}
    </li>`;
  }).join('');
  return `<div class="sec-head"><h2>The week</h2><span class="sub-right">high &amp; that night's low</span></div>
    <hr class="rule"><ol class="wk">${html}</ol>`;
}

// ---------- the fine print ----------
export function fineHTML(view) {
  const { ctx, written } = view;
  const m = ctx.model;
  const today = datePart(ctx.now);
  const d = dayByDate(m, today) || {};
  const tomorrow = dayByDate(m, addDays(today, 1));
  // drawn in a stretched 600x130 box (strokes don't scale); the sun dot is an HTML element placed by percent
  const VW = 600; const VH = 130; const cx = 300; const cy = 122; const rx = 288; const ry = 108;
  const ptAt = (f) => [cx - rx * Math.cos(Math.PI * f), cy - ry * Math.sin(Math.PI * f)];
  let arc = ''; let dot = ''; let nightNote = '';
  if (d.sunrise && d.sunset) {
    const now = minutesOfDay(ctx.now); const sr = minutesOfDay(d.sunrise); const ss = minutesOfDay(d.sunset);
    const up = ctx.now >= d.sunrise && ctx.now < d.sunset;
    if (up) {
      const f = Math.max(0, Math.min(1, (now - sr) / (ss - sr)));
      const [px, py] = ptAt(f);
      arc = `<path class="arc" d="M${cx - rx} ${cy} A${rx} ${ry} 0 0 1 ${px.toFixed(1)} ${py.toFixed(1)}"/>
        <path class="arc ahead" d="M${px.toFixed(1)} ${py.toFixed(1)} A${rx} ${ry} 0 0 1 ${cx + rx} ${cy}"/>`;
      dot = `<span class="sundot" style="left:${((px / VW) * 100).toFixed(2)}%;top:${((py / VH) * 100).toFixed(2)}%" aria-hidden="true"></span>`;
    } else {
      arc = `<path class="arc night" d="M${cx - rx} ${cy} A${rx} ${ry} 0 0 1 ${cx + rx} ${cy}"/>`;
      const rise = ctx.now < d.sunrise ? d.sunrise : tomorrow && tomorrow.sunrise;
      nightNote = `<p class="sun-night">sun's down${rise ? ` · rises ${esc(fmtClock(rise))}` : ''}</p>`;
    }
  }
  const svg = `<div class="sunbox"><svg class="sunarc" viewBox="0 0 ${VW} ${VH}" preserveAspectRatio="none" aria-hidden="true">
      <line class="horizon" x1="0" y1="${cy}" x2="${VW}" y2="${cy}"/>
      ${arc}
    </svg>${dot}${nightNote}</div>`;
  const stats = (written.fine || []).map((s) => `<div class="stat"><dt>${esc(s.label)}</dt><dd class="sv">${esc(s.value)}</dd><dd class="sn">${esc(s.note)}</dd></div>`).join('');
  const curTime = m.current.time ? fmtClock(m.current.time) : clockAt(view.wxFetchedAt, m.offset);
  return `<div class="card-head"><h2>The fine print</h2><p class="sub">open-meteo current, ${esc(curTime)}</p></div>
    <div class="sunwrap">${svg}
      <div class="sun-ends"><span><b>${esc(d.sunrise ? fmtClock(d.sunrise) : '—')}</b>sunrise</span><span class="r"><b>${esc(d.sunset ? fmtClock(d.sunset) : '—')}</b>sunset</span></div>
    </div>
    <hr class="rule">
    <dl class="stats">${stats}</dl>`;
}

// ---------- all ----------
/** Fills the trip plan card (hidden when `plan` is null), keeping the keyboard focus on the same checkbox. */
export function renderPlanCard(plan, el) {
  const html = plan ? planCardHTML(plan) : '';
  if (!html) { el.hidden = true; el.innerHTML = ''; return; }
  const f = document.activeElement;
  const sel = f && el.contains(f) && f.matches('input[data-plan-item], input[data-plan-check]') ? `input[${f.hasAttribute('data-plan-item') ? 'data-plan-item' : 'data-plan-check'}="${CSS.escape(f.getAttribute('data-plan-item') || f.getAttribute('data-plan-check'))}"]` : '';
  const open = el.querySelector('details.plan-earlier') && el.querySelector('details.plan-earlier').open;
  el.innerHTML = html;
  el.hidden = false;
  const d = el.querySelector('details.plan-earlier');
  if (d && open) d.open = true;
  if (sel) { const n = el.querySelector(sel); if (n) n.focus({ preventScroll: true }); }
}

export function renderAll(view, els) {
  const strip = els.hourly.querySelector('.hstrip');
  const scrollLeft = strip ? strip.scrollLeft : 0;
  els.hero.innerHTML = heroHTML(view);
  if (els.plan) renderPlanCard(view.plan, els.plan);
  const ready = view.status === 'ready';
  for (const k of ['hourly', 'week', 'fine']) els[k].hidden = !ready;
  const rundown = ready ? rundownHTML(view) : '';
  if (els.rundown) { els.rundown.hidden = !rundown; if (rundown) els.rundown.innerHTML = rundown; }
  if (!ready) return;
  els.hourly.innerHTML = hourlyHTML(view);
  els.week.innerHTML = weekHTML(view);
  els.fine.innerHTML = fineHTML(view);
  const s2 = els.hourly.querySelector('.hstrip');
  if (s2 && scrollLeft && !view.resetScroll) s2.scrollLeft = scrollLeft;
}
