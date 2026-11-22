// Settings sheet (<dialog>) and the reusable city picker (also used by onboarding).
import { icon } from './icons.js';
import { searchCities, reverseGeocode, currentPosition, placeLabel } from './geo.js';
import { fetchCalendar, describeCalendarError } from './calendar.js';
import { fmtMonthDay, fmtDateRange } from './time.js';
import { parseChecklist, checklistItems } from './tripprep.js';
import { eveningStart } from './evening.js';
import { extraMarkup, wireExtras, refreshExtras } from './settings2.js';
import { MODELS } from './ai.js';
import { esc, clockAt } from './render.js';

// ---------- city picker ----------
export function mountCityPicker(root, { prefix, onPick, locate: withLocate = true, placeholder = 'search for a city, like springfield, il' }) {
  root.innerHTML = `
    <label class="vh" for="${prefix}-search">search for a city</label>
    <input id="${prefix}-search" type="search" placeholder="${esc(placeholder)}" autocomplete="off" spellcheck="false" enterkeyhint="search">
    <div class="results" id="${prefix}-results" role="listbox" aria-label="matching places"></div>
    <button class="btn loc-btn" type="button" id="${prefix}-locate"${withLocate ? '' : ' hidden'}>${icon('pin', { size: 16 })} use my current location</button>
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
let manifestText = null;
let installEvent = null;

const STEPS = `
  <li>Open <a href="https://script.google.com" target="_blank" rel="noopener">script.google.com</a> and create a new project.</li>
  <li>Delete the sample code and paste the script (<b>copy script</b> below already contains your private key).</li>
  <li>Open <b>Project Settings</b> (gear icon) and tick <b>Show "appsscript.json" manifest file in editor</b>.</li>
  <li>Back in the editor, open <b>appsscript.json</b> and paste over it (<b>copy manifest</b> below).</li>
  <li>Click <b>Deploy → New deployment</b>, choose <b>Web app</b>, set <b>Execute as: Me</b> and <b>Who has access: Anyone</b>, then <b>Deploy</b>.</li>
  <li>Approve the Google permission prompt (read-only calendar, gmail, drive and contacts).</li>
  <li>Copy the <b>Web app URL</b> (ends in <code>/exec</code>), paste it below, then tap <b>test connection</b>.</li>`;

const UPDATE_STEPS = `
  <li>Paste the new script and the manifest (<b>copy script</b> and <b>copy manifest</b> below).</li>
  <li>Click <b>Deploy → Manage deployments</b>, then the pencil (edit) icon.</li>
  <li>Set <b>Version: New version</b> and click <b>Deploy</b>. The URL stays the same.</li>`;

const OURA_STEPS = `
  <li>Create an application at <a href="https://cloud.ouraring.com/oauth/applications" target="_blank" rel="noopener">cloud.ouraring.com/oauth/applications</a> (free). Scope: <b>daily</b>. Set the redirect URI to your web app url:
    <span class="copy-field"><input type="text" id="oura-redirect" readonly aria-label="your web app url, used as the oura redirect uri" placeholder="paste your web app url under Google first" spellcheck="false">
    <button class="btn" type="button" id="oura-redirect-copy">copy</button></span></li>
  <li>In Apps Script, open <b>Project Settings → Script properties</b> and add <b>OURA_CLIENT_ID</b> and <b>OURA_CLIENT_SECRET</b>.</li>
  <li>Tap <b>connect oura</b> below and authorize.</li>`;

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
      <h3 id="set-cal-h">Google</h3>
      <p class="status" id="cal-status">not connected</p>
      <p class="note tight" id="cal-extras" hidden></p>
      <div class="notice" id="cal-update" hidden><b>your google script is out of date.</b> <span id="cal-update-what"></span><ol>${UPDATE_STEPS}</ol></div>
      <ol class="steps" id="cal-steps">${STEPS}</ol>
      <div class="set-row"><button class="btn btn-accent" type="button" id="cal-copy">${icon('calendar', { size: 16 })} copy script</button>
        <button class="btn btn-accent" type="button" id="cal-copy-manifest">${icon('calendar', { size: 16 })} copy manifest</button></div>
      <p class="result" id="cal-copy-result" role="status"></p>
      <label for="cal-script" class="vh">calendar script</label>
      <textarea id="cal-script" readonly hidden></textarea>
      <p class="result" id="cal-manifest-result" role="status"></p>
      <label for="cal-manifest" class="vh">script manifest</label>
      <textarea id="cal-manifest" readonly hidden></textarea>
      <label for="cal-url">web app url</label>
      <input type="url" id="cal-url" inputmode="url" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(s.calendar.url || '')}" autocomplete="off" spellcheck="false">
      <div class="set-row"><button class="btn" type="button" id="cal-test">test connection</button></div>
      <p class="result" id="cal-test-result" role="status"></p>
      <p class="subhead">show in the app</p>
      <label class="switch" for="show-inbox"><input type="checkbox" id="show-inbox"${s.show.inbox ? ' checked' : ''}> show waiting on you</label>
      <label class="switch" for="show-leaveby"><input type="checkbox" id="show-leaveby"${s.show.leaveBy ? ' checked' : ''}> show leave-by times</label>
      <label class="switch" for="show-rundown"><input type="checkbox" id="show-rundown"${s.show.rundown !== false ? ' checked' : ''}> show the rundown (from the daily claude run)</label>
      <label class="switch" for="show-birthdays"><input type="checkbox" id="show-birthdays"${s.show.birthdays !== false ? ' checked' : ''}> show birthdays</label>
      <p class="note">anyone who has both the url and the key could read what the script returns: event titles, times and locations, email senders and subjects, drive times, park hours and oura scores. keep them private.</p>
    </section>

    <section class="set-sec" id="set-trip" aria-labelledby="set-trip-h">
      <h3 id="set-trip-h">Trips</h3>
      <p class="status" id="trip-status">no trip added here</p>
      <p class="note tight">trips are spotted from your calendar. add one here if it isn't on the calendar yet, or before you connect google.</p>
      <div class="picker" id="trip-picker"></div>
      <div class="date-row">
        <div><label for="trip-depart">leave</label><input type="date" id="trip-depart" value="${esc(s.trip.manual ? s.trip.manual.departDate : '')}"></div>
        <div><label for="trip-return">back home</label><input type="date" id="trip-return" value="${esc(s.trip.manual ? s.trip.manual.returnDate : '')}"></div>
      </div>
      <div class="set-row"><button class="btn btn-accent" type="button" id="trip-save">${icon('suitcase', { size: 16 })} save trip</button>
        <button class="btn" type="button" id="trip-clear"${s.trip.manual ? '' : ' hidden'}>remove trip</button></div>
      <p class="result" id="trip-result" role="status"></p>
      <p class="subhead">show in the app</p>
      <label class="switch" for="show-tripprep"><input type="checkbox" id="show-tripprep"${s.show.tripPrep !== false ? ' checked' : ''}> trip prep, from 3 days before you leave</label>
      <label class="switch" for="show-parks"><input type="checkbox" id="show-parks"${s.show.parks !== false ? ' checked' : ''}> park days (hours, shows, waits)</label>
      <label for="trip-checklist">before you go, one per line</label>
      <textarea id="trip-checklist" class="list" rows="5" spellcheck="false">${esc(checklistItems(s.trip.checklist).join('\n'))}</textarea>
      <p class="note">packing ideas come from the forecast where you're going. ticks are kept for each trip on this device.</p>
    </section>

    <section class="set-sec" id="set-evening" aria-labelledby="set-evening-h">
      <h3 id="set-evening-h">Evening</h3>
      <label class="switch" for="evening-on"><input type="checkbox" id="evening-on"${s.evening.enabled !== false ? ' checked' : ''}> show tomorrow's edition in the evening</label>
      <label for="evening-start">starting at</label>
      <input type="time" id="evening-start" value="${esc(eveningStart(s.evening))}">
      <p class="note">from this time until midnight the top card previews tomorrow: the high, your first event, what to wear and tonight's low. "show today" switches back for the rest of the evening.</p>
    </section>
    ${extraMarkup(s, seg)}

    <section class="set-sec" id="set-oura" aria-labelledby="set-oura-h">
      <h3 id="set-oura-h">Oura</h3>
      <p class="status" id="oura-status">not set up</p>
      <ol class="steps">${OURA_STEPS}</ol>
      <div class="set-row"><a class="btn btn-accent" id="oura-connect" target="_blank" rel="noopener" href="#" aria-disabled="true">${icon('ring', { size: 16 })} connect oura</a></div>
      <label class="switch" for="show-oura"><input type="checkbox" id="show-oura"${s.show.oura ? ' checked' : ''}> show last night (oura)</label>
      <p class="note">needs an oura membership for gen3 and newer rings.</p>
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
      <label class="switch" for="show-speak"><input type="checkbox" id="show-speak"${s.show.speak !== false ? ' checked' : ''}> read it to me button</label>
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
  $('cal-copy-manifest').addEventListener('click', copyManifest);
  const toggle = (id, key) => $(id).addEventListener('change', (e) => { const st = api.getSettings(); st.show[key] = e.target.checked; api.save(st, 'show'); });
  toggle('show-inbox', 'inbox'); toggle('show-leaveby', 'leaveBy'); toggle('show-oura', 'oura');
  $('oura-redirect').addEventListener('focus', (e) => e.target.select());
  $('oura-redirect-copy').addEventListener('click', async () => {
    const url = api.getSettings().calendar.url;
    const b = $('oura-redirect-copy');
    if (!url) return;
    try { await navigator.clipboard.writeText(url); b.textContent = 'copied'; } catch { $('oura-redirect').select(); b.textContent = 'press ctrl+c'; }
    setTimeout(() => { b.textContent = 'copy'; }, 2500);
  });
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
      out.textContent = `found ${res.events.length} event${res.events.length === 1 ? '' : 's'} · script v${res.version}${res.version < 3 ? ', update it to add park hours & trip drive times' : ''}`;
      if (st.calendar.url !== url) { st.calendar.url = url; }
      api.save(st, 'calendar');
      refreshStatus();
    } catch (err) {
      out.textContent = describeCalendarError(err); out.classList.add('err');
    }
  });

  // trips
  let tripPlace = s.trip.manual ? { name: s.trip.manual.city, region: s.trip.manual.region || '', lat: s.trip.manual.lat, lon: s.trip.manual.lon, countryCode: s.trip.manual.countryCode || '' } : null;
  mountCityPicker($('trip-picker'), {
    prefix: 'trip', locate: false, placeholder: 'where to? search for a city',
    onPick: (place) => {
      tripPlace = place;
      $('trip-search').value = placeLabel(place);
      $('trip-results').innerHTML = '';
      say('trip-result', `going to ${placeLabel(place).toLowerCase()}. pick the dates, then save.`);
    },
  });
  if (tripPlace) $('trip-search').value = placeLabel(tripPlace);
  $('trip-save').addEventListener('click', () => {
    const dep = $('trip-depart').value; const ret = $('trip-return').value;
    if (!tripPlace) return say('trip-result', 'search for where you\'re going first.', true);
    if (!dep || !ret) return say('trip-result', 'pick the day you leave and the day you get back.', true);
    if (ret < dep) return say('trip-result', 'the day you get back is before the day you leave.', true);
    const st = api.getSettings();
    st.trip.manual = { city: tripPlace.name, region: tripPlace.region || '', countryCode: tripPlace.countryCode || '', lat: tripPlace.lat, lon: tripPlace.lon, departDate: dep, returnDate: ret };
    api.save(st, 'trip');
    $('trip-clear').hidden = false;
    say('trip-result', `saved. trip mode is on for ${tripPlace.name.toLowerCase()}, ${fmtDateRange(dep, ret)}.`);
    refreshStatus();
  });
  $('trip-clear').addEventListener('click', () => {
    const st = api.getSettings(); st.trip.manual = null; api.save(st, 'trip');
    tripPlace = null; $('trip-search').value = ''; $('trip-depart').value = ''; $('trip-return').value = '';
    $('trip-clear').hidden = true;
    say('trip-result', 'removed. trips from your calendar still show up.');
    refreshStatus();
  });
  toggle('show-tripprep', 'tripPrep'); toggle('show-parks', 'parks');
  toggle('show-rundown', 'rundown'); toggle('show-birthdays', 'birthdays'); toggle('show-speak', 'speak');
  wireExtras({ dialog, api, toggle });
  $('trip-checklist').addEventListener('change', (e) => {
    const st = api.getSettings(); st.trip.checklist = parseChecklist(e.target.value); api.save(st, 'checklist');
    e.target.value = checklistItems(st.trip.checklist).join('\n');
  });

  // evening
  $('evening-on').addEventListener('change', (e) => { const st = api.getSettings(); st.evening.enabled = e.target.checked; api.save(st, 'evening'); });
  $('evening-start').addEventListener('change', (e) => {
    const st = api.getSettings(); st.evening.start = /^\d{2}:\d{2}$/.test(e.target.value) ? e.target.value : '18:00'; api.save(st, 'evening');
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

function say(id, text, err = false) {
  const out = dialog.querySelector(`#${id}`);
  if (!out) return;
  out.textContent = text;
  out.classList.toggle('err', err);
}

async function loadText(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`http ${res.status}`);
  return res.text();
}
async function loadScript() {
  if (!scriptText) scriptText = await loadText('./calendar-bridge/Code.gs');
  return scriptText;
}
async function loadManifest() {
  if (!manifestText) manifestText = await loadText('./calendar-bridge/appsscript.json');
  return manifestText;
}
function personalScript(text) {
  return text.replace('__PASTE_SECRET_HERE__', api.getSettings().calendar.secret);
}
/** The manifest wants the user's own time zone; the browser knows it. */
export function personalManifest(text, zone) {
  return text.replace('__TIME_ZONE__', zone || (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ''; } })() || 'America/New_York');
}
/** Copies text from inside the click handler (already-loaded text keeps the user gesture); falls back to a selected textarea. */
async function copyBlock({ cached, load, transform, outId, taId, ok, fallback }) {
  const out = dialog.querySelector(`#${outId}`);
  const ta = dialog.querySelector(`#${taId}`);
  out.classList.remove('err');
  let text;
  try {
    text = transform(cached() || await load());
  } catch {
    out.textContent = "couldn't load it. check your connection and try again."; out.classList.add('err');
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    out.textContent = ok;
    ta.hidden = true;
  } catch {
    ta.value = text; ta.hidden = false; ta.focus(); ta.select();
    out.textContent = fallback;
  }
}
const copyScript = () => copyBlock({
  cached: () => scriptText, load: loadScript, transform: personalScript, outId: 'cal-copy-result', taId: 'cal-script',
  ok: 'copied. paste it into the apps script editor.',
  fallback: "couldn't copy automatically. the script is selected below; copy it with ctrl+c / ⌘c.",
});
const copyManifest = () => copyBlock({
  cached: () => manifestText, load: loadManifest, transform: (t) => personalManifest(t), outId: 'cal-manifest-result', taId: 'cal-manifest',
  ok: 'copied. paste it over appsscript.json in the editor.',
  fallback: "couldn't copy automatically. the manifest is selected below; copy it with ctrl+c / ⌘c.",
});

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
    const b = st.bridge;
    if (s.calendar.url && b && !(c.error && !c.count)) {
      const feats = ['calendar', ...(b.version >= 2 && b.features.gmail ? ['gmail'] : []), ...(b.version >= 2 && b.features.leaveBy ? ['drive times'] : []),
        ...(b.version >= 3 && b.features.parks ? ['park hours'] : []), ...(b.version >= 3 && b.features.tripDrive ? ['trip drive'] : [])];
      cal.innerHTML = `<span class="ok">connected</span> · v${b.version} · ${esc(feats.join(', '))}${c.fetchedAt ? ` · synced ${esc(clockAt(c.fetchedAt, c.offset || 0))}` : ''}`;
    }
  }
  const upd = dialog.querySelector('#cal-update');
  if (upd) {
    upd.hidden = !(s.calendar.url && st.bridge && st.bridge.version < 3);
    const v = st.bridge ? st.bridge.version : 3;
    dialog.querySelector('#cal-update-what').textContent = `the new version adds ${v < 2 ? 'inbox, drive times, ' : ''}park hours and the drive time for trips. google will ask for two more read-only permissions: drive (to read the daily rundown file) and contacts (for birthdays). to update:`;
  }
  const extras = dialog.querySelector('#cal-extras');
  if (extras) {
    const lines = s.calendar.url ? bridgeProblems(st.bridgeExtras) : [];
    extras.hidden = !lines.length;
    extras.textContent = lines.join(' · ');
  }
  refreshExtras(dialog, api);
  const trip = dialog.querySelector('#trip-status');
  if (trip) {
    const m = s.trip.manual;
    const next = (st.trips || []).find((t) => !t.manual && t.returnDate >= (st.today || ''));
    trip.innerHTML = m ? `<span class="ok">trip mode</span> · ${esc(m.city.toLowerCase())}, ${esc(fmtDateRange(m.departDate, m.returnDate))}`
      : next ? `from your calendar: ${esc(next.city.toLowerCase())}, ${esc(fmtDateRange(next.departDate, next.returnDate))}` : 'no trip added here';
  }
  refreshOura(s, st);
}

/** Plain words for the v3 features that failed (normal states like "disabled" or "too close" say nothing). Pure. */
export function bridgeProblems(x) {
  if (!x) return [];
  const out = [];
  const b = x.briefing;
  if (b && !b.ok && b.error !== 'disabled') {
    out.push(b.error === 'not_found' ? 'rundown: no file yet (the daily run writes one each morning)'
      : b.error === 'too_big' ? 'rundown: the file is too big to read'
        : b.error === 'bad_json' ? "rundown: the file isn't valid json" : `rundown: ${b.error}`);
  }
  const bd = x.birthdays;
  if (bd && !bd.ok && bd.error !== 'disabled') out.push(`birthdays: ${bd.error}`);
  const p = x.parks;
  if (p && !p.ok && p.error !== 'disabled') out.push(p.error === 'themeparks unavailable' ? 'park hours: themeparks.wiki is unavailable right now' : `park hours: ${p.error}`);
  const t = x.tripDrive;
  if (t && !t.ok && !['disabled', 'too_close'].includes(t.error)) {
    out.push(t.error === 'no_route' ? 'trip drive: no driving route found' : t.error === 'bad_params' || t.error === 'no_origin' ? "trip drive: the request was incomplete, it'll try again" : `trip drive: ${t.error}`);
  }
  return out;
}

function refreshOura(s, st) {
  const status = dialog.querySelector('#oura-status');
  if (!status) return;
  const url = s.calendar.url;
  const redirect = dialog.querySelector('#oura-redirect');
  if (document.activeElement !== redirect) redirect.value = url || '';
  const link = dialog.querySelector('#oura-connect');
  if (url) {
    link.href = `${url}${url.includes('?') ? '&' : '?'}action=oura-connect&key=${encodeURIComponent(s.calendar.secret)}`;
    link.removeAttribute('aria-disabled');
  } else { link.href = '#'; link.setAttribute('aria-disabled', 'true'); }
  const o = st.oura;
  let text = 'not set up';
  let good = false;
  if (!url || !o) text = url ? 'checking…' : 'not set up';
  else if (o.version < 2) text = 'needs the updated google script first';
  else if (!o.data) text = 'not set up';
  else if (o.data.ok) {
    const score = o.data.readiness && o.data.readiness.score;
    const when = !o.data.day || o.data.day === st.today ? 'today' : `on ${fmtMonthDay(o.data.day)}`;
    text = score != null ? `connected · readiness ${Math.round(score)} ${when}` : 'connected';
    good = true;
  } else if (o.data.error === 'not_configured') text = 'not set up';
  else if (o.data.error === 'not_connected') text = 'not connected yet · tap connect oura';
  else text = o.data.message || o.data.error;
  status.innerHTML = good ? `<span class="ok">connected</span>${esc(text.slice('connected'.length))}` : esc(text);
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
  loadManifest().catch(() => {});
  if (!dialog.open) dialog.showModal();
  const target = section && dialog.querySelector(`#set-${section}`);
  if (target) {
    target.scrollIntoView({ block: 'start' });
    const first = target.querySelector('input, button, select');
    if (first) first.focus({ preventScroll: true });
  }
}
