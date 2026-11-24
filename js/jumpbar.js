// The phone's bottom jump bar: today / plan / day / week / settings. Buttons, not "#" links (the URL hash carries #plan= and #setup= imports).
import { icon } from './icons.js';
import { jumpItems, pickActiveJump, JUMP_ITEMS } from './uistate.js';

const SECTIONS = ['hero', 'plan', 'rundown', 'hourly', 'week', 'fine']; // page order on a phone
let nav = null;
let openSettingsFn = () => {};
let state = { ready: false, planVisible: false };
let active = null;
const inBand = new Set();

const reduced = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

export function jumpBarHTML(items) {
  return items.map((i) => `<button type="button" class="jb-btn" data-jump="${i.key}">${icon(i.icon, { size: 20 })}<span>${i.label}</span></button>`).join('');
}

function paintActive() {
  if (!nav) return;
  nav.querySelectorAll('[data-jump]').forEach((b) => {
    if (b.dataset.jump === active) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
  });
}

function recompute() {
  const ids = SECTIONS.filter((id) => inBand.has(id));
  active = pickActiveJump(ids, state.planVisible, active);
  paintActive();
}

/** Scrolls to a section ("settings" opens the sheet). Also used by the hero's "next" chip. */
export function jumpTo(key) {
  if (key === 'settings') { openSettingsFn(); return; }
  const item = JUMP_ITEMS.find((i) => i.key === key);
  if (!item || !item.target) return;
  let el = document.querySelector(item.target);
  if ((!el || el.hidden) && item.fallback) el = document.querySelector(item.fallback);
  if (!el || el.closest('[hidden]')) return;
  active = key;
  paintActive();
  el.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
}

/** Call after every render: shows the bar only on a ready screen, and the plan button only while the plan card is up. */
export function updateJumpBar({ ready, planVisible }) {
  if (!nav) return;
  const changed = ready !== state.ready || planVisible !== state.planVisible || !nav.firstElementChild;
  state = { ready: !!ready, planVisible: !!planVisible };
  nav.hidden = !ready;
  document.body.classList.toggle('has-jumpbar', !!ready);
  if (!changed) return;
  nav.innerHTML = jumpBarHTML(jumpItems({ planVisible: state.planVisible }));
  recompute();
}

export function initJumpBar(el, { openSettings }) {
  nav = el;
  if (!nav) return;
  openSettingsFn = openSettings;
  if (typeof IntersectionObserver !== 'function') return;
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) inBand.add(e.target.id); else inBand.delete(e.target.id); });
    recompute();
  }, { rootMargin: '0px 0px -70% 0px', threshold: 0 }); // the top 30% of the screen
  SECTIONS.forEach((id) => { const s = document.getElementById(id); if (s) io.observe(s); });
}
