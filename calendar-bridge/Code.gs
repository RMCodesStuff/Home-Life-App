/**
 * Home Life bridge (v2)
 *
 * What it does: a small Google Apps Script web app, running as you inside
 * Google, that gives the Home Life app four read-only things as JSON:
 *   1. Your upcoming calendar events (titles, times, locations; never
 *      descriptions or guest lists; declined events are skipped).
 *   2. "Waiting on you": up to 5 inbox threads that need a reply or an action
 *      (sender, subject, a short snippet) plus package statuses, from Gmail.
 *   3. Leave-by times: drive minutes and a "leave by" time for today's events
 *      that have an address (Google Maps service).
 *   4. "Last night": sleep and readiness from your Oura ring (optional).
 * Each feature is optional and fails on its own, so one problem never takes
 * down the others.
 *
 * The SECRET below is a private key. Requests without the right key get
 * {"ok":false,"error":"unauthorized"}, which keeps strangers out. Anyone who has
 * both the web app URL and the key could read what this script returns (event
 * titles, email senders and subjects, drive times, Oura scores), so keep both
 * private. Nothing is stored outside your Google account and your browser.
 *
 * Setup:
 *  1. Open https://script.google.com and create a new project.
 *  2. Delete the sample code and paste this script (in the app: settings ->
 *     Google -> "copy script", which already contains your private key).
 *  3. Project Settings (gear icon) -> tick "Show appsscript.json manifest
 *     file in editor". Open appsscript.json and replace its contents with the
 *     manifest (in the app: "copy manifest"). It limits Google's permission
 *     prompt to read-only calendar and gmail access.
 *  4. Deploy -> New deployment -> type "Web app" -> Execute as: Me,
 *     Who has access: Anyone -> Deploy.
 *  5. Approve the permission prompt (read-only calendar and gmail).
 *  6. Copy the Web app URL (ends in /exec), paste it into settings -> Google
 *     in the app, then tap "test connection".
 *
 * Updating an existing deployment (the URL stays the same): paste the new
 * script and manifest, then Deploy -> Manage deployments -> edit (pencil) ->
 * Version: New version -> Deploy.
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

const BRIDGE_VERSION = 2;
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const OURA_API = 'https://api.ouraring.com';
const OURA_AUTH = 'https://cloud.ouraring.com/oauth/authorize';

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
  events.forEach(function (ev) { delete ev.sortKey; delete ev.startMs; });

  return respond_({
    ok: true,
    version: BRIDGE_VERSION,
    timeZone: tz,
    generated: now.toISOString(),
    features: { gmail: ENABLE_GMAIL, leaveBy: ENABLE_LEAVE_BY, oura: ouraConfigured_() },
    events: events,
    inbox: inboxFeature_(nowMs, tz),
    oura: ouraFeature_(nowMs, tz)
  });
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
  try { cache.put(key, JSON.stringify(value === undefined ? null : value), seconds); } catch (err) { /* too big or unavailable */ }
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
