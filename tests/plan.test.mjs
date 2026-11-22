// Trip plan: validation, link payload, time, card composition and escaping. Everything here is fictional.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePlan, normalizePlan, encodePlan, decodePlan, parsePlanInput, planNow, composePlan, matchWaits, setDone, inText } from '../js/plan.js';
import { planCardHTML, planSheetHTML } from '../js/planui.js';

const mk = (over = {}) => ({
  v: 1, kind: 'home-life-plan', id: 'starfall-2027', title: 'starfall park weekend', tz: 'America/Denver', source: 'https://example.com/our-plan', intro: 'two fun days.',
  days: [
    {
      date: '2027-03-06', title: 'starfall park', hours: '9am to 9pm', summary: 'coasters first, shows after',
      items: [
        { id: 'sat-1200', time: '12:00', title: 'lunch at the diner', where: 'main street', tags: ['food', 'bogus'], who: 'everyone' },
        { id: 'sat-0900', time: '09:00', title: 'gates open: book the comet coaster', where: 'main gate', note: 'be early', who: 'everyone', tags: ['phone', 'multipass'], rides: ['comet coaster', 'teacups'], family: 'Robin meets us at the gate' },
        { id: 'sat-1000', time: '10:00', title: 'teacups', rides: ['teacups'] },
        { id: 'sat-2000', time: '20:00', title: 'fireworks', tags: ['show'] },
      ],
      tips: ['bring a charger'],
    },
    { date: '2027-03-07', title: 'water park', hours: '10am to 6pm', items: [{ id: 'sun-1000', time: '10:00', title: 'wave pool' }, { id: 'sun-1100', time: '11:00', title: 'slides' }] },
  ],
  checklist: [{ id: 'dinner-6', text: 'change the dinner booking to 6', due: '2027-03-05' }, { id: 'sunscreen', text: 'pack sunscreen', due: '2027-03-06' }, { id: 'later', text: 'later task', due: '2027-03-09' }],
  tips: ['water is free'],
  heights: [{ park: 'starfall park', ride: 'comet coaster', min: 40, call: 'yes' }, { park: 'starfall park', ride: 'teacups', min: 0 }, { park: 'starfall park', ride: 'rocket drop', min: 48 }],
  ...over,
});
const plan = () => normalizePlan(mk());
const at = (iso) => Date.parse(iso);
// 2027-03-06 in Denver is MST (UTC-7)
const sat = (hhmm) => at(`2027-03-06T${hhmm}:00-07:00`);

test('normalize accepts a good plan, sorts items, drops unknown tags and keeps https source', () => {
  const p = plan();
  assert.equal(p.id, 'starfall-2027');
  assert.deepEqual(p.days[0].items.map((i) => i.id), ['sat-0900', 'sat-1000', 'sat-1200', 'sat-2000']);
  assert.deepEqual(p.days[0].items[2].tags, ['food']);
  assert.equal(p.source, 'https://example.com/our-plan');
  assert.equal(p.days[1].title, 'water park');
  assert.equal(p.days[1].hours, '10am to 6pm');
  assert.equal(p.days[1].summary, '');
});
test('normalize rejects bad version, kind, id, tz, dates and duplicate ids', () => {
  assert.equal(normalizePlan(mk({ v: 2 })), null);
  assert.equal(normalizePlan(mk({ kind: 'other' })), null);
  assert.equal(normalizePlan(mk({ id: 'Bad Id' })), null);
  assert.equal(normalizePlan(mk({ title: '  ' })), null);
  assert.equal(normalizePlan(mk({ tz: 'Mars/Olympus' })), null);
  assert.equal(normalizePlan(mk({ days: [] })), null);
  const d = mk().days;
  assert.equal(normalizePlan(mk({ days: [{ ...d[0], date: '2027-02-30' }] })), null, 'impossible date');
  assert.equal(normalizePlan(mk({ days: [d[0], { ...d[1], date: d[0].date }] })), null, 'duplicate date');
  assert.equal(normalizePlan(mk({ days: [{ ...d[0], items: [...d[0].items, { id: 'sat-0900', time: '13:00', title: 'dup' }] }] })), null, 'duplicate item id');
  assert.equal(normalizePlan(mk({ days: [{ ...d[0], items: [{ id: 'dinner-6', time: '13:00', title: 'clash with checklist' }] }] })), null);
  assert.equal(normalizePlan(mk({ days: [{ ...d[0], items: [{ id: 'x', time: '24:00', title: 'bad time' }] }] })), null);
  assert.equal(validatePlan(null).ok, false);
  assert.match(validatePlan(mk({ v: 3 })).error, /version/);
});
test('long strings are truncated and a non-https source is dropped', () => {
  const d = mk().days[0];
  const p = normalizePlan(mk({
    title: 't'.repeat(500), source: 'http://example.com/plan',
    days: [{ ...d, items: [{ id: 'a', time: '08:00', title: 'x'.repeat(500), note: 'n'.repeat(2000), where: 'w'.repeat(900) }] }],
  }));
  assert.equal(p.title.length, 140);
  assert.equal(p.days[0].items[0].title.length, 140);
  assert.equal(p.days[0].items[0].note.length, 700);
  assert.equal(p.days[0].items[0].where.length, 300);
  assert.equal(p.source, '');
  assert.equal(normalizePlan(mk({ source: 'javascript:alert(1)' })).source, '');
  assert.equal(normalizePlan(mk({ source: 'not a url' })).source, '');
});
test('rides, heights and size caps', () => {
  const d = mk().days[0];
  const p = normalizePlan(mk({ days: [{ ...d, items: [{ id: 'a', time: '08:00', title: 'x', rides: Array.from({ length: 20 }, (_, i) => `r${i}`) }] }], heights: [{ ride: 'a', min: 61 }, { ride: 'b', min: 1.5 }, { ride: 'c', min: 36 }] }));
  assert.equal(p.days[0].items[0].rides.length, 8);
  assert.deepEqual(p.heights.map((h) => h.ride), ['c']);
  assert.equal(normalizePlan(mk({ intro: 'z'.repeat(250000) })), null, 'over 200 KB');
});

test('encode/decode round trips both forms', async () => {
  const p = plan();
  const z = await encodePlan(p);
  assert.ok(z.startsWith('z.'));
  assert.deepEqual((await decodePlan(z)).plan, p);
  assert.deepEqual((await decodePlan(`#plan=${z}`)).plan, p, 'with the hash prefix');
  const j = `j.${Buffer.from(JSON.stringify(p)).toString('base64url')}`;
  assert.deepEqual((await decodePlan(j)).plan, p);
  assert.deepEqual((await decodePlan(`${j}==`)).plan, p, 'padding tolerated');
  const emoji = normalizePlan(mk({ title: 'park day ☀ 🎢' }));
  assert.equal((await decodePlan(await encodePlan(emoji))).plan.title, 'park day ☀ 🎢');
});
test('garbage payloads give an error, not a plan', async () => {
  for (const bad of ['', 'hello', 'z.!!!!', 'z.AAAA', 'j.AAAA', `j.${Buffer.from('{"v":1}').toString('base64url')}`, `j.${Buffer.from('not json').toString('base64url')}`, 'z.' + 'A'.repeat(130000)]) {
    const r = await decodePlan(bad);
    assert.equal(r.ok, false, bad.slice(0, 20));
    assert.ok(r.error);
  }
});
test('parsePlanInput takes a full link, a bare payload or raw json', async () => {
  const p = plan();
  const z = await encodePlan(p);
  assert.deepEqual((await parsePlanInput(`https://example.github.io/app/#plan=${z}`)).plan, p);
  assert.deepEqual((await parsePlanInput(z)).plan, p);
  assert.deepEqual((await parsePlanInput(JSON.stringify(mk()))).plan, p);
  assert.equal((await parsePlanInput('{oops')).ok, false);
  assert.equal((await parsePlanInput('')).ok, false);
});

test('planNow reads the plan zone, not the device zone', () => {
  assert.deepEqual(planNow(at('2027-03-06T16:20:00Z'), 'America/Denver'), { date: '2027-03-06', minutes: 9 * 60 + 20 });
  assert.deepEqual(planNow(at('2027-03-07T03:30:00Z'), 'America/Denver'), { date: '2027-03-06', minutes: 20 * 60 + 30 });
  assert.deepEqual(planNow(at('2027-03-06T07:05:00Z'), 'UTC'), { date: '2027-03-06', minutes: 7 * 60 + 5 });
  assert.deepEqual(planNow(at('2027-03-06T07:05:00Z'), 'Asia/Tokyo'), { date: '2027-03-06', minutes: 16 * 60 + 5 });
  assert.equal(planNow(at('2027-03-06T07:00:00Z'), 'America/Denver').minutes, 0, 'midnight is 0, not 1440');
});
test('inText', () => {
  assert.equal(inText(25), 'in 25 min');
  assert.equal(inText(70), 'in 1 h 10 min');
  assert.equal(inText(120), 'in 2 h');
});

test('today mode: current and next with a countdown', () => {
  const v = composePlan(plan(), { nowMs: sat('10:35') });
  assert.equal(v.mode, 'today');
  assert.equal(v.status, 'during');
  assert.equal(v.current.id, 'sat-1000');
  assert.equal(v.next.id, 'sat-1200');
  assert.equal(v.nextIn, 'in 1 h 25 min');
  assert.deepEqual(v.earlier.map((r) => r.id), ['sat-0900']);
  assert.deepEqual(v.upcoming.map((r) => r.id), ['sat-1000', 'sat-1200', 'sat-2000']);
  assert.equal(v.next.clock, 'noon');
  assert.equal(v.day.hours, '9am to 9pm');
});
test('before the first item and after the last', () => {
  const b = composePlan(plan(), { nowMs: sat('08:08') });
  assert.equal(b.status, 'before');
  assert.equal(b.next.id, 'sat-0900');
  assert.equal(b.nextIn, 'in 52 min');
  assert.equal(b.current, null);
  assert.equal(b.earlier.length, 0);
  const last = composePlan(plan(), { nowMs: sat('20:10') });
  assert.equal(last.status, 'during');
  assert.equal(last.next, null, 'the last stop has no next');
  const a = composePlan(plan(), { nowMs: sat('21:00') });
  assert.equal(a.status, 'after');
  assert.deepEqual(a.tomorrow, { title: 'water park', first: '10am' });
  assert.equal(a.earlier.length, 4);
});
test('tomorrow mode: only once today is finished (evening or 90 minutes after), or the night before', () => {
  const eve = composePlan(plan(), { nowMs: sat('19:00'), evening: true });
  assert.equal(eve.mode, 'today', 'evening edition but a 8pm stop is left');
  const fin = composePlan(plan(), { nowMs: sat('20:35'), evening: true });
  assert.equal(fin.mode, 'tomorrow', 'evening and 30+ minutes after the last stop');
  assert.equal(fin.day.title, 'water park');
  assert.equal(fin.first.id, 'sun-1000');
  assert.deepEqual(fin.todo.map((c) => c.id), ['dinner-6', 'sunscreen']);
  assert.equal(composePlan(plan(), { nowMs: sat('20:35') }).mode, 'today', 'not evening, only 35 minutes after');
  assert.equal(composePlan(plan(), { nowMs: sat('21:45') }).mode, 'tomorrow', 'more than 90 minutes after the last stop');
  assert.equal(composePlan(plan(), { nowMs: sat('21:15') }).mode, 'today');
  const night = composePlan(plan(), { nowMs: at('2027-03-05T19:00:00-07:00'), evening: true });
  assert.equal(night.mode, 'tomorrow', 'the night before the first day');
  const onLastDay = composePlan(plan(), { nowMs: at('2027-03-07T23:30:00-07:00'), evening: true });
  assert.equal(onLastDay.mode, 'today', 'no tomorrow in the plan: stay on today');
});
test('soon mode, and nothing after the trip or far before it', () => {
  const s1 = composePlan(plan(), { nowMs: at('2027-03-05T12:00:00-07:00') });
  assert.equal(s1.mode, 'soon');
  assert.equal(s1.label, 'starts tomorrow');
  assert.deepEqual(s1.todo.map((c) => c.id), ['dinner-6', 'sunscreen'], 'everything due by the first day');
  assert.equal(composePlan(plan(), { nowMs: at('2027-03-04T12:00:00-07:00') }).label, 'starts in 2 days');
  assert.equal(composePlan(plan(), { nowMs: at('2027-03-01T12:00:00-07:00') }), null);
  assert.equal(composePlan(plan(), { nowMs: at('2027-03-08T12:00:00-07:00') }), null);
  assert.equal(composePlan(null, {}), null);
});
test('done items and checklist due filtering', () => {
  let done = setDone({}, 'sat-0900', true);
  done = setDone(done, 'dinner-6', true);
  const v = composePlan(plan(), { nowMs: sat('10:35'), done });
  assert.equal(v.earlier[0].done, true);
  assert.deepEqual(v.todo.map((c) => c.id), ['sunscreen'], 'done and not-yet-due entries are left out');
  assert.deepEqual(setDone(done, 'sat-0900', false), { 'dinner-6': true });
});

test('matchWaits normalizes, skips single rider and prefers the shortest match', () => {
  const waits = [
    { name: "Peter Pan's Flight", minutes: 35 },
    { name: 'Space Mountain', minutes: 50 },
    { name: 'Space Mountain Single Rider', minutes: 5 },
    { name: 'Rock ’n’ Roller Coaster Starring Aerosmith', minutes: 20 },
    { name: 'Rock ’n’ Roller Coaster', minutes: 25 },
    { name: 'Tea & Cups', minutes: 10 },
  ];
  assert.deepEqual(matchWaits(['peter pans flight'], waits), [{ name: "Peter Pan's Flight", minutes: 35 }]);
  assert.deepEqual(matchWaits(["Peter Pan's flight!"], waits), [{ name: "Peter Pan's Flight", minutes: 35 }]);
  assert.deepEqual(matchWaits(['space mountain'], waits), [{ name: 'Space Mountain', minutes: 50 }]);
  assert.deepEqual(matchWaits(['rock n roller coaster'], waits), [{ name: 'Rock ’n’ Roller Coaster', minutes: 25 }]);
  assert.deepEqual(matchWaits(['tea and cups'], waits), [{ name: 'Tea & Cups', minutes: 10 }]);
  assert.deepEqual(matchWaits(['no such ride'], waits), []);
  assert.deepEqual(matchWaits(['space mountain'], [{ name: 'Space Mountain Single Rider', minutes: 5 }]), []);
});
test('live waits attach to current and upcoming rows only', () => {
  const waits = [{ name: 'Comet Coaster', minutes: 30 }, { name: 'Teacups', minutes: 5 }];
  const v = composePlan(plan(), { nowMs: sat('09:30'), waits });
  assert.deepEqual(v.current.waits.map((w) => w.name), ['Comet Coaster', 'Teacups']);
  assert.deepEqual(v.upcoming.find((r) => r.id === 'sat-1000').waits, [{ name: 'Teacups', minutes: 5 }]);
  const later = composePlan(plan(), { nowMs: sat('11:00'), waits });
  assert.equal(later.earlier.every((r) => r.waits.length === 0), true);
});

test('card html escapes plan text and only links https sources', () => {
  const evil = '<script>alert(1)</script>';
  const d = mk().days[0];
  const p = normalizePlan(mk({
    title: evil,
    days: [{ ...d, title: evil, items: [{ id: 'a', time: '09:00', title: evil, note: evil, where: evil, who: evil, family: evil, tags: ['food'] }, { id: 'b', time: '23:00', title: evil }] }],
    checklist: [{ id: 'c', text: evil, due: '2027-03-06' }],
    tips: [evil], heights: [{ park: evil, ride: evil, min: 40, call: evil }],
  }));
  const v = composePlan(p, { nowMs: sat('09:05') });
  const html = planCardHTML(v);
  assert.ok(!html.includes('<script>'), 'card');
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('data-plan-item="a"'));
  assert.ok(html.includes('data-plan-check="c"'));
  assert.ok(html.includes('href="https://example.com/our-plan"'));
  assert.ok(!planSheetHTML(p, {}).includes('<script>'), 'sheet');
  const noLink = planCardHTML(composePlan({ ...p, source: '' }, { nowMs: sat('09:05') }));
  assert.ok(!noLink.includes('original plan'));
  assert.ok(planSheetHTML(plan(), {}).includes('no minimum (everyone rides): teacups'));
  assert.equal(planCardHTML(null), '');
});
