/**
 * Home Life bridge (v3)
 *
 * What it does: a small Google Apps Script web app, running as you inside
 * Google, that gives the Home Life app read-only things as JSON:
 *   1. Your upcoming calendar events (titles, times, locations; never
 *      descriptions or guest lists; declined events are skipped).
 *   2. "Waiting on you": up to 5 inbox threads that need a reply or an action
 *      (sender, subject, a short snippet) plus package statuses, from Gmail.
 *   3. Leave-by times: drive minutes and a "leave by" time for today's events
 *      that have an address (Google Maps service).
 *   4. "Last night": sleep and readiness from your Oura ring (optional).
 *   5. The rundown: today's briefing file written to Google Drive by the daily
 *      Claude run (folder "Home Life", file home-life-briefing-YYYY-MM-DD.json).
 *   6. Park days: hours, early entry, show times and today's wait times from
 *      ThemeParks.wiki, for theme parks named in a calendar event in the next
 *      3 days (free, no key).
 *   7. Trip drive: drive time to a trip destination, when the app asks for it.
 *   8. Birthdays: contacts with a birthday in the next 21 days.
 * Each feature is optional and fails on its own, so one problem never takes
 * down the others. Switch any of them off with the ENABLE_* constants below.
 *
 * Permissions (appsscript.json), all read-only:
 *   calendar.readonly        your events.
 *   gmail.readonly           the waiting list and package statuses.
 *   drive.readonly           reads the briefing file the Claude run creates.
 *                            The Drive connector cannot edit file contents, so
 *                            the narrower drive.file scope would not see those
 *                            files. This script only lists the "Home Life"
 *                            folder and reads home-life-briefing-*.json.
 *   contacts.readonly        birthdays (People API).
 *   script.external_request  Gmail API, Oura, ThemeParks.wiki, People API.
 *
 * The SECRET below is a private key. Requests without the right key get
 * {"ok":false,"error":"unauthorized"}, which keeps strangers out. Anyone who has
 * both the web app URL and the key could read what this script returns (event
 * titles, email senders and subjects, drive times, Oura scores, the rundown's
 * money and fantasy lines, birthdays, park data), so keep both private.
 * Nothing is stored outside your Google account and your browser.
 *
 * Setup:
 *  1. Open https://script.google.com and create a new project.
 *  2. Delete the sample code and paste this script (in the app: settings ->
 *     Google -> "copy script", which already contains your private key).
 *  3. Project Settings (gear icon) -> tick "Show appsscript.json manifest
 *     file in editor". Open appsscript.json and replace its contents with the
 *     manifest (in the app: "copy manifest"). It limits Google's permission
 *     prompt to the read-only access listed above.
 *  4. Deploy -> New deployment -> type "Web app" -> Execute as: Me,
 *     Who has access: Anyone -> Deploy.
 *  5. Approve the permission prompt (read-only calendar, gmail, drive, contacts).
 *  6. Copy the Web app URL (ends in /exec), paste it into settings -> Google
 *     in the app, then tap "test connection".
 *
 * Updating an existing deployment from v1 or v2 (the URL stays the same): paste
 * the new script and manifest, then in the editor pick any function (doGet) and
 * press Run once so Google shows the new Drive and Contacts permission prompt
 * and you can approve it, then Deploy -> Manage deployments -> edit (pencil) ->
 * Version: New version -> Deploy. Until approved, briefing and birthdays report
 * an error and everything else keeps working.
 *
 * Birthdays use the People API. If birthdays reports "people api is off for
 * this script", turn it on once: in the editor, Services (+) -> People API ->
 * Add. That enables the API for the script's project; the editor also adds a
 * "dependencies" block to appsscript.json, which is fine to keep (pasting this
 * manifest again later removes it, and the API stays on).
 *
 * The rundown (optional): create a folder named exactly "Home Life" in My Drive.
 * The daily Claude run saves home-life-briefing-YYYY-MM-DD.json there. The
 * bridge returns the newest file dated within the last 2 days.
 *
 * Oura (optional, one-time):
 *  1. Create an application at https://cloud.ouraring.com/oauth/applications
 *     (free; personal apps allow up to 10 users). Redirect URI = your Web app
 *     URL (ends in /exec). Scope: daily.
 *  2. In Apps Script: Project Settings -> Script properties -> add
 *     OURA_CLIENT_ID and OURA_CLIENT_SECRET. If the redirect does not match,
 *     also add OURA_REDIRECT_URI with your exact Web app URL.
 *  3. In the app: settings -> Oura -> "connect oura", then authorize.
 * Gen3 and newer rings need an active Oura membership for API access.
 */

const SECRET = '__PASTE_SECRET_HERE__';
const DEFAULT_DAYS = 14;
const MAX_DAYS = 21;
const MAX_TITLE = 120;
const MAX_LOCATION = 200;

const ENABLE_GMAIL = true;
const ENABLE_LEAVE_BY = true;
const ENABLE_BRIEFING = true;
const ENABLE_PARKS = true;
const ENABLE_TRIP_DRIVE = true;
const ENABLE_BIRTHDAYS = true;

const BRIDGE_VERSION = 3;
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const OURA_API = 'https://api.ouraring.com';
const OURA_AUTH = 'https://cloud.ouraring.com/oauth/authorize';
const PARKS_API = 'https://api.themeparks.wiki/v1';
const PEOPLE_API = 'https://people.googleapis.com/v1/people/me/connections';
const BRIEFING_FOLDER = 'Home Life';
const BRIEFING_FILE_RE = /^home-life-briefing-(\d{4}-\d{2}-\d{2})\.json$/;

const MAX_WAITING = 5;
const MAX_WAITING_FETCH = 15;
const MAX_PACKAGES = 4;
const MAX_PACKAGE_FETCH = 12;
const MAX_LOOKUPS = 8;
const MAX_DRIVE_SECONDS = 3 * 3600;
const LEAVE_BUFFER_MIN = 5;
const INBOX_CACHE_SECONDS = 600;
const OURA_CACHE_SECONDS = 1200;
const ROUTE_CACHE_SECONDS = 2700;
const BRIEFING_CACHE_SECONDS = 600;
const BRIEFING_MAX_AGE_DAYS = 2;
const BRIEFING_MAX_BYTES = 200000;
const DEST_CACHE_SECONDS = 86400;
const SCHEDULE_CACHE_SECONDS = 6 * 3600;
const LIVE_CACHE_SECONDS = 300;
const PARK_WINDOW_DAYS = 3;
const MAX_PARK_DAYS = 6;
const MAX_SHOWS = 6;
const MAX_WAITS = 6;
const NAMESAKE_UNKNOWN_GAP_MIN = 360;
const TRIP_CACHE_SECONDS = 3 * 3600;
const TRIP_MIN_MILES = 25;
const TRIP_DEPART_HOUR = 8;
const BIRTHDAY_DAYS = 21;
const BIRTHDAY_PAGES = 3;
const BIRTHDAY_CACHE_SECONDS = 12 * 3600;
const CACHE_CHUNK = 30000;
const CACHE_MAX_SECONDS = 21600; // CacheService keeps values at most 6 hours; longer asks are clamped

const WAITING_QUERY = 'in:inbox newer_than:10d -category:promotions -category:social -category:forums -from:me';
const PACKAGE_QUERY = 'newer_than:7d (subject:("out for delivery" OR "arriving today" OR "arriving tomorrow" OR delivered OR "has shipped" OR "on its way" OR "on the way"))';

// Action patterns, first match wins. The reason is what the app shows.
const ACTION_PATTERNS = [
  [/\b(please|kindly)\s+confirm|reply\s+["“]?confirm|confirm\s+(your|the|by)\b/i, 'asks you to confirm'],
  [/\brsvp\b/i, 'wants an rsvp'],
  [/\b(please\s+)?(reply|respond)\s+(by|to|at your)|let (me|us) know\b/i, 'waiting for your reply'],
  [/\b(action\s+(required|needed)|needs your attention)\b/i, 'action needed'],
  [/\b(sign|signature)\b.*\b(document|form|waiver|agreement|lease)|docusign\b/i, 'needs a signature'],
  [/\b(payment|bill|invoice|balance)\b.*\bdue\b|\bdue\s+(today|tomorrow|by)\b/i, 'payment due'],
  [/\b(approve|approval)\b/i, 'needs your approval']
];
const RECEIPT_PATTERN = /\b(order|shipping|booking)\s+confirmation\b|\breceipt\b|\bverification code\b|\bsecurity code\b|\bone[- ]time\b/i;

// ---------------------------------------------------------------- doGet

function doGet(e) {
  const params = (e && e.parameter) || {};

  // Oura redirects back here with code + state (no key). The state value, which
  // we issued and cached, is what authorizes this request.
  if (!params.key && params.state && (params.code || params.error)) {
    return ouraCallback_(params);
  }

  if (!params.key || params.key !== SECRET) {
    return respond_({ ok: false, error: 'unauthorized' });
  }

  if (params.action === 'oura-connect') {
    return ouraConnectPage_();
  }

  let days = parseInt(params.days, 10);
  if (!(days > 0)) days = DEFAULT_DAYS;
  days = Math.min(days, MAX_DAYS);

  const tz = Session.getScriptTimeZone();
  const nowMs = Date.now();
  const now = new Date(nowMs);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + days + 1);
  const from = parseFromParam_(params.from);

  const events = collectEvents_(start, end, tz);

  if (ENABLE_LEAVE_BY && from) {
    try { addLeaveBy_(events, from, nowMs, tz); } catch (err) { /* leave-by is best effort */ }
  }
  const parks = isolate_(function () { return parksFeature_(events, nowMs, tz); });
  events.forEach(function (ev) { delete ev.sortKey; delete ev.startMs; });

  const out = {
    ok: true,
    version: BRIDGE_VERSION,
    timeZone: tz,
    generated: now.toISOString(),
    features: {
      gmail: ENABLE_GMAIL, leaveBy: ENABLE_LEAVE_BY, oura: ouraConfigured_(),
      briefing: ENABLE_BRIEFING, parks: ENABLE_PARKS, tripDrive: ENABLE_TRIP_DRIVE, birthdays: ENABLE_BIRTHDAYS
    },
    events: events,
    inbox: inboxFeature_(nowMs, tz),
    oura: ouraFeature_(nowMs, tz),
    briefing: isolate_(function () { return briefingFeature_(nowMs, tz); }),
    parks: parks,
    birthdays: isolate_(function () { return birthdaysFeature_(nowMs, tz); })
  };
  if (params.trip) {
    out.tripDrive = isolate_(function () { return tripDriveFeature_(params.trip, params.tripDate, from, nowMs, tz); });
  }
  return respond_(out);
}

/** Runs one feature; a throw becomes {ok:false} so it can never break the response. */
function isolate_(fn) {
  try { return fn(); } catch (err) { return { ok: false, error: shortError_(err) }; }
}

function respond_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------- calendar

function collectEvents_(start, end, tz) {
  const calendars = CalendarApp.getAllCalendars().filter(function (c) {
    return !c.isHidden() && c.isSelected();
  });

  const seen = {};
  const events = [];

  calendars.forEach(function (cal) {
    cal.getEvents(start, end).forEach(function (ev) {
      const status = ev.getMyStatus();
      if (status === CalendarApp.GuestStatus.NO) return;

      const title = String(ev.getTitle() || '').slice(0, MAX_TITLE);
      const startMs = ev.getStartTime().getTime();
      const dedupeKey = title + '|' + startMs;
      if (seen[dedupeKey]) return;
      seen[dedupeKey] = true;

      const allDay = ev.isAllDayEvent();
      let startStr, endStr;
      if (allDay) {
        startStr = Utilities.formatDate(ev.getAllDayStartDate(), tz, 'yyyy-MM-dd');
        endStr = Utilities.formatDate(ev.getAllDayEndDate(), tz, 'yyyy-MM-dd');
      } else {
        startStr = Utilities.formatDate(ev.getStartTime(), tz, "yyyy-MM-dd'T'HH:mm:ssXXX");
        endStr = Utilities.formatDate(ev.getEndTime(), tz, "yyyy-MM-dd'T'HH:mm:ssXXX");
      }

      events.push({
        sortKey: startMs,
        startMs: startMs,
        id: ev.getId(),
        title: title,
        calendar: cal.getName(),
        allDay: allDay,
        start: startStr,
        end: endStr,
        location: String(ev.getLocation() || '').slice(0, MAX_LOCATION),
        myStatus: status ? String(status) : ''
      });
    });
  });

  events.sort(function (a, b) { return a.sortKey - b.sortKey; });
  return events;
}

// ---------------------------------------------------------------- leave-by

/** "39.7400,-104.9900" -> {lat, lng}, or null when missing or out of range. */
function parseFromParam_(s) {
  const m = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(String(s || ''));
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lng = parseFloat(m[2]);
  if (!(Math.abs(lat) <= 90) || !(Math.abs(lng) <= 180)) return null;
  return { lat: lat, lng: lng };
}

/** Same filter the app uses: a real address, not a link or an online meeting. */
function isPhysicalLocation_(loc) {
  const s = String(loc || '').trim();
  if (!s) return false;
  return !/^https?:|zoom\.us|meet\.google|teams\.microsoft|webex|^online$/i.test(s);
}

/** Drive time and "leave by" for an event. leaveBy = start - drive - buffer, floored to the minute. */
function computeTravel_(startMs, driveSeconds, meters, tz) {
  const leaveMs = Math.floor((startMs - driveSeconds * 1000 - LEAVE_BUFFER_MIN * 60000) / 60000) * 60000;
  return {
    minutes: Math.round(driveSeconds / 60),
    miles: Math.round((meters / 1609.344) * 10) / 10,
    leaveBy: Utilities.formatDate(new Date(leaveMs), tz, "yyyy-MM-dd'T'HH:mm:ssXXX")
  };
}

/** End of the lookup window: noon tomorrow, script time zone. */
function leaveWindowEnd_(nowMs) {
  const d = new Date(nowMs);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 12, 0, 0).getTime();
}

function routeCacheKey_(from, destination, startMs) {
  return ('lb|' + from.lat.toFixed(3) + ',' + from.lng.toFixed(3) + '|' + String(destination).toLowerCase().slice(0, 150) + '|' + Math.floor(startMs / 3600000)).slice(0, 240);
}

/** Looks up one drive. Returns {seconds, meters} or null (no route). Throws on service errors. */
function lookupDrive_(from, destination, startMs, nowMs) {
  const depart = new Date(Math.max(startMs - 30 * 60000, nowMs));
  const res = Maps.newDirectionFinder()
    .setOrigin(from.lat, from.lng)
    .setDestination(destination)
    .setMode(Maps.DirectionFinder.Mode.DRIVING)
    .setDepart(depart)
    .getDirections();
  const route = res && res.routes && res.routes[0];
  const leg = route && route.legs && route.legs[0];
  if (!leg) return null;
  const dur = leg.duration_in_traffic || leg.duration;
  if (!dur || !(dur.value >= 0) || !leg.distance) return null;
  return { seconds: dur.value, meters: leg.distance.value || 0 };
}

/** Adds `travel` to qualifying events, in place. At most MAX_LOOKUPS uncached lookups. */
function addLeaveBy_(events, from, nowMs, tz) {
  const windowEnd = leaveWindowEnd_(nowMs);
  const cache = cacheOf_();
  let lookups = 0;
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.allDay || ev.startMs < nowMs || ev.startMs > windowEnd) continue;
    if (!isPhysicalLocation_(ev.location)) continue;
    const key = routeCacheKey_(from, ev.location, ev.startMs);
    let drive;
    const hit = cacheRead_(cache, key);
    if (hit !== undefined) {
      drive = hit;
    } else {
      if (lookups >= MAX_LOOKUPS) continue;
      lookups++;
      try { drive = lookupDrive_(from, ev.location, ev.startMs, nowMs); } catch (err) { continue; }
      cacheWrite_(cache, key, drive, ROUTE_CACHE_SECONDS);
    }
    if (!drive || drive.seconds > MAX_DRIVE_SECONDS) continue; // no route, or a trip (the app covers those)
    ev.travel = computeTravel_(ev.startMs, drive.seconds, drive.meters, tz);
  }
}

// ---------------------------------------------------------------- cache helpers

function cacheOf_() {
  try { return CacheService.getScriptCache(); } catch (err) { return null; }
}
/** Returns the stored value, null for a stored "nothing", or undefined when absent. */
function cacheRead_(cache, key) {
  if (!cache) return undefined;
  try {
    const raw = cache.get(key);
    if (raw === null || raw === undefined) return undefined;
    return JSON.parse(raw);
  } catch (err) { return undefined; }
}
function cacheWrite_(cache, key, value, seconds) {
  if (!cache) return;
  try { cache.put(key, JSON.stringify(value === undefined ? null : value), Math.min(seconds, CACHE_MAX_SECONDS)); } catch (err) { /* too big or unavailable */ }
}

/** Like cacheWrite_ but splits values over the 100 KB per-key limit into chunks. */
function cacheWriteBig_(cache, key, value, seconds) {
  if (!cache) return;
  const raw = JSON.stringify(value === undefined ? null : value);
  if (raw.length <= CACHE_CHUNK) { cacheWrite_(cache, key, value, seconds); return; }
  const n = Math.ceil(raw.length / CACHE_CHUNK);
  const ttl = Math.min(seconds, CACHE_MAX_SECONDS);
  try {
    for (let i = 0; i < n; i++) cache.put(key + ':' + i, raw.slice(i * CACHE_CHUNK, (i + 1) * CACHE_CHUNK), ttl);
    cache.put(key, JSON.stringify({ chunked: n }), ttl);
  } catch (err) { /* unavailable */ }
}
function cacheReadBig_(cache, key) {
  const head = cacheRead_(cache, key);
  if (!head || typeof head !== 'object' || !head.chunked) return head;
  try {
    let raw = '';
    for (let i = 0; i < head.chunked; i++) {
      const part = cache.get(key + ':' + i);
      if (part === null || part === undefined) return undefined;
      raw += part;
    }
    return JSON.parse(raw);
  } catch (err) { return undefined; }
}

/** Short, token-free error text for responses. */
function shortError_(err) {
  const s = String((err && err.message) || err || 'error').replace(/[A-Za-z0-9_\-\.]{24,}/g, '...');
  return s.slice(0, 80);
}

// ---------------------------------------------------------------- date helpers

function todayIn_(nowMs, tz) {
  return Utilities.formatDate(new Date(nowMs), tz, 'yyyy-MM-dd');
}
function dayShift_(date, n) {
  const p = date.split('-').map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
  return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
}

// ---------------------------------------------------------------- gmail

function gmailGet_(path) {
  const res = UrlFetchApp.fetch(GMAIL_API + path, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  return gmailParse_(res);
}
function gmailParse_(res) {
  const code = res.getResponseCode();
  if (code === 401 || code === 403) throw new Error('gmail access not approved (redeploy and approve)');
  if (code !== 200) throw new Error('gmail http ' + code);
  return JSON.parse(res.getContentText());
}

function listThreads_(query, max) {
  const j = gmailGet_('/threads?q=' + encodeURIComponent(query) + '&maxResults=' + max);
  return (j.threads || []).map(function (t) { return t.id; });
}

/** Fetches thread metadata in one batch. Failed threads are skipped. */
function fetchThreads_(ids) {
  if (!ids.length) return [];
  const token = ScriptApp.getOAuthToken();
  const reqs = ids.map(function (id) {
    return {
      url: GMAIL_API + '/threads/' + encodeURIComponent(id) + '?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date',
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    };
  });
  const out = [];
  UrlFetchApp.fetchAll(reqs).forEach(function (res) {
    try {
      if (res.getResponseCode() === 200) out.push(JSON.parse(res.getContentText()));
    } catch (err) { /* skip */ }
  });
  return out;
}

function headerValue_(msg, name) {
  const hs = (msg && msg.payload && msg.payload.headers) || [];
  const want = name.toLowerCase();
  for (let i = 0; i < hs.length; i++) {
    if (String(hs[i].name).toLowerCase() === want) return String(hs[i].value || '');
  }
  return '';
}

/** Display name from a From header; falls back to the address local part. */
function displayName_(from) {
  const s = String(from || '').trim();
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]*)>\s*$/.exec(s);
  let name = '';
  let addr = '';
  if (m) { name = m[1].trim(); addr = m[2].trim(); } else if (s.indexOf('@') >= 0) { addr = s; } else { name = s; }
  if (name && name.indexOf('@') < 0) return name;
  const local = addr.split('@')[0];
  return local || name || '';
}

function decodeEntities_(s) {
  return String(s || '')
    .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, function (m, n) { return String.fromCharCode(parseInt(n, 10)); })
    .replace(/&amp;/g, '&');
}

/** The newest message of a thread (messages carry internalDate in ms). */
function newestMessage_(thread) {
  const msgs = (thread && thread.messages) || [];
  let best = null;
  msgs.forEach(function (m) {
    if (!best || Number(m.internalDate || 0) >= Number(best.internalDate || 0)) best = m;
  });
  return best;
}
const hasLabel_ = function (msg, label) { return ((msg && msg.labelIds) || []).indexOf(label) >= 0; };

/** Does this thread need the user? Returns {reason} or null. */
function classifyThread_(thread) {
  const last = newestMessage_(thread);
  if (!last) return null;
  if (hasLabel_(last, 'SENT')) return null; // the user already replied
  const subject = headerValue_(last, 'Subject');
  const snippet = decodeEntities_(last.snippet);
  const starred = ((thread.messages) || []).some(function (m) { return hasLabel_(m, 'STARRED'); });
  if (starred) return { reason: 'starred' };
  if (!hasLabel_(last, 'UNREAD') && !hasLabel_(last, 'IMPORTANT')) return null;
  // Plain receipts are not tasks unless the body asks for something.
  const text = RECEIPT_PATTERN.test(subject) ? snippet : subject + ' ' + snippet;
  for (let i = 0; i < ACTION_PATTERNS.length; i++) {
    if (ACTION_PATTERNS[i][0].test(text)) return { reason: ACTION_PATTERNS[i][1] };
  }
  return null;
}

function threadUrl_(id) { return 'https://mail.google.com/mail/u/0/#all/' + id; }
const isoOf_ = function (msg) { return new Date(Number(msg.internalDate || 0)).toISOString(); };

/** Up to MAX_WAITING threads that need the user, newest first. */
function buildWaiting_(threads) {
  const out = [];
  (threads || []).forEach(function (t) {
    const c = classifyThread_(t);
    if (!c) return;
    const last = newestMessage_(t);
    out.push({
      ms: Number(last.internalDate || 0),
      item: {
        id: String(t.id),
        from: displayName_(headerValue_(last, 'From')).slice(0, 60),
        subject: decodeEntities_(headerValue_(last, 'Subject')).slice(0, 120),
        snippet: decodeEntities_(last.snippet).replace(/\s+/g, ' ').trim().slice(0, 120),
        date: isoOf_(last),
        reason: c.reason,
        url: threadUrl_(t.id)
      }
    });
  });
  out.sort(function (a, b) { return b.ms - a.ms; });
  return out.slice(0, MAX_WAITING).map(function (x) { return x.item; });
}

// ---- packages

const MERCHANT_NOISE = ['com', 'net', 'org', 'inc', 'llc', 'ltd', 'co', 'orders', 'order', 'shipping', 'shipment', 'shipments',
  'delivery', 'deliveries', 'updates', 'update', 'notifications', 'notification', 'team', 'support', 'tracking', 'noreply', 'no-reply'];

function merchantName_(from) {
  const s = String(from || '');
  const name = displayName_(s);
  const m = /<([^>]*)>/.exec(s);
  const addr = m ? m[1] : (s.indexOf('@') >= 0 ? s : '');
  const hasDisplay = /^\s*"?[^"<@]+?"?\s*</.test(s) && name.indexOf('@') < 0;
  let base = hasDisplay ? name : (addr.split('@')[1] || '').split('.')[0] || name;
  base = base.toLowerCase().replace(/\.(com|net|org)\b/g, '');
  const kept = base.replace(/[^a-z0-9&' -]+/g, ' ').split(/\s+/).filter(function (w) {
    return w && MERCHANT_NOISE.indexOf(w) < 0;
  });
  return kept.join(' ').trim() || base.trim();
}

/**
 * Package status for one message, or null. Priority: delivered (only when dated
 * today) -> out for delivery -> arriving today -> arriving tomorrow. A plain
 * "shipped" with no arrival day is dropped. Stale messages (not from today) are
 * ignored, since "arriving today" in yesterday's email is not today's news.
 */
function packageStatus_(subject, snippet, msgMs, nowMs, tz) {
  const t = (String(subject || '') + ' ' + String(snippet || '')).toLowerCase();
  const isToday = todayIn_(msgMs, tz) === todayIn_(nowMs, tz);
  if (!isToday) return null;
  const forward = t.replace(/\b(will|to|be|being|expected|scheduled|until|once|when|if)\s+(be\s+)?delivered\b/g, ' ');
  if (/\bdelivered\b/.test(forward)) return 'delivered';
  if (/\bout for delivery\b/.test(t)) return 'out for delivery';
  if (/\barriv(?:ing|es)\s+today\b|\bdelivery\s+today\b|\bdelivered\s+today\b|\bwill be delivered today\b/.test(t)) return 'arriving today';
  if (/\barriv(?:ing|es)\s+tomorrow\b|\bdelivery\s+tomorrow\b|\bdelivered\s+tomorrow\b/.test(t)) return 'arriving tomorrow';
  return null;
}

function buildPackages_(threads, nowMs, tz) {
  const rows = [];
  (threads || []).forEach(function (t) {
    const last = newestMessage_(t);
    if (!last) return;
    const status = packageStatus_(headerValue_(last, 'Subject'), decodeEntities_(last.snippet), Number(last.internalDate || 0), nowMs, tz);
    if (!status) return;
    rows.push({
      ms: Number(last.internalDate || 0),
      item: {
        id: String(t.id),
        merchant: merchantName_(headerValue_(last, 'From')),
        status: status,
        subject: decodeEntities_(headerValue_(last, 'Subject')).slice(0, 120),
        date: isoOf_(last),
        url: threadUrl_(t.id)
      }
    });
  });
  rows.sort(function (a, b) { return b.ms - a.ms; });
  const seen = {};
  const out = [];
  rows.forEach(function (r) {
    const k = r.item.merchant + '|' + r.item.status;
    if (seen[k]) return;
    seen[k] = true;
    out.push(r.item);
  });
  return out.slice(0, MAX_PACKAGES);
}

function inboxFeature_(nowMs, tz) {
  if (!ENABLE_GMAIL) return { ok: false, error: 'disabled' };
  const cache = cacheOf_();
  const hit = cacheRead_(cache, 'hl-inbox-v2');
  if (hit) return hit;
  try {
    const waiting = buildWaiting_(fetchThreads_(listThreads_(WAITING_QUERY, MAX_WAITING_FETCH)));
    let packages = [];
    try {
      packages = buildPackages_(fetchThreads_(listThreads_(PACKAGE_QUERY, MAX_PACKAGE_FETCH)), nowMs, tz);
    } catch (err) { /* packages are a bonus; keep the waiting list */ }
    const result = { ok: true, waiting: waiting, packages: packages };
    cacheWrite_(cache, 'hl-inbox-v2', result, INBOX_CACHE_SECONDS);
    return result;
  } catch (err) {
    return { ok: false, error: shortError_(err) };
  }
}

// ---------------------------------------------------------------- oura

function props_() { return PropertiesService.getScriptProperties(); }

function ouraConfigured_() {
  const p = props_();
  return !!(p.getProperty('OURA_CLIENT_ID') && p.getProperty('OURA_CLIENT_SECRET'));
}
function ouraRedirectUri_() {
  return props_().getProperty('OURA_REDIRECT_URI') || ScriptApp.getService().getUrl();
}
function ouraError_(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

function escHtml_(s) {
  return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
}
function page_(title, body) {
  const html = '<!doctype html><html><head><base target="_top"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<style>body{font:18px/1.5 system-ui,sans-serif;max-width:30em;margin:15vh auto;padding:0 20px;color:#241e1a}' +
    'a.go{display:inline-block;margin-top:18px;padding:16px 26px;border-radius:30px;background:#c4613f;color:#fff;font-size:22px;text-decoration:none}</style>' +
    '</head><body>' + body + '</body></html>';
  return HtmlService.createHtmlOutput(html).setTitle(title);
}

/** action=oura-connect (key required): a page with one big link to Oura's authorize screen. */
function ouraConnectPage_() {
  if (!ouraConfigured_()) {
    return page_('Oura', '<h1>oura is not set up</h1><p>add OURA_CLIENT_ID and OURA_CLIENT_SECRET in Project Settings, then try again.</p>');
  }
  const state = Utilities.getUuid();
  cacheWrite_(cacheOf_(), 'oura-state:' + state, 1, 600);
  const url = OURA_AUTH + '?response_type=code' +
    '&client_id=' + encodeURIComponent(props_().getProperty('OURA_CLIENT_ID')) +
    '&redirect_uri=' + encodeURIComponent(ouraRedirectUri_()) +
    '&scope=daily' +
    '&state=' + encodeURIComponent(state);
  return page_('Connect Oura', '<h1>connect oura</h1><p>this lets your home life script read your sleep and readiness scores.</p>' +
    '<a class="go" target="_top" href="' + escHtml_(url) + '">authorize with oura</a>');
}

function ouraTokenRequest_(form) {
  const res = UrlFetchApp.fetch(OURA_API + '/oauth/token', { method: 'post', payload: form, muteHttpExceptions: true });
  const code = res.getResponseCode();
  let j = null;
  try { j = JSON.parse(res.getContentText()); } catch (err) { j = null; }
  return { code: code, json: j };
}

function ouraStoreTokens_(j, nowMs) {
  const p = props_();
  const values = { OURA_ACCESS_TOKEN: String(j.access_token) };
  if (j.refresh_token) values.OURA_REFRESH_TOKEN = String(j.refresh_token); // Oura rotates these
  values.OURA_EXPIRES_AT = String(nowMs + (Number(j.expires_in) || 86400) * 1000);
  p.setProperties(values);
}

/** Redirect target. Validates `state` against the cache, exchanges `code`, stores tokens. */
function ouraCallback_(params) {
  const cache = cacheOf_();
  const key = 'oura-state:' + params.state;
  if (cacheRead_(cache, key) === undefined) {
    return page_('Oura', '<h1>that link expired</h1><p>go back to the app and tap connect oura again.</p>');
  }
  try { cache.remove(key); } catch (err) { /* ignore */ }
  if (params.error || !params.code || !ouraConfigured_()) {
    return page_('Oura', '<h1>oura was not connected</h1><p>you can close this tab and try again from the app.</p>');
  }
  try {
    const p = props_();
    const r = ouraTokenRequest_({
      grant_type: 'authorization_code',
      code: String(params.code),
      redirect_uri: ouraRedirectUri_(),
      client_id: p.getProperty('OURA_CLIENT_ID'),
      client_secret: p.getProperty('OURA_CLIENT_SECRET')
    });
    if (r.code !== 200 || !r.json || !r.json.access_token) {
      return page_('Oura', '<h1>oura did not accept that</h1><p>check the redirect uri in your oura application matches your web app url exactly, then try again.</p>');
    }
    ouraStoreTokens_(r.json, Date.now());
    try { cache.remove('hl-oura-v2'); } catch (err) { /* ignore */ }
    return page_('Oura', '<h1>oura connected</h1><p>you can close this tab.</p>');
  } catch (err) {
    return page_('Oura', '<h1>something went wrong</h1><p>close this tab and try again from the app.</p>');
  }
}

function ouraRefresh_() {
  const p = props_();
  const refresh = p.getProperty('OURA_REFRESH_TOKEN');
  if (!refresh) throw ouraError_('not_connected');
  const r = ouraTokenRequest_({
    grant_type: 'refresh_token',
    refresh_token: refresh,
    client_id: p.getProperty('OURA_CLIENT_ID'),
    client_secret: p.getProperty('OURA_CLIENT_SECRET')
  });
  if (r.code !== 200 || !r.json || !r.json.access_token) {
    throw ouraError_('auth_failed', 'oura connection expired, connect oura again in settings');
  }
  ouraStoreTokens_(r.json, Date.now());
  return String(r.json.access_token);
}

function ouraAccessToken_(nowMs) {
  const p = props_();
  const token = p.getProperty('OURA_ACCESS_TOKEN');
  if (!token && !p.getProperty('OURA_REFRESH_TOKEN')) throw ouraError_('not_connected');
  const exp = Number(p.getProperty('OURA_EXPIRES_AT') || 0);
  if (!token || exp - 60000 < nowMs) return ouraRefresh_();
  return token;
}

function ouraFetchAll_(token, startDate, endDate) {
  const paths = ['/v2/usercollection/daily_readiness', '/v2/usercollection/daily_sleep', '/v2/usercollection/sleep'];
  const reqs = paths.map(function (path) {
    return {
      url: OURA_API + path + '?start_date=' + startDate + '&end_date=' + endDate,
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    };
  });
  return UrlFetchApp.fetchAll(reqs);
}

const num_ = function (v) { return typeof v === 'number' && isFinite(v) ? v : null; };
const avg_ = function (xs) {
  const v = xs.filter(function (x) { return x !== null && x !== undefined; });
  return v.length ? Math.round(v.reduce(function (a, b) { return a + b; }, 0) / v.length) : null;
};
const latestBy_ = function (list) {
  let best = null;
  (list || []).forEach(function (r) { if (r && r.day && (!best || r.day >= best.day)) best = r; });
  return best;
};

/** One sleep record per day: the long_sleep one (latest), else the longest. */
function sleepRecordFor_(records, day) {
  const mine = (records || []).filter(function (r) { return r && r.day === day; });
  if (!mine.length) return null;
  const long = mine.filter(function (r) { return r.type === 'long_sleep'; });
  if (long.length) {
    return long.reduce(function (a, b) { return String(b.bedtime_start || '') >= String(a.bedtime_start || '') ? b : a; });
  }
  return mine.reduce(function (a, b) { return (num_(b.total_sleep_duration) || 0) > (num_(a.total_sleep_duration) || 0) ? b : a; });
}

/** Turns the three Oura collections into the app's shape. Every field is optional. */
function pickOura_(readinessList, dailySleepList, sleepList) {
  const r = latestBy_(readinessList);
  const ds = latestBy_(dailySleepList);
  const days = [r && r.day, ds && ds.day].filter(Boolean).sort();
  const day = days.length ? days[days.length - 1] : null;
  if (!day) return { ok: false, error: 'no oura data yet' };
  const sleepDay = ds ? ds.day : day;
  const rec = sleepRecordFor_(sleepList, sleepDay);

  const sleep = (ds || rec) ? {
    score: ds ? num_(ds.score) : null,
    totalSec: rec ? num_(rec.total_sleep_duration) : null,
    deepSec: rec ? num_(rec.deep_sleep_duration) : null,
    remSec: rec ? num_(rec.rem_sleep_duration) : null,
    efficiency: rec ? num_(rec.efficiency) : null,
    avgHrv: rec ? num_(rec.average_hrv) : null,
    lowestHr: rec ? num_(rec.lowest_heart_rate) : null,
    bedtimeStart: rec && rec.bedtime_start ? String(rec.bedtime_start) : null,
    bedtimeEnd: rec && rec.bedtime_end ? String(rec.bedtime_end) : null
  } : null;

  // Week = the 7 days before the latest day, latest excluded.
  const lo = dayShift_(day, -7);
  const inWeek = function (d) { return d && d < day && d >= lo; };
  const weekDays = {};
  (sleepList || []).forEach(function (s) { if (s && inWeek(s.day)) weekDays[s.day] = true; });
  const weekTotals = Object.keys(weekDays).map(function (d) {
    const rr = sleepRecordFor_(sleepList, d);
    return rr ? num_(rr.total_sleep_duration) : null;
  });

  return {
    ok: true,
    day: day,
    readiness: r ? { score: num_(r.score), temperatureDeviation: num_(r.temperature_deviation) } : null,
    sleep: sleep,
    week: {
      readinessAvg: avg_((readinessList || []).filter(function (x) { return x && inWeek(x.day); }).map(function (x) { return num_(x.score); })),
      sleepScoreAvg: avg_((dailySleepList || []).filter(function (x) { return x && inWeek(x.day); }).map(function (x) { return num_(x.score); })),
      totalSecAvg: avg_(weekTotals)
    }
  };
}

function ouraData_(nowMs, tz) {
  const today = todayIn_(nowMs, tz);
  const startDate = dayShift_(today, -8);
  const endDate = dayShift_(today, 1);
  let token = ouraAccessToken_(nowMs);
  let res = ouraFetchAll_(token, startDate, endDate);
  if (res.some(function (x) { return x.getResponseCode() === 401; })) {
    token = ouraRefresh_(); // refresh once, retry once
    res = ouraFetchAll_(token, startDate, endDate);
  }
  if (res.some(function (x) { const c = x.getResponseCode(); return c === 401 || c === 403; })) {
    throw ouraError_('auth_failed', 'oura refused access (membership required for gen3 and newer)');
  }
  const bad = res.filter(function (x) { return x.getResponseCode() !== 200; })[0];
  if (bad) throw new Error('oura http ' + bad.getResponseCode());
  const lists = res.map(function (x) { return (JSON.parse(x.getContentText()).data) || []; });
  return pickOura_(lists[0], lists[1], lists[2]);
}

function ouraFeature_(nowMs, tz) {
  if (!ouraConfigured_()) return { ok: false, error: 'not_configured' };
  const cache = cacheOf_();
  const hit = cacheRead_(cache, 'hl-oura-v2');
  if (hit) return hit;
  try {
    const result = ouraData_(nowMs, tz);
    if (result.ok) cacheWrite_(cache, 'hl-oura-v2', result, OURA_CACHE_SECONDS);
    return result;
  } catch (err) {
    if (err && err.code) return { ok: false, error: err.code, message: err.code === 'not_connected' ? undefined : shortError_(err) };
    return { ok: false, error: shortError_(err) };
  }
}

// ---------------------------------------------------------------- briefing (Drive)

/** Newest briefing file name within the age window: {date, name} or null. Pure. */
function pickBriefingName_(names, today) {
  const oldest = dayShift_(today, -BRIEFING_MAX_AGE_DAYS);
  let best = null;
  (names || []).forEach(function (name) {
    const m = BRIEFING_FILE_RE.exec(String(name));
    if (!m) return;
    const date = m[1];
    if (date < oldest || date > today) return;
    if (!best || date > best.date) best = { date: date, name: String(name) };
  });
  return best;
}

/** Reads the newest briefing file's text from the "Home Life" folder(s). Returns {name, date, text} or null. */
function readBriefingFile_(today) {
  const files = {};
  const trashed = function (x) { try { return typeof x.isTrashed === 'function' && x.isTrashed(); } catch (err) { return false; } };
  const updated = function (x) { try { return typeof x.getLastUpdated === 'function' ? x.getLastUpdated().getTime() : 0; } catch (err) { return 0; } };
  const folders = DriveApp.getFoldersByName(BRIEFING_FOLDER);
  while (folders.hasNext()) {
    const folder = folders.next();
    if (trashed(folder)) continue;
    const it = folder.getFiles();
    while (it.hasNext()) {
      const f = it.next();
      const name = f.getName();
      if (BRIEFING_FILE_RE.test(name) && !trashed(f)) (files[name] = files[name] || []).push(f);
    }
  }
  const pick = pickBriefingName_(Object.keys(files), today);
  if (!pick) return null;
  // Drive allows duplicate names (a re-run the same day): the newest copy wins.
  const file = files[pick.name].reduce(function (a, b) { return updated(b) > updated(a) ? b : a; });
  return { name: pick.name, date: pick.date, text: file.getBlob().getDataAsString('UTF-8') };
}

function briefingFeature_(nowMs, tz) {
  if (!ENABLE_BRIEFING) return { ok: false, error: 'disabled' };
  const today = todayIn_(nowMs, tz);
  const cache = cacheOf_();
  let hit = cacheRead_(cache, 'hl-briefing-v3');
  if (!hit || !hit.file || !hit.forDate || hit.forDate < dayShift_(today, -BRIEFING_MAX_AGE_DAYS)) hit = undefined;
  if (!hit) {
    let found;
    try { found = readBriefingFile_(today); } catch (err) { return { ok: false, error: shortError_(err) }; }
    if (!found) return { ok: false, error: 'not_found' };
    if (found.text.length > BRIEFING_MAX_BYTES) return { ok: false, error: 'too_big' };
    let data;
    try { data = JSON.parse(found.text); } catch (err) { return { ok: false, error: 'bad_json' }; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: 'bad_json' };
    hit = { file: found.name, forDate: found.date, data: data };
    cacheWriteBig_(cache, 'hl-briefing-v3', hit, BRIEFING_CACHE_SECONDS);
  }
  return { ok: true, file: hit.file, forDate: hit.forDate, stale: hit.forDate !== today, data: hit.data };
}

// ---------------------------------------------------------------- parks (ThemeParks.wiki)

const PARK_STOP_WORDS = ['park', 'theme', 'the'];

/** Lowercase, strip punctuation, drop the filler words. Returns a token array. */
function parkTokens_(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(function (w) {
    return w && PARK_STOP_WORDS.indexOf(w) < 0;
  });
}

// Travel and lodging words. An event that only loosely names a park ("Drive to
// Disneyland", "Disneyland Hotel") is not a park day; one with the full park name
// ("Event at Disneyland Park") always is.
const PARK_TRAVEL_RE = /\b(hotels?|inn|motel|lodge|lodging|suites?|airbnb|vrbo|check ?in|check ?out|flights?|airport|drive|driving|leave|depart|departure|return|travel|pack|packing)\b/;

/** Lowercase words separated by single spaces, padded: " event at disneyland park ". */
function parkPhrase_(s) {
  return ' ' + String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
}

/**
 * Parks named by an event (title + location). A park matches when every token of
 * its name appears among the text's tokens (a weak match is skipped when the text
 * reads like travel or lodging, unless the full park name appears). When one
 * matched park's tokens are a strict subset of another's, only the more specific
 * one is kept. Parks with the same name in different destinations ("Disneyland
 * Park" in Anaheim and Paris) are narrowed by destination words in the text
 * ("paris", "resort"); any that remain tied are all returned, next to each other.
 */
function matchParks_(text, parks) {
  const have = {};
  parkTokens_(text).forEach(function (t) { have[t] = true; });
  const phrase = parkPhrase_(text);
  const travel = PARK_TRAVEL_RE.test(phrase);
  const hits = [];
  (parks || []).forEach(function (p) {
    const toks = parkTokens_(p && p.name);
    if (!toks.length || !p.id) return;
    if (!toks.every(function (t) { return have[t]; })) return;
    if (travel && phrase.indexOf(parkPhrase_(p.name)) < 0) return;
    const destScore = parkTokens_(p.dest).filter(function (t) { return toks.indexOf(t) < 0 && have[t]; }).length;
    hits.push({ park: p, toks: toks, key: toks.join(' '), destScore: destScore });
  });
  return hits.filter(function (h) {
    return !hits.some(function (o) {
      if (o === h) return false;
      if (o.key === h.key) return o.destScore > h.destScore;
      return o.toks.length > h.toks.length && h.toks.every(function (t) { return o.toks.indexOf(t) >= 0; });
    });
  }).map(function (h) { return h.park; });
}

/** UTC offset in minutes of a time zone at an instant, or null. */
function zoneOffsetMin_(zone, ms) {
  if (!zone) return null;
  try {
    const s = Utilities.formatDate(new Date(ms), zone, "yyyy-MM-dd'T'HH:mm:ssXXX");
    if (/Z$/.test(s)) return 0;
    const m = /([+-])(\d{2}):(\d{2})$/.exec(s);
    return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : null;
  } catch (err) { return null; }
}

/**
 * Among same-named parks, the one whose time zone is closest to the script's. A park
 * whose zone is unknown (its schedule failed) counts as 6 hours away, so it beats a
 * park on another continent: better no data that day than Paris hours in Anaheim.
 * Ties keep list order.
 */
function pickNamesake_(candidates, zoneOf, tz, ms) {
  const home = zoneOffsetMin_(tz, ms);
  let best = null;
  let bestGap = Infinity;
  (candidates || []).forEach(function (p) {
    const off = zoneOffsetMin_(zoneOf(p.id), ms);
    const gap = off === null || home === null ? NAMESAKE_UNKNOWN_GAP_MIN : Math.abs(off - home);
    if (!best || gap < bestGap) { best = p; bestGap = gap; }
  });
  return best;
}

/** Dates (yyyy-MM-dd) of an event that fall inside the window set. */
function eventDatesInWindow_(ev, windowDates) {
  const out = [];
  const start = String(ev.start || '').slice(0, 10);
  if (ev.allDay) {
    const end = String(ev.end || '').slice(0, 10);
    for (let d = start, n = 0; d && d < end && n < 30; d = dayShift_(d, 1), n++) {
      if (windowDates.indexOf(d) >= 0) out.push(d);
    }
    if (!out.length && start && windowDates.indexOf(start) >= 0 && !(end > start)) out.push(start);
  } else if (windowDates.indexOf(start) >= 0) {
    out.push(start);
  }
  return out;
}

/**
 * Unique {date, park, alts} entries from events, soonest first, capped. `alts` holds
 * every same-named candidate (usually just `park`); parksFeature_ picks among them.
 */
function parkDaysFromEvents_(events, parks, windowDates) {
  const seen = {};
  const out = [];
  (events || []).forEach(function (ev) {
    const dates = eventDatesInWindow_(ev, windowDates);
    if (!dates.length) return;
    const text = String(ev.title || '') + ' ' + String(ev.location || '');
    const groups = {};
    const order = [];
    matchParks_(text, parks).forEach(function (p) {
      const key = parkTokens_(p.name).join(' ');
      if (!groups[key]) { groups[key] = []; order.push(key); }
      groups[key].push(p);
    });
    order.forEach(function (key) {
      dates.forEach(function (date) {
        const k = key + '|' + date;
        if (seen[k]) {
          if (groups[key].length < seen[k].alts.length) { seen[k].alts = groups[key]; seen[k].park = groups[key][0]; }
          return;
        }
        seen[k] = { date: date, park: groups[key][0], alts: groups[key] };
        out.push(seen[k]);
      });
    });
  });
  out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.park.name < b.park.name ? -1 : 1); });
  return out.slice(0, MAX_PARK_DAYS);
}

function parksGet_(path) {
  const res = UrlFetchApp.fetch(PARKS_API + path, { muteHttpExceptions: true, headers: { Accept: 'application/json' } });
  const code = res.getResponseCode();
  if (code !== 200) throw new Error('themeparks http ' + code);
  return JSON.parse(res.getContentText());
}

/** Flat list of {id, name, dest} parks from the destinations list, cached (24 h asked, 6 h is the cache's limit). */
function loadParkList_(cache) {
  const hit = cacheReadBig_(cache, 'hl-parks-dest-v3');
  if (hit) return hit;
  const j = parksGet_('/destinations');
  const out = [];
  ((j && j.destinations) || []).forEach(function (d) {
    ((d && d.parks) || []).forEach(function (p) {
      if (p && p.id && p.name) out.push({ id: String(p.id), name: String(p.name), dest: String((d && d.name) || '') });
    });
  });
  if (out.length) cacheWriteBig_(cache, 'hl-parks-dest-v3', out, DEST_CACHE_SECONDS);
  return out;
}

/** Compact schedule: {timezone, schedule:[{date,type,open,close}]}, cached 6 h. */
function loadSchedule_(cache, parkId) {
  const key = 'hl-parks-sched-' + parkId;
  const hit = cacheReadBig_(cache, key);
  if (hit) return hit;
  const j = parksGet_('/entity/' + encodeURIComponent(parkId) + '/schedule');
  const out = {
    timezone: j && j.timezone ? String(j.timezone) : null,
    schedule: ((j && j.schedule) || []).filter(function (s) { return s && s.date; }).map(function (s) {
      return { date: String(s.date), type: String(s.type || ''), open: s.openingTime || null, close: s.closingTime || null };
    })
  };
  cacheWriteBig_(cache, key, out, SCHEDULE_CACHE_SECONDS);
  return out;
}

/** Compact live data: [{name, type, status, wait, times:[startTime]}], cached 5 min. */
function loadLive_(cache, parkId) {
  const key = 'hl-parks-live-' + parkId;
  const hit = cacheReadBig_(cache, key);
  if (hit) return hit;
  const j = parksGet_('/entity/' + encodeURIComponent(parkId) + '/live');
  const out = ((j && j.liveData) || []).filter(function (e) { return e && e.name; }).map(function (e) {
    const stand = e.queue && e.queue.STANDBY;
    return {
      name: String(e.name).slice(0, 80),
      type: String(e.entityType || ''),
      status: String(e.status || ''),
      wait: stand && typeof stand.waitTime === 'number' && isFinite(stand.waitTime) ? stand.waitTime : null,
      times: (e.showtimes || []).map(function (t) { return t && t.startTime; }).filter(Boolean).map(String)
    };
  });
  cacheWriteBig_(cache, key, out, LIVE_CACHE_SECONDS);
  return out;
}

/** hours and early entry for a date from a compact schedule. Pure. Either may be null. */
function parkHours_(schedule, date) {
  const rows = (schedule || []).filter(function (s) { return s.date === date; });
  const t = function (s) { return Date.parse(s); };
  const valid = function (r) { return r.open && r.close && isFinite(t(r.open)) && isFinite(t(r.close)); };
  const ops = rows.filter(function (r) { return r.type === 'OPERATING' && valid(r); });
  let hours = null;
  if (ops.length) {
    const open = ops.reduce(function (a, b) { return t(b.open) < t(a.open) ? b : a; });
    const close = ops.reduce(function (a, b) { return t(b.close) > t(a.close) ? b : a; });
    hours = { open: open.open, close: close.close };
  }
  let early = null;
  if (hours) {
    const ex = rows.filter(function (r) { return r.type === 'EXTRA_HOURS' && valid(r) && t(r.open) < t(hours.open); });
    if (ex.length) {
      const first = ex.reduce(function (a, b) { return t(b.open) < t(a.open) ? b : a; });
      early = { open: first.open, close: first.close };
    }
  }
  return { hours: hours, early: early };
}

/** Local yyyy-MM-dd of an ISO time in a time zone (falls back to the script zone). */
function localDateIn_(iso, zone, fallbackTz) {
  const ms = Date.parse(iso);
  if (!isFinite(ms)) return null;
  try { return Utilities.formatDate(new Date(ms), zone || fallbackTz, 'yyyy-MM-dd'); } catch (err) {
    return Utilities.formatDate(new Date(ms), fallbackTz, 'yyyy-MM-dd');
  }
}

/** SHOW entities with showtimes on `date` (park-local), sorted, max MAX_SHOWS. Pure. */
function parkShows_(live, date, zone, fallbackTz) {
  const out = [];
  (live || []).forEach(function (e) {
    if (e.type !== 'SHOW') return;
    const times = (e.times || []).filter(function (t) { return localDateIn_(t, zone, fallbackTz) === date; })
      .sort(function (a, b) { return Date.parse(a) - Date.parse(b); });
    if (times.length) out.push({ name: e.name, times: times });
  });
  out.sort(function (a, b) { return Date.parse(a.times[0]) - Date.parse(b.times[0]); });
  return out.slice(0, MAX_SHOWS);
}

/** Top standby waits among operating attractions. Pure. */
function parkWaits_(live) {
  return (live || []).filter(function (e) {
    return e.type === 'ATTRACTION' && e.status === 'OPERATING' && typeof e.wait === 'number';
  }).sort(function (a, b) { return b.wait - a.wait; }).slice(0, MAX_WAITS).map(function (e) {
    return { name: e.name, minutes: e.wait };
  });
}

function parksFeature_(events, nowMs, tz) {
  if (!ENABLE_PARKS) return { ok: false, error: 'disabled' };
  const today = todayIn_(nowMs, tz);
  const windowDates = [];
  for (let i = 0; i < PARK_WINDOW_DAYS; i++) windowDates.push(dayShift_(today, i));
  // Cheap pre-check so a quiet calendar costs no network calls at all.
  const candidates = (events || []).filter(function (ev) { return eventDatesInWindow_(ev, windowDates).length; });
  if (!candidates.length) return { ok: true, source: 'themeparks.wiki', days: [] };

  const cache = cacheOf_();
  let list;
  try { list = loadParkList_(cache); } catch (err) { return { ok: false, error: shortError_(err) }; }
  const pairs = parkDaysFromEvents_(candidates, list, windowDates);

  // Each park's schedule and live data are fetched at most once per request (and cached).
  const schedules = {};
  const lives = {};
  const scheduleFor = function (id) {
    if (!(id in schedules)) { try { schedules[id] = loadSchedule_(cache, id); } catch (err) { schedules[id] = null; } }
    return schedules[id];
  };
  const liveFor = function (id) {
    if (!(id in lives)) { try { lives[id] = loadLive_(cache, id); } catch (err) { lives[id] = null; } }
    return lives[id];
  };
  const zoneOf = function (id) { const sc = scheduleFor(id); return sc && sc.timezone; };

  const days = [];
  let failures = 0;
  const used = {};
  pairs.forEach(function (pair) {
    const park = pair.alts && pair.alts.length > 1
      ? pickNamesake_(pair.alts, zoneOf, tz, Date.parse(pair.date + 'T12:00:00Z'))
      : pair.park;
    const id = park.id;
    if (used[id + '|' + pair.date]) return;
    used[id + '|' + pair.date] = true;
    const sched = scheduleFor(id);
    const live = liveFor(id);
    if (!sched && !live) { failures++; return; }
    const zone = (sched && sched.timezone) || tz;
    const hrs = sched ? parkHours_(sched.schedule, pair.date) : { hours: null, early: null };
    days.push({
      date: pair.date,
      parkId: id,
      name: park.name,
      timezone: zone,
      hours: hrs.hours,
      early: hrs.early,
      shows: live ? parkShows_(live, pair.date, zone, tz) : [],
      waits: live && pair.date === today ? parkWaits_(live) : []
    });
  });
  if (!days.length && failures) return { ok: false, error: 'themeparks unavailable' };
  return { ok: true, source: 'themeparks.wiki', days: days };
}

// ---------------------------------------------------------------- trip drive

function tripDriveFeature_(tripParam, tripDate, from, nowMs, tz) {
  if (!ENABLE_TRIP_DRIVE) return { ok: false, error: 'disabled' };
  const trip = parseFromParam_(tripParam);
  const date = String(tripDate || '');
  if (!trip || !/^\d{4}-\d{2}-\d{2}$/.test(date) || dayShift_(date, 0) !== date) return { ok: false, error: 'bad_params' };
  if (!from) return { ok: false, error: 'no_origin' }; // the app must send from= with trip=
  tripDate = date;
  const cache = cacheOf_();
  const key = ('td|' + from.lat.toFixed(3) + ',' + from.lng.toFixed(3) + '|' + trip.lat.toFixed(3) + ',' + trip.lng.toFixed(3) + '|' + tripDate).slice(0, 240);
  const hit = cacheRead_(cache, key);
  if (hit) return hit;

  const wanted = Utilities.parseDate(tripDate + ' ' + ('0' + TRIP_DEPART_HOUR).slice(-2) + ':00', tz, 'yyyy-MM-dd HH:mm');
  // Directions refuses departures in the past, so a past 8am becomes "a minute from now".
  const depart = new Date(Math.max(wanted.getTime(), nowMs + 60000));
  let res;
  try {
    res = Maps.newDirectionFinder()
      .setOrigin(from.lat, from.lng)
      .setDestination(trip.lat, trip.lng)
      .setMode(Maps.DirectionFinder.Mode.DRIVING)
      .setDepart(depart)
      .getDirections();
  } catch (err) { return { ok: false, error: shortError_(err) }; }
  const route = res && res.routes && res.routes[0];
  const leg = route && route.legs && route.legs[0];
  const dur = leg && (leg.duration_in_traffic || leg.duration);
  if (!leg || !dur || !(dur.value >= 0) || !leg.distance) return { ok: false, error: 'no_route' };
  const miles = Math.round((leg.distance.value / 1609.344) * 10) / 10;
  const result = miles < TRIP_MIN_MILES
    ? { ok: false, error: 'too_close' }
    : {
      ok: true,
      minutes: Math.round(dur.value / 60),
      miles: miles,
      summary: String((route && route.summary) || '').slice(0, 80),
      departAt: Utilities.formatDate(depart, tz, "yyyy-MM-dd'T'HH:mm:ssXXX")
    };
  cacheWrite_(cache, key, result, TRIP_CACHE_SECONDS);
  return result;
}

// ---------------------------------------------------------------- birthdays (People API)

function peopleGet_(url) {
  const res = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code === 403 && /has not been used|is disabled|SERVICE_DISABLED|accessNotConfigured/i.test(res.getContentText())) {
    throw new Error('people api is off for this script (see setup notes)');
  }
  if (code === 401 || code === 403) throw new Error('contacts access not approved (redeploy and approve)');
  if (code !== 200) throw new Error('people http ' + code);
  return JSON.parse(res.getContentText());
}

/** One compact {name, month, day, year|null} per contact that has a usable birthday. Pure. */
function compactContacts_(connections) {
  const out = [];
  (connections || []).forEach(function (p) {
    const names = (p && p.names) || [];
    const name = String((names[0] && (names[0].displayName || names[0].givenName)) || '').trim().slice(0, 60);
    if (!name) return;
    const bdays = ((p && p.birthdays) || []).map(function (b) { return b && b.date; })
      .filter(function (d) { return d && d.month >= 1 && d.month <= 12 && d.day >= 1 && d.day <= 31; });
    if (!bdays.length) return;
    const d = bdays.filter(function (x) { return x.year; })[0] || bdays[0];
    out.push({ name: name, month: d.month, day: d.day, year: d.year > 1800 ? d.year : null });
  });
  return out;
}

/** Birthdays within `windowDays` of today (inclusive), soonest first. Pure. */
function upcomingBirthdays_(contacts, today, windowDays) {
  const tp = today.split('-').map(Number);
  const todayUtc = Date.UTC(tp[0], tp[1] - 1, tp[2]);
  const out = [];
  (contacts || []).forEach(function (c) {
    let occ = Date.UTC(tp[0], c.month - 1, c.day);
    if (occ < todayUtc) occ = Date.UTC(tp[0] + 1, c.month - 1, c.day);
    const daysAway = Math.round((occ - todayUtc) / 86400000);
    if (daysAway > windowDays) return;
    const od = new Date(occ);
    const year = od.getUTCFullYear();
    out.push({
      name: c.name,
      date: year + '-' + ('0' + (od.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + od.getUTCDate()).slice(-2),
      daysAway: daysAway,
      turning: c.year && year >= c.year ? year - c.year : null
    });
  });
  out.sort(function (a, b) { return a.daysAway - b.daysAway || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0); });
  return out;
}

function loadContacts_(cache) {
  const hit = cacheReadBig_(cache, 'hl-bdays-v3');
  if (hit) return hit;
  const all = [];
  let token = '';
  for (let page = 0; page < BIRTHDAY_PAGES; page++) {
    const j = peopleGet_(PEOPLE_API + '?personFields=names,birthdays&pageSize=1000' + (token ? '&pageToken=' + encodeURIComponent(token) : ''));
    compactContacts_(j && j.connections).forEach(function (c) { all.push(c); });
    token = j && j.nextPageToken;
    if (!token) break;
  }
  cacheWriteBig_(cache, 'hl-bdays-v3', all, BIRTHDAY_CACHE_SECONDS);
  return all;
}

function birthdaysFeature_(nowMs, tz) {
  if (!ENABLE_BIRTHDAYS) return { ok: false, error: 'disabled' };
  let contacts;
  try { contacts = loadContacts_(cacheOf_()); } catch (err) { return { ok: false, error: shortError_(err) }; }
  return { ok: true, upcoming: upcomingBirthdays_(contacts, todayIn_(nowMs, tz), BIRTHDAY_DAYS) };
}
