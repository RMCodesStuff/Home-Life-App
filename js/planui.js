// Trip plan UI: the card, the whole-trip sheet, the settings section and the confirm sheet for an incoming plan link (#plan=…).
// Every string from a plan is untrusted: it all goes through esc() before it reaches HTML.
import { esc } from './render.js';
import { icon } from './icons.js';
import { fmtDateRange, fmtDateLong } from './time.js';
import { rowExpanded, todoIsOpen } from './uistate.js';
import { PLAN_PREFIX, decodePlan, encodePlan, parsePlanInput, planRange, planStops, rowOf } from './plan.js';

// the app wires these in at boot: {getPlan, getDone, setPlan(plan), removePlan(), setDone(id, on)}
let host = null;
export function initPlanUI(h) { host = h; }

// ---------- rows ----------
const cb = (attr, id, checked, label) => `<input type="checkbox" class="plan-cb" ${attr}="${esc(id)}"${checked ? ' checked' : ''} aria-label="${esc(label)}">`;

/** Live-wait chips for a stop. */
const waitChips = (r) => (r.waits && r.waits.length ? r.waits.map((w) => `<span class="plan-wait">${esc(w.name)} · <b>${w.minutes} min</b></span>`).join('') : '');
/** The next stop's live waits, under its line in the now block. */
const nextWaits = (r) => (r.waits && r.waits.length ? `<p class="plan-waits">${waitChips(r)}</p>` : '');
const chev = icon('chevron', { size: 18, className: 'chev' });

/**
 * One stop. In the card (`collapsible`) the row shows checkbox, time, title and one line of chips (waits, then tags); where, who,
 * note and family show when it is expanded (tap the row). The whole-trip sheet shows everything, no toggle.
 */
function rowHTML(r, { now = false, collapsible = false } = {}) {
  const tags = r.tags.map((t) => `<span class="plan-chip plan-tag-${esc(t.key)}">${esc(t.label)}</span>`).join('');
  const chips = collapsible ? `${waitChips(r)}${tags}` : `${r.who ? `<span class="plan-chip plan-who">${esc(r.who)}</span>` : ''}${tags}`;
  const detail = [
    collapsible && (r.where || r.who) ? `<p class="plan-meta">${r.where ? `<span class="plan-where">${esc(r.where)}</span>` : ''}${r.who ? `<span class="plan-chip plan-who">${esc(r.who)}</span>` : ''}</p>` : '',
    r.note ? `<p class="plan-note">${esc(r.note)}</p>` : '',
    r.family ? `<p class="plan-family">${icon('people', { size: 14 })}<span>${esc(r.family)}</span></p>` : '',
  ].join('');
  let body;
  if (collapsible) {
    const open = rowExpanded(r.id, now);
    const did = `plan-d-${esc(r.id)}`;
    const head = `<span class="plan-rtitle">${esc(r.title)}</span>${chips ? `<span class="plan-meta plan-meta-line">${chips}</span>` : ''}`;
    body = detail
      ? `<button type="button" class="plan-toggle" data-toggle-row="${esc(r.id)}" aria-expanded="${open}" aria-controls="${did}"><span class="plan-th">${head}</span>${chev}</button>
      <div class="plan-detail" id="${did}"${open ? '' : ' hidden'}>${detail}</div>`
      : `<div class="plan-toggle static"><span class="plan-th">${head}</span></div>`;
  } else {
    body = `<p class="plan-rtitle">${esc(r.title)}</p>
      ${r.where ? `<p class="plan-meta"><span class="plan-where">${esc(r.where)}</span>${chips}</p>` : chips ? `<p class="plan-meta">${chips}</p>` : ''}
      ${r.note ? `<p class="plan-note">${esc(r.note)}</p>` : ''}
      ${r.family ? `<p class="plan-family">${icon('people', { size: 14 })}<span>${esc(r.family)}</span></p>` : ''}
      ${r.waits && r.waits.length ? `<p class="plan-waits">${waitChips(r)}</p>` : ''}`;
  }
  return `<li class="plan-row${now ? ' is-now' : ''}">
    ${cb('data-plan-item', r.id, r.done, `done: ${r.title}`)}
    <span class="plan-time">${esc(r.clock)}</span>
    <div class="plan-body">${body}</div>
  </li>`;
}
/** The to-do list: a details element, open when short, before the first stop or looking ahead (see todoIsOpen), else closed. */
const todoHTML = (todo, view = {}, label = 'to do') => {
  if (!todo.length) return '';
  const open = todoIsOpen({ count: todo.length, status: view.status, mode: view.mode });
  return `<details class="plan-todo"${open ? ' open' : ''}><summary>${label} · ${todo.length}${chev}</summary><ul class="checks">${todo.map((c) => `<li><label class="check"><input type="checkbox" data-plan-check="${esc(c.id)}"><span>${esc(c.text)}</span></label></li>`).join('')}</ul></details>`;
};
const footHTML = (plan) => `<div class="plan-foot"><button class="btn" type="button" data-action="open-plan">whole trip</button>${plan.source ? `<a class="plan-src" href="${esc(plan.source)}" target="_blank" rel="noopener">original plan</a>` : ''}</div>`;
const eyebrow = (text) => `<p class="top-eyebrow">${icon('suitcase', { size: 16 })}<span>${esc(text)}</span></p>`;

// ---------- the card ----------
export function planCardHTML(v) {
  if (!v) return '';
  if (v.mode === 'soon') {
    return `${eyebrow(`trip plan · ${v.label}`)}
      <h2 class="plan-title">${esc(v.plan.title)}</h2>
      <p class="plan-sub">first day · ${esc(fmtDateLong(v.day.date))}${v.day.title ? ` · ${esc(v.day.title)}` : ''}</p>
      ${todoHTML(v.todo, v)}${footHTML(v.plan)}`;
  }
  const sub = [v.day.hours, v.day.summary].filter(Boolean).map(esc).join(' · ');
  const head = `<h2 class="plan-title">${esc(v.day.title || fmtDateLong(v.day.date))}</h2>${sub ? `<p class="plan-sub">${sub}</p>` : ''}`;
  if (v.mode === 'tomorrow') {
    return `${eyebrow("tomorrow's plan")}${head}
      ${v.first ? `<div class="plan-now"><p class="plan-kicker">first up</p><p class="plan-big"><span class="plan-bt">${esc(v.first.clock)}</span> ${esc(v.first.title)}</p></div>` : ''}
      ${todoHTML(v.todo, v)}
      ${v.items.length ? `<ul class="plan-list">${v.items.map((r) => rowHTML(r, { collapsible: true })).join('')}</ul>${v.more ? `<p class="plan-more">and ${v.more} more</p>` : ''}` : ''}
      ${footHTML(v.plan)}`;
  }
  const line = (r) => `<span class="plan-bt">${esc(r.clock)}</span> ${esc(r.title)}`;
  let nowBlock = '';
  if (v.status === 'before') {
    nowBlock = `<p class="plan-kicker">first up · <span class="plan-in">${esc(v.nextIn)}</span></p><p class="plan-big">${line(v.next)}</p>${v.next.where ? `<p class="plan-meta"><span class="plan-where">${esc(v.next.where)}</span></p>` : ''}${nextWaits(v.next)}`;
  } else if (v.status === 'during') {
    nowBlock = `<p class="plan-kicker">now</p><p class="plan-big">${line(v.current)}</p>${v.current.family ? `<p class="plan-family">${icon('people', { size: 14 })}<span>${esc(v.current.family)}</span></p>` : ''}
      ${v.next ? `<p class="plan-kicker plan-kicker-next">next · <span class="plan-in">${esc(v.nextIn)}</span></p><p class="plan-next">${line(v.next)}</p>${nextWaits(v.next)}` : '<p class="plan-kicker plan-kicker-next">that\'s the last stop on the plan</p>'}`;
  } else if (v.status === 'after') {
    nowBlock = `<p class="plan-big">that's the plan for today</p>${v.tomorrow ? `<p class="plan-sub">tomorrow · ${esc(v.tomorrow.title || 'the next day')}${v.tomorrow.first ? ` · first up ${esc(v.tomorrow.first)}` : ''}</p>` : ''}`;
  } else nowBlock = '<p class="plan-big">nothing planned for today</p>';
  const earlier = v.earlier.length ? `<details class="plan-earlier"><summary>earlier · ${v.earlier.length}</summary><ul class="plan-list">${v.earlier.map((r) => rowHTML(r, { collapsible: true })).join('')}</ul></details>` : '';
  const upcoming = v.upcoming.length ? `<ul class="plan-list">${v.upcoming.map((r) => rowHTML(r, { now: !!v.current && r.id === v.current.id, collapsible: true })).join('')}</ul>` : '';
  return `${eyebrow("today's plan")}${head}<div class="plan-now">${nowBlock}</div>${todoHTML(v.todo, v)}${earlier}${upcoming}${footHTML(v.plan)}`;
}

// ---------- the whole-trip sheet ----------
function heightsHTML(heights) {
  if (!heights.length) return '';
  const parks = [...new Set(heights.map((h) => h.park))];
  return `<section class="plan-sec"><h3>ride heights</h3>${parks.map((p) => {
    const list = heights.filter((h) => h.park === p);
    const some = list.filter((h) => h.min > 0).sort((a, b) => a.min - b.min);
    const none = list.filter((h) => h.min === 0);
    return `${p ? `<p class="tp-label">${esc(p)}</p>` : ''}<ul class="plan-heights">
      ${some.map((h) => `<li><b>${h.min}″</b> · ${esc(h.ride)}${h.call ? ` · <span class="plan-note">${esc(h.call)}</span>` : ''}</li>`).join('')}
      ${none.length ? `<li>no minimum (everyone rides): ${none.map((h) => esc(h.ride)).join(', ')}</li>` : ''}</ul>`;
  }).join('')}</section>`;
}
export function planSheetHTML(plan, done = {}) {
  const days = plan.days.map((d) => `<section class="plan-sec">
      <h3>${esc(d.title || fmtDateLong(d.date))}</h3>
      <p class="plan-sub">${esc(fmtDateLong(d.date))}${d.hours ? ` · ${esc(d.hours)}` : ''}${d.summary ? ` · ${esc(d.summary)}` : ''}</p>
      ${d.items.length ? `<ul class="plan-list">${d.items.map((it) => rowHTML(rowOf(it, done, null))).join('')}</ul>` : ''}
      ${d.tips.length ? `<ul class="plan-tips">${d.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
    </section>`).join('');
  const check = plan.checklist.length ? `<section class="plan-sec"><h3>to do</h3><ul class="checks">${plan.checklist.map((c) => `<li><label class="check"><input type="checkbox" data-plan-check="${esc(c.id)}"${done[c.id] ? ' checked' : ''}><span>${esc(c.text)}${c.due ? ` <span class="plan-note">· by ${esc(fmtDateRange(c.due, c.due))}</span>` : ''}</span></label></li>`).join('')}</ul></section>` : '';
  const tips = plan.tips.length ? `<section class="plan-sec"><h3>tips</h3><ul class="plan-tips">${plan.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></section>` : '';
  return `<div class="sheet-inner">
    <header class="sheet-head"><h2 id="plan-sheet-title">${esc(plan.title)}</h2>
      <button type="button" class="icon-btn" id="plan-sheet-close" aria-label="close trip plan">${icon('close', { size: 22 })}</button></header>
    <p class="plan-sub">${esc(planRange(plan))} · ${plan.days.length} ${plan.days.length === 1 ? 'day' : 'days'}</p>
    ${plan.intro ? `<p class="plan-intro">${esc(plan.intro)}</p>` : ''}
    ${days}${check}${tips}${heightsHTML(plan.heights)}
    ${plan.source ? `<p class="plan-sec"><a class="plan-src" href="${esc(plan.source)}" target="_blank" rel="noopener">original plan</a></p>` : ''}
  </div>`;
}
export function openPlanSheet(plan = host && host.getPlan(), done = host && host.getDone()) {
  const d = document.getElementById('plan-sheet');
  if (!d || !plan) return;
  d.innerHTML = planSheetHTML(plan, done || {});
  d.querySelector('#plan-sheet-close').addEventListener('click', () => d.close());
  if (!d.open) d.showModal();
  d.querySelector('.sheet-inner').scrollTop = 0;
}
export function initPlanSheet() {
  const d = document.getElementById('plan-sheet');
  if (d) d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
}

// ---------- toast and confirm ----------
function toast(text) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = text;
  el.hidden = false;
  setTimeout(() => { if (el.textContent === text) el.hidden = true; }, 9000);
}
function confirmPlan(plan, { replace, onUse }) {
  const d = document.createElement('dialog');
  d.className = 'sheet confirm';
  d.setAttribute('aria-labelledby', 'plan-confirm-h');
  d.innerHTML = `<div class="confirm-inner">
      <h2 id="plan-confirm-h">${replace ? 'replace' : 'add'} “${esc(plan.title)}” ${replace ? 'on' : 'to'} this device?</h2>
      <p class="note tight">${plan.days.length} ${plan.days.length === 1 ? 'day' : 'days'} · ${esc(planRange(plan))}</p>
      <p class="note tight">it stays on this device only.</p>
      <div class="set-row"><button class="btn btn-accent" type="button" id="plan-use">${replace ? 'replace plan' : 'add plan'}</button>
        <button class="btn" type="button" id="plan-cancel">not now</button></div>
    </div>`;
  document.body.appendChild(d);
  const close = (fn) => () => { d.close(); d.remove(); fn(); };
  d.querySelector('#plan-use').addEventListener('click', close(onUse));
  d.querySelector('#plan-cancel').addEventListener('click', close(() => {}));
  d.addEventListener('cancel', (e) => { e.preventDefault(); close(() => {})(); });
  d.showModal();
  d.querySelector('#plan-use').focus();
}

/** Shows the confirm sheet for a decoded plan; "add plan" stores it. */
export function offerPlan(plan) {
  if (!host || document.querySelector('dialog.confirm')) return;
  const cur = host.getPlan();
  confirmPlan(plan, { replace: !!cur && cur.id === plan.id, onUse: () => { host.setPlan(plan); paintPlanSettings(); toast(`added “${plan.title}”.`); } });
}

/** Call on boot and on hashchange. `#plan=…` is cleared from the address bar at once, then the confirm sheet (or a one-line error) shows. */
export function offerPlanFromHash() {
  if (!String(location.hash).startsWith(PLAN_PREFIX)) return false;
  const payload = location.hash.slice(PLAN_PREFIX.length);
  try { history.replaceState(null, '', location.pathname + location.search); } catch { /* ignore */ }
  decodePlan(payload).then((r) => { if (r.ok) offerPlan(r.plan); else toast(r.error); });
  return true;
}

// ---------- settings section ----------
export function planSettingsMarkup() {
  return `
    <section class="set-sec" id="set-plan" aria-labelledby="set-plan-h">
      <h3 id="set-plan-h">Trip plan</h3>
      <div id="plan-set-body"></div>
    </section>`;
}
let settingsRoot = null;
function paintPlanSettings() {
  const body = settingsRoot && settingsRoot.querySelector('#plan-set-body');
  if (!body || !host) return;
  const plan = host.getPlan();
  body.innerHTML = `
    ${plan ? `<p class="status">${esc(plan.title)} · ${esc(planRange(plan))} · ${planStops(plan)} stops</p>
      <div class="set-row"><button class="btn btn-accent" type="button" id="plan-copy">copy link for another device</button>
        <button class="btn" type="button" id="plan-show">show plan</button>
        <button class="btn" type="button" id="plan-remove">remove plan</button></div>` : '<p class="status">no plan on this device</p>'}
    <p class="note tight">a trip plan shows today's stops, what's next and live waits on park days. plans stay on this device; use the link to add one to another device.</p>
    <label for="plan-paste">paste a plan link</label>
    <div class="set-row"><input type="text" id="plan-paste" placeholder="link, code or plan json" autocomplete="off" spellcheck="false"><button class="btn" type="button" id="plan-add">add</button></div>
    <p class="result" id="plan-result" role="status"></p>
    <label for="plan-link" class="vh">plan link</label>
    <textarea id="plan-link" readonly hidden></textarea>`;
  const $ = (id) => body.querySelector(`#${id}`);
  const say = (text, err = false) => { const o = $('plan-result'); o.textContent = text; o.classList.toggle('err', err); };
  if (plan) {
    $('plan-show').addEventListener('click', () => openPlanSheet());
    $('plan-copy').addEventListener('click', async () => {
      say('');
      const link = `${location.origin}${location.pathname}${PLAN_PREFIX}${await encodePlan(plan)}`;
      const ta = $('plan-link');
      try { await navigator.clipboard.writeText(link); ta.hidden = true; say('copied. open it on the other device.'); } catch {
        ta.value = link; ta.hidden = false; ta.focus(); ta.select();
        say("couldn't copy automatically. the link is selected below; copy it with ctrl+c / ⌘c.");
      }
    });
    let armed = null;
    $('plan-remove').addEventListener('click', (e) => {
      const b = e.currentTarget;
      if (armed) { clearTimeout(armed); host.removePlan(); paintPlanSettings(); return; }
      b.textContent = 'tap again to remove';
      armed = setTimeout(() => { armed = null; b.textContent = 'remove plan'; }, 4000);
    });
  }
  const add = async () => {
    const r = await parsePlanInput($('plan-paste').value);
    if (!r.ok) { say(r.error, true); return; }
    say('');
    offerPlan(r.plan);
    $('plan-paste').value = '';
  };
  $('plan-add').addEventListener('click', add);
  $('plan-paste').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
}
export function wirePlanSettings({ dialog }) {
  settingsRoot = dialog;
  paintPlanSettings();
}
export { paintPlanSettings };
