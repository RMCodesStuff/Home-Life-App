// Dinner tonight, from the meal planner (read-only). Pure: plan slots, the day's meals, thaw and eat-by notes.
// The plan doc (mealPlans/currentWeek) maps "{weekday}_{meal}" (monday_dinner) to a recipe id.
import { addDays, dowLong, fmtClock, addMinutes, minutesOfDay } from './time.js';
import { shortTitle } from './calendar.js';

export const MEALS = ['breakfast', 'lunch', 'dinner'];
export const slotKey = (date, meal) => `${dowLong(date)}_${meal}`;

/** Recipe ids referenced on these dates. */
export function recipeIdsFor(plan, dates) {
  const ids = new Set();
  if (!plan || typeof plan !== 'object') return [];
  for (const d of dates) for (const m of MEALS) { const id = plan[slotKey(d, m)]; if (typeof id === 'string' && id && id.length < 200 && !id.includes('/')) ids.add(id); }
  return [...ids];
}

/** {breakfast, lunch, dinner} -> {id, name, ingredients} | null, for one date. */
export function mealsForDay(plan, recipes, date) {
  const out = {};
  for (const m of MEALS) {
    const id = plan && plan[slotKey(date, m)];
    const rec = id && recipes ? recipes[id] : null;
    out[m] = rec && rec.name ? { id, name: String(rec.name).slice(0, 80), ingredients: Array.isArray(rec.ingredients) ? rec.ingredients.filter((x) => typeof x === 'string').slice(0, 60) : [] } : null;
  }
  return out;
}

/** Keep only what Home Life needs from a recipe doc. */
export const slimRecipe = (r) => (r && typeof r === 'object' ? {
  name: String(r.name || '').slice(0, 80),
  ingredients: Array.isArray(r.ingredients) ? r.ingredients.filter((x) => typeof x === 'string').map((x) => x.slice(0, 120)).slice(0, 60) : [],
  servings: Number.isFinite(r.servings) ? r.servings : null,
  mealTypes: Array.isArray(r.mealTypes) ? r.mealTypes.filter((x) => typeof x === 'string').slice(0, 3) : [],
} : null);

const MEAT = /\b(ground (?:beef|turkey|pork|chicken|lamb|bison)|chicken(?: breasts?| thighs?| drumsticks?| wings?| tenders?)?|beef(?: chuck| roast| stew meat)?|flank steak|sirloin|steaks?|pork(?: chops?| loin| tenderloin| shoulder| belly)?|sausages?|turkey(?: breast)?|salmon(?: fillets?)?|shrimp|prawns|fish(?: fillets?)?|cod|tilapia|halibut|mahi mahi|tuna steaks?|lamb|meatballs|ribs)\b/;
const NOT_RAW = /\b(broth|stock|bouillon|sauce|seasoning|powder|base|flavou?r|canned|cooked|smoked|rotisserie|jerky|deli|dried|paste|bacon bits)\b/;
/** "ground beef" from "1 lb ground beef (85%)"; '' when the line isn't raw meat or fish. */
export function meatPhrase(ingredient) {
  const s = String(ingredient || '').toLowerCase();
  if (NOT_RAW.test(s)) return '';
  const m = MEAT.exec(s);
  return m ? m[1] : '';
}

/**
 * thaw: tomorrow's dinner has raw meat or fish ("thaw: move the ground beef to the fridge for tomorrow's beef & broccoli bowls").
 * eatBy: a timed event today starting 5:30–8:30pm ("men's group at 7, eat by 6:15": start − its drive − 15 minutes).
 */
export function mealNotes({ plan, recipes, today, events = [] }) {
  const tomorrow = mealsForDay(plan, recipes, addDays(today, 1)).dinner;
  let thaw = '';
  if (tomorrow) {
    const phrase = tomorrow.ingredients.map(meatPhrase).find(Boolean);
    if (phrase) thaw = `thaw: move the ${phrase} to the fridge for tomorrow's ${tomorrow.name.toLowerCase()}`;
  }
  let eatBy = '';
  const ev = (events || []).filter((e) => !e.allDay && e.date === today && e.ls && minutesOfDay(e.ls) >= 17 * 60 + 30 && minutesOfDay(e.ls) <= 20 * 60 + 30)
    .sort((a, b) => a.ls.localeCompare(b.ls))[0];
  if (ev) {
    const drive = ev.travel && Number.isFinite(ev.travel.minutes) ? ev.travel.minutes : 0;
    const by = addMinutes(ev.ls, -drive - 15);
    eatBy = `${shortTitle(ev.title)} at ${fmtClock(ev.ls).replace(/(am|pm)$/, '')}, eat by ${fmtClock(by).replace(/(am|pm)$/, '')}`;
  }
  return { thaw, eatBy };
}
