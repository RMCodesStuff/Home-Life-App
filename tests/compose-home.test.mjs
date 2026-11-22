// The page's home-feature composition, the Claude facts for them, and the settings wording for bridge problems. All fictional.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalize } from '../js/weather.js';
import { modelAt } from '../js/evening.js';
import { composeHome, fineWithHome } from '../js/compose.js';
import { normalizeBriefing, normalizeBirthdays } from '../js/briefing.js';
import { buildFacts, extraFacts, fingerprint, SYSTEM_PROMPT } from '../js/ai.js';
import { writeAll } from '../js/insights.js';
import { bridgeProblems } from '../js/settings.js';

const raw = JSON.parse(fs.readFileSync(new URL('./fixtures/forecast.json', import.meta.url), 'utf8'));
const home = normalize(raw, { name: 'Fictionville' }, 'imperial', { aq: { us_aqi: 61, pm2_5: 9, pm10: 182, dust: 40 } });
const ctxAt = (now, over = {}) => {
  const m = modelAt(home, now);
  return { now, units: 'imperial', model: m, homeModel: m, tripModels: {}, travel: null, events: [], inbox: null, oura: { ok: true, readiness: { score: 72 } }, ...over };
};
const SHOW = { rundown: true, birthdays: true, dinner: true, workout: true, kidTips: true, radar: true, dust: true, parks: true };
const SETTINGS = {
  show: SHOW,
  phoenix: { power: { enabled: true, windows: [{ days: [0, 1, 2, 3, 4, 5, 6], start: '16:00', end: '19:00' }], months: [11], mode: 'months', hotAt: 90 }, watering: { enabled: true, days: [6, 0] } },
  chores: [
    { id: 't', name: 'trash', kind: 'bin', rule: { type: 'weekly', day: 0 }, holiday: true },
    { id: 'f', name: 'ac filter', kind: 'task', rule: { type: 'days', n: 30 }, last: '2026-10-22' },
  ],
  workout: { workCalendars: null, window: 'any' },
};
const BRIDGE = {
  version: 3,
  briefing: normalizeBriefing({ ok: true, forDate: '2026-11-21', data: { generatedAt: '2026-11-21T05:41:00-07:00', note: 'a calm saturday.' } }),
  birthdays: normalizeBirthdays({ ok: true, upcoming: [{ name: 'Pat Doe', date: '2026-11-22', turning: 60 }] }),
  parks: null,
};
const MEALS = {
  dates: ['2026-11-21', '2026-11-22', '2026-11-23'],
  plan: { saturday_dinner: 'r1', sunday_dinner: 'r2' },
  recipes: { r1: { name: 'Chicken Fried Rice', ingredients: ['1 lb chicken thighs'] }, r2: { name: 'Beef & Broccoli Bowls', ingredients: ['1 lb ground beef'] } },
};
const SUMMARY = { v: 1, app: 'rack-session-timer', updatedAt: '2026-11-20T19:00:00.000Z', date: '2026-11-20', week: { n: 3, of: 6 }, next: { full: { day: 'B', label: 'Day B', title: '', min: 24, lift: null } }, recent: [], moveUp: [] };

test('composeHome: morning chips, rundown, birthdays, dinner, workout, fine print', () => {
  const v = composeHome(ctxAt('2026-11-21T06:40'), { target: '2026-11-21', today: '2026-11-21', evening: false, settings: SETTINGS, bridge: BRIDGE, meals: MEALS, summary: SUMMARY });
  assert.equal(v.rundown.note, 'a calm saturday.');
  assert.deepEqual(v.birthdays, ["pat's birthday tomorrow · turning 60"]);
  assert.equal(v.dinner.meals.dinner.name, 'Chicken Fried Rice');
  assert.equal(v.workout.state, 'propose');
  assert.equal(v.workout.version, 'full');
  const keys = v.chipsToday.map((c) => c.key);
  assert.ok(keys.includes('train'), 'train chip');
  assert.ok(keys.includes('power'), 'power peak (november enabled in this test)');
  assert.ok(keys.includes('water'), 'saturday is a watering day');
  assert.ok(keys.includes('dust'), 'pm10 182');
  assert.ok(keys.includes('chore:f'), 'ac filter due');
  assert.ok(!keys.includes('chore:t'), 'bins only show the night before');
  assert.equal(v.chipsToday.find((c) => c.key === 'train').after, 'leave');
  assert.deepEqual(v.chipsTomorrow, [], 'no evening chips in the morning');
  assert.equal(v.fine.dusty, true);
  assert.equal(v.fine.waterNote.date, '2026-11-21');
});

test('composeHome: tomorrow\'s chips in the evening (thaw, bins, birthday), switches off, no data', () => {
  const v = composeHome(ctxAt('2026-11-21T19:30'), { target: '2026-11-22', today: '2026-11-21', evening: true, settings: SETTINGS, bridge: BRIDGE, meals: MEALS, summary: SUMMARY });
  const t = Object.fromEntries(v.chipsTomorrow.map((c) => [c.key, c.text]));
  assert.equal(t.thaw, "thaw: move the ground beef to the fridge for tomorrow's beef & broccoli bowls");
  assert.match(t['chore:bins'], /^trash out tonight/);
  assert.equal(t.bday, "tomorrow is pat's birthday");
  assert.ok(t.train, 'tomorrow\'s workout');
  assert.ok(t.water, 'sunday is a watering day too');
  assert.equal(v.dinner.meals.dinner.name, 'Beef & Broccoli Bowls', 'your day shows tomorrow\'s meals');
  assert.equal(v.dinner.eatBy, '');
  const off = composeHome(ctxAt('2026-11-21T06:40'), {
    target: '2026-11-21', today: '2026-11-21', evening: false, bridge: BRIDGE, meals: MEALS, summary: SUMMARY,
    settings: { ...SETTINGS, show: { rundown: false, birthdays: false, dinner: false, workout: false, kidTips: false, radar: false, dust: false } },
  });
  assert.equal(off.rundown, null);
  assert.deepEqual(off.birthdays, []);
  assert.equal(off.dinner, null);
  assert.equal(off.workout, null);
  assert.ok(!off.chipsToday.some((c) => c.key === 'dust' || c.key === 'train'));
  const bare = composeHome(ctxAt('2026-11-21T06:40'), { target: '2026-11-21', today: '2026-11-21', evening: false, settings: { show: SHOW }, bridge: null, meals: null, summary: null });
  assert.equal(bare.rundown, null);
  assert.equal(bare.dinner, null);
  assert.equal(bare.workout.day, null, 'no timer summary: a generic proposal');
});

test('fineWithHome adds dust and the watering call', () => {
  const fine = [{ key: 'aqi', label: 'air quality', value: '61', note: 'moderate, fine for most people' }];
  const out = fineWithHome(fine, { dusty: true, waterNote: { date: '2026-11-22', advice: { value: 'skip', note: '0.4 in. of rain coming' } } }, '2026-11-21');
  assert.equal(out[0].note, 'moderate, fine for most people, and dusty');
  assert.deepEqual(out[1], { key: 'water', label: 'watering', value: 'skip', note: 'sun: 0.4 in. of rain coming' });
  assert.equal(fineWithHome(fine, null, '2026-11-21'), fine);
});

test('Claude facts: the extras are trimmed, money never included; the fingerprint follows them', () => {
  const ctx = ctxAt('2026-11-21T06:40');
  const v = composeHome(ctx, { target: '2026-11-21', today: '2026-11-21', evening: false, settings: SETTINGS, bridge: BRIDGE, meals: MEALS, summary: SUMMARY });
  const extras = { workout: v.workout, dinner: v.dinner, birthdays: v.birthdays, rundownNote: v.rundown.note, parkDay: { name: 'Starfall Park', hours: 'open 8am–midnight', shows: ['wondrous journeys 9:30pm · 54° & clear'] } };
  const facts = buildFacts(ctx, writeAll(ctx), extras);
  assert.equal(facts.workout.state, 'propose');
  assert.equal(facts.workout.session, 'full · Day B');
  assert.equal(facts.dinner.tonight, 'Chicken Fried Rice');
  assert.deepEqual(facts.birthdays, ["pat's birthday tomorrow · turning 60"]);
  assert.equal(facts.rundown_note, 'a calm saturday.');
  assert.equal(facts.park_day.name, 'Starfall Park');
  assert.ok(!/\$\d/.test(JSON.stringify(facts)), 'no money amounts');
  const bare = buildFacts(ctx, writeAll(ctx));
  assert.deepEqual([bare.workout, bare.dinner, bare.birthdays, bare.rundown_note, bare.park_day], [null, null, [], '', null]);
  assert.deepEqual(extraFacts(), { workout: null, dinner: null, birthdays: [], rundown_note: '', park_day: null });
  assert.notEqual(fingerprint(ctx, extras), fingerprint(ctx, {}), 'new context means a fresh rewrite');
  assert.equal(fingerprint(ctx), fingerprint(ctx, {}));
  assert.match(SYSTEM_PROMPT, /never mention money/);
  assert.match(SYSTEM_PROMPT, /facts\.park_day/);
});

test('bridgeProblems: plain words for v3 failures, quiet for normal states', () => {
  assert.deepEqual(bridgeProblems(null), []);
  assert.deepEqual(bridgeProblems({ briefing: { ok: false, error: 'disabled' }, birthdays: { ok: true }, parks: { ok: false, error: 'disabled' }, tripDrive: { ok: false, error: 'too_close' } }), []);
  assert.deepEqual(bridgeProblems({
    briefing: { ok: false, error: 'not_found' },
    birthdays: { ok: false, error: 'contacts access not approved (redeploy and approve)' },
    parks: { ok: false, error: 'themeparks unavailable' },
    tripDrive: { ok: false, error: 'no_route' },
  }), [
    'rundown: no file yet (the daily run writes one each morning)',
    'birthdays: contacts access not approved (redeploy and approve)',
    'park hours: themeparks.wiki is unavailable right now',
    'trip drive: no driving route found',
  ]);
  assert.deepEqual(bridgeProblems({ briefing: { ok: false, error: 'too_big' } }), ['rundown: the file is too big to read']);
  assert.deepEqual(bridgeProblems({ briefing: { ok: false, error: 'bad_json' } }), ["rundown: the file isn't valid json"]);
  assert.deepEqual(bridgeProblems({ tripDrive: { ok: false, error: 'no_origin' } }), ["trip drive: the request was incomplete, it'll try again"]);
  assert.deepEqual(bridgeProblems({ tripDrive: { ok: false, error: 'bad_params' } }), ["trip drive: the request was incomplete, it'll try again"]);
});
