// Dinner tonight (meal plan), workout of the day (rack timer summary), Firebase error mapping. Everything here is fictional.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { slotKey, recipeIdsFor, mealsForDay, slimRecipe, meatPhrase, mealNotes } from '../js/meals.js';
import { normalizeSummary, pickSummary, freeGaps, proposeWorkout, bestWindow, trainChip, trainClock, workoutTitle, workoutDetail, windowLine } from '../js/workout.js';
import { mapFbError } from '../js/fb.js';
import { FIREBASE, mealPlanPath, recipePath, rackUserPath, LINKS } from '../js/connections.js';

// ---------------------------------------------------------------- meals
const PLAN = { tuesday_dinner: 'r1', tuesday_lunch: 'r3', wednesday_dinner: 'r2', wednesday_breakfast: 'r4', thursday_dinner: 'bad/id', friday_dinner: '' };
const RECIPES = {
  r1: { name: 'Chicken Fried Rice', ingredients: ['2 cups cooked rice', '1 lb chicken thighs', '2 eggs'] },
  r2: { name: 'Beef & Broccoli Bowls', ingredients: ['1 tbsp soy sauce', '1 lb ground beef (85%)', '2 cups broccoli'] },
  r3: { name: 'Big Salad', ingredients: ['greens', 'chicken broth vinaigrette'] },
  r4: { name: 'Oatmeal', ingredients: ['oats'] },
};

test('meal slots and the day\'s meals', () => {
  assert.equal(slotKey('2026-11-17', 'dinner'), 'tuesday_dinner');
  assert.deepEqual(recipeIdsFor(PLAN, ['2026-11-17', '2026-11-18']).sort(), ['r1', 'r2', 'r3', 'r4']);
  assert.deepEqual(recipeIdsFor(PLAN, ['2026-11-19']), [], 'ids with slashes are never read');
  assert.deepEqual(recipeIdsFor(null, ['2026-11-17']), []);
  const tue = mealsForDay(PLAN, RECIPES, '2026-11-17');
  assert.equal(tue.dinner.name, 'Chicken Fried Rice');
  assert.equal(tue.lunch.name, 'Big Salad');
  assert.equal(tue.breakfast, null);
  assert.equal(mealsForDay(PLAN, {}, '2026-11-17').dinner, null, 'a recipe not loaded yet');
  assert.deepEqual(slimRecipe({ name: 'X', ingredients: ['a', 3], servings: 4, mealTypes: ['dinner'], instructions: 'long text', createdAt: 'x' }), { name: 'X', ingredients: ['a'], servings: 4, mealTypes: ['dinner'] });
});

test('meatPhrase finds raw meat and fish, not broth or cooked things', () => {
  assert.equal(meatPhrase('1 lb ground beef (85%)'), 'ground beef');
  assert.equal(meatPhrase('2 chicken breasts'), 'chicken breasts');
  assert.equal(meatPhrase('1 lb salmon fillets'), 'salmon fillets');
  assert.equal(meatPhrase('12 oz shrimp, peeled'), 'shrimp');
  assert.equal(meatPhrase('4 pork chops'), 'pork chops');
  assert.equal(meatPhrase('1 package italian sausage'), 'sausage');
  assert.equal(meatPhrase('2 cups chicken broth'), '');
  assert.equal(meatPhrase('1 tbsp fish sauce'), '');
  assert.equal(meatPhrase('1 rotisserie chicken, shredded'), '');
  assert.equal(meatPhrase('2 cups cooked rice'), '');
  assert.equal(meatPhrase(null), '');
});

test('mealNotes: thaw for tomorrow\'s dinner, eat by for an evening event', () => {
  const ev = (o) => ({ id: 'e', title: "Men's group", allDay: false, date: '2026-11-17', ls: '2026-11-17T19:00', le: '2026-11-17T20:30', travel: { minutes: 30 }, ...o });
  const n = mealNotes({ plan: PLAN, recipes: RECIPES, today: '2026-11-17', events: [ev({})] });
  assert.equal(n.thaw, "thaw: move the ground beef to the fridge for tomorrow's beef & broccoli bowls");
  assert.equal(n.eatBy, "men's group at 7, eat by 6:15");
  assert.equal(mealNotes({ plan: PLAN, recipes: RECIPES, today: '2026-11-17', events: [ev({ travel: null, ls: '2026-11-17T17:30' })] }).eatBy, "men's group at 5:30, eat by 5:15");
  assert.equal(mealNotes({ plan: PLAN, recipes: RECIPES, today: '2026-11-17', events: [ev({ ls: '2026-11-17T17:00' })] }).eatBy, '', 'too early for dinner plans');
  assert.equal(mealNotes({ plan: PLAN, recipes: RECIPES, today: '2026-11-17', events: [ev({ ls: '2026-11-17T21:00' })] }).eatBy, '', 'too late');
  assert.equal(mealNotes({ plan: PLAN, recipes: RECIPES, today: '2026-11-17', events: [ev({ allDay: true })] }).eatBy, '');
  assert.equal(mealNotes({ plan: PLAN, recipes: RECIPES, today: '2026-11-16', events: [] }).thaw, "thaw: move the chicken thighs to the fridge for tomorrow's chicken fried rice");
  assert.equal(mealNotes({ plan: PLAN, recipes: RECIPES, today: '2026-11-18', events: [] }).thaw, '', 'no plan for thursday');
  assert.deepEqual(mealNotes({ plan: null, recipes: null, today: '2026-11-17' }), { thaw: '', eatBy: '' });
});

// ---------------------------------------------------------------- workout
const SUMMARY = {
  v: 1, app: 'rack-session-timer', updatedAt: '2026-11-16T19:02:11.000Z', date: '2026-11-16', url: 'https://rmcodesstuff.github.io/rack-session-timer/',
  week: { n: 3, of: 6 },
  next: {
    full: { day: 'B', label: 'Day B', title: 'Hinge + pull', min: 24, lift: { key: 'rdl', name: 'Romanian deadlift', lb: 135 }, kit: 'bar, plates' },
    workday: { day: 'B', label: 'Day B', title: 'Hinge + pull', min: 18, lift: { key: 'rdl', name: 'Romanian deadlift', lb: 135 }, kit: '' },
    evening: { day: 'E2', label: 'Core 2', title: 'Core', min: 15, lift: null, kit: '' },
    circuit: { day: 'R3', label: 'Circuit 3', title: 'Bodyweight', min: 22, lift: null, kit: '' },
  },
  last: { date: '2026-11-15', version: 'full', day: 'A', label: 'Day A', status: 'done', durationSec: 1480, setsDone: 30, setsTotal: 32, effort: 7 },
  recent: [{ date: '2026-11-15', version: 'full', day: 'A', status: 'done', durationSec: 1480 }],
  inProgress: null, moveUp: [],
};
const hrs = (date, temp = () => 60) => Array.from({ length: 24 }, (_, h) => ({ time: `${date}T${String(h).padStart(2, '0')}:00`, temp: temp(h) }));
const E = (id, ls, le, o = {}) => ({ id, title: id, allDay: false, date: ls.slice(0, 10), ls, le, calendar: 'me@gmail.example', ...o });
const TUE = '2026-11-17';
const base = { summary: SUMMARY, oura: { ok: true, readiness: { score: 72 } }, events: [], hours: hrs(TUE), now: `${TUE}T05:30`, today: TUE, settings: {} };

test('normalizeSummary and pickSummary', () => {
  const s = normalizeSummary(SUMMARY);
  assert.equal(s.next.full.lift.lb, 135);
  assert.equal(s.next.kb, undefined, 'versions not on the plan are left out');
  assert.equal(normalizeSummary({ app: 'other' }), null);
  assert.equal(normalizeSummary(null), null);
  const thin = normalizeSummary({ app: 'rack-session-timer', next: { full: { day: 'A' } } });
  assert.equal(thin.next.full.label, 'Day A');
  assert.deepEqual(thin.recent, []);
  const newer = { ...SUMMARY, updatedAt: '2026-11-17T01:00:00.000Z', week: { n: 4, of: 6 } };
  assert.equal(pickSummary(SUMMARY, newer).week.n, 4);
  assert.equal(pickSummary(newer, SUMMARY).week.n, 4);
  assert.equal(pickSummary(null, SUMMARY).week.n, 3);
  assert.equal(pickSummary(undefined, undefined), null);
});

test('free gaps between events, using leave-by', () => {
  const evs = [E('a', `${TUE}T08:00`, `${TUE}T09:00`, { travel: { leaveBy: `${TUE}T07:30`, minutes: 30 } }), E('b', `${TUE}T12:00`, `${TUE}T13:00`), E('c', `${TUE}T20:30`, `${TUE}T22:00`)];
  assert.deepEqual(freeGaps(evs, TUE).map((g) => [g.start.slice(11), g.end.slice(11)]), [['05:00', '07:30'], ['09:00', '12:00'], ['13:00', '20:30']]);
  assert.deepEqual(freeGaps([], TUE).map((g) => [g.start.slice(11), g.end.slice(11)]), [['05:00', '21:00']]);
});

test('proposeWorkout: resume, done, rest, away', () => {
  const resume = proposeWorkout({ ...base, summary: { ...SUMMARY, date: TUE, inProgress: { version: 'full', day: 'B', label: 'Day B', done: 20, total: 32 } } });
  assert.equal(resume.state, 'resume');
  assert.deepEqual(resume.why, ['finish day b: 12 sets left']);
  assert.equal(resume.link, 'https://rmcodesstuff.github.io/rack-session-timer/', 'the timer shows its own resume card');
  const stale = proposeWorkout({ ...base, summary: { ...SUMMARY, date: '2026-11-15', inProgress: { version: 'full', day: 'B', done: 20, total: 32 } } });
  assert.notEqual(stale.state, 'resume', 'yesterday\'s unfinished session is not today\'s');
  const done = proposeWorkout({ ...base, summary: { ...SUMMARY, recent: [{ date: TUE, version: 'full', day: 'A', status: 'done', durationSec: 1440 }] } });
  assert.equal(done.state, 'done');
  assert.deepEqual(done.why, ['done: full · day a, 24 min']);
  assert.deepEqual(proposeWorkout({ ...base, parkDay: true }).why, ['rest: a park day is 8+ miles of walking']);
  const away = proposeWorkout({ ...base, away: true });
  assert.equal(away.version, 'circuit');
  assert.deepEqual(away.why, ['22-min circuit in the hotel room']);
  assert.equal(away.link, 'https://rmcodesstuff.github.io/rack-session-timer/?ver=circuit&day=R3&from=homelife');
  const noCircuit = proposeWorkout({ ...base, away: true, summary: { ...SUMMARY, next: { full: SUMMARY.next.full } } });
  assert.equal(noCircuit.state, 'rest');
});

test('proposeWorkout: version by readiness, streak and work calendars; window and link', () => {
  const full = proposeWorkout(base);
  assert.equal(full.state, 'propose');
  assert.equal(full.version, 'full');
  assert.equal(workoutTitle(full), 'Full · Day B');
  assert.equal(workoutDetail(full), 'romanian deadlift 135 lb · ~24 min · week 3 of 6');
  assert.deepEqual(full.window, { start: `${TUE}T06:00`, end: `${TUE}T07:30`, temp: 60 });
  assert.equal(windowLine(full), 'best window 6–7:30 · garage 60°');
  assert.equal(trainChip(full), '6am · full b, 24 min');
  assert.equal(full.link, 'https://rmcodesstuff.github.io/rack-session-timer/?ver=full&day=B&from=homelife');
  const low = proposeWorkout({ ...base, oura: { ok: true, readiness: { score: 62 } } });
  assert.equal(low.version, 'evening');
  assert.deepEqual(low.why, ['readiness 62, keep it light']);
  const streak = proposeWorkout({ ...base, summary: { ...SUMMARY, recent: ['2026-11-16', '2026-11-15', '2026-11-14'].map((date) => ({ date, version: 'full', day: 'A', status: 'done', durationSec: 1400 })) } });
  assert.equal(streak.version, 'workday');
  const work = proposeWorkout({ ...base, events: [E('standup', `${TUE}T09:00`, `${TUE}T09:30`, { calendar: 'Work' })] });
  assert.equal(work.version, 'workday');
  assert.equal(work.min, 18);
  const saturday = proposeWorkout({ ...base, today: '2026-11-21', now: '2026-11-21T07:00', hours: hrs('2026-11-21'), events: [E('x', '2026-11-21T09:00', '2026-11-21T10:00', { calendar: 'Work' })] });
  assert.equal(saturday.version, 'full', 'work calendars only count on weekdays');
  const primed = proposeWorkout({ ...base, oura: { ok: true, readiness: { score: 88 } } });
  assert.ok(primed.why.includes('primed: add 5 lb if last time was clean'));
  const ready = proposeWorkout({ ...base, oura: { ok: true, readiness: { score: 88 } }, summary: { ...SUMMARY, moveUp: ['Romanian deadlift'] } });
  assert.ok(ready.why.includes('primed: ready to move up on romanian deadlift'));
  const generic = proposeWorkout({ ...base, summary: null });
  assert.equal(generic.version, 'full');
  assert.equal(generic.day, null);
  assert.equal(generic.min, 25);
  assert.equal(generic.link, '../rack-session-timer/?ver=full&from=homelife');
  const genericLow = proposeWorkout({ ...base, summary: null, oura: { ok: true, readiness: { score: 50 } } });
  assert.equal(genericLow.version, 'evening');
});

test('bestWindow: preferences, heat, cold, no room', () => {
  const evs = [E('a', `${TUE}T07:00`, `${TUE}T08:00`), E('b', `${TUE}T10:00`, `${TUE}T16:00`)];
  assert.equal(bestWindow({ events: evs, hours: hrs(TUE), date: TUE, need: 34 }).start, `${TUE}T06:00`, 'before the first event');
  assert.equal(bestWindow({ events: evs, hours: hrs(TUE), date: TUE, need: 34, pref: 'evening' }).start, `${TUE}T16:00`);
  // the evening you prefer is 96° in the garage: take the earliest window under 85 instead
  const hot = bestWindow({ events: [E('a', `${TUE}T08:00`, `${TUE}T09:00`), E('b', `${TUE}T12:00`, `${TUE}T16:00`)], hours: hrs(TUE, (h) => (h < 7 ? 78 : 96)), date: TUE, need: 34, pref: 'evening' });
  assert.equal(hot.start, `${TUE}T06:00`);
  assert.equal(hot.note, 'garage 78° at 6');
  const cold = bestWindow({ events: [], hours: hrs(TUE, () => 38), date: TUE, need: 34 });
  assert.equal(cold.note, 'cold garage, take the long warm-up');
  assert.equal(bestWindow({ events: [E('all', `${TUE}T05:00`, `${TUE}T21:00`)], hours: [], date: TUE, need: 34 }), null);
  const later = bestWindow({ events: [], hours: hrs(TUE), date: TUE, now: `${TUE}T14:10`, need: 34 });
  assert.equal(later.start, `${TUE}T14:10`, 'never in the past');
  assert.equal(trainClock(`${TUE}T17:30`), '5:30pm');
  assert.equal(trainClock(`${TUE}T06:15`), '6:15');
  assert.equal(trainClock(`${TUE}T06:00`), '6am');
});

// ---------------------------------------------------------------- firebase plumbing
test('Firebase errors map to four kinds; configs carry no personal data', () => {
  assert.equal(mapFbError({ code: 'permission-denied' }), 'permission');
  assert.equal(mapFbError({ code: 'auth/unauthorized-domain' }), 'permission');
  assert.equal(mapFbError({ code: 'unavailable' }), 'network');
  assert.equal(mapFbError({ code: 'auth/network-request-failed' }), 'network');
  assert.equal(mapFbError(new TypeError('Failed to fetch dynamically imported module')), 'network');
  assert.equal(mapFbError({ code: 'not-connected' }), 'not-connected');
  assert.equal(mapFbError({ code: 'auth/popup-closed-by-user' }), 'other');
  assert.equal(mapFbError(null), 'other');
  assert.equal(mealPlanPath(), 'artifacts/fresh-meal-planner-app/households/main/mealPlans/currentWeek');
  assert.equal(recipePath('r1'), 'artifacts/fresh-meal-planner-app/households/main/recipes/r1');
  assert.equal(rackUserPath('u1'), 'users/u1');
  assert.equal(FIREBASE.meals.projectId, 'recipe-planner-bcd94');
  assert.equal(FIREBASE.rack.projectId, 'workout-app-21b1d');
  assert.equal(LINKS.rackTimer, '../rack-session-timer/');
  const src = fs.readFileSync(new URL('../js/connections.js', import.meta.url), 'utf8');
  assert.ok(!/[\w.+-]+@[\w-]+\.[\w.]+/.test(src), 'no email addresses');
});
