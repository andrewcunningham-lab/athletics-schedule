/**
 * Sandoval officials calendar feed.
 * Each official gets one private link: <this web app URL>?cal=<their token>
 * It returns an iCalendar (.ics) feed of every Sandoval home game he is on, read live from the scheduler's database,
 * so changes to a game's time, or removing him from a crew, show up on his phone calendar automatically.
 *
 * Setup (one time):
 *  1. script.google.com -> New project. Name it "Sandoval officials calendar".
 *  2. Replace Code.gs with this file. Project Settings -> check "Show appsscript.json", and replace it with appsscript.json from the repo.
 *  3. Deploy -> New deployment -> type Web app. Execute as: Me. Who has access: Anyone. Deploy and approve the permissions.
 *     (Use the Google account that owns the sandoval-schedule Firebase project.)
 *  4. Copy the Web app URL (ends in /exec) into the scheduler: Officials texting -> Settings -> Calendar feed link.
 */
var PROJECT = 'sandoval-schedule';
var TZ = 'America/Chicago';
var BASE = 'https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents';

function doGet(e) {
  var t = String((e && e.parameter && e.parameter.cal) || '').trim();
  if (!t) return ContentService.createTextOutput('Sandoval officials calendar feed is running.');
  var ref = findOfficial_(t);
  var cfg = getDoc_('txcfg/settings') || {};
  var school = cfg.school || 'Sandoval', ad = cfg.adName || '';
  var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Sandoval Athletics//Officials//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:' + esc_(school + ' officiating'), 'X-WR-TIMEZONE:' + TZ, 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'];
  if (ref) {
    var hours = +((getDoc_('meta/practiceCfg') || {}).gameHours) || 2;
    var since = Utilities.formatDate(new Date(Date.now() - 60 * 864e5), TZ, 'yyyy-MM-dd');
    var assigns = query_('refAssign', 'date', 'GREATER_THAN_OR_EQUAL', since);
    var mine = assigns.filter(function (a) { return (a.data.slots || []).some(function (x) { return onSlot_(x, ref); }); });
    var games = batchGet_(mine.map(function (a) { return 'games/' + a.id; }));
    var stamp = Utilities.formatDate(new Date(), 'UTC', "yyyyMMdd'T'HHmmss'Z'");
    mine.forEach(function (a) {
      var g = games[a.id]; if (!g || g.cancelled) return;
      var partners = (a.data.slots || []).filter(function (x) { return x && x.name && !onSlot_(x, ref); }).map(function (x) { return x.name; });
      lines.push('BEGIN:VEVENT', 'UID:' + a.id + '-' + ref.id + '@sandoval-officials', 'DTSTAMP:' + stamp);
      var m = String(g.time || '').match(/(\d{1,2}):(\d{2})\s*([AP])M/i);
      if (m) {
        var h = (+m[1]) % 12 + (m[3].toUpperCase() === 'P' ? 12 : 0);
        var start = Utilities.parseDate(g.date + ' ' + h + ':' + m[2], TZ, 'yyyy-MM-dd H:mm');
        var end = new Date(start.getTime() + hours * 3600e3);
        lines.push('DTSTART:' + utc_(start), 'DTEND:' + utc_(end));
      } else {
        var d = g.date.replace(/-/g, ''); var next = Utilities.formatDate(new Date(Utilities.parseDate(g.date, TZ, 'yyyy-MM-dd').getTime() + 864e5), TZ, 'yyyyMMdd');
        lines.push('DTSTART;VALUE=DATE:' + d, 'DTEND;VALUE=DATE:' + next);
      }
      lines.push('SUMMARY:' + esc_('Officiating: ' + g.team + ' at ' + school),
        'LOCATION:' + esc_(school + (g.facility ? ' - ' + g.facility : '')),
        'DESCRIPTION:' + esc_('School: ' + school + '\nLevel: ' + g.team + '\nTime: ' + (g.time || 'TBA') + '\nPartners: ' + (partners.join(', ') || 'none yet') + (ad ? '\nContact: ' + ad + ', AD at ' + school : '')),
        'STATUS:CONFIRMED', 'END:VEVENT');
    });
  }
  lines.push('END:VCALENDAR');
  return ContentService.createTextOutput(lines.map(fold_).join('\r\n') + '\r\n').setMimeType(ContentService.MimeType.ICAL);
}

function onSlot_(x, ref) { return !!(x && x.name && ((x.refId && x.refId === ref.id) || String(x.name).trim().toLowerCase() === String(ref.name).trim().toLowerCase())); }
function utc_(d) { return Utilities.formatDate(d, 'UTC', "yyyyMMdd'T'HHmmss'Z'"); }
function esc_(s) { return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
function fold_(line) { var out = '', s = line; while (s.length > 74) { out += s.slice(0, 74) + '\r\n '; s = s.slice(74); } return out + s; }

function findOfficial_(token) {
  var hits = query_('refs', 'calToken', 'EQUAL', token);
  return hits.length ? { id: hits[0].id, name: hits[0].data.name } : null;
}

// ---- Firestore REST helpers (uses the deploying account's access to the Firebase project) ----
function call_(method, url, body) {
  var res = UrlFetchApp.fetch(url, { method: method, contentType: 'application/json', payload: body ? JSON.stringify(body) : undefined,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  if (res.getResponseCode() === 404) return null;
  if (res.getResponseCode() >= 300) throw new Error('Firestore ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
  return JSON.parse(res.getContentText());
}
function getDoc_(path) { var d = call_('get', BASE + '/' + path); return d ? fields_(d.fields) : null; }
function query_(col, field, op, value) {
  var r = call_('post', BASE + ':runQuery', { structuredQuery: { from: [{ collectionId: col }],
    where: { fieldFilter: { field: { fieldPath: field }, op: op, value: { stringValue: value } } } } }) || [];
  return r.filter(function (x) { return x.document; }).map(function (x) { return { id: x.document.name.split('/').pop(), data: fields_(x.document.fields) }; });
}
function batchGet_(paths) {
  var out = {}; if (!paths.length) return out;
  var prefix = 'projects/' + PROJECT + '/databases/(default)/documents/';
  for (var i = 0; i < paths.length; i += 100) {
    var r = call_('post', BASE + ':batchGet', { documents: paths.slice(i, i + 100).map(function (p) { return prefix + p; }) }) || [];
    r.forEach(function (x) { if (x.found) out[x.found.name.split('/').pop()] = fields_(x.found.fields); });
  }
  return out;
}
function fields_(f) { var o = {}; Object.keys(f || {}).forEach(function (k) { o[k] = val_(f[k]); }); return o; }
function val_(v) {
  if ('stringValue' in v) return v.stringValue; if ('integerValue' in v) return +v.integerValue; if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue; if ('nullValue' in v) return null; if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(val_); if ('mapValue' in v) return fields_(v.mapValue.fields); return null;
}
