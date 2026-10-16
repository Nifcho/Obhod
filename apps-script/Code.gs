/**
 * Обход на точките – връзка между приложението и тази таблица.
 *
 * Пускане (еднократно):
 *   Внедряване → Ново внедряване → Тип: Уеб приложение
 *   Изпълни като: Аз   ·   Кой има достъп: Всеки
 * Копирайте адреса, който завършва на /exec, и го дайте на Claude.
 *
 * Листове:
 *   „Отметки“  – текущо минатите точки (по един ред на точка)
 *   „История“  – всяко действие: минах, върнах, нов курс
 *   „Шофьори“  – имената, които приложението предлага (може да се редактира)
 *   „Търговски обекти“ – обектите с координати, адрес, телефон и бележка
 *   „Наряд …“  – по един лист на ден (напр. „Наряд Понеделник“): обектите в реда на обхода
 *   „Счупени“  – сигнали за счупени кофи от шофьорите; за всеки идва имейл (адресът е в лист „Настройки“).
 *                Когато кофата е оправена, напишете „Оправено“ в колона „Статус“ – маха се от приложението.
 *
 * Първи път след добавянето на сигналите: изберете функцията „probaIzvestie“ горе и натиснете ▶ „Изпълни“,
 * разрешете достъпа (изпращане на имейл) – ще дойде пробен имейл. После внедрете нова версия.
 *
 * След промяна на този код: Внедряване → Управление на внедряванията → молив →
 * Версия: Нова версия → Внедряване. Адресът /exec остава същият.
 */

var SHEET_STATE = 'Отметки';
var SHEET_LOG = 'История';
var SHEET_DRIVERS = 'Шофьори';
var SHEET_OBJECTS = 'Търговски обекти';
var NARIAD_PREFIX = 'Наряд';
var SHEET_BROKEN = 'Счупени';
var SHEET_SETTINGS = 'Настройки';
// Кой получава известията за счупени кофи: адресът от листа „Настройки“ (ред „Известия…“, колона B,
// може няколко, разделени със запетая). Ако там е празно – този адрес, а ако и той е празен – собственикът.
var NOTIFY_TO = 'nikolay.dimitrov@alara.bg';
var BROKEN_HEAD = ['Дата и час', 'Маршрут', 'Точка', 'Улица', 'Кофа', 'Бележка', 'Шофьор', 'Карта', 'Статус', 'Известие', 'Код на точката', 'Код на сигнала'];

function doGet(e) {
  return respond_(handle_(e && e.parameter ? e.parameter : {}));
}

function doPost(e) {
  var p = {};
  try { p = JSON.parse(e.postData.contents); } catch (err) { p = {}; }
  return respond_(handle_(p));
}

function respond_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function handle_(p) {
  var out = { ok: true };
  try {
    var ss = SpreadsheetApp.getActive();
    ensureSheets_(ss);
    var ops = p.ops;
    if (typeof ops === 'string') { try { ops = JSON.parse(ops); } catch (err) { ops = null; } }
    if (ops && ops.length) {
      var lock = LockService.getScriptLock();
      lock.waitLock(20000);
      try {
        var applied = [];
        for (var i = 0; i < ops.length; i++) {
          applyOp_(ss, ops[i]);
          if (ops[i] && ops[i].id) applied.push(ops[i].id);
        }
        out.applied = applied;
      } finally {
        lock.releaseLock();
      }
    }
    var reports = p.reports;
    if (typeof reports === 'string') { try { reports = JSON.parse(reports); } catch (err) { reports = null; } }
    if (reports && reports.length) {
      var lock2 = LockService.getScriptLock();
      lock2.waitLock(20000);
      try {
        var got = [];
        for (var r = 0; r < reports.length; r++) {
          if (reports[r] && reports[r].id) { applyReport_(ss, reports[r]); got.push(reports[r].id); }
        }
        out.reportsApplied = got;
      } finally {
        lock2.releaseLock();
      }
    }
    out.broken = readBroken_(ss);
    out.visits = readState_(ss);
    out.drivers = readDrivers_(ss);
    if (p.action === 'nariad' || p.nariad) out.nariad = readNariad_(ss);
    out.now = Date.now();
  } catch (err) {
    out.ok = false;
    out.error = String(err);
  }
  return out;
}

function ensureSheets_(ss) {
  if (!ss.getSheetByName(SHEET_STATE)) {
    ss.insertSheet(SHEET_STATE).appendRow(['Код на точката', 'Маршрут', 'Точка', 'Улица', 'Минато на', 'Шофьор']);
  }
  if (!ss.getSheetByName(SHEET_LOG)) {
    ss.insertSheet(SHEET_LOG).appendRow(['Дата и час', 'Действие', 'Маршрут', 'Точка', 'Улица', 'Шофьор', 'Код на точката']);
  }
  if (!ss.getSheetByName(SHEET_DRIVERS)) {
    ss.insertSheet(SHEET_DRIVERS).appendRow(['Име']);
  }
  if (!ss.getSheetByName(SHEET_SETTINGS)) {
    var st = ss.insertSheet(SHEET_SETTINGS);
    st.getRange(1, 1, 1, 2).setValues([['Известия за счупени кофи до', '']]);
    st.getRange(1, 1).setFontWeight('bold');
  }
  if (!ss.getSheetByName(SHEET_BROKEN)) {
    var b = ss.insertSheet(SHEET_BROKEN);
    b.appendRow(BROKEN_HEAD);
    b.setFrozenRows(1);
    b.getRange(1, 1, 1, BROKEN_HEAD.length).setFontWeight('bold');
  }
}

function stateRows_(sh) {
  var n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, 6).getValues();
}

function findRow_(rows, pid) {
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === pid) return i;
  }
  return -1;
}

function toMs_(v) {
  if (v instanceof Date) return v.getTime();
  var n = Number(v);
  return isNaN(n) ? 0 : n;
}

function applyOp_(ss, op) {
  if (!op || !op.a) return;
  var sh = ss.getSheetByName(SHEET_STATE);
  var log = ss.getSheetByName(SHEET_LOG);
  var at = Number(op.at) || Date.now();
  var by = String(op.by || '').slice(0, 60);

  if (op.a === 'mark') {
    var pid = String(op.pid || '');
    if (!pid) return;
    var rows = stateRows_(sh);
    var i = findRow_(rows, pid);
    var row = [pid, op.route || '', String(op.n || ''), op.st || '', new Date(at), by];
    if (i >= 0) {
      if (toMs_(rows[i][4]) >= at) return; // по-нова отметка вече има
      sh.getRange(i + 2, 1, 1, 6).setValues([row]);
    } else {
      sh.appendRow(row);
    }
    log.appendRow([new Date(at), 'Минах', op.route || '', String(op.n || ''), op.st || '', by, pid]);
    return;
  }

  if (op.a === 'unmark') {
    var pid2 = String(op.pid || '');
    var rows2 = stateRows_(sh);
    var j = findRow_(rows2, pid2);
    if (j >= 0 && toMs_(rows2[j][4]) <= at) {
      sh.deleteRow(j + 2);
      log.appendRow([new Date(at), 'Върнах', op.route || '', String(op.n || ''), op.st || '', by, pid2]);
    }
    return;
  }

  if (op.a === 'reset') {
    var pids = op.pids || [];
    var set = {};
    for (var k = 0; k < pids.length; k++) set[String(pids[k])] = true;
    var rows3 = stateRows_(sh);
    var removed = 0;
    for (var r = rows3.length - 1; r >= 0; r--) {
      if (set[String(rows3[r][0])] && toMs_(rows3[r][4]) <= at) {
        sh.deleteRow(r + 2);
        removed++;
      }
    }
    log.appendRow([new Date(at), 'Нов курс (изчистени ' + removed + ')', op.route || '', '', '', by, '']);
  }
}

function readState_(ss) {
  var rows = stateRows_(ss.getSheetByName(SHEET_STATE));
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    out.push({ pid: String(rows[i][0]), at: toMs_(rows[i][4]), by: String(rows[i][5] || '') });
  }
  return out;
}

function readDrivers_(ss) {
  var sh = ss.getSheetByName(SHEET_DRIVERS);
  var n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, 1).getValues()
    .map(function (r) { return String(r[0] || '').trim(); })
    .filter(function (s) { return s; });
}

// Листовете с наряди и обектите – връщат се както се виждат в таблицата;
// приложението само намира колоните по заглавията им.
function readNariad_(ss) {
  var tabs = [];
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var sh = sheets[i];
    var name = sh.getName();
    if (name !== SHEET_OBJECTS && name.indexOf(NARIAD_PREFIX) !== 0) continue;
    var lr = sh.getLastRow(), lc = Math.min(sh.getLastColumn(), 12);
    var values = (lr > 0 && lc > 0) ? sh.getRange(1, 1, lr, lc).getDisplayValues() : [];
    tabs.push({ name: name, values: values });
  }
  return { tabs: tabs, at: Date.now() };
}

// ---------- сигнали за счупени кофи ----------
function applyReport_(ss, rp) {
  var sh = ss.getSheetByName(SHEET_BROKEN);
  var id = String(rp.id);
  var n = sh.getLastRow() - 1;
  if (n > 0) {
    var ids = sh.getRange(2, 12, n, 1).getValues();
    for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === id) return; // вече е записан (повторно изпращане)
  }
  var at = new Date(Number(rp.at) || Date.now());
  var by = String(rp.by || '').slice(0, 60);
  var map = (rp.lat && rp.lon) ? 'https://www.google.com/maps?q=' + rp.lat + ',' + rp.lon : '';
  var row = [at, rp.route || '', String(rp.n || ''), rp.st || '', rp.kind || '', String(rp.note || '').slice(0, 500), by, map, 'Ново', '', String(rp.pid || ''), id];
  sh.appendRow(row);
  var last = sh.getLastRow();
  var status;
  try { notifyBroken_(ss, rp, at, by, map); status = 'Изпратено ' + Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'dd.MM HH:mm'); }
  catch (err) { status = 'Грешка: ' + String(err).slice(0, 200); }
  sh.getRange(last, 10).setValue(status);
}

function notifyTo_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_SETTINGS);
  if (sh && sh.getLastRow() > 0) {
    var rows = sh.getRange(1, 1, sh.getLastRow(), 2).getDisplayValues();
    for (var i = 0; i < rows.length; i++) {
      if (/известия/i.test(rows[i][0])) {
        var to = String(rows[i][1] || '').replace(/[;\s]+/g, ',').replace(/^,+|,+$/g, '');
        if (to) return to;
      }
    }
  }
  return NOTIFY_TO || Session.getEffectiveUser().getEmail();
}

function notifyBroken_(ss, rp, at, by, map) {
  var tz = ss.getSpreadsheetTimeZone();
  var where = (rp.route || '') + ', т. ' + (rp.n || '') + (rp.st ? ' – ' + rp.st : '');
  var subject = 'Счупена кофа: ' + where;
  var lines = [
    'Счупена кофа: ' + (rp.kind || 'не е посочено коя'),
    'Място: ' + where,
    'Подаде: ' + (by || '—') + ', ' + Utilities.formatDate(at, tz, 'dd.MM.yyyy HH:mm')
  ];
  if (rp.note) lines.push('Бележка: ' + rp.note);
  if (map) lines.push('Карта: ' + map);
  lines.push('', 'Всички сигнали: ' + ss.getUrl() + '#gid=' + ss.getSheetByName(SHEET_BROKEN).getSheetId());
  lines.push('Когато е оправено, напишете „Оправено“ в колона „Статус“.');
  MailApp.sendEmail({ to: notifyTo_(), subject: subject, body: lines.join('\n'), name: 'Обход на точките' });
}

function readBroken_(ss) {
  var sh = ss.getSheetByName(SHEET_BROKEN);
  var n = sh.getLastRow() - 1;
  if (n < 1) return [];
  var rows = sh.getRange(2, 1, n, 12).getValues();
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var st = String(rows[i][8] || '').toLowerCase();
    if (st.indexOf('оправ') === 0 || st.indexOf('готов') === 0 || st.indexOf('сменен') === 0) continue;
    if (!rows[i][10]) continue;
    out.push({ pid: String(rows[i][10]), at: toMs_(rows[i][0]), kind: String(rows[i][4] || ''), note: String(rows[i][5] || ''), by: String(rows[i][6] || '') });
  }
  return out;
}

// Пусни веднъж от редактора (▶ Изпълни), за да разрешиш изпращането на имейли и да видиш пробно известие.
function probaIzvestie() {
  var ss = SpreadsheetApp.getActive();
  ensureSheets_(ss);
  MailApp.sendEmail({ to: notifyTo_(), subject: 'Проба: известия за счупени кофи', body: 'Известията от „Обход на точките“ работят. Ще идват на този адрес: ' + notifyTo_(), name: 'Обход на точките' });
}
