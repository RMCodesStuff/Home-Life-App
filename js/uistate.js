// Main-screen UI state and the small pure rules behind it (chip limit, which rows and to-do lists start open, jump bar targets).
// The state lives for the session only (the app re-renders every minute or so, so it has to survive that); only the fine print
// choice is kept in localStorage.
import { getRaw, setRaw } from './store.js';

export const CHIP_LIMIT = 4;
export const TODO_AUTO_OPEN = 3;
export const FINE_KEY = 'hl.ui.fine';

export const ui = {
  narrative: false, // hero narrative expanded
  chips: false, // hero chips expanded
  rows: new Map(), // plan row id -> expanded (user choice)
  todo: null, // plan to-do list open (user choice), null = use the rule
  rd: {}, // rundown section key -> open
};

/** First `limit` chips; the rest are hidden behind a "+N more" button until `expanded`. */
export function limitChips(chips, expanded, limit = CHIP_LIMIT) {
  const list = Array.isArray(chips) ? chips : [];
  if (expanded || list.length <= limit) return { shown: list, hidden: 0 };
  return { shown: list.slice(0, limit), hidden: list.length - limit };
}

/** Should the plan's to-do list start open? Few items, before the first stop, or looking ahead (soon / tomorrow). */
export function todoDefaultOpen({ count, status, mode }) {
  return count <= TODO_AUTO_OPEN || status === 'before' || mode === 'soon' || mode === 'tomorrow';
}
export const todoIsOpen = (view, remembered = ui.todo) => (remembered == null ? todoDefaultOpen(view) : !!remembered);

/** Is this plan row expanded? The row you are on starts open; a choice the user made wins. */
export function rowExpanded(id, isNow, rows = ui.rows) {
  return rows.has(id) ? !!rows.get(id) : !!isNow;
}

// ---------- jump bar ----------
export const JUMP_ITEMS = [
  { key: 'today', label: 'today', icon: 'sun', target: '#hero' },
  { key: 'plan', label: 'plan', icon: 'suitcase', target: '#plan' },
  { key: 'day', label: 'day', icon: 'calendar', target: '#hourly .yourday', fallback: '#hourly' },
  { key: 'week', label: 'week', icon: 'calendar', target: '#week' },
  { key: 'settings', label: 'settings', icon: 'gear', target: null },
];
/** The bar's items; "plan" only while the plan card is showing. */
export const jumpItems = ({ planVisible = false } = {}) => JUMP_ITEMS.filter((i) => i.key !== 'plan' || planVisible);
/** Which bar item a page section belongs to (the rundown reads as part of the plan or today; the fine print as part of the week). */
export function jumpKeyForSection(id, planVisible) {
  switch (id) {
    case 'hero': return 'today';
    case 'plan': return 'plan';
    case 'rundown': return planVisible ? 'plan' : 'today';
    case 'hourly': return 'day';
    case 'week': case 'fine': return 'week';
    default: return null;
  }
}
/** Of the sections currently in the top band of the screen (in page order), the bar item to highlight; `prev` when none. */
export function pickActiveJump(sectionIds, planVisible, prev = null) {
  const keys = sectionIds.map((id) => jumpKeyForSection(id, planVisible)).filter(Boolean);
  const wanted = keys.length ? keys[keys.length - 1] : prev;
  return wanted === 'plan' && !planVisible ? 'today' : wanted;
}

// ---------- fine print ----------
let fineMem = null; // in case storage is blocked: the choice still holds for the session
export function fineOpen() { return fineMem != null ? fineMem : getRaw(FINE_KEY) === '1'; }
export function setFineOpen(on) { fineMem = !!on; setRaw(FINE_KEY, on ? '1' : '0'); }
