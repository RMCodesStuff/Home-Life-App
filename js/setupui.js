// "Other devices" settings section, the QR code, and the confirm sheet for an incoming setup link (#setup=…).
import { buildSetupLink, parseSetupHash, applySetup, summarizeSetup, SETUP_PREFIX } from './devicesetup.js';
import { esc } from './render.js';

export const QR_LIB_URL = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';

export function setupMarkup() {
  return `
    <section class="set-sec" id="set-devices" aria-labelledby="set-devices-h">
      <h3 id="set-devices-h">Other devices</h3>
      <p class="note tight">set up your phone, or someone else's in your home, in one step: open the link on the other device and it picks up your home, your google script and the rest of these settings.</p>
      <label class="switch" for="setup-claude"><input type="checkbox" id="setup-claude"> include my claude api key</label>
      <div class="set-row"><button class="btn btn-accent" type="button" id="setup-copy">copy setup link</button>
        <button class="btn" type="button" id="setup-qr-btn">show QR code</button></div>
      <p class="result" id="setup-result" role="status"></p>
      <label for="setup-link" class="vh">setup link</label>
      <textarea id="setup-link" readonly hidden></textarea>
      <div class="qr-box" id="setup-qr" hidden></div>
      <p class="note warn-note">this link carries your google script key and home: anyone who has it can read what your script returns. send it only to yourself or someone else in your home.</p>
    </section>`;
}

// ---------- QR ----------
let qrLoading = null;
/** Loads the qrcode-generator UMD build once. Resolves to the global `qrcode` function, rejects if the CDN is unreachable. */
export function loadQr() {
  if (globalThis.qrcode) return Promise.resolve(globalThis.qrcode);
  if (!qrLoading) {
    qrLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = QR_LIB_URL; s.async = true;
      s.onload = () => (globalThis.qrcode ? resolve(globalThis.qrcode) : reject(new Error('qr library missing')));
      s.onerror = () => reject(new Error('qr library failed to load'));
      document.head.appendChild(s);
    });
  }
  return qrLoading;
}

/** SVG markup for `text`, dark modules on white with a 4-module quiet zone (scans on a dark screen). Throws if it does not fit. */
export function qrSvg(qrcode, text) {
  const qr = qrcode(0, 'L');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const q = 4;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + q} ${r + q}h1v1h-1z`;
  const size = n + q * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="QR code for the setup link" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

// ---------- settings section ----------
const currentLink = (api, dialog) => buildSetupLink(location.origin + location.pathname, api.getSettings(), { includeClaudeKey: dialog.querySelector('#setup-claude').checked });

export function wireSetup({ dialog, api }) {
  const $ = (id) => dialog.querySelector(`#${id}`);
  const say = (text, err = false) => { const o = $('setup-result'); o.textContent = text; o.classList.toggle('err', err); };
  const refreshQr = () => { if (!$('setup-qr').hidden) renderQr(); };

  async function renderQr() {
    const box = $('setup-qr');
    try {
      const qrcode = await loadQr();
      box.innerHTML = qrSvg(qrcode, currentLink(api, dialog));
      box.hidden = false;
      $('setup-qr-btn').textContent = 'hide QR code';
    } catch (err) {
      box.hidden = true; box.innerHTML = '';
      $('setup-qr-btn').textContent = 'show QR code';
      if (String(err && err.message).includes('overflow')) say("there's too much in your settings to fit in a QR code. use copy setup link instead.", true);
      else { $('setup-qr-btn').hidden = true; say('', false); }
    }
  }

  $('setup-copy').addEventListener('click', async () => {
    const link = currentLink(api, dialog);
    const ta = $('setup-link');
    $('setup-copy').dataset.link = link;
    say('');
    try {
      await navigator.clipboard.writeText(link);
      say('copied. open it on the other device.');
      ta.hidden = true;
    } catch {
      ta.value = link; ta.hidden = false; ta.focus(); ta.select();
      say("couldn't copy automatically. the link is selected below; copy it with ctrl+c / ⌘c.");
    }
  });
  $('setup-qr-btn').addEventListener('click', () => {
    if (!$('setup-qr').hidden) { $('setup-qr').hidden = true; $('setup-qr-btn').textContent = 'show QR code'; return; }
    say('');
    renderQr();
  });
  $('setup-claude').addEventListener('change', () => { $('setup-link').hidden = true; refreshQr(); });
  // find out early whether the QR library is reachable, so the button is hidden rather than failing on tap
  loadQr().catch(() => { $('setup-qr-btn').hidden = true; });
}

// ---------- incoming link ----------
function toast(text) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = text;
  el.hidden = false;
  setTimeout(() => { if (el.textContent === text) el.hidden = true; }, 9000);
}

function confirmSheet(lines, { onUse, onCancel }) {
  const d = document.createElement('dialog');
  d.className = 'sheet confirm';
  d.setAttribute('aria-labelledby', 'setup-confirm-h');
  d.innerHTML = `<div class="confirm-inner">
      <h2 id="setup-confirm-h">Set up this device with your Home Life settings?</h2>
      <p class="note tight">this replaces the settings on this device with these:</p>
      <ul class="confirm-list">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
      <div class="set-row"><button class="btn btn-accent" type="button" id="setup-use">use these settings</button>
        <button class="btn" type="button" id="setup-cancel">cancel</button></div>
    </div>`;
  document.body.appendChild(d);
  const close = (fn) => () => { d.close(); d.remove(); fn(); };
  d.querySelector('#setup-use').addEventListener('click', close(onUse));
  d.querySelector('#setup-cancel').addEventListener('click', close(onCancel));
  d.addEventListener('cancel', (e) => { e.preventDefault(); close(onCancel)(); });
  d.showModal();
  d.querySelector('#setup-use').focus();
}

/**
 * Call on boot. If the address has `#setup=…`: clears it from the address bar at once, then either shows a one-line error
 * or the confirm sheet. `apply(mergedSettings)` is called only after "use these settings".
 */
export function offerSetupFromHash({ getSettings, apply }) {
  if (!String(location.hash).startsWith(SETUP_PREFIX)) return false;
  const parsed = parseSetupHash(location.hash);
  try { history.replaceState(null, '', location.pathname + location.search); } catch { /* ignore */ }
  if (!parsed.ok) { toast(parsed.error); return true; }
  if (document.querySelector('dialog.confirm')) return true;
  const merged = applySetup(getSettings(), parsed.settings);
  const includesKey = !!parsed.settings.ai;
  confirmSheet(summarizeSetup(merged, { includesClaudeKey: includesKey }), { onUse: () => apply(merged), onCancel: () => {} });
  return true;
}
