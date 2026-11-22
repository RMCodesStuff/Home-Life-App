// Assembles the page's v3 view models: trip prep and park days (second card), and the home features (rundown, birthdays,
// dinner, workout, phoenix pack). Pure: storage, geocodes and fetched data come in as arguments.
import { diffDays, fmtDateRange, addMinutes, addDays, dowShort as dowShortOf } from './time.js';
import { modelForDate } from './insights.js';
import { prepTrip, packingList, mergePacking, checklistItems, findConflicts, tripSub } from './tripprep.js';
import { parkDaysFor, parkView, modelForPark, driveLine, parkTag } from './parks.js';
import { rundownView, birthdayLines, birthdayTomorrow } from './briefing.js';
import { mealsForDay, mealNotes } from './meals.js';
import { proposeWorkout, trainChip } from './workout.js';
import { powerPeakChip, wateringDay, wateringAdvice, dustChip, dustHigh, choreChips, kidTips, radarWanted } from './phoenix.js';
import { dayByDate as dayOf } from './weather.js';

/**
 * ctx: the app ctx (now, units, model, homeModel, tripModels, travel, events)
 * opts: { target (date the second card is about), today, settings, bridge, home ({lat, lon, name}), coordsFor(loc),
 *         checks(tripId) -> {key: true}, briefingPacking (optional extra items) }
 * -> { park: [parkView], prep: {...}|null, dayConflicts: [text], parkTags: {date: tag} }
 */
export function composeTrip(ctx, opts) {
  const { target, today, settings, bridge, home, coordsFor = () => null, checks = () => ({}), briefingPacking = null } = opts;
  const show = (settings && settings.show) || {};
  const units = ctx.units;
  const parks = bridge && bridge.parks && bridge.parks.ok ? bridge.parks : null;
  const parkTags = {};
  if (parks && show.parks !== false) for (const d of parks.days) if (!parkTags[d.date]) parkTags[d.date] = parkTag(d.name);

  const models = [...Object.values(ctx.tripModels || {}), ctx.homeModel || ctx.model];
  // the date at the park: a park model's own wall clock decides "today" for standby waits
  const park = show.parks === false ? [] : parkDaysFor(parks, target).map((day) => {
    const model = modelForPark(day, models, modelForDate(ctx, day.date));
    return parkView(day, { model, units, today });
  });

  const homeOffset = (ctx.homeModel || ctx.model).offset || 0;
  const tripOffset = (t) => (ctx.tripModels && ctx.tripModels[t.id] ? ctx.tripModels[t.id].offset : null);
  const td = bridge && bridge.tripDrive && bridge.tripDrive.ok ? bridge.tripDrive : null;
  const driveTripId = bridge && bridge.tripReq ? bridge.tripReq.id : '';
  const homeNow = addMinutes(ctx.now, (homeOffset - (ctx.model.offset || 0)) / 60);
  const conflicts = home ? findConflicts({
    events: ctx.events, travel: ctx.travel, home, coordsFor, today, now: homeNow, homeName: home.name || '', homeOffset, tripOffset, tripDrive: td, driveTripId,
  }) : [];
  const dayConflicts = conflicts.filter((c) => c.date === target).map((c) => c.text);

  let prep = null;
  const trip = show.tripPrep === false ? null : prepTrip(ctx.travel, target);
  if (trip) {
    const tripModel = ctx.tripModels && ctx.tripModels[trip.id];
    const parkDates = parks ? [...new Set(parks.days.filter((d) => d.date >= trip.departDate && d.date <= trip.returnDate).map((d) => d.date))] : [];
    const packing = mergePacking(packingList({ model: tripModel, trip, parkDates, units }), briefingPacking);
    const ticks = checks(trip.id) || {};
    const todo = checklistItems(settings && settings.trip && settings.trip.checklist);
    prep = {
      trip,
      sub: tripSub(trip, fmtDateRange),
      drive: td && driveTripId === trip.id ? driveLine(td, units) : '',
      conflicts: conflicts.filter((c) => c.tripId === trip.id).map((c) => c.text),
      packing: packing.map((text) => ({ key: `pack:${text}`, text, done: !!ticks[`pack:${text}`] })),
      todo: todo.map((text) => ({ key: `todo:${text}`, text, done: !!ticks[`todo:${text}`] })),
      // park hours and the drive come from the v3 script; nudge when a connected script is older
      needsUpdate: !!(bridge && bridge.version < 3),
      departsIn: diffDays(trip.departDate, target),
    };
  }
  return { park, prep, dayConflicts, parkTags };
}

// ---------------------------------------------------------------- everything else on the page (v3 home features)

/**
 * The rundown, birthdays, dinner, workout and the Phoenix pack for one render. Pure.
 * opts: { target, today, evening (tomorrow's edition is showing), settings, bridge, meals ({plan, recipes}|null),
 *         summary (rack timer summary|null), parkToday/parkTomorrow (bool) }
 * -> { rundown, birthdays: [text], dinner: {date, meals, eatBy}|null, workout, chipsToday: [chip], chipsTomorrow: [chip],
 *      kidTips: [text], radar: bool, fine: {waterNote, dusty} }
 */
export function composeHome(ctx, opts) {
  const { target, today, evening, settings = {}, bridge = null, meals = null, summary = null } = opts;
  const show = settings.show || {};
  const units = ctx.units;
  const tomorrow = addDays(today, 1);
  const home = ctx.homeModel || ctx.model;
  const chipsToday = [];
  const chipsTomorrow = [];

  const rundown = show.rundown !== false && bridge && bridge.briefing ? rundownView(bridge.briefing, today) : null;
  const birthdays = show.birthdays !== false && bridge && bridge.birthdays ? birthdayLines(bridge.birthdays, today).map((x) => x.text) : [];
  const bdayChip = show.birthdays !== false && bridge && bridge.birthdays ? birthdayTomorrow(bridge.birthdays, today) : '';

  // dinner: the target day's meals; eat-by only for tonight, thaw for tomorrow's dinner (evening)
  let dinner = null;
  let notes = { thaw: '', eatBy: '' };
  if (show.dinner !== false && meals && meals.plan) {
    const m = mealsForDay(meals.plan, meals.recipes, target);
    notes = mealNotes({ plan: meals.plan, recipes: meals.recipes, today, events: ctx.events });
    if (m.breakfast || m.lunch || m.dinner) dinner = { date: target, meals: m, eatBy: target === today ? notes.eatBy : '' };
  }

  // workout for the target day
  let workout = null;
  if (show.workout !== false) {
    const info = ctx.travel ? ctx.travel.dayInfo(target) : null;
    const away = !!(info && info.where === 'away' && info.flag !== 'return');
    const model = modelForDate(ctx, target);
    const parkDay = !!(bridge && bridge.parks && bridge.parks.ok && bridge.parks.days.some((d) => d.date === target)) && show.parks !== false;
    workout = proposeWorkout({
      summary, oura: target === today ? ctx.oura : null, events: ctx.events, hours: model ? model.hours : [], now: target === today ? ctx.now : '',
      today: target, away, parkDay, settings: settings.workout || {}, units,
    });
  }
  const train = trainChip(workout);

  // phoenix pack
  const ph = settings.phoenix || {};
  const power = (date, now) => powerPeakChip({ model: modelForDate(ctx, date), date, now, cfg: ph.power, units });
  const water = (date) => (wateringDay(ph.watering, date) ? wateringAdvice(home, date, units) : null);
  const dust = show.dust !== false ? dustChip(ctx.model.aqi) : '';
  const tonightModel = modelForDate(ctx, tomorrow);
  const hour = +ctx.now.slice(11, 13);
  const chores = (ev, morning) => choreChips({ chores: settings.chores, today, evening: ev, morning, tonightModel, units });

  if (train) chipsToday.push({ key: 'train', icon: 'dumbbell', label: 'train', text: train, after: 'leave' });
  const pToday = power(today, ctx.now);
  if (pToday) chipsToday.push({ key: 'power', icon: 'bolt', label: 'power', text: pToday.replace(/^power /, '') });
  const wToday = water(today);
  if (wToday) chipsToday.push({ key: 'water', icon: 'drop', label: 'yard', text: wToday.line });
  if (dust) chipsToday.push({ key: 'dust', icon: 'wind', label: 'air', text: dust });
  // without the evening edition, tonight's chores still show from 5pm
  for (const c of chores(!evening && hour >= 17, true)) chipsToday.push({ ...c, icon: 'bin' });

  if (evening) {
    if (train) chipsTomorrow.push({ key: 'train', icon: 'dumbbell', label: 'train', text: train });
    if (notes.thaw) chipsTomorrow.push({ key: 'thaw', icon: 'fork', label: 'dinner', text: notes.thaw });
    for (const c of chores(true, false)) chipsTomorrow.push({ ...c, icon: 'bin' });
    if (bdayChip) chipsTomorrow.push({ key: 'bday', icon: 'gift', label: 'birthday', text: bdayChip });
    const pT = power(tomorrow, '');
    if (pT) chipsTomorrow.push({ key: 'power', icon: 'bolt', label: 'power', text: pT.replace(/^power /, '') });
    const wT = water(tomorrow);
    if (wT) chipsTomorrow.push({ key: 'water', icon: 'drop', label: 'yard', text: wT.line });
  }

  const kids = show.kidTips !== false ? kidTips(modelForDate(ctx, target), target, units) : [];
  const radar = show.radar !== false && radarWanted(ctx.model, ctx.now, ctx.model.alerts);
  // fine print: the next watering day's call, and dust in the air-quality note
  let waterNote = null;
  if (ph.watering && ph.watering.enabled && (ph.watering.days || []).length) {
    for (let i = 0; i < 7 && !waterNote; i++) {
      const d = addDays(today, i);
      if (wateringDay(ph.watering, d) && dayOf(home, d)) waterNote = { date: d, advice: wateringAdvice(home, d, units) };
    }
  }
  return { rundown, birthdays, dinner, workout, chipsToday, chipsTomorrow, kidTips: kids, radar, fine: { waterNote, dusty: show.dust !== false && dustHigh(ctx.model.aqi) } };
}

/** The fine print with the home extras: "and dusty" on air quality, and the next watering day's call. Pure. */
export function fineWithHome(fine, hf, today) {
  let out = Array.isArray(fine) ? fine : [];
  if (!hf) return out;
  if (hf.dusty) out = out.map((s) => (s.key === 'aqi' ? { ...s, note: s.note ? `${s.note}, and dusty` : 'dusty' } : s));
  const w = hf.waterNote;
  if (w && w.advice) {
    const when = w.date === today ? '' : `${dowShortOf(w.date)}: `;
    out = [...out, { key: 'water', label: 'watering', value: w.advice.value, note: `${when}${w.advice.note}` }];
  }
  return out;
}
