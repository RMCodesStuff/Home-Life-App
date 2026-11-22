// Settings sections for the v3 home features: calendars, meal plan, workout, chores and the Phoenix home pack.
// Mounted by settings.js; reads/writes through the same api ({getSettings, save, getStatus, reload}).
import { icon } from './icons.js';
import { esc } from './render.js';
import { TAG_COLORS, isWorkCalendar } from './calendars.js';
import { CHORE_PRESETS } from './phoenix.js';
import { fbConnect, fbDisconnect } from './fb.js';
import { fmtMonthDay, addDays, dowIndex } from './time.js';

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pills = (name, labels, chosen, offset = 0) => `<div class="pills" role="group">${labels.map((l, i) => `<label class="pill"><input type="checkbox" data-pill="${name}" value="${i + offset}"${chosen.includes(i + offset) ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div>`;
const sw = (id, on, text) => `<label class="switch" for="${id}"><input type="checkbox" id="${id}"${on ? ' checked' : ''}> ${text}</label>`;
const FB_HELP = {
  permission: "sign-in isn't allowed here yet. do the one-time step below, then try again.",
  network: "couldn't reach google. check your connection and try again.",
  'not-connected': 'not connected.',
  other: 'that didn\'t work. try again.',
};

export function extraMarkup(s, seg) {
  const ph = s.phoenix;
  return `
    <section class="set-sec" id="set-cals" aria-labelledby="set-cals-h">
      <h3 id="set-cals-h">Calendars</h3>
      <p class="note tight">the calendars your google script sends. a calendar switched off is hidden everywhere: your day, trips, leave-by, the workout window and tomorrow's edition. a label tags its events in your day.</p>
      <div id="cals-list" class="cals-list"><p class="status">connect google to see your calendars.</p></div>
    </section>

    <section class="set-sec" id="set-meals" aria-labelledby="set-meals-h">
      <h3 id="set-meals-h">Meal plan</h3>
      <p class="status" id="meals-status">not connected</p>
      <div class="set-row"><button class="btn btn-accent" type="button" id="meals-connect">${icon('fork', { size: 16 })} connect meal plan</button>
        <button class="btn" type="button" id="meals-disconnect" hidden>disconnect</button></div>
      <p class="result" id="meals-result" role="status"></p>
      ${sw('show-dinner', s.show.dinner !== false, 'show dinner in your day')}
      <p class="note">read-only: today's and tomorrow's meals. sign in with the google account you use in the meal planner. one-time step: in the Firebase console for the meal planner (recipe-planner-bcd94): Authentication → Settings → Authorized domains → Add domain → rmcodesstuff.github.io.</p>
    </section>

    <section class="set-sec" id="set-workout" aria-labelledby="set-workout-h">
      <h3 id="set-workout-h">Workout</h3>
      <p class="status" id="wo-status">no rack timer plan on this device yet</p>
      <div class="set-row"><button class="btn btn-accent" type="button" id="rack-connect">${icon('dumbbell', { size: 16 })} connect rack timer account</button>
        <button class="btn" type="button" id="rack-disconnect" hidden>disconnect</button></div>
      <p class="result" id="rack-result" role="status"></p>
      ${sw('show-workout', s.show.workout !== false, "show today's workout")}
      <fieldset class="seg"><legend>preferred window</legend>${seg('wowin', [['any', 'any'], ['morning', 'morning'], ['midday', 'midday'], ['evening', 'evening']], s.workout.window || 'any')}</fieldset>
      <p class="subhead">work calendars <span class="muted-inline">(a weekday with these means the short version)</span></p>
      <div id="wo-cals" class="wo-cals"></div>
      <p class="note">the rack timer shares its plan with this app automatically on the same device. connect its account to see it from your other devices too.</p>
    </section>

    <section class="set-sec" id="set-chores" aria-labelledby="set-chores-h">
      <h3 id="set-chores-h">Chores</h3>
      <div id="chores-list" class="chores-list"></div>
      <p class="subhead">add a chore</p>
      <div class="set-row chore-add">${CHORE_PRESETS.map((p) => `<button class="btn" type="button" data-preset="${p.key}">${esc({ trash: 'trash night', recycling: 'recycling night', filter: 'ac filter (30 days)', pest: 'pest control (90 days)' }[p.key])}</button>`).join('')}
        <button class="btn" type="button" data-preset="custom">something else</button></div>
      <p class="note">bins show the night before pickup, with a nudge when it's gusty. filters and the like show the morning they're due; tap "done" here when you've done them. holiday delay moves a pickup a day later when thanksgiving, christmas, new year's day, memorial day, independence day or labor day falls earlier that week.</p>
    </section>

    <section class="set-sec" id="set-phoenix" aria-labelledby="set-phoenix-h">
      <h3 id="set-phoenix-h">Home extras</h3>
      <p class="subhead first">power peak</p>
      ${sw('pp-on', ph.power.enabled, 'show peak hours and when to pre-cool')}
      <div id="pp-windows" class="pp-windows"></div>
      <div class="set-row"><button class="btn" type="button" id="pp-add">add a window</button></div>
      <fieldset class="seg"><legend>which days</legend>${seg('ppmode', [['months', 'these months'], ['hot', 'when it hits 90°']], ph.power.mode === 'hot' ? 'hot' : 'months')}</fieldset>
      <div id="pp-months">${pills('month', MONTHS, ph.power.months || [], 1)}</div>
      <p class="subhead">watering</p>
      ${sw('wt-on', ph.watering.enabled, 'skip-or-water advice on watering days')}
      <div id="wt-days">${pills('wday', DAYS, ph.watering.days || [])}</div>
      <p class="subhead">also show</p>
      ${sw('show-dust', s.show.dust !== false, 'dusty air warnings')}
      ${sw('show-radar', s.show.radar !== false, 'rain radar when rain or an alert is near')}
      ${sw('show-kidtips', s.show.kidTips !== false, 'kid-friendly heat and sun tips')}
    </section>`;
}

function chooseOptions(list, cur) {
  return list.map(([v, l]) => `<option value="${v}"${String(cur) === String(v) ? ' selected' : ''}>${l}</option>`).join('');
}
function choreRow(c, today) {
  const t = c.rule.type;
  const n = c.rule.n || (t === 'days' ? 30 : 2);
  const last = c.last || c.start;
  return `<div class="chore" data-id="${esc(c.id)}">
    <div class="chore-top"><input type="text" data-k="name" maxlength="30" value="${esc(c.name)}" aria-label="chore name">
      <button class="text-btn muted" type="button" data-act="remove">remove</button></div>
    <div class="chore-rule">
      <select data-k="type" aria-label="how often">${chooseOptions([['weekly', 'every week'], ['weeks', 'every few weeks'], ['days', 'every few days']], t)}</select>
      ${t === 'weekly' ? `<select data-k="day" aria-label="pickup day">${chooseOptions(DAYS.map((d, i) => [i, `on ${d}`]), c.rule.day ?? 4)}</select>` : ''}
      ${t === 'weeks' ? `<span class="inl">every <input type="number" data-k="n" min="2" max="8" value="${n}" aria-label="weeks"> weeks from <input type="date" data-k="start" value="${esc(c.rule.start || '')}" aria-label="first pickup"></span>` : ''}
      ${t === 'days' ? `<span class="inl">every <input type="number" data-k="n" min="1" max="365" value="${n}" aria-label="days"> days</span>` : ''}
    </div>
    ${t === 'days' ? `<div class="chore-rule"><span class="chore-note">${last ? `last done ${esc(fmtMonthDay(last))}` : 'not done yet'}</span><button class="btn" type="button" data-act="done"${c.last === today ? ' disabled' : ''}>${icon('check', { size: 16 })} done today</button></div>`
      : `<div class="chore-rule">${sw(`ch-bin-${esc(c.id)}`, c.kind !== 'task', 'a bin (out the night before)').replace('<input', '<input data-k="bin"')}${sw(`ch-hol-${esc(c.id)}`, !!c.holiday, 'holiday delay').replace('<input', '<input data-k="holiday"')}</div>`}
  </div>`;
}
function windowRow(w, i) {
  return `<div class="pp-win" data-i="${i}">
    ${pills(`ppday-${i}`, DAYS, w.days || [])}
    <div class="chore-rule"><span class="inl"><input type="time" data-k="start" value="${esc(w.start)}" aria-label="peak starts"> to <input type="time" data-k="end" value="${esc(w.end)}" aria-label="peak ends"></span>
      <button class="text-btn muted" type="button" data-act="remove-win">remove</button></div>
  </div>`;
}

/** Wires the sections. `ctx`: {dialog, api, toggle(id, key)}. */
export function wireExtras({ dialog, api, toggle }) {
  const $ = (id) => dialog.querySelector(`#${id}`);
  const today = () => (api.getStatus ? api.getStatus().today : '') || '';
  toggle('show-dinner', 'dinner'); toggle('show-workout', 'workout'); toggle('show-dust', 'dust'); toggle('show-radar', 'radar'); toggle('show-kidtips', 'kidTips');

  // calendars
  $('cals-list').addEventListener('change', (e) => {
    const row = e.target.closest('[data-cal]');
    if (!row) return;
    const st = api.getSettings();
    const name = row.dataset.cal;
    const cur = { ...(st.calendars[name] || {}) };
    const k = e.target.dataset.k;
    if (k === 'show') cur.show = e.target.checked;
    if (k === 'label') cur.label = e.target.value.trim().toLowerCase().slice(0, 14);
    if (k === 'color') cur.color = e.target.value;
    st.calendars[name] = cur;
    api.save(st, 'calendars');
  });

  // meal plan + rack timer accounts (popups only from these clicks)
  const account = (name, btn, out) => async () => {
    const b = $(btn); b.disabled = true; say(dialog, out, 'opening google sign-in…');
    try { await fbConnect(name); say(dialog, out, 'connected.'); api.reload(name); } catch (err) { say(dialog, out, FB_HELP[err.kind] || FB_HELP.other, true); } finally { b.disabled = false; }
    refreshExtras(dialog, api);
  };
  $('meals-connect').addEventListener('click', account('meals', 'meals-connect', 'meals-result'));
  $('rack-connect').addEventListener('click', account('rack', 'rack-connect', 'rack-result'));
  $('meals-disconnect').addEventListener('click', async () => { await fbDisconnect('meals'); say(dialog, 'meals-result', 'disconnected. the cached plan is cleared.'); api.reload('meals-off'); refreshExtras(dialog, api); });
  $('rack-disconnect').addEventListener('click', async () => { await fbDisconnect('rack'); say(dialog, 'rack-result', 'disconnected.'); api.reload('rack-off'); refreshExtras(dialog, api); });

  // workout
  dialog.querySelectorAll('input[name="wowin"]').forEach((r) => r.addEventListener('change', (e) => { const st = api.getSettings(); st.workout.window = e.target.value; api.save(st, 'workout'); }));
  $('wo-cals').addEventListener('change', () => {
    const st = api.getSettings();
    const chosen = [...dialog.querySelectorAll('#wo-cals input:checked')].map((i) => i.value);
    st.workout.workCalendars = chosen;
    api.save(st, 'workout');
  });

  // chores
  dialog.querySelector('.chore-add').addEventListener('click', (e) => {
    const b = e.target.closest('[data-preset]');
    if (!b) return;
    const st = api.getSettings();
    const t = today();
    const p = CHORE_PRESETS.find((x) => x.key === b.dataset.preset);
    const nextThu = t ? addDays(t, ((4 - dowIndex(t) + 7) % 7) || 7) : null;
    const id = `c${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
    const chore = p ? JSON.parse(JSON.stringify({ id, name: p.name, kind: p.kind, rule: p.rule, holiday: !!p.holiday, last: null, start: t || null }))
      : { id, name: 'new chore', kind: 'task', rule: { type: 'days', n: 14 }, holiday: false, last: null, start: t || null };
    if (chore.rule.type === 'weeks' && !chore.rule.start) chore.rule.start = nextThu;
    st.chores = [...(st.chores || []), chore];
    api.save(st, 'chores');
    refreshExtras(dialog, api);
  });
  $('chores-list').addEventListener('change', (e) => {
    const row = e.target.closest('.chore');
    if (!row) return;
    const st = api.getSettings();
    const c = (st.chores || []).find((x) => x.id === row.dataset.id);
    if (!c) return;
    const k = e.target.dataset.k;
    if (k === 'name') c.name = e.target.value.trim().toLowerCase().slice(0, 30) || c.name;
    if (k === 'type') {
      const type = e.target.value;
      c.rule = type === 'weekly' ? { type, day: 4 } : type === 'weeks' ? { type, n: 2, start: c.rule.start || today() } : { type, n: 30 };
      if (type === 'days') { c.kind = 'task'; c.start = c.start || today(); }
    }
    if (k === 'day') c.rule.day = +e.target.value;
    if (k === 'n') c.rule.n = Math.max(1, Math.min(365, parseInt(e.target.value, 10) || 1));
    if (k === 'start') c.rule.start = e.target.value || null;
    if (k === 'bin') c.kind = e.target.checked ? 'bin' : 'task';
    if (k === 'holiday') c.holiday = e.target.checked;
    api.save(st, 'chores');
    if (k === 'type') refreshExtras(dialog, api);
  });
  $('chores-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    const row = e.target.closest('.chore');
    if (!b || !row) return;
    const st = api.getSettings();
    if (b.dataset.act === 'remove') st.chores = (st.chores || []).filter((x) => x.id !== row.dataset.id);
    if (b.dataset.act === 'done') { const c = st.chores.find((x) => x.id === row.dataset.id); if (c) c.last = today(); }
    api.save(st, 'chores');
    refreshExtras(dialog, api);
  });

  // phoenix pack
  const ph = (fn) => { const st = api.getSettings(); fn(st.phoenix); api.save(st, 'phoenix'); };
  $('pp-on').addEventListener('change', (e) => ph((p) => { p.power.enabled = e.target.checked; }));
  $('wt-on').addEventListener('change', (e) => ph((p) => { p.watering.enabled = e.target.checked; }));
  dialog.querySelectorAll('input[name="ppmode"]').forEach((r) => r.addEventListener('change', (e) => ph((p) => { p.power.mode = e.target.value; })));
  $('pp-months').addEventListener('change', () => ph((p) => { p.power.months = [...dialog.querySelectorAll('#pp-months input:checked')].map((i) => +i.value); }));
  $('wt-days').addEventListener('change', () => ph((p) => { p.watering.days = [...dialog.querySelectorAll('#wt-days input:checked')].map((i) => +i.value); }));
  $('pp-add').addEventListener('click', () => { ph((p) => { p.power.windows = [...(p.power.windows || []), { days: [1, 2, 3, 4, 5], start: '16:00', end: '19:00' }]; }); refreshExtras(dialog, api); });
  $('pp-windows').addEventListener('change', (e) => {
    const row = e.target.closest('.pp-win');
    if (!row) return;
    const i = +row.dataset.i;
    ph((p) => {
      const w = p.power.windows[i];
      if (!w) return;
      w.days = [...row.querySelectorAll('input[data-pill]:checked')].map((x) => +x.value);
      const s = row.querySelector('[data-k="start"]').value; const en = row.querySelector('[data-k="end"]').value;
      if (/^\d{2}:\d{2}$/.test(s)) w.start = s;
      if (/^\d{2}:\d{2}$/.test(en)) w.end = en;
    });
  });
  $('pp-windows').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act="remove-win"]');
    if (!b) return;
    const i = +b.closest('.pp-win').dataset.i;
    ph((p) => { p.power.windows.splice(i, 1); });
    refreshExtras(dialog, api);
  });
}

function say(dialog, id, text, err = false) {
  const out = dialog.querySelector(`#${id}`);
  if (!out) return;
  out.textContent = text;
  out.classList.toggle('err', err);
}

/** Dynamic parts: the calendar list, work calendars, chores, power windows, account statuses. */
export function refreshExtras(dialog, api) {
  if (!dialog || !api) return;
  const s = api.getSettings();
  const st = api.getStatus ? api.getStatus() : {};
  const $ = (id) => dialog.querySelector(`#${id}`);
  const cals = st.calendars || [];
  const list = $('cals-list');
  if (list && !list.contains(document.activeElement)) {
    list.innerHTML = cals.length ? cals.map((c) => `<div class="cal-row" data-cal="${esc(c.name)}">
        <label class="switch"><input type="checkbox" data-k="show"${c.show ? ' checked' : ''}> <span class="cal-name">${esc(c.name)}${c.own ? ' <span class="muted-inline">(yours)</span>' : ''}</span></label>
        <div class="cal-opts"><input type="text" data-k="label" maxlength="14" value="${esc(c.label)}" placeholder="no tag" aria-label="label for ${esc(c.name)}">
          <select data-k="color" aria-label="tag color for ${esc(c.name)}">${chooseOptions([['', 'no color'], ...TAG_COLORS.map((t) => [t, t])], c.label ? c.color : '')}</select>
          ${c.label ? `<span class="ev-tag c-${esc(c.color)}"><i aria-hidden="true"></i>${esc(c.label)}</span>` : ''}</div>
      </div>`).join('') : '<p class="status">connect google to see your calendars.</p>';
  }
  const wc = $('wo-cals');
  if (wc && !wc.contains(document.activeElement)) {
    const chosen = s.workout.workCalendars;
    wc.innerHTML = cals.length ? cals.map((c) => `<label class="switch"><input type="checkbox" value="${esc(c.name)}"${isWorkCalendar(c.name, chosen) ? ' checked' : ''}> ${esc(c.name)}</label>`).join('')
      + (Array.isArray(chosen) && chosen.length ? '' : '<p class="note tight">picked automatically: calendars named work, or a company email.</p>') : '<p class="status">no calendars yet.</p>';
  }
  const t = st.today || '';
  const cl = $('chores-list');
  if (cl && !cl.contains(document.activeElement)) cl.innerHTML = (s.chores || []).length ? s.chores.map((c) => choreRow(c, t)).join('') : '<p class="status">no chores yet.</p>';
  const pw = $('pp-windows');
  if (pw && !pw.contains(document.activeElement)) pw.innerHTML = (s.phoenix.power.windows || []).map(windowRow).join('') || '<p class="status">no peak windows.</p>';

  const meals = st.meals || {};
  const ms = $('meals-status');
  if (ms) {
    ms.innerHTML = meals.connected ? `<span class="ok">connected</span>${meals.at ? ` · synced ${esc(meals.at)}` : ''}${meals.dinner ? ` · tonight: ${esc(meals.dinner)}` : ''}`
      : meals.kind && meals.kind !== 'not-connected' ? esc(FB_HELP[meals.kind] || FB_HELP.other) : 'not connected';
    $('meals-connect').hidden = !!meals.connected;
    $('meals-disconnect').hidden = !meals.connected;
  }
  const rack = st.rack || {};
  const ws = $('wo-status');
  if (ws) {
    ws.innerHTML = rack.updatedAt ? `<span class="ok">from your rack timer</span> · updated ${esc(rack.updatedAt)}${rack.source === 'account' ? ' (account)' : ''}` : 'no rack timer plan on this device yet';
    $('rack-connect').hidden = !!rack.connected;
    $('rack-disconnect').hidden = !rack.connected;
  }
}
