/**
 * Home Life calendar bridge
 *
 * What it does: a tiny Google Apps Script web app that returns the titles,
 * times and locations of your upcoming calendar events as JSON, so the Home
 * Life app can show "your day" and detect trips. It never returns event
 * descriptions or guest lists. Declined events are skipped.
 *
 * The SECRET below is a private key. Requests without the right key get
 * {"ok":false,"error":"unauthorized"}, which keeps strangers out. Anyone who has
 * both the web app URL and the key could read event titles, times and
 * locations for the next two weeks, so keep both private.
 *
 * Setup:
 *  1. Open https://script.google.com and create a new project.
 *  2. Delete the sample code and paste this script (in the app: settings ->
 *     calendar -> "copy script", which already contains your private key).
 *  3. Click Deploy -> New deployment, choose type "Web app".
 *  4. Set "Execute as: Me" and "Who has access: Anyone", then Deploy.
 *  5. Approve the Google permission prompt (it only reads your calendars).
 *  6. Copy the Web app URL (ends in /exec), paste it into settings -> calendar
 *     in the app, then tap "test connection".
 */

const SECRET = '__PASTE_SECRET_HERE__';
const DEFAULT_DAYS = 14;
const MAX_DAYS = 21;
const MAX_TITLE = 120;
const MAX_LOCATION = 200;

function doGet(e) {
  const params = (e && e.parameter) || {};
  if (!params.key || params.key !== SECRET) {
    return respond_({ ok: false, error: 'unauthorized' });
  }

  let days = parseInt(params.days, 10);
  if (!(days > 0)) days = DEFAULT_DAYS;
  days = Math.min(days, MAX_DAYS);

  const tz = Session.getScriptTimeZone();
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + days + 1);

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
  events.forEach(function (ev) { delete ev.sortKey; });

  return respond_({
    ok: true,
    timeZone: tz,
    generated: new Date().toISOString(),
    events: events
  });
}

function respond_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
