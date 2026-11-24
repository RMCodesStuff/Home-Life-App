// Main-screen UI rules: chip limit, to-do and row defaults, jump bar targets, and the collapsed plan card / rundown markup. All fictional.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ui, limitChips, todoDefaultOpen, todoIsOpen, rowExpanded, jumpItems, jumpKeyForSection, pickActiveJump, JUMP_ITEMS, CHIP_LIMIT } from '../js/uistate.js';
import { normalizePlan, composePlan } from '../js/plan.js';
import { planCardHTML, planSheetHTML } from '../js/planui.js';
import { rundownHTML } from '../js/render.js';

const reset = () => { ui.narrative = false; ui.chips = false; ui.rows.clear(); ui.todo = null; ui.rd = {}; };
const at = (iso) => Date.parse(iso);
const sat = (hhmm) => at(`2027-03-06T${hhmm}:00-07:00`);
const mk = (n = 3) => normalizePlan({
  v: 1, kind: 'home-life-plan', id: 'starfall-2027', title: 'starfall park weekend', tz: 'America/Denver', source: 'https://example.com/our-plan',
  days: [{
    date: '2027-03-06', title: 'starfall park', hours: '9am to 9pm',
    items: [
      { id: 'a', time: '09:00', title: 'gates open', where: 'main gate', who: 'everyone', note: 'be early', family: 'Robin meets us', tags: ['phone'], rides: ['comet coaster'] },
      { id: 'b', time: '10:00', title: 'teacups', where: 'fantasy lane', who: 'kids', note: 'quick one', tags: ['food'], rides: ['teacups'] },
      { id: 'c', time: '11:00', title: 'plain stop' },
    ],
  }, { date: '2027-03-07', title: 'water park', items: [{ id: 'd', time: '10:00', title: 'wave pool' }] }],
  checklist: Array.from({ length: n }, (_, i) => ({ id: `t${i}`, text: `task ${i}`, due: '2027-03-06' })),
});
const WAITS = [{ name: 'Comet Coaster', minutes: 30 }, { name: 'Teacups', minutes: 5 }];

test('limitChips shows the first four and counts the rest', () => {
  const six = ['1', '2', '3', '4', '5', '6'];
  assert.deepEqual(limitChips(six, false), { shown: ['1', '2', '3', '4'], hidden: 2 });
  assert.deepEqual(limitChips(six, true), { shown: six, hidden: 0 });
  assert.deepEqual(limitChips(six.slice(0, 4), false), { shown: six.slice(0, 4), hidden: 0 });
  assert.deepEqual(limitChips([], false), { shown: [], hidden: 0 });
  assert.deepEqual(limitChips(null, false), { shown: [], hidden: 0 });
  assert.equal(CHIP_LIMIT, 4);
});

test('to-do list opens when short, before the first stop, or looking ahead; a remembered choice wins', () => {
  assert.equal(todoDefaultOpen({ count: 3, status: 'during', mode: 'today' }), true);
  assert.equal(todoDefaultOpen({ count: 4, status: 'during', mode: 'today' }), false);
  assert.equal(todoDefaultOpen({ count: 6, status: 'before', mode: 'today' }), true);
  assert.equal(todoDefaultOpen({ count: 6, status: 'after', mode: 'today' }), false);
  assert.equal(todoDefaultOpen({ count: 6, mode: 'soon' }), true);
  assert.equal(todoDefaultOpen({ count: 6, mode: 'tomorrow' }), true);
  assert.equal(todoIsOpen({ count: 6, status: 'during', mode: 'today' }, null), false);
  assert.equal(todoIsOpen({ count: 6, status: 'during', mode: 'today' }, true), true);
  assert.equal(todoIsOpen({ count: 1, status: 'during', mode: 'today' }, false), false);
});

test('rows: the current row starts open, a user choice wins', () => {
  const rows = new Map();
  assert.equal(rowExpanded('x', true, rows), true);
  assert.equal(rowExpanded('x', false, rows), false);
  rows.set('x', false);
  assert.equal(rowExpanded('x', true, rows), false);
  rows.set('y', true);
  assert.equal(rowExpanded('y', false, rows), true);
});

test('jump bar items and targets', () => {
  assert.deepEqual(jumpItems({ planVisible: false }).map((i) => i.key), ['today', 'day', 'week', 'settings']);
  assert.deepEqual(jumpItems({ planVisible: true }).map((i) => i.key), ['today', 'plan', 'day', 'week', 'settings']);
  const t = Object.fromEntries(JUMP_ITEMS.map((i) => [i.key, i.target]));
  assert.equal(t.today, '#hero');
  assert.equal(t.plan, '#plan');
  assert.equal(t.day, '#hourly .yourday');
  assert.equal(JUMP_ITEMS.find((i) => i.key === 'day').fallback, '#hourly');
  assert.equal(t.week, '#week');
  assert.equal(t.settings, null);
  assert.equal(jumpKeyForSection('hero', true), 'today');
  assert.equal(jumpKeyForSection('rundown', true), 'plan');
  assert.equal(jumpKeyForSection('rundown', false), 'today');
  assert.equal(jumpKeyForSection('fine', false), 'week');
  assert.equal(jumpKeyForSection('nope', false), null);
});

test('active jump item: the last section in the top band wins, otherwise keep the previous', () => {
  assert.equal(pickActiveJump(['hero'], true, null), 'today');
  assert.equal(pickActiveJump(['hero', 'plan'], true, null), 'plan');
  assert.equal(pickActiveJump(['hourly', 'week'], false, 'today'), 'week');
  assert.equal(pickActiveJump([], false, 'day'), 'day');
  assert.equal(pickActiveJump([], true, null), null);
  assert.equal(pickActiveJump([], false, 'plan'), 'today', 'plan card went away');
});

test('plan card: rows are collapsed, the current row is open, details sit behind the toggle', () => {
  reset();
  const v = composePlan(mk(), { nowMs: sat('10:05'), waits: WAITS });
  const html = planCardHTML(v);
  const rowB = html.split('<li class="plan-row').find((x) => x.includes('data-plan-item="b"'));
  assert.ok(html.includes('plan-row is-now'));
  assert.match(rowB, /aria-expanded="true"/, 'current row (teacups) starts open');
  const rowC = html.split('<li class="plan-row').find((x) => x.includes('data-plan-item="c"'));
  assert.ok(!rowC.includes('aria-expanded'), 'a stop with nothing more to show has no toggle');
  ui.rows.set('b', false);
  const closed = planCardHTML(v).split('<li class="plan-row').find((x) => x.includes('data-plan-item="b"'));
  assert.match(closed, /aria-expanded="false"/);
  assert.match(closed, /class="plan-detail"[^>]*hidden/);
  assert.match(closed, /plan-wait/, 'live wait chip stays on the collapsed line');
  assert.ok(closed.indexOf('plan-wait') < closed.indexOf('plan-tag-food'), 'waits come before tags');
  reset();
});

test('plan card: to-do list is a details element that follows the open rule and is remembered', () => {
  reset();
  const few = planCardHTML(composePlan(mk(3), { nowMs: sat('10:05') }));
  assert.match(few, /<details class="plan-todo" open><summary>to do · 3/);
  const many = planCardHTML(composePlan(mk(5), { nowMs: sat('10:05') }));
  assert.match(many, /<details class="plan-todo"><summary>to do · 5/);
  const before = planCardHTML(composePlan(mk(5), { nowMs: sat('08:00') }));
  assert.match(before, /<details class="plan-todo" open>/);
  ui.todo = true;
  assert.match(planCardHTML(composePlan(mk(5), { nowMs: sat('10:05') })), /<details class="plan-todo" open>/);
  ui.todo = false;
  assert.match(planCardHTML(composePlan(mk(2), { nowMs: sat('10:05') })), /<details class="plan-todo"><summary>/);
  reset();
});

test('plan card: the next stop shows its live waits', () => {
  reset();
  const during = planCardHTML(composePlan(mk(), { nowMs: sat('09:30'), waits: WAITS }));
  const nextBlock = during.slice(during.indexOf('plan-kicker-next'), during.indexOf('plan-todo') > 0 ? during.indexOf('plan-todo') : during.indexOf('plan-list'));
  assert.match(nextBlock, /Teacups · <b>5 min<\/b>/);
  const before = planCardHTML(composePlan(mk(), { nowMs: sat('08:00'), waits: WAITS }));
  assert.match(before.slice(before.indexOf('first up'), before.indexOf('plan-todo')), /Comet Coaster · <b>30 min<\/b>/);
});

test('whole-trip sheet still shows every detail with no toggles', () => {
  const html = planSheetHTML(mk(), {});
  assert.ok(html.includes('main gate') && html.includes('be early') && html.includes('Robin meets us'));
  assert.ok(!html.includes('data-toggle-row'));
});

test('rundown: sections show a heading and summary; details open on tap; action buttons stay visible', () => {
  reset();
  const view = { home: { rundown: {
    sub: 'from claude at 5:41am', note: 'a quiet day.',
    money: { line: '2 bills due this week', bills: [{ text: 'card · $12.00 · tue' }], budget: null, over: [], notable: [] },
    fantasy: { line: 'lineup locks 11am', alerts: ['a starter is questionable'], swaps: [], waivers: [] },
    playlist: { name: 'Westbound', why: 'road trip', url: 'https://open.spotify.com/playlist/abc' },
  } } };
  const html = rundownHTML(view);
  assert.ok(html.includes('a quiet day.'), 'note stays visible');
  assert.match(html, /data-toggle="rd:money" aria-expanded="false" aria-controls="rd-money"/);
  assert.match(html, /id="rd-money" hidden/);
  assert.ok(html.includes('2 bills due this week'), 'summary visible');
  assert.match(html, /<a class="btn btn-accent rd-btn" href="https:\/\/open.spotify.com/, 'spotify button outside the collapsed detail');
  ui.rd.money = true;
  const open = rundownHTML(view);
  assert.match(open, /aria-expanded="true"/);
  assert.doesNotMatch(open, /id="rd-money" hidden/);
  assert.match(open, /id="rd-fantasy" hidden/);
  // nothing more to show: a plain heading and line, no toggle
  const plain = rundownHTML({ home: { rundown: { sub: 's', note: '', money: null, fantasy: { line: 'quiet day', alerts: [], swaps: [], waivers: [] }, playlist: null } } });
  assert.ok(plain.includes('quiet day') && !plain.includes('data-toggle'));
  reset();
});
