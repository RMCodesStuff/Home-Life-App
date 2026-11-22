// Settings sheet (<dialog>) and the reusable city picker (also used by onboarding).
import { icon } from './icons.js';
import { searchCities, reverseGeocode, currentPosition, placeLabel } from './geo.js';
import { fetchCalendar, describeCalendarError } from './calendar.js';
import { MODELS } from './ai.js';
import { esc, clockAt } from './render.js';

// ---------- city picker ----------
export function mountCityPicker(root, { prefix, onPick }) {
  root.innerHTML = `
    <label class="vh" for="${prefix}-search">search for a city</label>
    <input id="${prefix}-search" type="search" placeholder="search for a city, like springfield, il" autocomplete="off" spellcheck="false" enterkeyhint="search">
    <div class="results" id="${prefix}-results" role="listbox" aria-label="matching places"></div>
    <button class="btn loc-btn" type="button" id="${prefix}-locate">${icon('pin', { size: 16 })} use my current location</button>
    <p class="msg" id="${prefix}-msg" role="status"></p>`;
  const input = root.querySelector(`#${prefix}-search`);
  const results = root.querySelector(`#${prefix}-results`);
  const msg = root.querySelector(`#${prefix}-msg`);
  const locate = root.querySelector(`#${prefix}-locate`);
  let timer = null; let seq = 0;
  const say = (text, err = false) => { msg.textContent = text; msg.classList.toggle('err', err); };

  async function run() {
    const q = input.value.trim();
    const my = ++seq;
    if (q.length < 2) { results.innerHTML = ''; say(''); return; }
    say('searching…');
    try {
      const list = await searchCities(q);
      if (my !== seq) return;
      say(list.length ? '' : `no places match "${q}". try just the city name.`);
      results.innerHTML = list.map((p, i) => `<button type="button" role="option" data-i="${i}"><span>${esc(p.name)}</span><span class="r-region">${esc([p.region, p.countryCode === 'US' ? '' : p.country].filter(Boolean).join(', '))}</span></button>`).join('');
      results.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
        const p = list[+b.dataset.i];
        results.innerHTML = ''; input.value = placeLabel(p); say('');
        onPick({ name: p.name, region: p.region, lat: p.lat, lon: p.lon, countryCode: p.countryCode, timezone: p.timezone });
      }));
    } catch {
      if (my === seq) say("couldn't search right now. check your connection and try again.", true);
    }
  }
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 300); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); run(); }
    if (e.key === 'ArrowDown') { const b = results.querySelector('button'); if (b) { e.preventDefault(); b.focus(); } }
  });
  locate.addEventListener('click', async () => {
    say('finding you…'); locate.disabled = true;
    try {
      const pos = await currentPosition();
      const where = await reverseGeocode(pos.lat, pos.lon);
      say('');
      onPick({ name: (where && where.city) || 'my location', region: (where && where.region) || '', lat: +pos.lat.toFixed(4), lon: +pos.lon.toFixed(4), countryCode: (where && where.countryCode) || '' });
    } catch (e) {
      if (e && e.code === 'denied') say("location is blocked for this site. allow it in your browser's site settings, or search for your city instead.", true);
      else if (e && e.code === 'unsupported') say("this browser can't share your location. search for your city instead.", true);
      else say("couldn't get your location. search for your city instead.", true);
    } finally { locate.disabled = false; }
  });
}

// ---------- settings sheet ----------
let api = null; // {getSettings, save(settings, kind), getStatus}
let dialog = null;
let scriptText = null;
let installEvent = null;

const STEPS = `
  <li>Open <a href="https://script.google.com" target="_blank" rel="noopener">script.google.com</a> and create a new project.</li>
  <li>Delete the sample code and paste the script (<b>copy script</b> below already contains your private key).</li>
  <li>Click <b>Deploy → New deployment</b>, choose type <b>Web app</b>.</li>
  <li>Set <b>Execute as: Me</b> and <b>Who has access: Anyone</b>, then <b>Deploy</b>.</li>
  <li>Approve the Google permission prompt (it only reads your calendars).</li>
  <li>Copy the <b>Web app URL</b> (ends in <code>/exec</code>), paste it below, then tap <b>test connection</b>.</li>`;

function markup(s) {
  const seg = (name, opts, cur) => `<div class="seg-opts">${opts.map(([v, label]) => `<input type="radio" name="${name}" id="${name}-${v}" value="${v}"${cur === v ? ' checked' : ''}><label for="${name}-${v}">${label}</label>`).join('')}</div>`;
  return `<div class="sheet-inner">
    <header class="sheet-head"><h2 id="settings-title">Settings</h2>
      <button type="button" class="icon-btn" id="settings-close" aria-label="close settings">${icon('close', { size: 22 })}</button></header>

    <section class="set-sec" id="set-home" aria-labelledby="set-home-h">
      <h3 id="set-home-h">Home</h3>
      <p class="status" id="home-current"></p>
      <div class="picker" id="set-picker"></div>
      <label for="home-label">label</label>
      <input type="text" id="home-label" maxlength="24" placeholder="home" value="${esc(s.homeLabel || 'home')}">
    </section>

    <section class="set-sec" id="set-calendar" aria-labelledby="set-cal-h">
      <h3 id="set-cal-h">Calendar</h3>
      <p class="status" id="cal-status">not connected</p>
      <ol class="steps">${STEPS}</ol>
      <div class="set-row"><button class="btn btn-accent" type="button" id="cal-copy">${icon('calendar', { size: 16 })} copy script</button></div>
      <p class="result" id="cal-copy-result" role="status"></p>
      <label for="cal-script" class="vh">calendar script</label>
      <textarea id="cal-script" readonly hidden></textarea>
      <label for="cal-url">web app url</label>
      <input type="url" id="cal-url" inputmode="url" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(s.calendar.url || '')}" autocomplete="off" spellcheck="false">
      <div class="set-row"><button class="btn" type="button" id="cal-test">test connection</button></div>
      <p class="result" id="cal-test-result" role="status"></p>
      <p class="note">anyone who has both the url and the key could read event titles, times and locations for the next two weeks. keep them private.</p>
    </section>

    <section class="set-sec" id="set-ai" aria-labelledby="set-ai-h">
      <h3 id="set-ai-h">Written forecast</h3>
      <label class="switch" for="ai-enabled"><input type="checkbox" id="ai-enabled"${s.ai.enabled ? ' checked' : ''}> use claude</label>
      <label for="ai-key">api key</label>
      <div class="set-row" style="margin-top:0"><input type="password" id="ai-key" autocomplete="off" spellcheck="false" placeholder="sk-ant-…" value="${esc(s.ai.key || '')}">
        <button class="btn" type="button" id="ai-key-show" aria-controls="ai-key">show</button></div>
      <label for="ai-model">model</label>
      <select id="ai-model">${MODELS.map((m) => `<option value="${m.id}"${s.ai.model === m.id ? ' selected' : ''}>${m.label}</option>`).join('')}</select>
      <p class="note">your key is stored only in this browser and sent only to api.anthropic.com. claude rewrites the forecast at most every 3 hours; with opus 5.5 that's a few cents per rewrite, with haiku 5.5 a fraction of a cent. <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noopener">get a key</a></p>
    </section>

    <section class="set-sec" id="set-display" aria-labelledby="set-display-h">
      <h3 id="set-display-h">Display</h3>
      <fieldset class="seg"><legend>units</legend>${seg('units', [['imperial', '°F'], ['metric', '°C']], s.units)}</fieldset>
      <fieldset class="seg"><legend>theme</legend>${seg('theme', [['auto', 'auto'], ['dark', 'dark'], ['light', 'light']], s.theme)}</fieldset>
    </section>

    <section class="set-sec" id="set-install" aria-labelledby="set-install-h">
      <h3 id="set-install-h">Install</h3>
      <button class="btn btn-accent" type="button" id="install-btn" hidden>install app</button>
      <p class="note" id="install-help">in chrome: ⋮ menu → cast, save, and share → install page as app. on android: ⋮ → add to home screen.</p>
    </section>
  </div>`;
}

export function initSettings(el, options) {
  dialog = el;
  api = options;
  build();
  // close on backdrop click
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
}

function build() {
  const s = api.getSettings();
  dialog.innerHTML = markup(s);
  const $ = (id) => dialog.querySelector(`#${id}`);
  $('settings-close').addEventListener('click', () => dialog.close());

  mountCityPicker($('set-picker'), {
    prefix: 'set',
    onPick: (place) => { const st = api.getSettings(); st.home = place; api.save(st, 'home'); refreshStatus(); },
  });
  $('home-label').addEventListener('change', (e) => { const st = api.getSettings(); st.homeLabel = e.target.value.trim().toLowerCase() || 'home'; api.save(st, 'label'); });

  // calendar
  $('cal-copy').addEventListener('click', copyScript);
  $('cal-url').addEventListener('change', (e) => {
    const st = api.getSettings(); st.calendar.url = e.target.value.trim(); api.save(st, 'calendar'); refreshStatus();
  });
  $('cal-test').addEventListener('click', async () => {
    const out = $('cal-test-result'); const url = $('cal-url').value.trim();
    out.classList.remove('err');
    if (!/^https:\/\//.test(url)) { out.textContent = 'paste the web app url first (it starts with https:// and ends in /exec).'; out.classList.add('err'); return; }
    out.textContent = 'testing…';
    try {
      const st = api.getSettings();
      const res = await fetchCalendar(url, st.calendar.secret);
      out.textContent = `found ${res.events.length} event${res.events.length === 1 ? '' : 's'}`;
      if (st.calendar.url !== url) { st.calendar.url = url; }
      api.save(st, 'calendar');
      refreshStatus();
    } catch (err) {
      out.textContent = describeCalendarError(err); out.classList.add('err');
    }
  });

  // ai
  $('ai-enabled').addEventListener('change', (e) => { const st = api.getSettings(); st.ai.enabled = e.target.checked; api.save(st, 'ai'); });
  $('ai-key').addEventListener('change', (e) => { const st = api.getSettings(); st.ai.key = e.target.value.trim(); api.save(st, 'ai'); });
  $('ai-key-show').addEventListener('click', (e) => {
    const k = $('ai-key'); const show = k.type === 'password';
    k.type = show ? 'text' : 'password'; e.currentTarget.textContent = show ? 'hide' : 'show';
  });
  $('ai-model').addEventListener('change', (e) => { const st = api.getSettings(); st.ai.model = e.target.value; api.save(st, 'ai'); });

  // display
  dialog.querySelectorAll('input[name="units"]').forEach((r) => r.addEventListener('change', (e) => { const st = api.getSettings(); st.units = e.target.value; api.save(st, 'units'); }));
  dialog.querySelectorAll('input[name="theme"]').forEach((r) => r.addEventListener('change', (e) => { const st = api.getSettings(); st.theme = e.target.value; api.save(st, 'theme'); }));

  // install
  $('install-btn').addEventListener('click', async () => {
    if (!installEvent) return;
    installEvent.prompt();
    try { await installEvent.userChoice; } catch { /* ignore */ }
    installEvent = null; refreshInstall();
  });
  refreshStatus();
  refreshInstall();
}

async function loadScript() {
  if (scriptText) return scriptText;
  const res = await fetch('./calendar-bridge/Code.gs', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`http ${res.status}`);
  scriptText = await res.text();
  return scriptText;
}
function personalScript(text) {
  return text.replace('__PASTE_SECRET_HERE__', api.getSettings().calendar.secret);
}
async function copyScript() {
  const out = dialog.querySelector('#cal-copy-result');
  const ta = dialog.querySelector('#cal-script');
  out.classList.remove('err');
  let text;
  try {
    text = personalScript(scriptText || await loadScript());
  } catch {
    out.textContent = "couldn't load the script. check your connection and try again."; out.classList.add('err');
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    out.textContent = 'copied. paste it into the apps script editor.';
    ta.hidden = true;
  } catch {
    ta.value = text; ta.hidden = false; ta.focus(); ta.select();
    out.textContent = "couldn't copy automatically. the script is selected below; copy it with ctrl+c / ⌘c.";
  }
}

export function refreshStatus() {
  if (!dialog || !api) return;
  const s = api.getSettings();
  const st = api.getStatus ? api.getStatus() : {};
  const home = dialog.querySelector('#home-current');
  if (home) home.textContent = s.home ? `home is ${placeLabel(s.home).toLowerCase()}` : 'no home set yet';
  const cal = dialog.querySelector('#cal-status');
  if (cal) {
    const c = st.calendar || {};
    if (!s.calendar.url) cal.textContent = 'not connected';
    else if (c.error && !c.count) cal.textContent = `not working · ${c.error}`;
    else if (c.fetchedAt) cal.innerHTML = `<span class="ok">connected</span> · ${c.count} event${c.count === 1 ? '' : 's'} · synced ${esc(clockAt(c.fetchedAt, c.offset || 0))}`;
    else cal.textContent = 'connected · syncing…';
  }
}

function refreshInstall() {
  if (!dialog) return;
  const standalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
  dialog.querySelector('#set-install').hidden = !!standalone;
  dialog.querySelector('#install-btn').hidden = !installEvent;
  dialog.querySelector('#install-help').hidden = !!installEvent;
}
export function setInstallPrompt(e) { installEvent = e; refreshInstall(); }

export function openSettings(section) {
  if (!dialog) return;
  refreshStatus();
  refreshInstall();
  loadScript().catch(() => {});
  if (!dialog.open) dialog.showModal();
  const target = section && dialog.querySelector(`#set-${section}`);
  if (target) {
    target.scrollIntoView({ block: 'start' });
    const first = target.querySelector('input, button, select');
    if (first) first.focus({ preventScroll: true });
  }
}
