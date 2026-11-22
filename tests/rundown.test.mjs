// The morning rundown, birthdays and read-aloud text. Everything here is fictional.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fmtMoney, safeSpotify, normalizeBriefing, rundownView, budgetPace, runClock, normalizeBirthdays, birthdayLines, birthdayTomorrow } from '../js/briefing.js';
import { readAloudText } from '../js/speech.js';
import { normalizeBridge } from '../js/calendar.js';

const DATA = {
  v: 1, generatedAt: '2026-11-22T05:41:00-07:00', forDate: '2026-11-22',
  push: '62° & sunny · church 8am', note: 'a quiet sunday. church first, then the drive west.',
  money: {
    line: '2 bills due this week ($612), groceries on pace',
    billsDue: [{ name: 'Card payment', amount: 412.18, date: '2026-11-24' }, { name: 'Water', amount: 199.8, date: '2026-11-27' }, { name: 'bad' }],
    budget: { month: '2026-11', spent: 2340.12, budgeted: 3000, pctOfMonth: 0.73 },
    overBudget: [{ category: 'Restaurants', spent: 410.5, budgeted: 300 }],
    notable: [{ merchant: 'Costco', amount: 286.41, date: '2026-11-21' }],
  },
  fantasy: { line: 'lineup locks 11am · 1 questionable', gameDay: true, lockLocal: '11:00am', matchup: 'you 112.4 projected vs 104.8', alerts: ['a starter is questionable (hamstring)'], swaps: ['start x over y (modest edge)'], waivers: [] },
  playlist: { name: 'Westbound', url: 'https://open.spotify.com/playlist/abc123', why: 'road trip to seattle' },
  trip: { city: 'Seattle', packing: ['a warm layer for nights in the low 50s', 'ear plugs'], note: 'cool nights' },
};
const B = (over = {}) => ({ ok: true, file: 'home-life-briefing-2026-11-22.json', forDate: '2026-11-22', stale: false, data: DATA, ...over });

test('fmtMoney and safe spotify links', () => {
  assert.equal(fmtMoney(1234.5), '$1,234.50');
  assert.equal(fmtMoney(412.18), '$412.18');
  assert.equal(fmtMoney(1234567), '$1,234,567.00');
  assert.equal(fmtMoney(-12), '-$12.00');
  assert.equal(fmtMoney(0.5), '$0.50');
  assert.equal(fmtMoney('12'), '');
  assert.equal(safeSpotify('https://open.spotify.com/playlist/x'), 'https://open.spotify.com/playlist/x');
  assert.equal(safeSpotify('spotify:playlist:x'), 'spotify:playlist:x');
  assert.equal(safeSpotify('javascript:alert(1)'), '');
  assert.equal(safeSpotify('https://evil.example/open.spotify.com/'), '');
  assert.equal(runClock('2026-11-22T05:41:00-07:00'), '5:41am');
});

test('normalizeBriefing: errors, sections that are null or {error}, junk dropped', () => {
  for (const error of ['disabled', 'not_found', 'too_big', 'bad_json', 'drive access not approved (redeploy and approve)']) {
    assert.deepEqual(normalizeBriefing({ ok: false, error }), { ok: false, error });
  }
  assert.equal(normalizeBriefing(null), null);
  assert.deepEqual(normalizeBriefing({ ok: true, forDate: '2026-11-22', data: [] }), { ok: false, error: 'bad_json' });
  const b = normalizeBriefing(B());
  assert.equal(b.ok, true);
  assert.equal(b.data.money.billsDue.length, 2, 'a bill without an amount is dropped');
  assert.equal(b.data.playlist.url, 'https://open.spotify.com/playlist/abc123');
  assert.deepEqual(b.data.trip.packing, ['a warm layer for nights in the low 50s', 'ear plugs']);
  const thin = normalizeBriefing(B({ data: { ...DATA, money: null, fantasy: { error: 'statsdeck unavailable' }, playlist: { name: 'x', url: 'javascript:x' }, trip: null } }));
  assert.equal(thin.data.money, null);
  assert.equal(thin.data.fantasy, null, '{error} sections are dropped');
  assert.equal(thin.data.playlist.url, '', 'unsafe links are dropped');
  assert.equal(thin.data.trip, null);
});

test('rundownView: sections, money formatting, hidden when old or failed, from yesterday when stale', () => {
  const v = rundownView(normalizeBriefing(B()), '2026-11-22');
  assert.equal(v.sub, 'from claude at 5:41am');
  assert.equal(v.clock, '5:41am');
  assert.equal(v.note, 'a quiet sunday. church first, then the drive west.');
  assert.deepEqual(v.money.bills.map((x) => x.text), ['card payment · $412.18 · tue', 'water · $199.80 · fri']);
  assert.deepEqual(v.money.over, ['restaurants · $410.50 of $300.00']);
  assert.deepEqual(v.money.notable, ['costco · $286.41 · sat']);
  assert.equal(v.money.budget.status, 'ahead of pace');
  assert.equal(v.money.budget.text, '$2,340.12 of $3,000.00 · 73% through the month');
  assert.deepEqual(v.fantasy, { line: 'lineup locks 11am · 1 questionable', alerts: ['a starter is questionable (hamstring)'], swaps: ['start x over y (modest edge)'], waivers: [] });
  assert.deepEqual(v.playlist, { name: 'Westbound', why: 'road trip to seattle', url: 'https://open.spotify.com/playlist/abc123' });
  const y = rundownView(normalizeBriefing(B({ forDate: '2026-11-21', stale: true, data: { ...DATA, forDate: '2026-11-21' } })), '2026-11-22');
  assert.equal(y.sub, 'from claude at 5:41am · from yesterday');
  assert.equal(rundownView(normalizeBriefing(B({ forDate: '2026-11-20' })), '2026-11-22'), null, 'older than yesterday');
  assert.equal(rundownView(normalizeBriefing({ ok: false, error: 'not_found' }), '2026-11-22'), null);
  const noGame = rundownView(normalizeBriefing(B({ data: { ...DATA, fantasy: { ...DATA.fantasy, gameDay: false, waivers: [] } } })), '2026-11-22');
  assert.equal(noGame.fantasy, null, 'fantasy only on game days or with waivers');
  const waivers = rundownView(normalizeBriefing(B({ data: { ...DATA, fantasy: { ...DATA.fantasy, gameDay: false, waivers: ['pick up z'] } } })), '2026-11-22');
  assert.deepEqual(waivers.fantasy.waivers, ['pick up z']);
  assert.equal(rundownView(normalizeBriefing(B({ data: { generatedAt: DATA.generatedAt } })), '2026-11-22'), null, 'nothing to show');
});

test('budgetPace', () => {
  assert.equal(budgetPace({ spent: 1500, budgeted: 3000, pctOfMonth: 0.5 }).status, 'on pace');
  assert.equal(budgetPace({ spent: 900, budgeted: 3000, pctOfMonth: 0.5 }).status, 'under pace');
  const over = budgetPace({ spent: 3300, budgeted: 3000, pctOfMonth: 0.9 });
  assert.equal(over.status, 'over budget');
  assert.equal(over.fill, 1);
  assert.equal(over.spentPct, 110);
  assert.equal(budgetPace({ spent: 100, budgeted: 3000, pctOfMonth: null }).marker, null);
});

test('birthdays: normalize, lines within 14 days, evening chip', () => {
  const b = normalizeBirthdays({ ok: true, upcoming: [
    { name: 'Pat Doe', date: '2026-11-26', daysAway: 4, turning: 60 },
    { name: 'Sam Roe', date: '2026-11-22', daysAway: 0, turning: null },
    { name: 'Lee Poe', date: '2026-11-23', daysAway: 1, turning: 9 },
    { name: 'Far Away', date: '2026-12-10', daysAway: 18, turning: null },
    { name: 'Mid Way', date: '2026-12-03', daysAway: 11, turning: 41 },
    { name: '', date: '2026-11-24' }, { name: 'No Date' },
  ] });
  assert.equal(b.upcoming.length, 5);
  assert.deepEqual(birthdayLines(b, '2026-11-22').map((x) => x.text), [
    "today: sam's birthday", "lee's birthday tomorrow · turning 9", "pat's birthday thursday · turning 60", "mid's birthday thu, dec 3 · turning 41",
  ]);
  assert.deepEqual(birthdayLines(b, '2026-11-23').map((x) => x.text).slice(0, 1), ["today: lee's birthday · turning 9"], 'recomputed from the date, not the cached daysAway');
  assert.equal(birthdayTomorrow(b, '2026-11-22'), "tomorrow is lee's birthday");
  assert.equal(birthdayTomorrow(b, '2026-11-20'), '');
  assert.equal(birthdayTomorrow({ ok: true, upcoming: [{ name: 'A B', date: '2026-11-23' }, { name: 'C D', date: '2026-11-23' }] }, '2026-11-22'), "tomorrow is a's and c's birthday");
  assert.deepEqual(normalizeBirthdays({ ok: false, error: 'contacts access not approved (redeploy and approve)' }), { ok: false, error: 'contacts access not approved (redeploy and approve)' });
  assert.deepEqual(birthdayLines({ ok: false }, '2026-11-22'), []);
});

test('normalizeBridge v3 carries the rundown and birthdays; v2 does not', () => {
  const v3 = normalizeBridge({ ok: true, version: 3, features: { briefing: true, birthdays: true }, briefing: B(), birthdays: { ok: true, upcoming: [] } });
  assert.equal(v3.briefing.ok, true);
  assert.deepEqual(v3.birthdays, { ok: true, upcoming: [] });
  assert.equal(v3.features.briefing, true);
  const v2 = normalizeBridge({ ok: true, version: 2, briefing: B() });
  assert.equal(v2.briefing, null);
  assert.equal(v2.birthdays, null);
});

test('readAloudText strips markers and reads chips and the rundown note', () => {
  const t = readAloudText({
    lead: '62° & sunny,', accent: 'another clean blue day', narrative: 'about 43 & clear at 7. *63 thu, then rain.*',
    chips: [{ label: 'umbrella', text: 'no, 0% all day' }, { label: 'leave', text: '7:33 for church · 22 min' }, { label: 'x', text: '' }], note: 'a quiet sunday',
  });
  assert.equal(t, '62 degrees and sunny, another clean blue day. about 43 and clear at 7. 63 thu, then rain. umbrella: no, 0% all day. leave: 7:33 for church, 22 min. a quiet sunday.');
  assert.ok(!t.includes('*'));
  assert.equal(readAloudText({}), '');
});
