// Assembles the trip-prep and park-day view for the second card. Pure: storage and geocodes come in as functions.
import { diffDays, fmtDateRange } from './time.js';
import { modelForDate } from './insights.js';
import { prepTrip, packingList, mergePacking, checklistItems, findConflicts, tripSub } from './tripprep.js';
import { parkDaysFor, parkView, modelForPark, driveLine, parkTag } from './parks.js';

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
  const conflicts = home ? findConflicts({
    events: ctx.events, travel: ctx.travel, home, coordsFor, today, homeName: home.name || '', homeOffset, tripOffset, tripDrive: td, driveTripId,
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
