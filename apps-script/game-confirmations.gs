/**
 * Sandoval automatic game confirmations.
 * Every hour it checks the schedule. At or after the "Send at" hour each day, every game in the next 7 days that
 * hasn't been confirmed yet gets its own email to the opposing school's AD (from the Schools list), BCC ad@sandoval501.org.
 * If a confirmed game's date or time changes later, that school gets an UPDATED email. Everything it does is written to
 * the confSent collection, which the scheduler shows under Game confirmations.
 *
 * Setup (one time), signed in as ad@sandoval501.org so the emails come from that address:
 *  1. script.google.com -> New project. Name it "Sandoval game confirmations".
 *  2. Replace Code.gs with this file. Project Settings -> "Show appsscript.json", replace it with game-confirmations.appsscript.json.
 *  3. ad@sandoval501.org needs access to the sandoval-schedule Firebase project (Firebase console -> Project settings ->
 *     Users and permissions -> add ad@sandoval501.org as Editor), unless it already owns the project.
 *  4. In the editor, pick the function "setup" and click Run. Approve the permissions. This creates the hourly timer.
 *  5. Optional check: pick "preview" and click Run, then open Execution log to see what it would send right now (sends nothing).
 * Turn it on or off any time in the scheduler: Game confirmations -> Email setup.
 */
var PROJECT = 'sandoval-schedule';
var TZ = 'America/Chicago';
var BASE = 'https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents';
var AD = 'ad@sandoval501.org';
var DAYS_OUT = 7;
var SKIP = /tournament|tourney|shootout|multi-day|classic|invitational|thanksgiving|holiday|meet the|program|regional|sectional/i;
var DEF_SUBJ = 'Game confirmation: Sandoval and {school}, {date}';
var DEF_BODY = "Hello,\n\nI'm confirming the following game between Sandoval and {school}:\n\n{game}\n\nPlease let us know if anything doesn't match your schedule.\n\nThank you,\nSandoval Athletics\nad@sandoval501.org";
var DN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
var DL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
var ML = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'run') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('run').timeBased().everyHours(1).create();
  Logger.log('Hourly timer created. Turn sending on in the scheduler: Game confirmations -> Email setup.');
}
function run() { work_(false); }
function preview() { work_(true); }

function work_(dry) {
  var cfg = getDoc_('mailcfg/settings') || {};
  if (!dry && !cfg.autoOn) return;
  var now = new Date();
  var hour = +Utilities.formatDate(now, TZ, 'H');
  if (!dry && hour < (cfg.autoHour == null ? 8 : +cfg.autoHour)) return;
  var today = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
  var end = addDays_(today, DAYS_OUT);
  var from = cfg.autoFrom && cfg.autoFrom > today ? cfg.autoFrom : addDays_(today, 1);
  if (from > end) { if (dry) Logger.log('Nothing to do: automatic confirmations start with games on ' + cfg.autoFrom + '.'); return; }
  var games = rangeQuery_('games', 'date', from, end);
  var schools = list_('schools');
  var sent = {};
  var got = batchGet_(games.map(function (g) { return 'confSent/' + g.id; }));
  Object.keys(got).forEach(function (k) { sent[k] = got[k]; });
  var subjT = cfg.autoSubj || DEF_SUBJ, bodyT = cfg.autoBody || DEF_BODY;
  var n = 0;
  games.sort(function (a, b) { return a.data.date < b.data.date ? -1 : a.data.date > b.data.date ? 1 : 0; }).forEach(function (row) {
    var g = row.data, id = row.id, prev = sent[id];
    if (SKIP.test(g.opp || '') || SKIP.test(g.team || '')) return;
    if (g.cancelled) {
      if (prev && prev.status === 'sent') save_(dry, id, { status: 'cancelled', date: g.date, time: g.time || '', team: g.team, school: prev.school || '', to: prev.to || '', note: 'Game was cancelled after it was confirmed. No email sent about the cancellation.', at: Date.now(), sentAt: prev.sentAt || 0 });
      return;
    }
    var same = prev && prev.date === g.date && (prev.time || '') === (g.time || '');
    if (prev && prev.status === 'sent' && same) return;
    var sc = findSchool_(schools, g.opp);
    if (!sc || !sc.email) {
      if (!(prev && prev.status === 'skipped' && same)) save_(dry, id, { status: 'skipped', date: g.date, time: g.time || '', team: g.team, school: sc ? sc.name : '', to: '', note: sc ? 'No AD email for ' + sc.name + ' on the Schools list.' : 'No school on the Schools list matches "' + (g.opp || '') + '".', at: Date.now() });
      return;
    }
    var updated = !!(prev && prev.status === 'sent' && !same);
    var v = { school: sc.name, date: longDate_(g.date), game: gameLine_(g) };
    var subject = (updated ? 'UPDATED: ' : '') + fill_(subjT, v);
    var body = (updated ? 'This replaces our earlier confirmation for this game. It was ' + longDate_(prev.date) + ' at ' + (prev.time || 'TBA') + '.\n\n' : '') + fill_(bodyT, v);
    if (dry) { Logger.log('Would send to ' + sc.email + ': ' + subject); n++; return; }
    MailApp.sendEmail(sc.email, subject, body, { bcc: AD, replyTo: AD, name: 'Sandoval Athletics' });
    save_(false, id, { status: 'sent', updated: updated, date: g.date, time: g.time || '', team: g.team, school: sc.name, to: sc.email, subject: subject, note: '', at: Date.now(), sentAt: Date.now() });
    n++;
  });
  if (dry) Logger.log(n ? n + ' email(s) would go out now.' : 'Nothing would go out right now.');
}

function addDays_(s, n) { var d = Utilities.parseDate(s + ' 12:00', TZ, 'yyyy-MM-dd HH:mm'); return Utilities.formatDate(new Date(d.getTime() + n * 864e5), TZ, 'yyyy-MM-dd'); }
function dt_(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2], 12); }
function longDate_(s) { var d = dt_(s); return DL[d.getDay()] + ', ' + ML[d.getMonth()] + ' ' + d.getDate(); }
function fmtDate_(s) { var d = dt_(s); return DN[d.getDay()] + ' ' + (d.getMonth() + 1) + '/' + d.getDate() + '/' + String(d.getFullYear()).slice(2); }
function gameLine_(g) { return fmtDate_(g.date) + ' · ' + (g.time || 'TBA') + ' · ' + g.team + ' · ' + (g.ha === 'A' ? 'Away (at ' + g.opp + ')' : 'Home (at Sandoval)'); }
function fill_(t, v) { return String(t).replace(/\{(\w+)\}/g, function (m, k) { return v[k] != null ? v[k] : m; }); }
function nk_(t) { return String(t || '').toLowerCase().replace(/\s*\(.*?\)\s*/g, ' ').replace(/[^a-z0-9/&]+/g, ' ').trim(); }
function findSchool_(schools, opp) {
  var k = nk_(opp); if (!k) return null;
  for (var i = 0; i < schools.length; i++) { var sc = schools[i].data; if ([sc.name].concat(sc.aliases || []).some(function (n) { return nk_(n) === k; })) return sc; }
  return null;
}

// ---- Firestore REST helpers (uses ad@sandoval501.org's access to the Firebase project) ----
function call_(method, url, body) {
  var res = UrlFetchApp.fetch(url, { method: method, contentType: 'application/json', payload: body ? JSON.stringify(body) : undefined,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  if (res.getResponseCode() === 404) return null;
  if (res.getResponseCode() >= 300) throw new Error('Firestore ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
  return JSON.parse(res.getContentText());
}
function getDoc_(path) { var d = call_('get', BASE + '/' + path); return d ? fields_(d.fields) : null; }
function list_(col) {
  var out = [], token = '';
  do { var r = call_('get', BASE + '/' + col + '?pageSize=300' + (token ? '&pageToken=' + encodeURIComponent(token) : '')) || {};
    (r.documents || []).forEach(function (d) { out.push({ id: d.name.split('/').pop(), data: fields_(d.fields) }); }); token = r.nextPageToken || ''; } while (token);
  return out;
}
function rangeQuery_(col, field, from, to) {
  var f = function (op, v) { return { fieldFilter: { field: { fieldPath: field }, op: op, value: { stringValue: v } } }; };
  var r = call_('post', BASE + ':runQuery', { structuredQuery: { from: [{ collectionId: col }],
    where: { compositeFilter: { op: 'AND', filters: [f('GREATER_THAN_OR_EQUAL', from), f('LESS_THAN_OR_EQUAL', to)] } } } }) || [];
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
function save_(dry, id, data) {
  if (dry) { Logger.log('Would log ' + id + ': ' + data.status + (data.note ? ' (' + data.note + ')' : '')); return; }
  var f = {}; Object.keys(data).forEach(function (k) { f[k] = enc_(data[k]); });
  call_('patch', BASE + '/confSent/' + id, { fields: f });
}
function enc_(v) { if (typeof v === 'boolean') return { booleanValue: v }; if (typeof v === 'number') return { integerValue: String(Math.round(v)) }; return { stringValue: String(v == null ? '' : v) }; }
function fields_(f) { var o = {}; Object.keys(f || {}).forEach(function (k) { o[k] = val_(f[k]); }); return o; }
function val_(v) {
  if ('stringValue' in v) return v.stringValue; if ('integerValue' in v) return +v.integerValue; if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue; if ('nullValue' in v) return null; if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(val_); if ('mapValue' in v) return fields_(v.mapValue.fields); return null;
}
