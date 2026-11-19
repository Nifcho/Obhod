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
 *   „Шофьори“  – имената, които приложението предлага (може да се редактира), и до всяко име:
 *                „ПИН“ – кодът за влизане (празно = 0000), „Език“ – English = приложението е на английски,
 *                „Маршрути“ – кои маршрути вижда, разделени със запетая (празно = всички).
 *   „Търговски обекти“ – обектите с координати, адрес, телефон и бележка
 *   „Наряд …“  – по един лист на ден (напр. „Наряд Понеделник“): обектите в реда на обхода
 *   „Промени в наряда“ – какво е добавено/махнато от търговския наряд за конкретна дата (от приложението)
 *                Наряда може да променя само човек с ПИН от лист „Настройки“ (редове „ПИН Ники“, „ПИН Тошко“ …,
 *                колона B – кодът). Нов човек = нов ред „ПИН Име“; изтрит ред = край на достъпа.
 *   „Преводи“  – английските преводи на бележките и етикетите (за шофьорите на английски); правят се сами
 *                с Google Translate, а грешен превод се поправя в колона „English“.
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
var SHEET_CHANGES = 'Промени в наряда';
var SHEET_TR = 'Преводи';
var CHANGES_HEAD = ['Дата', 'Обект', 'Промяна', 'Шофьор', 'Час', 'Ширина', 'Дължина', 'Код'];
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
    // превод на английски за бележки и етикети (лист „Преводи“, иначе Google Translate)
    var trList = p.tr;
    if (typeof trList === 'string') { try { trList = JSON.parse(trList); } catch (err) { trList = null; } }
    if (trList && trList.length) out.tr = translate_(ss, trList);
    // влизане на шофьор: име + ПИН от листа „Шофьори“
    var drv = readDriverRows_(ss);
    if (p.login) out.login = loginDriver_(drv, p.name, p.pin);
    // ПИН за промяна на търговския наряд (проверка от приложението)
    if (p.checkPin) { var who = pinOwner_(ss, p.pin); out.pin = { ok: !!who, who: who }; }
    // търговски наряд: добавени/махнати обекти за деня (само с ПИН) и бройките кофи по обект (всички)
    var nar = p.nar;
    if (typeof nar === 'string') { try { nar = JSON.parse(nar); } catch (err) { nar = null; } }
    if (nar && nar.length) {
      var lock3 = LockService.getScriptLock();
      lock3.waitLock(20000);
      try {
        var done = [], rejected = [], editor = pinOwner_(ss, p.pin);
        for (var q = 0; q < nar.length; q++) {
          var o = nar[q];
          if (!o || !o.id) continue;
          if (o.a !== 'bins') {   // добавяне, махане и ред на наряда – само с ПИН
            if (!editor) { rejected.push(o.id); continue; }
            o.by = editor;
          }
          applyNar_(ss, o); done.push(o.id);
        }
        out.narApplied = done;
        out.narRejected = rejected;
        out.narCaps = ['order', 'tpl'];
      } finally {
        lock3.releaseLock();
      }
      out.nariad = readNariad_(ss);
    }
    out.broken = readBroken_(ss);
    out.visits = readState_(ss);
    out.drivers = drv.map(function (d) { return d.name; });
    out.driverInfo = driverInfo_(drv);
    if (!out.nariad && (p.action === 'nariad' || p.nariad)) out.nariad = readNariad_(ss);
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
  if (!ss.getSheetByName(SHEET_CHANGES)) {
    var c = ss.insertSheet(SHEET_CHANGES);
    c.appendRow(CHANGES_HEAD);
    c.setFrozenRows(1);
    c.getRange(1, 1, 1, CHANGES_HEAD.length).setFontWeight('bold');
    c.getRange('A2:A').setNumberFormat('@');
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

// „Шофьори“: колона A – името; колоните „ПИН“, „Език“ и „Маршрути“ се намират по заглавието си.
function readDriverRows_(ss) {
  var sh = ss.getSheetByName(SHEET_DRIVERS);
  if (!sh || sh.getLastRow() < 2) return [];
  var lc = Math.max(1, Math.min(sh.getLastColumn(), 10));
  var v = sh.getRange(1, 1, sh.getLastRow(), lc).getDisplayValues();
  var head = v[0].map(norm_);
  var col = function (re) { for (var i = 1; i < head.length; i++) if (re.test(head[i])) return i; return -1; };
  var cp = col(/пин|pin/), cl = col(/език|lang/), cr = col(/маршрут|route/);
  var cell = function (r, c) { return c >= 0 ? String(v[r][c] || '').trim() : ''; };
  var out = [];
  for (var r = 1; r < v.length; r++) {
    var name = String(v[r][0] || '').trim();
    if (name) out.push({ name: name, pin: cell(r, cp), lang: cell(r, cl), routes: cell(r, cr) });
  }
  return out;
}
function readDrivers_(ss) { return readDriverRows_(ss).map(function (d) { return d.name; }); }
var driverLang_ = function (s) { return /^(en|english|англ)/i.test(String(s || '').trim()) ? 'en' : 'bg'; };
// без ПИН кодовете – те остават само в таблицата
function driverInfo_(rows) {
  var o = {};
  rows.forEach(function (d) { o[d.name] = { lang: driverLang_(d.lang), routes: d.routes }; });
  return o;
}
// празен ПИН = 0000; водещите нули не се броят (ако клетката е станала число)
function loginDriver_(rows, name, pin) {
  var digits = function (s) { s = String(s == null ? '' : s).trim(); return /^\d+$/.test(s) ? s.replace(/^0+(?=\d)/, '') : s; };
  var nm = norm_(name);
  for (var i = 0; i < rows.length; i++) {
    if (norm_(rows[i].name) !== nm) continue;
    if (digits(pin) !== digits(rows[i].pin || '0000')) return { ok: false };
    return { ok: true, name: rows[i].name, lang: driverLang_(rows[i].lang), routes: rows[i].routes };
  }
  return { ok: false, unknown: true };
}

// Листовете с наряди и обектите – връщат се както се виждат в таблицата;
// приложението само намира колоните по заглавията им.
function readNariad_(ss) {
  var tabs = [];
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var sh = sheets[i];
    var name = sh.getName();
    if (name !== SHEET_OBJECTS && name !== SHEET_CHANGES && name.indexOf(NARIAD_PREFIX) !== 0) continue;
    var lr = sh.getLastRow(), lc = Math.min(sh.getLastColumn(), 12);
    var values = (lr > 0 && lc > 0) ? sh.getRange(1, 1, lr, lc).getDisplayValues() : [];
    if (name === SHEET_CHANGES && values.length > 801) values = [values[0]].concat(values.slice(values.length - 800));
    tabs.push({ name: name, values: values });
  }
  return { tabs: tabs, at: Date.now() };
}

// ---------- търговски наряд: промени за деня и кофи ----------
var norm_ = function (s) {
  return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[„“"'`´’]/g, '').replace(/[\s\-–—_.,()\/]+/g, ' ').trim();
};

// ПИН кодовете от „Настройки“: ред „ПИН Име“, колона B – кодът. Връща името или ''.
function pinOwner_(ss, pin) {
  pin = String(pin == null ? '' : pin).trim();
  if (!pin) return '';
  var sh = ss.getSheetByName(SHEET_SETTINGS);
  if (!sh || sh.getLastRow() < 1) return '';
  var rows = sh.getRange(1, 1, sh.getLastRow(), 2).getDisplayValues();
  for (var i = 0; i < rows.length; i++) {
    var m = /^\s*пин\s+(.+?)\s*$/i.exec(String(rows[i][0] || ''));
    if (m && String(rows[i][1] || '').trim() === pin) return m[1];
  }
  return '';
}

// Колоните в „Търговски обекти“ по заглавие; липсващите („Сини“, „Жълти“, „По заявка“) се добавят вдясно.
function objectCols_(sh) {
  var lc = Math.max(sh.getLastColumn(), 1);
  var head = sh.getRange(1, 1, 1, lc).getDisplayValues()[0];
  var col = {};
  for (var i = 0; i < head.length; i++) {
    var h = String(head[i] || '').toLowerCase();
    if (/друг/.test(h)) col.alias = col.alias || i + 1;
    else if (/обект/.test(h)) col.name = col.name || i + 1;
    else if (/координат/.test(h)) col.ll = col.ll || i + 1;
    else if (/син/.test(h)) col.b = col.b || i + 1;
    else if (/жълт/.test(h)) col.y = col.y || i + 1;
    else if (/заявк/.test(h)) col.req = col.req || i + 1;
  }
  var add = function (key, title) {
    if (col[key]) return;
    lc = Math.max(sh.getLastColumn(), lc) + 1;
    sh.getRange(1, lc).setValue(title).setFontWeight('bold');
    col[key] = lc;
  };
  add('b', 'Сини'); add('y', 'Жълти'); add('req', 'По заявка');
  return col;
}

// Редът на обекта по име или по „Други имена“ (0 = няма такъв)
function findObject_(sh, col, name) {
  var n = sh.getLastRow() - 1;
  if (n < 1) return 0;
  var key = norm_(name);
  var names = sh.getRange(2, col.name, n, 1).getDisplayValues();
  for (var i = 0; i < n; i++) if (norm_(names[i][0]) === key) return i + 2;
  if (col.alias) {
    var al = sh.getRange(2, col.alias, n, 1).getDisplayValues();
    for (var j = 0; j < n; j++) {
      var parts = String(al[j][0] || '').split(/[;\n]+/);
      for (var k = 0; k < parts.length; k++) if (norm_(parts[k]) === key) return j + 2;
    }
  }
  return 0;
}

// Нов обект (по заявка) – добавя се в „Търговски обекти“ с 1 синя и 1 жълта кофа.
function ensureObject_(ss, name, lat, lon) {
  var sh = ss.getSheetByName(SHEET_OBJECTS);
  if (!sh) return 0;
  var col = objectCols_(sh);
  var r = findObject_(sh, col, name);
  if (r) return r;
  var row = sh.getLastRow() + 1;
  sh.getRange(row, col.name).setValue(name);
  if (col.ll && lat != null && lon != null) sh.getRange(row, col.ll).setValue(lat.toFixed(6) + ', ' + lon.toFixed(6));
  sh.getRange(row, col.b).setValue(1);
  sh.getRange(row, col.y).setValue(1);
  sh.getRange(row, col.req).setValue('да');
  return row;
}

function changeLogged_(sh, id) {
  var n = sh.getLastRow() - 1;
  if (n <= 0) return false;
  var ids = sh.getRange(2, 8, n, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return true;
  return false;
}

// Ред на каране за датата: „Обект 1 › Обект 2 › …“; празен списък = обратно по наряда за деня.
function applyOrder_(ss, op, by, at) {
  var sh = ss.getSheetByName(SHEET_CHANGES);
  if (changeLogged_(sh, op.id)) return;
  var names = (op.names || []).map(function (x) { return String(x || '').replace(/›/g, '>').trim().slice(0, 120); })
    .filter(function (x) { return x; }).slice(0, 300);
  sh.appendRow([String(op.date || ''), names.length ? names.join(' › ') : '—', names.length ? 'Подреден' : 'Ред по шаблона', by, at, '', '', String(op.id)]);
}

// „За всеки <ден>“: преномерира „№“ в листа „Наряд <ден>“ по новия ред и подрежда редовете по него.
// Редовете без № (по заявка) остават без номер, след номерираните.
function applyTpl_(ss, op, by, at) {
  var day = String(op.day || '').trim();
  var sh = null;
  ss.getSheets().forEach(function (s) {
    var nm = s.getName();
    if (!sh && /^наряд/i.test(nm) && norm_(nm.replace(/^наряд[\s:–\-]*/i, '')) === norm_(day)) sh = s;
  });
  if (!sh) return;
  var last = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (last < 2 || lastCol < 1) return;
  var vals = sh.getRange(1, 1, last, lastCol).getValues();
  var hi = -1;
  for (var i = 0; i < Math.min(vals.length, 6); i++) {
    if (vals[i].some(function (v) { return /обект/i.test(String(v)); })) { hi = i; break; }
  }
  if (hi < 0) return;
  var cNum = -1, cName = -1;
  vals[hi].forEach(function (h, j) {
    h = String(h || '').toLowerCase().trim();
    if (cName < 0 && /обект/.test(h) && !/друг/.test(h)) cName = j;
    if (cNum < 0 && (h === '№' || h === 'ред' || /номер/.test(h))) cNum = j;
  });
  if (cNum < 0 || cName < 0) return;
  var pos = {};
  (op.names || []).forEach(function (n, k) { var key = norm_(n); if (key && pos[key] == null) pos[key] = k; });
  var rows = [];
  for (var r = hi + 1; r < vals.length; r++) {
    var name = String(vals[r][cName] || '').trim(), num = String(vals[r][cNum] == null ? '' : vals[r][cNum]).trim();
    if (name && num !== '') rows.push({ r: r, key: norm_(name), num: parseFloat(num), i: rows.length });
  }
  if (!rows.length) return;
  rows.sort(function (a, b) {
    var pa = pos[a.key], pb = pos[b.key];
    if (pa != null && pb != null) return pa - pb;
    if (pa != null) return -1;
    if (pb != null) return 1;
    return (isFinite(a.num) && isFinite(b.num) ? a.num - b.num : 0) || a.i - b.i;
  });
  var col = [];
  for (var q = hi + 1; q < vals.length; q++) col.push([vals[q][cNum]]);
  rows.forEach(function (x, k) { col[x.r - hi - 1] = [k + 1]; });
  sh.getRange(hi + 2, cNum + 1, col.length, 1).setValues(col);
  sh.getRange(hi + 2, 1, col.length, lastCol).sort({ column: cNum + 1, ascending: true });
  ss.getSheetByName(SHEET_LOG).appendRow([at, 'Нов ред на наряда за всеки ден', 'Търговски – ' + day, '', '', by, '']);
}

function applyNar_(ss, op) {
  var by = String(op.by || '').slice(0, 60);
  var at = new Date(Number(op.at) || Date.now());
  if (op.a === 'order') return applyOrder_(ss, op, by, at);
  if (op.a === 'tpl') return applyTpl_(ss, op, by, at);
  var name = String(op.name || '').trim().slice(0, 120);
  if (!name) return;
  if (op.a === 'add' || op.a === 'del') {
    var sh = ss.getSheetByName(SHEET_CHANGES);
    if (changeLogged_(sh, op.id)) return; // вече е записано
    var lat = Number(op.lat), lon = Number(op.lon);
    var hasLL = isFinite(lat) && isFinite(lon) && lat > 38 && lat < 48 && lon > 18 && lon < 32;
    sh.appendRow([String(op.date || ''), name, op.a === 'add' ? 'Добавен' : 'Махнат', by, at, hasLL ? lat : '', hasLL ? lon : '', String(op.id)]);
    if (op.a === 'add' && op.isNew) ensureObject_(ss, name, hasLL ? lat : null, hasLL ? lon : null);
    return;
  }
  if (op.a === 'bins') {
    var osh = ss.getSheetByName(SHEET_OBJECTS);
    if (!osh) return;
    var b = Math.max(0, Math.min(30, Math.round(Number(op.b) || 0)));
    var y = Math.max(0, Math.min(30, Math.round(Number(op.y) || 0)));
    var col = objectCols_(osh);
    var r = findObject_(osh, col, name) || ensureObject_(ss, name, null, null);
    if (!r) return;
    osh.getRange(r, col.b).setValue(b);
    osh.getRange(r, col.y).setValue(y);
    ss.getSheetByName(SHEET_LOG).appendRow([at, 'Кофи: ' + b + ' сини, ' + y + ' жълти', 'Търговски', '', name, by, '']);
  }
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

// Преводите се пазят в лист „Преводи“ (Български | English) – ако някой е грешен, поправете го там.
function translate_(ss, list) {
  var out = {};
  var sh = ss.getSheetByName(SHEET_TR);
  if (!sh) {
    sh = ss.insertSheet(SHEET_TR);
    sh.getRange(1, 1, 1, 2).setValues([['Български', 'English']]).setFontWeight('bold');
    sh.setFrozenRows(1); sh.setColumnWidth(1, 420); sh.setColumnWidth(2, 420);
  }
  var known = {}, lr = sh.getLastRow();
  if (lr > 1) sh.getRange(2, 1, lr - 1, 2).getValues().forEach(function (r) {
    var k = String(r[0] || '').trim(); if (k && String(r[1] || '').trim()) known[k] = String(r[1]).trim();
  });
  var add = [];
  for (var i = 0; i < list.length && i < 40; i++) {
    var s = String(list[i] == null ? '' : list[i]).trim().slice(0, 500);
    if (!s || out[s]) continue;
    if (known[s]) { out[s] = known[s]; continue; }
    try {
      var t = LanguageApp.translate(s, 'bg', 'en');
      if (t) { out[s] = t; known[s] = t; add.push([s, t]); }
    } catch (err) {}
  }
  if (add.length) {
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try { sh.getRange(sh.getLastRow() + 1, 1, add.length, 2).setValues(add); } finally { lock.releaseLock(); }
  }
  return out;
}

// Проба на превода: изберете „probaPrevod“ горе и натиснете ▶ „Изпълни“ (при първия път разрешете достъпа).
function probaPrevod() {
  Logger.log(LanguageApp.translate('Звъни се преди обслужване.', 'bg', 'en'));
}
