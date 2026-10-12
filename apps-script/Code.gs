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
 */

var SHEET_STATE = 'Отметки';
var SHEET_LOG = 'История';
var SHEET_DRIVERS = 'Шофьори';

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
    out.visits = readState_(ss);
    out.drivers = readDrivers_(ss);
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
