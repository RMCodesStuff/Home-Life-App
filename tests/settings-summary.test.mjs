import test from 'node:test';
import assert from 'node:assert/strict';
import { orderSections, sectionSummaries, clockWords, SECTION_ORDER } from '../js/settings.js';

const base = () => ({
  home: { name: 'Springfield', region: 'IL', countryCode: 'US' },
  calendar: { url: '', secret: '' },
  trip: { manual: null },
  evening: { enabled: true, start: '18:00' },
  chores: [], phoenix: { power: { enabled: false }, watering: { enabled: false } },
  ai: { enabled: false }, theme: 'auto', units: 'imperial',
});

test('orderSections follows the spec order and keeps unknown ids last', () => {
  const shuffled = [...SECTION_ORDER].reverse();
  assert.deepEqual(orderSections(shuffled), SECTION_ORDER);
  assert.deepEqual(orderSections(['set-zzz', 'set-install', 'set-home', 'set-aaa']), ['set-home', 'set-install', 'set-zzz', 'set-aaa']);
  assert.equal(SECTION_ORDER[0], 'set-home');
  assert.equal(SECTION_ORDER[2], 'set-plan');
});

test('clockWords', () => {
  assert.equal(clockWords('18:00'), '6pm');
  assert.equal(clockWords('18:30'), '6:30pm');
  assert.equal(clockWords('00:05'), '12:05am');
  assert.equal(clockWords('nope'), '');
});

const conn = () => { const s = base(); s.calendar.url = 'https://script.google.com/macros/s/x/exec'; return s; };

test('google summary: not connected, connected with version, update available, not working', () => {
  assert.equal(sectionSummaries(base())['set-calendar'], 'not connected');
  assert.equal(sectionSummaries(conn(), { bridge: { version: 3 } })['set-calendar'], 'connected · v3');
  assert.equal(sectionSummaries(conn(), { bridge: { version: 2 } })['set-calendar'], 'update available');
  assert.equal(sectionSummaries(conn(), { calendar: { error: 'x', count: 0 } })['set-calendar'], 'not working');
  assert.equal(sectionSummaries(conn(), {})['set-calendar'], undefined); // connected but status unknown: omitted
});

test('home, plan, trips', () => {
  assert.equal(sectionSummaries(base())['set-home'], 'springfield, il');
  assert.equal(sectionSummaries({ ...base(), home: null })['set-home'], 'not set');
  assert.equal(sectionSummaries(base(), {}, { plan: { title: 'Lake Weekend' } })['set-plan'], 'lake weekend');
  assert.equal(sectionSummaries(base(), {}, { plan: null })['set-plan'], 'no plan');
  assert.equal(sectionSummaries(base(), {}, {})['set-plan'], undefined);
  assert.equal(sectionSummaries(base(), { trips: [{ manual: false, returnDate: '2030-01-05' }], today: '2030-01-01' })['set-trip'], 'from your calendar');
  assert.equal(sectionSummaries(base(), { trips: [{ manual: false, returnDate: '2029-01-05' }], today: '2030-01-01' })['set-trip'], 'no trips');
  assert.equal(sectionSummaries(base(), {})['set-trip'], undefined);
  const m = base(); m.trip.manual = { city: 'Lakeside' };
  assert.equal(sectionSummaries(m)['set-trip'], 'lakeside');
});

test('evening, calendars, chores, extras, forecast, display', () => {
  assert.equal(sectionSummaries(base())['set-evening'], 'from 6pm');
  const e = base(); e.evening = { enabled: false, start: '19:00' };
  assert.equal(sectionSummaries(e)['set-evening'], 'off');
  assert.equal(sectionSummaries(base(), { calendars: [{ show: true }, { show: false }, { show: true }] })['set-cals'], '2 shown');
  assert.equal(sectionSummaries(base(), { calendars: [] })['set-cals'], undefined);
  const c = base(); c.chores = [{}, {}];
  assert.equal(sectionSummaries(c)['set-chores'], '2 chores');
  c.chores = [{}];
  assert.equal(sectionSummaries(c)['set-chores'], '1 chore');
  assert.equal(sectionSummaries(base())['set-phoenix'], 'off');
  const p = base(); p.phoenix.watering.enabled = true;
  assert.equal(sectionSummaries(p)['set-phoenix'], 'on');
  assert.equal(sectionSummaries(base())['set-ai'], 'on-device');
  const a = base(); a.ai.enabled = true; a.theme = 'dark'; a.units = 'metric';
  assert.equal(sectionSummaries(a)['set-ai'], 'claude');
  assert.equal(sectionSummaries(a)['set-display'], 'dark · °C');
  assert.equal(sectionSummaries(base())['set-devices'], 'share your setup');
});

test('meal plan, workout, oura, install', () => {
  assert.equal(sectionSummaries(base(), { meals: { connected: true } })['set-meals'], 'connected');
  assert.equal(sectionSummaries(base(), { meals: { connected: false } })['set-meals'], 'not connected');
  assert.equal(sectionSummaries(base(), {})['set-meals'], undefined);
  assert.equal(sectionSummaries(base(), { rack: { connected: false, updatedAt: '7:10am' } })['set-workout'], 'from your rack timer');
  assert.equal(sectionSummaries(base(), { rack: { connected: true } })['set-workout'], 'connected');
  assert.equal(sectionSummaries(base(), { rack: {} })['set-workout'], 'not connected');
  assert.equal(sectionSummaries(base())['set-oura'], 'not set up');
  assert.equal(sectionSummaries(conn(), { oura: { version: 3, data: { ok: true } } })['set-oura'], 'connected');
  assert.equal(sectionSummaries(conn(), { oura: { version: 3, data: { ok: false, error: 'not_connected' } } })['set-oura'], 'not connected');
  assert.equal(sectionSummaries(conn(), { oura: { version: 3, data: { ok: false, error: 'weird' } } })['set-oura'], undefined);
  assert.equal(sectionSummaries(conn(), {})['set-oura'], undefined);
  assert.equal(sectionSummaries(base(), {}, { installed: true })['set-install'], 'installed');
  assert.equal(sectionSummaries(base(), {}, { installed: false })['set-install'], 'add to home screen');
  assert.equal(sectionSummaries(base(), {}, {})['set-install'], undefined);
});
