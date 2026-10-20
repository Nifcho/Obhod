(function () {
  'use strict';

  // ---------- setup ----------
  const CFG = window.OBHOD_CONFIG || {};
  const API = String(CFG.apiUrl || '').trim();
  const ROUTES = window.ROUTES || [];
  const $ = s => document.querySelector(s);
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  const ICON = {
    nav: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11l18-8-8 18-2-8-8-2z"/></svg>',
    tel: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z"/></svg>',
    off: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/></svg>',
    on: '<svg viewBox="0 0 24 24" aria-hidden="true" style="stroke-width:2.6"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    warn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l9.5 17h-19z"/><path d="M12 10v4.5M12 17.5v.5"/></svg>',
    loc: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="8"/></svg>',
    navmode: '<svg viewBox="0 0 24 24" aria-hidden="true" style="fill:currentColor;stroke-width:1.5"><path d="M12 2.5l7 18-7-4-7 4z"/></svg>',
    lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></svg>',
    edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    cross: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    xfer: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h14M13 6l6 6-6 6"/></svg>',
    undo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/></svg>',
    grip: '<svg viewBox="0 0 24 24" aria-hidden="true" style="stroke-width:3.4"><path d="M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01"/></svg>'
  };

  const byKey = {}, ptById = {};
  for (const r of ROUTES) {
    byKey[r.key] = r;
    r.ordered = [];
    r.groups.forEach(g => r.pts.filter(p => p.grp === g).forEach(p => r.ordered.push(p)));
    for (const p of r.pts) {
      p.route = r.key; p.routeName = r.name; p.kind = r.kind || ''; p.ll = p.lat != null && p.lon != null;
      p.shape = (p.grp === 'Изгрев' || p.grp === 'Изток 44–47') ? 'sq' : (p.grp === 'Лозенец 91–95' ? 'dm' : 'ci');
      ptById[p.id] = p;
    }
  }

  const S = {
    route: byKey[LS.get('obhod.route', '')] ? LS.get('obhod.route', '') : (ROUTES[0] && ROUTES[0].key),
    filter: LS.get('obhod.filter', 'left'),
    sort: LS.get('obhod.sort', 'num'),
    name: LS.get('obhod.name', ''),
    server: new Map(Object.entries(LS.get('obhod.server', {}))),
    queue: LS.get('obhod.queue', []),
    reports: LS.get('obhod.reports', []), reportsOld: false,
    narq: LS.get('obhod.narq', []), narOld: false, pin: LS.get('obhod.pin', null),
    broken: new Map(Object.entries(LS.get('obhod.broken', {}))),
    drivers: LS.get('obhod.drivers', CFG.drivers || []),
    navApp: LS.get('obhod.nav', ''), routeSeq: [], pendingNav: null,
    sel: null, lastSync: 0, syncErr: false, pos: null, geoErr: null, follow: false, buzzed: {}
  };
  let V = new Map();
  const cur = () => byKey[S.route];

  // Търговските отметки важат за една смяна: от SHIFT_H часа до SHIFT_H часа на следващия ден.
  const SHIFT_H = CFG.turgShiftHour != null && !isNaN(Number(CFG.turgShiftHour)) ? Number(CFG.turgShiftHour) : 10;
  function shiftStart(t) { const d = new Date(t); d.setHours(SHIFT_H, 0, 0, 0); if (d.getTime() > t) d.setDate(d.getDate() - 1); return d.getTime(); }
  const isTg = id => String(id).startsWith('tg-');

  // ---------- visits (server + pending) ----------
  function applyOp(m, op) {
    if (op.a === 'mark') { const c = m.get(op.pid); if (!c || c.at < op.at) m.set(op.pid, { at: op.at, by: op.by }); }
    else if (op.a === 'unmark') { const c = m.get(op.pid); if (c && c.at <= op.at) m.delete(op.pid); }
    else if (op.a === 'reset') { for (const pid of op.pids || []) { const c = m.get(pid); if (c && c.at <= op.at) m.delete(pid); } }
  }
  function computeVisits() {
    const m = new Map(S.server); for (const op of S.queue) applyOp(m, op);
    const s0 = shiftStart(Date.now());
    for (const [k, v] of m) if (isTg(k) && v.at < s0) m.delete(k);
    V = m;
  }
  // счупени кофи: подадени (от таблицата) + чакащи изпращане от този телефон
  function brokenOf(id) {
    const pend = S.reports.filter(r => r.pid === id);
    if (pend.length) { const r = pend[pend.length - 1]; return { kind: r.kind, note: r.note, by: r.by, at: r.at, pending: true }; }
    return S.broken.get(id) || null;
  }
  function saveServer() { const o = {}; S.server.forEach((v, k) => { o[k] = v; }); LS.set('obhod.server', o); }
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  function enqueue(op) {
    op.id = uid();
    if (!API) { applyOp(S.server, op); saveServer(); }
    else { S.queue.push(op); LS.set('obhod.queue', S.queue); scheduleSync(50); }
    refresh();
  }

  // ---------- sync with the sheet ----------
  let syncing = false, syncTimer = 0;
  async function fetchJSON(url, opt) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20000);
    try { const r = await fetch(url, Object.assign({ redirect: 'follow', signal: ctl.signal, cache: 'no-store' }, opt || {})); return await r.json(); }
    finally { clearTimeout(t); }
  }
  async function sync() {
    if (!API || syncing) return;
    syncing = true;
    let res = null;
    try {
      if (S.queue.length || S.reports.length || S.narq.length) {
        const ops = S.queue.slice(0, 40), reports = S.reports.slice(0, 10), nar = S.narq.slice(0, 40);
        const body = { ops };
        if (reports.length) body.reports = reports;
        if (nar.length) { body.nar = nar; body.nariad = 1; if (S.pin && S.pin.pin) body.pin = S.pin.pin; }
        res = await fetchJSON(API, { method: 'POST', body: JSON.stringify(body) });
        if (res && res.ok) {
          if (nar.length) {
            // старият скрипт не познава промените в наряда – пазим ги, докато таблицата ги потвърди
            if (Array.isArray(res.narApplied)) {
              // по-стар скрипт приема реда, но не го записва – тези промени остават да чакат
              const caps = new Set(res.narCaps || []), unsup = o => (o.a === 'order' || o.a === 'tpl') && !caps.has(o.a);
              const got = new Set(res.narApplied.concat(res.narRejected || []).filter(id => !nar.some(o => o.id === id && unsup(o))));
              if (res.narRejected && res.narRejected.length) {
                setPin(null);
                toast('ПИН кодът не е валиден – промените в наряда не са записани.');
              }
              S.narq = S.narq.filter(o => !got.has(o.id)); LS.set('obhod.narq', S.narq); S.narOld = nar.some(unsup);
              if (TURG && NAR) applyTurg();
            } else S.narOld = true;
          }
          if (res.nariad && res.nariad.tabs) { LS.set('obhod.nariad', res.nariad); narErr = false; setNariad(res.nariad); }
          const done = new Set(res.applied && res.applied.length ? res.applied : ops.map(o => o.id));
          S.queue = S.queue.filter(o => !done.has(o.id));
          LS.set('obhod.queue', S.queue);
          if (reports.length) {
            // старият скрипт не познава сигналите – пазим ги, докато таблицата ги потвърди
            if (Array.isArray(res.reportsApplied)) {
              const got = new Set(res.reportsApplied);
              S.reports = S.reports.filter(r => !got.has(r.id)); LS.set('obhod.reports', S.reports); S.reportsOld = false;
            } else S.reportsOld = true;
          }
        }
      } else {
        res = await fetchJSON(API + (API.indexOf('?') >= 0 ? '&' : '?') + 'action=state&t=' + Date.now());
      }
      if (res && res.ok) {
        S.server = new Map((res.visits || []).filter(v => ptById[v.pid] || isTg(v.pid)).map(v => [v.pid, { at: Number(v.at), by: v.by || '' }]));
        saveServer();
        if (res.drivers && res.drivers.length) { S.drivers = res.drivers; LS.set('obhod.drivers', S.drivers); }
        if (Array.isArray(res.broken)) {
          S.broken = new Map(res.broken.map(b => [b.pid, b]));
          const o = {}; S.broken.forEach((v, k) => { o[k] = v; }); LS.set('obhod.broken', o);
        }
        S.lastSync = Date.now(); S.syncErr = false;
      } else { S.syncErr = true; }
    } catch (e) { S.syncErr = true; }
    syncing = false;
    refresh();
    scheduleSync(S.queue.length ? (S.syncErr ? 8000 : 1500) : ((S.reports.length && !S.reportsOld) || (S.narq.length && !S.narOld)) && !S.syncErr ? 3000 : (Number(CFG.pollSec) || 10) * 1000);
  }
  function scheduleSync(ms) {
    if (!API) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      if (document.visibilityState === 'visible' || S.queue.length || S.reports.length || S.narq.length) sync(); else scheduleSync(20000);
    }, ms);
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scheduleSync(100); });
  window.addEventListener('online', () => scheduleSync(100));

  // ---------- helpers ----------
  function distM(a, b) {
    const R = 6371000, toR = Math.PI / 180;
    const dLat = (b.lat - a.lat) * toR, dLon = (b.lon - a.lon) * toR;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }
  function fmtDist(d) {
    if (d == null) return '';
    if (d < 1000) return (d < 100 ? Math.round(d / 5) * 5 : Math.round(d / 10) * 10) + ' м';
    return (d / 1000).toFixed(d < 10000 ? 1 : 0).replace('.', ',') + ' км';
  }
  function fmtWhen(t) {
    const d = new Date(t), n = new Date();
    const hm = d.toLocaleTimeString('bg-BG', { hour: '2-digit', minute: '2-digit' });
    return d.toDateString() === n.toDateString() ? hm : d.toLocaleDateString('bg-BG', { day: '2-digit', month: '2-digit' }) + ' ' + hm;
  }
  const plural = (n, one, many) => (n === 1 ? one : many);
  function fmtPhone(s) {
    let d = String(s).replace(/[^0-9+]/g, '');
    if (d.startsWith('+359')) d = '0' + d.slice(4);
    if (/^08\d{8}$/.test(d)) return d.replace(/^(\d{4})(\d{3})(\d{3})$/, '$1 $2 $3');
    if (/^02\d{7}$/.test(d)) return d.replace(/^(\d{2})(\d{3})(\d{4})$/, '$1 $2 $3');
    return d;
  }
  function contTxt(p) {
    if (p.kind === 'turg') {
      const a = [];
      if (p.b) a.push(p.b + ' ' + plural(p.b, 'синя', 'сини'));
      if (p.y) a.push(p.y + ' ' + plural(p.y, 'жълта', 'жълти'));
      return a.length ? a.join(' + ') : 'без кофи';
    }
    if (p.y == null && p.g == null) return 'бройката не се вижда';
    const a = [];
    if (p.y) a.push(p.y + ' ' + plural(p.y, 'жълт', 'жълти'));
    if (p.g) a.push(p.g + ' ' + plural(p.g, 'зелен', 'зелени'));
    return a.join(' + ');
  }
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function dotsEl(p) {
    if (p.kind === 'turg') {
      if (!p.b && !p.y) return null;
      const s = el('span', 'dots'); s.title = contTxt(p); s.setAttribute('aria-label', contTxt(p));
      for (let i = 0; i < Math.min(p.b || 0, 8); i++) s.append(el('i', 'dot b'));
      for (let i = 0; i < Math.min(p.y || 0, 8); i++) s.append(el('i', 'dot y'));
      return s;
    }
    if (p.y == null && p.g == null && p.kind) return null;   // маршрутите без бройки
    const s = el('span', 'dots'); s.title = contTxt(p); s.setAttribute('aria-label', contTxt(p));
    if (p.y == null && p.g == null) { s.textContent = '?'; return s; }
    for (let i = 0; i < (p.y || 0); i++) s.append(el('i', 'dot y'));
    for (let i = 0; i < (p.g || 0); i++) s.append(el('i', 'dot g'));
    return s;
  }
  // ---------- търговски наряди: листовете „Наряд …“ и „Търговски обекти“ в таблицата ----------
  const TURG = byKey.turg || null;
  const TURG_BUILTIN = TURG ? TURG.pts.slice() : [];
  const WEEK = ['неделя', 'понеделник', 'вторник', 'сряда', 'четвъртък', 'петък', 'събота'];
  const SHORT = { 'понеделник': 'Пн', 'вторник': 'Вт', 'сряда': 'Ср', 'четвъртък': 'Чт', 'петък': 'Пт', 'събота': 'Сб', 'неделя': 'Нд' };
  const normName = s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[„“"'`´’]/g, '').replace(/[\s\-–—_.,()\/]+/g, ' ').trim();
  const TRL = { 'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'sht', 'ъ': 'a', 'ь': '', 'ю': 'yu', 'я': 'ya' };
  const slugId = s => 'tg-' + Array.from(String(s).toLowerCase()).map(ch => TRL[ch] != null ? TRL[ch] : ch).join('').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  function parseLL(s) {
    const m = String(s || '').match(/-?\d+[.,]\d+/g);
    if (!m || m.length < 2) return null;
    let a = parseFloat(m[0].replace(',', '.')), b = parseFloat(m[1].replace(',', '.'));
    if (a > 18 && a < 32 && b > 38 && b < 48) { const t = a; a = b; b = t; }
    return (a > 38 && a < 48 && b > 18 && b < 32) ? { lat: a, lon: b } : null;
  }
  function parsePhones(s, def) {
    const out = [];
    for (const part of String(s || '').split(/[;\n]+/)) {
      const m = part.match(/\+?\d[\d\s\-\/().]{5,}\d/);
      if (!m) continue;
      let d = m[0].replace(/[^\d+]/g, '');
      if (d.startsWith('00')) d = '+' + d.slice(2);
      else if (d.startsWith('359')) d = '+' + d;
      else if (d.startsWith('0')) d = '+359' + d.slice(1);
      else if (!d.startsWith('+') && d.length === 9) d = '+359' + d;
      const label = part.replace(m[0], '').replace(/^[\s:,\-–—]+|[\s:,\-–—]+$/g, '') || def;
      out.push([label, d]);
    }
    return out;
  }
  // Колоните се намират по заглавията – редът им няма значение.
  function parseTable(values) {
    values = values || [];
    let hi = -1;
    for (let i = 0; i < Math.min(values.length, 6); i++) if ((values[i] || []).some(v => /обект/i.test(String(v)))) { hi = i; break; }
    if (hi < 0) return [];
    const c = {};
    values[hi].forEach((h, i) => {
      h = String(h || '').toLowerCase().trim();
      const k = /друг/.test(h) ? 'alias' : /обект/.test(h) ? 'name' : /координат/.test(h) ? 'll' : /ширина/.test(h) ? 'lat' : /дължина/.test(h) ? 'lon'
        : /адрес/.test(h) ? 'addr' : /телефон/.test(h) ? 'ph' : /етикет/.test(h) ? 'tag' : /бележк/.test(h) ? 'note'
        : /^син/.test(h) ? 'b' : /^жълт/.test(h) ? 'y' : /заявк/.test(h) ? 'req' : (h === '№' || h === 'ред' || /номер/.test(h)) ? 'num' : '';
      if (k && c[k] == null) c[k] = i;
    });
    if (c.name == null) return [];
    const out = [];
    for (let i = hi + 1; i < values.length; i++) {
      const row = values[i] || [];
      const g = k => c[k] == null || row[c[k]] == null ? '' : String(row[c[k]]).trim();
      const name = g('name'); if (!name) continue;
      let ll = parseLL(g('ll'));
      if (!ll && c.lat != null && c.lon != null) ll = parseLL(g('lat') + '; ' + g('lon'));
      const cnt = k => { const v = g(k); if (v === '') return null; const n = parseInt(v, 10); return isNaN(n) ? null : Math.max(0, n); };
      out.push({ name, ll, addr: g('addr'), ph: g('ph'), tag: g('tag'), note: g('note'), alias: g('alias'),
        num: c.num == null ? null : g('num'), b: cnt('b'), y: cnt('y'), req: /^(да|x|х|✓|✔|true|1|по заявка)$/i.test(g('req')) });
    }
    return out;
  }
  function buildDay(items, cat) {
    const pts = [], seen = {};
    items.forEach((it, i) => {
      const c = cat.get(normName(it.name)) || null;
      let id = slugId(c ? c.name : it.name);
      if (seen[id]) { seen[id]++; id += '-' + seen[id]; } else seen[id] = 1;
      const bins = binsOf(c ? c.name : it.name, c);
      const p = { id, n: String(i + 1), st: it.name, b: bins.b, y: bins.y, g: null, grp: 'Търговски', okey: canonKey(it.name) };
      if (c ? c.req : it.req) p.req = true;
      if (it.added) p.added = it.added;
      const ll = it.ll || (c && c.ll);
      if (ll) { p.lat = ll.lat; p.lon = ll.lon; }
      const addr = it.addr || (c && c.addr); if (addr) p.addr = addr;
      const tags = Array.from(new Set([it.tag, c && c.tag].filter(Boolean))); if (tags.length) p.tag = tags.join(' · ');
      const notes = Array.from(new Set([it.note, c && c.note].filter(Boolean))); if (notes.length) p.note = notes.join(' ');
      const ph = parsePhones(it.ph, it.name).concat(c ? parsePhones(c.ph, c.name) : []); if (ph.length) p.ph = ph;
      pts.push(p);
    });
    return pts;
  }
  // „Промени в наряда“: Дата | Обект | Промяна (Добавен/Махнат/Подреден/Ред по шаблона) | Шофьор | Час | Ширина | Дължина | Код
  // при „Подреден“ в „Обект“ е целият ред на каране за датата: „Обект 1 › Обект 2 › …“
  function parseChanges(values) {
    values = values || []; const out = [];
    const head = (values[0] || []).map(h => String(h || '').toLowerCase());
    const ix = re => head.findIndex(h => re.test(h));
    const c = { date: ix(/дата/), name: ix(/обект/), op: ix(/промян/), by: ix(/шофьор|кой/), at: ix(/час|кога/), lat: ix(/ширина/), lon: ix(/дължина/), id: ix(/код/) };
    if (c.date < 0 || c.name < 0 || c.op < 0) return out;
    for (let i = 1; i < values.length; i++) {
      const r = values[i] || [], g = k => (c[k] < 0 || r[c[k]] == null ? '' : String(r[c[k]]).trim());
      const date = normDate(g('date')), name = g('name'), opTxt = g('op'); if (!date) continue;
      if (/подред|шаблон|^ред(\s|$)|order/i.test(opTxt)) {
        const names = /шаблон/i.test(opTxt) ? [] : name.split(ORD_SEP).map(x => x.trim()).filter(Boolean);
        out.push({ date, op: 'order', names, by: g('by'), at: parseWhen(g('at')) + i / 1000, id: g('id') });
        continue;
      }
      if (!name) continue;
      const op = /махн|del|-/i.test(opTxt) ? 'del' : 'add';
      out.push({ date, name, op, by: g('by'), at: parseWhen(g('at')) + i / 1000, ll: parseLL(g('lat') + '; ' + g('lon')), id: g('id') });
    }
    return out;
  }
  const ORD_SEP = /\s*›\s*/;
  // „2026-10-20“, „20.10.2026“ или „10/20/2026“ → „2026-10-20“
  function normDate(s) {
    let m = String(s || '').match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
    m = String(s || '').match(/(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/);
    if (m) return /\//.test(s) ? m[3] + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0') : m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
    return '';
  }
  function parseWhen(s) {
    const m = String(s || '').match(/(\d{1,2})\.(\d{1,2})\.(\d{4})\D+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (m) return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0)).getTime();
    const t = Date.parse(s); return isNaN(t) ? 0 : t;
  }
  // редовете с № се карат по номера (ако всички номера са числа); без № (по заявка) – след тях
  function byNum(items) {
    const num = items.filter(it => it.num !== ''), cand = items.filter(it => it.num === '');
    if (!num.length || num.some(it => it.num == null || !isFinite(parseFloat(it.num)))) return items;
    return num.map((it, i) => [it, i]).sort((a, b) => parseFloat(a[0].num) - parseFloat(b[0].num) || a[1] - b[1]).map(x => x[0]).concat(cand);
  }
  function parseNariad(raw) {
    let catRows = [], changes = []; const tabs = [];
    for (const t of (raw && raw.tabs) || []) {
      const nm = String(t.name || '').trim();
      if (normName(nm) === 'търговски обекти') catRows = parseTable(t.values);
      else if (normName(nm) === 'промени в наряда') changes = parseChanges(t.values);
      else if (/^наряд/i.test(nm)) tabs.push({ name: nm.replace(/^наряд[\s:–\-]*/i, '').trim() || nm, items: byNum(parseTable(t.values)) });
    }
    const cat = new Map(), catList = [];
    for (const r of catRows) { const k = normName(r.name); if (k && !cat.has(k)) { cat.set(k, r); catList.push(r); } }
    for (const r of catRows) for (const a of (r.alias || '').split(/[;\n]+/)) { const k = normName(a); if (k && !cat.has(k)) cat.set(k, r); }
    const N = { src: 'sheet', at: Number(raw.at) || Date.now(), cat, catList, changes, days: withWeek(tabs.map(t => ({ name: t.name, items: t.items }))) };
    NAR_CAT = cat;
    for (const d of N.days) d.pts = buildDay((d.items || []).filter(it => !isCand(it)), cat);   // шаблонът – за броя по дни
    return N;
  }

  // ---------- наряд за конкретния ден: шаблон ± промените (добавени по заявка, махнати) ----------
  let NAR_CAT = new Map();
  const isCand = it => it.num === '';   // ред без № в листа на деня = по заявка за този ден (не е включен сам)
  const canonKey = name => { const c = NAR_CAT.get(normName(name)); return normName(c ? c.name : name); };
  const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const fmtDay = s => { const m = String(s || '').match(/^\d{4}-(\d{2})-(\d{2})$/); return m ? m[2] + '.' + m[1] : ''; };
  // датата, за която се отнася денят: днешната смяна или следващият такъв ден от седмицата
  function dayDate(name) {
    const s0 = new Date(shiftStart(Date.now())), wd = WEEK.indexOf(normName(name));
    if (wd < 0) return ymd(s0);
    const d = new Date(s0); d.setDate(d.getDate() + ((wd - s0.getDay() + 7) % 7));
    return ymd(d);
  }
  // кофите: последната промяна от този телефон (докато таблицата я потвърди) или от „Търговски обекти“; иначе 1 синя + 1 жълта
  function binsOf(name, c) {
    const k = canonKey(name);
    for (let i = S.narq.length - 1; i >= 0; i--) { const o = S.narq[i]; if (o.a === 'bins' && canonKey(o.name) === k) return { b: o.b, y: o.y }; }
    if (c && (c.b != null || c.y != null)) return { b: c.b || 0, y: c.y || 0 };
    return { b: 1, y: 1 };
  }
  function dayChanges(date) {
    const m = new Map();
    const pend = S.narq.filter(o => (o.a === 'add' || o.a === 'del') && o.date === date)
      .map(o => ({ date: o.date, name: o.name, op: o.a, by: o.by, at: o.at, ll: o.lat != null ? { lat: o.lat, lon: o.lon } : null, pending: true }));
    // по реда в таблицата (последният записан печели), а промените от този телефон – над тях (часовниците на телефоните се различават)
    for (const c of ((NAR && NAR.changes) || []).concat(pend)) {
      if (c.date !== date || c.op === 'order') continue;
      m.set(canonKey(c.name), c);
    }
    return m;
  }
  // редът на каране за датата (последното „Подреден“); празен списък = по шаблона
  function dayOrder(date) {
    let best = null;
    for (const c of (NAR && NAR.changes) || []) if (c.op === 'order' && c.date === date) best = c;   // последният ред в таблицата
    for (const o of S.narq) if (o.a === 'order' && o.date === date) best = { date, op: 'order', names: o.names || [], by: o.by, at: o.at, pending: true };
    return best && best.names.length ? best : null;
  }
  // „За всеки ден“, докато таблицата не го потвърди – шаблонът се показва вече в новия ред
  function tplItems(day) {
    let op = null; for (const o of S.narq) if (o.a === 'tpl' && normName(o.day) === normName(day.name)) op = o;
    const items = day.items || [];
    if (!op) return items;
    const pos = new Map((op.names || []).map((n, i) => [canonKey(n), i])), k = it => canonKey(it.name);
    const num = items.filter(it => !isCand(it));
    return num.filter(it => pos.has(k(it))).sort((a, b) => pos.get(k(a)) - pos.get(k(b))).concat(num.filter(it => !pos.has(k(it))), items.filter(isCand));
  }
  function dayInfo(day) {
    const date = dayDate(day.name), ch = dayChanges(date);
    const items = [], removed = [], keys = new Set();
    for (const it of tplItems(day)) {
      if (isCand(it)) continue;
      const k = canonKey(it.name), c = ch.get(k);
      if (keys.has(k)) continue;
      if (c && c.op === 'del') { removed.push({ name: it.name, ch: c }); continue; }
      items.push(it); keys.add(k);
    }
    const added = [];
    for (const [k, c] of ch) if (c.op === 'add' && !keys.has(k)) { added.push({ name: c.name, ll: c.ll || null, added: { by: c.by, at: c.at } }); keys.add(k); }
    const cands = [];
    for (const it of day.items || []) if (isCand(it) && !keys.has(canonKey(it.name)) && !cands.some(x => canonKey(x.name) === canonKey(it.name))) cands.push(it);
    return { date, items, added, removed, cands, keys };
  }
  const llOfItem = it => it.ll || ((NAR_CAT.get(normName(it.name)) || {}).ll) || null;
  // добавените се вмъкват там, където най-малко удължават обхода
  // ако редът е сменен с плъзгане – по него; обектите, които не са в него, също се вмъкват най-изгодно
  function buildEffective(day) {
    const I = dayInfo(day), ord = dayOrder(I.date), k = it => canonKey(it.name);
    let list = I.items.slice(), rest = I.added;
    if (ord) {
      const pos = new Map(ord.names.map((n, i) => [canonKey(n), i])), all = I.items.concat(I.added);
      list = all.filter(it => pos.has(k(it))).sort((a, b) => pos.get(k(a)) - pos.get(k(b)));
      rest = all.filter(it => !pos.has(k(it)));
    }
    I.order = ord;
    for (const a of rest) {
      const ll = llOfItem(a); let pos = list.length;
      if (ll) {
        let best = Infinity;
        for (let i = 0; i <= list.length; i++) {
          const p = i > 0 ? llOfItem(list[i - 1]) : null, n = i < list.length ? llOfItem(list[i]) : null;
          if (!p && !n) continue;
          const cost = (p ? distM(p, ll) : 0) + (n ? distM(ll, n) : 0) - (p && n ? distM(p, n) : 0) + (p && n ? 0 : 400);
          if (cost < best) { best = cost; pos = i; }
        }
      }
      list.splice(pos, 0, a);
    }
    return { I, pts: buildDay(list, NAR_CAT) };
  }
  // Винаги се показват всички дни от седмицата; листовете от таблицата ги попълват.
  const WEEK_ORDER = ['понеделник', 'вторник', 'сряда', 'четвъртък', 'петък', 'събота', 'неделя'];
  function withWeek(days) {
    const out = WEEK_ORDER.map(wd => days.find(x => normName(x.name) === wd) || { name: wd[0].toUpperCase() + wd.slice(1), items: [], pts: [] });
    for (const d of days) if (out.indexOf(d) < 0) out.push(d);
    return out;
  }
  let NAR = null, narSig = '', narBusy = false, narLast = 0, narErr = false, started = false;
  // Запис на листовете, вграден в data.js – ползва се, докато таблицата не е достъпна (или скриптът не е обновен).
  const SNAP = window.NARIAD_SNAPSHOT && window.NARIAD_SNAPSHOT.tabs ? window.NARIAD_SNAPSHOT : null;
  function builtinNariad() {
    if (SNAP) { const n = parseNariad(SNAP); n.src = 'snapshot'; n.at = Number(SNAP.at) || 0; return n; }
    return { src: 'builtin', at: 0, cat: new Map(), catList: [], changes: [], days: withWeek(TURG_BUILTIN.length ? [{ name: 'Сряда', items: TURG_BUILTIN.map(p => ({ name: p.st, ll: p.lat != null ? { lat: p.lat, lon: p.lon } : null, num: null })), pts: TURG_BUILTIN }] : []) };
  }
  const dayOf = name => NAR && NAR.days.find(d => d.name === name);
  function todayDay() {
    if (!NAR) return null;
    const wd = WEEK[new Date(shiftStart(Date.now())).getDay()];
    const d = NAR.days.find(x => normName(x.name) === wd);
    return d ? d.name : null;
  }
  function chosenDay() {
    if (!NAR || !NAR.days.length) return null;
    const ch = LS.get('obhod.turgDay', null);
    if (ch && ch.shift === shiftStart(Date.now()) && dayOf(ch.day)) return ch.day;
    return todayDay() || (NAR.days.find(d => d.pts.length) || NAR.days[0]).name;
  }
  function applyTurg() {
    if (!TURG || !NAR) return;
    S.turgDay = chosenDay();
    const day = dayOf(S.turgDay), pts = day ? buildEffective(day).pts : [];
    for (const p of TURG.pts) if (ptById[p.id] === p) delete ptById[p.id];
    for (const p of pts) {
      p.route = 'turg'; p.routeName = 'Търговски' + (S.turgDay ? ' – ' + S.turgDay : ''); p.kind = 'turg';
      p.ll = p.lat != null && p.lon != null; p.shape = 'ci'; p.grp = 'Търговски';
      ptById[p.id] = p;
    }
    TURG.pts = pts; TURG.ordered = pts.slice();
    if (S.sel && !ptById[S.sel]) S.sel = null;
    if (S.route === 'turg' && started) buildMarkers();
  }
  function setNariad(raw) {
    const sig = JSON.stringify(raw.tabs || []);
    if (sig === narSig && NAR && NAR.src === 'sheet') { NAR.at = Number(raw.at) || NAR.at; return false; }
    narSig = sig; NAR = parseNariad(raw);
    applyTurg();
    return true;
  }
  function setDay(name) {
    if (!dayOf(name)) return;
    LS.set('obhod.turgDay', { day: name, shift: shiftStart(Date.now()) });
    applyTurg(); refresh();
    const left = cur().pts.filter(p => !V.has(p.id));
    fitTo(left.length ? left : cur().pts);
  }
  async function loadNariad(force) {
    if (!API || !TURG || narBusy) return;
    if (!force && Date.now() - narLast < 120000) return;
    narBusy = true;
    try {
      const res = await fetchJSON(API + (API.indexOf('?') >= 0 ? '&' : '?') + 'action=nariad&t=' + Date.now());
      if (res && res.ok && res.nariad && res.nariad.tabs) {
        LS.set('obhod.nariad', res.nariad);
        narErr = false;
        if (setNariad(res.nariad)) { refresh(); if (S.route === 'turg') { const left = cur().pts.filter(p => !V.has(p.id)); fitTo(left.length ? left : cur().pts); } }
      } else narErr = res && res.ok ? 'old' : true;
    } catch (e) { narErr = true; }
    narLast = Date.now(); narBusy = false;
    if (S.route === 'turg') renderSummary();
  }

  // ---------- navigation apps ----------
  const IS_HUAWEI = /huawei|honor|harmonyos|hmscore/i.test(navigator.userAgent || '');
  const addrQ = p => encodeURIComponent((p.addr || p.st) + ', София');
  const NAV_APPS = {
    google: { name: 'Google Maps', sub: 'Може маршрут през няколко точки', url: p => `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${p.ll ? p.lat + ',' + p.lon : addrQ(p)}` },
    waze: { name: 'Waze', sub: 'По една точка наведнъж', url: p => p.ll ? `https://waze.com/ul?ll=${p.lat},${p.lon}&navigate=yes` : `https://waze.com/ul?q=${addrQ(p)}&navigate=yes` },
    petal: { name: 'Petal Maps', sub: 'Картите на Huawei, по една точка наведнъж', url: p => p.ll ? `https://www.petalmaps.com/navigation/?daddr=${p.lat},${p.lon}&type=drive&coordinateType=0&utm_source=obhod` : `geo:0,0?q=${addrQ(p)}` },
    geo: { name: 'Друго приложение', sub: 'Телефонът пита с какво да отвори', url: p => p.ll ? `geo:${p.lat},${p.lon}?q=${p.lat},${p.lon}(${encodeURIComponent((p.kind === 'turg' ? '' : 'Точка ') + (p.kind === 'turg' ? p.st : p.n))})` : `geo:0,0?q=${addrQ(p)}` }
  };
  const navOrder = () => IS_HUAWEI ? ['petal', 'waze', 'geo', 'google'] : ['google', 'waze', 'petal', 'geo'];
  const navApp = () => NAV_APPS[S.navApp] ? S.navApp : null;
  const navUrl = p => NAV_APPS[navApp() || 'google'].url(p);
  function routeUrl(list) {
    list = list.filter(p => p.ll);
    if (!list.length) return null;
    if (navApp() && navApp() !== 'google') return navUrl(list[0]);
    const d = list[list.length - 1];
    let u = `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${d.lat},${d.lon}`;
    const w = list.slice(0, -1).map(p => `${p.lat},${p.lon}`).join('|');
    if (w) u += '&waypoints=' + encodeURIComponent(w);
    return u;
  }
  function setLink(a, url) {
    a.href = url;
    if (/^https?:/.test(url)) { a.target = '_blank'; a.rel = 'noopener'; } else { a.removeAttribute('target'); a.removeAttribute('rel'); }
  }
  let toastT = 0;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 4200); }

  // ---------- map ----------
  const map = L.map('map', { zoomControl: false, attributionControl: true, zoomSnap: 0.5, zoomDelta: 0.5 }).setView([42.68, 23.33], 13);
  map.attributionControl.setPosition('bottomleft');
  map.attributionControl.setPrefix(false);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
  }).addTo(map);
  const markerLayer = L.layerGroup().addTo(map);
  let markers = {};
  let meMarker = null, accCircle = null;
  let nearInfo = null, tnext = null;

  function iconFor(p) {
    const d = V.has(p.id);
    const cls = ['pin', p.shape, d ? 'done' : '', brokenOf(p.id) ? 'brk' : '', S.sel === p.id ? 'sel' : '', (!d && !tnext && nearInfo && nearInfo.p === p) ? 'near' : '', (!d && tnext && tnext.p === p) ? 'nxt' : '', p.n.length > 3 ? 'n5' : (p.n.length > 2 ? 'n3' : '')].join(' ');
    return L.divIcon({ className: '', html: `<div class="pinbox"><div class="${cls}"><span>${p.n}</span></div></div>`, iconSize: [32, 32], iconAnchor: [16, 16] });
  }
  function buildMarkers() {
    markerLayer.clearLayers(); markers = {};
    for (const p of cur().pts) {
      if (!p.ll) continue;
      const m = L.marker([p.lat, p.lon], { icon: iconFor(p), keyboard: false });
      m.on('click', () => select(p.id, false));
      m.addTo(markerLayer); markers[p.id] = m;
    }
  }
  function updateMarkers() {
    for (const id in markers) {
      const p = ptById[id];
      markers[id].setIcon(iconFor(p));
      markers[id].setZIndexOffset(S.sel === id ? 1000 : (V.has(id) ? -500 : 0));
    }
  }
  function sheetPad() { const sh = $('#sheet'); return window.innerWidth >= 900 ? 40 : Math.min(sh.getBoundingClientRect().height, window.innerHeight * 0.5) + 20; }
  function fitTo(pts, includeFar) {
    pts = pts.filter(p => p.ll);
    if (!includeFar) { const near = pts.filter(p => !p.far); if (near.length) pts = near; }
    if (!pts.length) return;
    const b = L.latLngBounds(pts.map(p => [p.lat, p.lon]));
    if (S.pos && includeFar === 'withMe') b.extend([S.pos.lat, S.pos.lon]);
    map.fitBounds(b, { paddingTopLeft: [24, 64], paddingBottomRight: [70, window.innerWidth >= 900 ? 30 : 30], maxZoom: 17 });
  }
  map.on('dragstart', () => { if (S.follow) setFollow(false); });
  map.on('zoomend', () => { if (S.nav && S.pos) map.panTo(navTarget(), { animate: false }); });
  function zoomClass() { const z = map.getZoom(), c = map.getContainer(); c.classList.toggle('zlow', z < 15.5); c.classList.toggle('zmid', z >= 15.5 && z < 16.5); }
  map.on('zoomend', zoomClass); zoomClass();

  // ---------- маршрут при каране (приблизителен, от GPS запис на обхода) ----------
  // window.CHAINS[k] = { routes: [наряди, които се карат заедно], seq: [id по реда на обхода],
  //   legs: [път от seq[k] до seq[k+1] като Google polyline, '' = прекъсване] }; r.chain = k.
  // Когато следващата точка е в другия наряд от веригата, приложението прехвърля шофьора там.
  // Изминатото е сиво на точки, следващият отсечек е ярко син, останалото – светлосиньо със стрелки за посоката.
  S.trk = LS.get('obhod.trk', true) !== false;
  const trkLayer = L.layerGroup().addTo(map);
  let trkSig = '';
  function decodePoly(s) {
    const out = []; let i = 0, la = 0, lo = 0;
    while (i < s.length) {
      for (let k = 0; k < 2; k++) {
        let b, sh = 0, r = 0;
        do { b = s.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32 && i < s.length);
        const v = (r & 1) ? ~(r >> 1) : (r >> 1);
        if (k === 0) la += v; else lo += v;
      }
      out.push([la / 1e5, lo / 1e5]);
    }
    return out;
  }
  const CHAINS = window.CHAINS || {};
  const chainOf = r => (r && r.chain && CHAINS[r.chain]) || null;
  const chainRoutes = c => (c ? c.routes.map(k => byKey[k]).filter(Boolean) : []);
  function trkSeq(c) {
    if (!c._seq) {
      c._seq = c.seq.map(id => ptById[id]).filter(Boolean);
      c._legs = c.legs.map(s => (s ? decodePoly(s) : null));
    }
    return c._seq;
  }
  const trkOn = r => !!(chainOf(r) && S.trk);
  // следващата точка: първата немината след последно отметнатата (по време) в цялата верига
  function trkNext(c) {
    if (!c) return null;
    const seq = trkSeq(c), n = seq.length;
    let from = -1, at = -1;
    seq.forEach((p, i) => { const v = V.get(p.id); if (v && v.at > at) { at = v.at; from = i; } });
    for (let k = 1; k <= n; k++) { const i = (from + k) % n; if (!V.has(seq[i].id) && seq[i].ll) return { p: seq[i], i, from }; }
    return null;
  }
  function trkUpcoming(c, k) {
    const tn = trkNext(c); if (!tn) return [];
    const seq = trkSeq(c), out = [];
    for (let j = 0; j < seq.length && out.length < k; j++) { const p = seq[(tn.i + j) % seq.length]; if (!V.has(p.id) && p.ll) out.push(p); }
    return out;
  }
  // стрелки (шеврони) по линията през gap пиксела – смятат се наново при всяко мащабиране
  function trkArrows(lines, gap, h) {
    const z = map.getZoom(), out = [];
    for (const ln of lines) {
      const P = ln.map(ll => map.project(ll, z)), cum = [0];
      for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + P[i].distanceTo(P[i - 1]));
      const total = cum[cum.length - 1];
      if (total < 22) continue;
      let i = 1;
      for (let s = total < gap ? total / 2 : gap / 2; s < total; s += gap) {
        while (i < P.length - 1 && cum[i] < s) i++;
        const a = P[i - 1], b = P[i], sl = (cum[i] - cum[i - 1]) || 1, t = (s - cum[i - 1]) / sl;
        const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t, dx = (b.x - a.x) / sl, dy = (b.y - a.y) / sl;
        const pt = (u, v) => map.unproject(L.point(x + dx * u - dy * v, y + dy * u + dx * v), z);
        out.push([pt(-h * .7, -h), pt(h * .6, 0), pt(-h * .7, h)]);
      }
    }
    return out;
  }
  function trkFlag(p, txt) {
    const icon = L.divIcon({ className: '', html: `<div class="upr"><div class="trkflag">${txt}</div></div>`, iconSize: [0, 0], iconAnchor: [0, 0] });
    L.marker([p.lat, p.lon], { icon, interactive: false, keyboard: false, zIndexOffset: 900 }).addTo(trkLayer);
  }
  // точка от другия наряд, към/от която води маршрутът – натискане прехвърля там
  function trkXfer(q, out) {
    const lbl = (out ? '→ ' : '') + q.routeName + ' ' + q.n + (out ? '' : ' →');
    const icon = L.divIcon({ className: '', html: `<div class="upr"><div class="trkxfer${out ? ' out' : ''}"><i></i><span></span></div></div>`, iconSize: [0, 0], iconAnchor: [0, 0] });
    const m = L.marker([q.lat, q.lon], { icon, keyboard: false, zIndexOffset: -300, title: 'Към ' + q.routeName });
    m.on('add', () => { const s = m.getElement() && m.getElement().querySelector('span'); if (s) s.textContent = lbl; });
    m.on('click', () => transferTo(q.route));
    m.addTo(trkLayer);
  }
  function drawTrack() {
    const r = cur(), c = chainOf(r), on = trkOn(r);
    $('#trkBtn').hidden = !c;
    $('#trkBtn').setAttribute('aria-pressed', String(on));
    $('#trkBtn').setAttribute('aria-label', on ? 'Скрий маршрута' : 'Покажи маршрута');
    const seq = on ? trkSeq(c) : [];
    const sig = on ? [r.key, map.getZoom(), tnext ? tnext.i + ':' + tnext.from : '-', seq.map(p => (V.has(p.id) ? 1 : 0)).join('')].join('|') : 'off';
    if (sig === trkSig) return;
    trkSig = sig; trkLayer.clearLayers();
    if (!on) return;
    const legs = c._legs, inR = p => p.route === r.key;
    // на картата са отсечките, които докосват този наряд (вкл. прехода към другия наряд)
    const cls = legs.map((lg, k) => (!lg || !(inR(seq[k]) || inR(seq[k + 1])) ? null : (V.has(seq[k].id) && V.has(seq[k + 1].id) ? 'done' : 'rem')));
    if (tnext && tnext.from >= 0 && tnext.from < tnext.i) for (let k = tnext.from; k < tnext.i; k++) if (legs[k]) cls[k] = 'next';
    const xfer = [];
    legs.forEach((lg, k) => { if (cls[k] && cls[k] !== 'done' && inR(seq[k]) !== inR(seq[k + 1])) xfer.push(inR(seq[k]) ? [seq[k + 1], true] : [seq[k], false]); });
    const lines = { done: [], rem: [], next: [] };
    legs.forEach((lg, k) => {
      const c = cls[k]; if (!c) return;
      const arr = lines[c];
      if (k > 0 && cls[k - 1] === c) arr[arr.length - 1] = arr[arr.length - 1].concat(lg.slice(1)); else arr.push(lg.slice());
    });
    const z = map.getZoom(), w = z >= 16.5 ? 1 : (z >= 15 ? .85 : .7);
    if (lines.done.length) L.polyline(lines.done, { className: 'trk-done', weight: 4 * w, interactive: false }).addTo(trkLayer);
    for (const cl of ['rem', 'next']) {
      if (!lines[cl].length) continue;
      const wt = (cl === 'next' ? 7.5 : 5.5) * w;
      L.polyline(lines[cl], { className: 'trk-case', weight: wt + 3.5, interactive: false }).addTo(trkLayer);
      L.polyline(lines[cl], { className: 'trk-' + cl, weight: wt, interactive: false }).addTo(trkLayer);
      const ar = trkArrows(lines[cl], cl === 'next' ? 50 : 72, wt * .78);
      if (ar.length) L.polyline(ar, { className: 'trk-arr', weight: Math.max(1.8, wt * .34), interactive: false, fill: false }).addTo(trkLayer);
    }
    if (!seq.some(p => V.has(p.id)) && seq.length) { if (inR(seq[0])) trkFlag(seq[0], 'Начало'); if (inR(seq[seq.length - 1])) trkFlag(seq[seq.length - 1], 'Край'); }
    const seen = new Set();
    for (const [q, out] of xfer) { if (seen.has(q.id)) continue; seen.add(q.id); trkXfer(q, out); }
    if (chainRoutes(c).length > 1 && !LS.get('obhod.xferHint', 0)) { LS.set('obhod.xferHint', 1); LS.set('obhod.trkHint', 1); setTimeout(() => toast(chainRoutes(c).map(x => x.name).join(' и ') + ' се карат заедно – когато следващата точка е в другия наряд, те прехвърлям там.'), 2500); }
    if (!LS.get('obhod.trkHint', 0)) { LS.set('obhod.trkHint', 1); setTimeout(() => toast('Лилавата линия е приблизителният маршрут. Следващият отсечек е по-ярък.'), 2500); }
  }
  map.on('zoomend', drawTrack);
  // прехвърля в друг наряд и показва отсечката до следващата точка
  function transferTo(key) {
    if (!byKey[key]) return;
    if (key !== S.route) setRoute(key, true);
    if (S.nav) return;   // в навигация картата си следва колата и показва следващия отсечек
    if (S.follow) setFollow(false);
    const c = chainOf(cur());
    if (!tnext || !c) { fitTo(cur().pts.filter(p => !V.has(p.id))); return; }
    const pts = [tnext.p]; if (tnext.from >= 0) pts.push(trkSeq(c)[tnext.from]);
    if (S.pos) pts.push(S.pos);
    const b = L.latLngBounds(pts.map(p => [p.lat, p.lon]));
    map.fitBounds(b.pad(.25), { paddingTopLeft: [24, 64], paddingBottomRight: [70, 30], maxZoom: 17 });
  }

  // ---------- location ----------
  // Screen stays on the whole time the app is open.
  // Wake Lock where the browser has it; otherwise a tiny silent looping video (started on the first tap).
  let wakeLock = null, awakeVideo = null;
  async function keepAwake() {
    if (document.visibilityState !== 'visible') return;
    if ('wakeLock' in navigator) {
      if (wakeLock) return;
      try {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; if (document.visibilityState === 'visible') setTimeout(keepAwake, 1000); });
        return;
      } catch (e) { wakeLock = null; }
    }
    try {
      if (!awakeVideo) {
        awakeVideo = document.createElement('video');
        for (const [src, type] of [['media/keepawake.mp4', 'video/mp4'], ['media/keepawake.webm', 'video/webm']]) {
          const s = document.createElement('source'); s.src = src; s.type = type; awakeVideo.append(s);
        }
        awakeVideo.muted = true; awakeVideo.loop = true;
        awakeVideo.setAttribute('playsinline', ''); awakeVideo.setAttribute('muted', '');
        awakeVideo.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:0;top:0';
        document.body.append(awakeVideo);
      }
      if (awakeVideo.paused) await awakeVideo.play();
    } catch (e) {}
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') keepAwake(); });
  ['pointerdown', 'touchend', 'click'].forEach(ev => document.addEventListener(ev, () => { if (!wakeLock && (!awakeVideo || awakeVideo.paused)) keepAwake(); }, { passive: true }));

  function setFollow(on) {
    if (!on && S.nav) setNav(false);
    S.follow = on;
    if (on && S.pos && !S.nav) map.setView([S.pos.lat, S.pos.lon], Math.max(map.getZoom(), 17), { animate: true });
    renderLocBtn();
  }
  function renderLocBtn() {
    const b = $('#locBtn'), st = S.nav ? 'nav' : (S.follow ? 'follow' : (S.pos ? 'on' : 'off'));
    if (b.dataset.state !== st) b.innerHTML = st === 'nav' ? ICON.navmode : ICON.loc;
    b.dataset.state = st;
    b.setAttribute('aria-label', st === 'nav' ? 'Спри навигацията' : (st === 'follow' ? 'Навигация – картата се върти по посоката' : 'Следвай моето местоположение'));
    $('#navAttr').hidden = !S.nav;
  }

  // ---------- навигация: картата се върти по посоката на движение, колата е долу в средата ----------
  // Картата се завърта с CSS (без външна библиотека); точките и етикетите се връщат изправени.
  // Докато се върти, картата е по-голяма от екрана (диагонала), за да няма празни ъгли.
  S.nav = false;
  const mapEl = $('#map');
  let navBrg = 0, navWrap = 0, navPrev = null, navTouch = null, navPtrs = 0;
  const RAD = Math.PI / 180;
  function bearingTo(a, b) {
    const f1 = a.lat * RAD, f2 = b.lat * RAD, dl = (b.lon - a.lon) * RAD;
    const y = Math.sin(dl) * Math.cos(f2), x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
    return (Math.atan2(y, x) / RAD + 360) % 360;
  }
  // посоката: от GPS при движение, иначе от последните ~12 м път; при спиране остава последната
  function navHeading() {
    const p = S.pos; if (!p) return null;
    if (p.heading != null && !isNaN(p.heading) && (p.speed || 0) > 1.4) { navPrev = p; return p.heading; }
    if (navPrev && distM(navPrev, p) > 12) { const b = bearingTo(navPrev, p); navPrev = p; return b; }
    if (!navPrev) navPrev = p;
    return null;
  }
  function navSize(on) {
    const wrap = mapEl.parentElement, W = wrap.clientWidth, H = wrap.clientHeight;
    if (on) {
      const D = Math.ceil(Math.hypot(W, H)) + 2;
      Object.assign(mapEl.style, { inset: 'auto', width: D + 'px', height: D + 'px', left: Math.round((W - D) / 2) + 'px', top: Math.round((H - D) / 2) + 'px' });
    } else ['inset', 'width', 'height', 'left', 'top'].forEach(k => { mapEl.style[k] = ''; });
    map.invalidateSize({ pan: false, animate: false });
  }
  function setBrg(b, animate) {
    const d = ((b - navBrg + 540) % 360) - 180;
    navBrg = (navBrg + d + 360) % 360; navWrap += d;
    mapEl.classList.toggle('brg-anim', !!animate);
    mapEl.style.setProperty('--brg', navWrap.toFixed(1) + 'deg');
    drawMe();
  }
  // центърът е пред колата, за да се вижда повече път напред
  function navTarget() {
    const z = map.getZoom(), pt = map.project([S.pos.lat, S.pos.lon], z);
    const d = mapEl.parentElement.clientHeight * 0.22, r = navBrg * RAD;
    return map.unproject(pt.add(L.point(Math.sin(r) * d, -Math.cos(r) * d)), z);
  }
  function navUpdate(first) {
    if (!S.nav || !S.pos) return;
    const h = navHeading();
    if (h != null && (first || Math.abs(((h - navBrg + 540) % 360) - 180) > 6)) setBrg(h, !first);
    map.panTo(navTarget(), first ? { animate: false } : { animate: true, duration: 0.9, easeLinearity: 1, noMoveStart: true });
  }
  function setNav(on) {
    if (on === S.nav) return;
    if (on && !S.pos) return;
    S.nav = on;
    if (on) {
      S.follow = true;
      map.dragging.disable();
      map.options.touchZoom = 'center'; map.options.doubleClickZoom = 'center';
      navSize(true);
      mapEl.classList.add('navrot');
      const h0 = navHeading();
      const nxt = tnext ? tnext.p : (nearInfo ? nearInfo.p : null);
      setBrg(h0 != null ? h0 : (nxt ? bearingTo(S.pos, nxt) : 0), false);
      if (map.getZoom() < 17) map.setZoom(17, { animate: false });
      navUpdate(true);
    } else {
      const c = map.getCenter(), z = map.getZoom();
      mapEl.classList.remove('navrot', 'brg-anim');
      navBrg = 0; navWrap = 0; mapEl.style.removeProperty('--brg'); drawMe();
      navSize(false);
      map.setView(c, z, { animate: false });
      map.dragging.enable();
      map.options.touchZoom = true; map.options.doubleClickZoom = true;
    }
    renderLocBtn();
  }
  // в навигация плъзгането спира навигацията (картата се изправя и после се мести нормално)
  mapEl.addEventListener('pointerdown', e => { navPtrs++; if (S.nav && navPtrs === 1) navTouch = { x: e.clientX, y: e.clientY }; else navTouch = null; }, true);
  mapEl.addEventListener('pointermove', e => {
    if (!S.nav || !navTouch || navPtrs > 1) return;
    if (Math.hypot(e.clientX - navTouch.x, e.clientY - navTouch.y) > 14) { navTouch = null; setFollow(false); toast('Навигацията е спряна – натисни бутона за местоположение, за да я пуснеш пак.'); }
  }, true);
  ['pointerup', 'pointercancel'].forEach(ev => mapEl.addEventListener(ev, () => { navPtrs = Math.max(0, navPtrs - 1); if (!navPtrs) navTouch = null; }, true));
  function drawMe() {
    if (!S.pos) return;
    const ll = [S.pos.lat, S.pos.lon];
    const moving = S.pos.heading != null && !isNaN(S.pos.heading) && (S.pos.speed || 0) > 1;
    const hd = moving ? S.pos.heading : (S.nav ? navBrg : null);   // в навигация стрелката винаги сочи напред
    const html = `<div class="me">${hd != null ? `<i class="dir" style="transform:rotate(${Math.round(hd)}deg)"></i>` : ''}</div>`;
    const icon = L.divIcon({ className: '', html, iconSize: [22, 22], iconAnchor: [11, 11] });
    if (!meMarker) { meMarker = L.marker(ll, { icon, interactive: false, zIndexOffset: 2000 }).addTo(map); }
    else { meMarker.setLatLng(ll); meMarker.setIcon(icon); }
    const r = Math.min(S.pos.acc || 0, 500);
    if (!accCircle) accCircle = L.circle(ll, { radius: r, color: '#1f6fe0', weight: 1, opacity: .4, fillOpacity: .1, interactive: false }).addTo(map);
    else { accCircle.setLatLng(ll); accCircle.setRadius(r); }
  }
  let lastListRender = 0;
  function onPos(pos) {
    const c = pos.coords;
    const first = !S.pos;
    S.pos = { lat: c.latitude, lon: c.longitude, acc: c.accuracy, heading: c.heading, speed: c.speed };
    S.geoErr = null;
    drawMe();
    if (S.nav) navUpdate(false);
    else if (S.follow) map.panTo([S.pos.lat, S.pos.lon], { animate: true });
    if (first) renderLocBtn();
    renderCard(); updateMarkers();
    const now = Date.now();
    if (S.sort === 'near' && now - lastListRender > 4000) { renderList(); lastListRender = now; } else updateListDistances();
  }
  function onGeoErr(e) {
    S.geoErr = e && e.code === 1 ? 'denied' : 'err';
    renderLocBtn();
  }
  function startGeo() {
    if (!('geolocation' in navigator)) { S.geoErr = 'none'; return; }
    navigator.geolocation.watchPosition(onPos, onGeoErr, { enableHighAccuracy: true, maximumAge: 4000, timeout: 30000 });
  }

  // ---------- rendering ----------
  function nearestRemaining() {
    if (!S.pos) return null;
    let best = null, bd = Infinity;
    for (const p of cur().pts) { if (V.has(p.id) || !p.ll) continue; const d = distM(S.pos, p); if (d < bd) { bd = d; best = p; } }
    return best ? { p: best, d: bd } : null;
  }
  // Маршрутът се избира от падащо меню; до името е колко точки остават (✓ – всички минати).
  function renderRoutes() {
    const sel = $('#routeSel');
    if (sel.options.length !== ROUTES.length) {
      sel.textContent = '';
      for (const r of ROUTES) { const o = document.createElement('option'); o.value = r.key; sel.append(o); }
    }
    ROUTES.forEach((r, i) => {
      const left = r.pts.filter(p => !V.has(p.id)).length;
      const txt = r.name + (r.pts.length ? (left ? ' · ' + left : ' ✓') : '');
      if (sel.options[i].textContent !== txt) sel.options[i].textContent = txt;
    });
    if (sel.value !== S.route) sel.value = S.route;
  }
  function renderWho() {
    const b = $('#whoBtn');
    $('#whoName').textContent = S.name || 'Кой си?';
    b.classList.toggle('need', !S.name);
  }
  function renderSync() {
    const s = $('#sync');
    let mode, txt;
    if (!API) { mode = 'local'; txt = 'Таблицата не е свързана – отметките са само на този телефон'; }
    else if (S.queue.length && S.syncErr) { mode = 'offline'; txt = `Няма връзка – ${S.queue.length} ${plural(S.queue.length, 'отметка чака', 'отметки чакат')}`; }
    else if (S.queue.length) { mode = 'pending'; txt = 'Записвам…'; }
    else if (S.narq.length && S.narOld) { mode = 'pending'; txt = 'Промените в наряда чакат – скриптът в таблицата трябва да се обнови'; }
    else if (S.narq.length) { mode = 'pending'; txt = S.syncErr ? 'Няма връзка – промените в наряда чакат' : 'Записвам наряда…'; }
    else if (S.reports.length) { mode = 'pending'; txt = S.reportsOld ? 'Сигналът за счупена кофа чака – таблицата още не го приема' : (S.syncErr ? 'Няма връзка – сигналът за счупена кофа чака' : 'Изпращам сигнала…'); }
    else if (S.syncErr) { mode = 'offline'; txt = 'Няма връзка с таблицата'; }
    else if (S.lastSync) { mode = 'live'; txt = 'Общи отметки · на живо'; }
    else { mode = 'pending'; txt = 'Свързване…'; }
    s.dataset.mode = mode; $('#syncTxt').textContent = txt;
  }
  function renderSummary() {
    const r = cur(), tot = r.pts.length, done = r.pts.filter(p => V.has(p.id)).length;
    $('#doneN').textContent = done; $('#totN').textContent = tot;
    $('#barFill').style.width = (tot ? done / tot * 100 : 0) + '%';
    const col = r.kind === 'turg' ? dayColor(S.turgDay) : 'y';
    const yt = r.pts.reduce((s, p) => s + (p[col] || 0), 0), yl = r.pts.filter(p => !V.has(p.id)).reduce((s, p) => s + (p[col] || 0), 0);
    $('#yelTot').textContent = yt; $('#yelLeft').textContent = yl;
    $('#binLbl').textContent = col === 'b' ? 'Сини:' : 'Жълти:';
    $('#binDot').className = 'dot ' + (col === 'b' ? 'b' : 'y');
    $('#binSum').hidden = !col || !r.pts.some(p => p[col] != null);
    renderDays(r);
    $('#resetBtn').disabled = !resetGroup().some(x => x.pts.some(p => V.has(p.id)));
    // route through next remaining points: nearest-first from my position, else by number
    const left = r.ordered.filter(p => !V.has(p.id) && p.ll);
    let seq = [];
    if (r.kind === 'turg') seq = left.slice(0, 4);
    else if (trkOn(r)) seq = trkUpcoming(chainOf(r), 4);
    else if (S.pos && left.length) {
      let here = S.pos; const pool = left.slice();
      while (seq.length < 4 && pool.length) {
        let bi = 0, bd = Infinity; pool.forEach((p, i) => { const d = distM(here, p); if (d < bd) { bd = d; bi = i; } });
        here = pool[bi]; seq.push(pool.splice(bi, 1)[0]);
      }
    } else seq = left.slice(0, 4);
    S.routeSeq = seq;
    const a = $('#routeNext'), u = routeUrl(seq);
    const multi = seq.length > 1 && (!navApp() || navApp() === 'google');
    if (u) { setLink(a, u); a.removeAttribute('aria-disabled'); $('#routeTxt').textContent = multi ? `Маршрут: следващите ${seq.length}` : (r.kind === 'turg' ? `Навигация до ${seq[0].st}` : `Навигация до т. ${seq[0].n}`); }
    else { a.removeAttribute('href'); a.setAttribute('aria-disabled', 'true'); $('#routeTxt').textContent = 'Всички са минати'; }
    $('#navName').textContent = navApp() ? NAV_APPS[navApp()].name : 'не е избрано';
  }
  // от листа „Обекти“: Понеделник синьо, Вторник жълто, Сряда синьо, Четвъртък жълто, Петък синьо
  const dayColor = name => ({ 'понеделник': 'b', 'сряда': 'b', 'петък': 'b', 'вторник': 'y', 'четвъртък': 'y' })[normName(name)] || '';
  function renderDays(r) {
    const box = $('#days'), lbl = $('#dayLbl');
    const on = r.kind === 'turg' && !!NAR;
    box.hidden = !on; lbl.hidden = !on;
    box.textContent = '';
    if (!on) return;
    const today = todayDay();
    for (const d of NAR.days) {
      const b = el('button', 'chip day' + (d.name === today ? ' today' : '') + (d.pts.length ? '' : ' none'));
      b.type = 'button'; b.dataset.day = d.name;
      b.setAttribute('aria-pressed', String(d.name === S.turgDay));
      b.textContent = SHORT[normName(d.name)] || d.name;
      b.title = d.name + ' · ' + d.pts.length + ' ' + plural(d.pts.length, 'обект', 'обекта');
      box.append(b);
    }
    const name = S.turgDay || '';
    const warn = !!(today && name && name !== today);
    const dd = name ? fmtDay(dayDate(name)) : '';
    const txt = el('span', 'daytxt', (warn ? 'Не е днес' : (name ? 'Наряд ' + name.toLowerCase() : 'Няма наряд')) + (dd ? ' · ' + dd : ''));
    const ed = el('button', 'dayedit' + (S.pin ? '' : ' locked')); ed.type = 'button'; ed.dataset.act = 'naredit'; ed.innerHTML = (S.pin ? ICON.edit : ICON.lock) + '<span>Промени</span>';
    ed.title = 'Добави или махни обекти за ' + (dd || 'деня');
    const st = el('button', 'stamp'); st.type = 'button'; st.dataset.act = 'nariad';
    st.title = 'Обнови наряда от таблицата';
    if (!API) st.hidden = true;
    else if (NAR.src === 'snapshot') st.textContent = '↻ запис ' + fmtWhen(NAR.at);
    else if (NAR.src !== 'sheet') st.textContent = narBusy ? '↻ …' : '↻ вграден';
    else st.textContent = (narErr === true ? '↻ без връзка ' : '↻ ') + fmtWhen(NAR.at);
    lbl.textContent = ''; lbl.append(txt, ed, st);
    lbl.classList.toggle('warn', warn);
  }
  function subEl(p, withGroup, noDist) {
    const sub = el('span', 'sub');
    const dt = dotsEl(p); if (dt) sub.append(dt);
    if (withGroup) sub.append(el('span', null, p.grp));
    if (p.tag) sub.append(el('span', 'tag', p.tag));
    if (p.added) sub.append(el('span', 'tag add', 'добавен' + (p.added.by ? ' · ' + (p.added.by === S.name ? 'ти' : p.added.by) : '')));
    else if (p.req) sub.append(el('span', 'tag', 'по заявка'));
    if (brokenOf(p.id)) { const b = el('span', 'brkmark'); b.innerHTML = ICON.warn + '<span>счупена</span>'; sub.append(b); }
    if (p.ph && p.ph.length) { const t = el('span', 'telmark'); t.innerHTML = ICON.tel; t.title = 'Има телефон'; sub.append(t); }
    if (!p.ll) sub.append(el('span', 'noll', 'без точка на картата'));
    const v = V.get(p.id);
    if (v) sub.append(el('span', 'when', 'Минато ' + fmtWhen(v.at) + (v.by ? ' · ' + (v.by === S.name ? 'ти' : v.by) : '')));
    else if (S.pos && !noDist && p.ll) sub.append(el('span', 'd', fmtDist(distM(S.pos, p))));
    return sub;
  }
  function renderCard() {
    const card = $('#card'); card.textContent = '';
    const r = cur();
    nearInfo = nearestRemaining();
    let p = null, label = '', d = null, selected = false, other = false;
    if (S.sel && ptById[S.sel] && ptById[S.sel].route === S.route) { p = ptById[S.sel]; label = 'Избрана точка'; selected = true; }
    else if (r.kind === 'turg') { p = r.ordered.find(q => !V.has(q.id)) || null; label = 'Следващ по наряда'; }
    else if (tnext && !(nearInfo && nearInfo.p !== tnext.p && nearInfo.d <= 40)) { p = tnext.p; label = 'Следваща по маршрута'; if (p.route !== S.route) { label += ' · ' + p.routeName; other = true; } }
    else if (nearInfo) { p = nearInfo.p; label = 'Най-близо'; }
    else { p = r.ordered.find(q => !V.has(q.id)) || null; label = 'Следваща'; }
    if (!p) {
      card.className = 'card';
      const msg = r.kind !== 'turg' ? 'Всички точки в маршрута са минати. Натиснете „Нов курс“ преди следващия обход.'
        : (r.pts.length ? 'Всички обекти от наряда са минати.' : 'Няма обекти в наряда' + (S.turgDay ? ' за ' + S.turgDay.toLowerCase() : '') + '.');
      card.append(el('div', 'empty-card', msg));
      if (r.kind === 'turg' && NAR) { const b = el('button', 'btn'); b.type = 'button'; b.dataset.act = 'naredit'; b.innerHTML = ICON.edit + '<span>Добави обекти за деня</span>'; card.append(b); }
      return;
    }
    if (S.pos && p.ll) d = distM(S.pos, p);
    const done = V.has(p.id);
    const here = !done && d != null && d <= 30 && (S.pos.acc || 99) <= 50;
    card.className = 'card' + (here ? ' here' : '') + (done ? ' done' : '');
    if (here && !S.buzzed[p.id]) { S.buzzed[p.id] = 1; if (navigator.vibrate) navigator.vibrate([60, 40, 60]); }

    const lbl = el('div', 'lbl'); lbl.append(el('span', null, here ? 'Тук си' : label));
    if (selected) { const x = el('button', 'x', 'Затвори ×'); x.type = 'button'; x.dataset.act = 'unselect'; lbl.append(x); }
    card.append(lbl);
    const hd = el('div', 'hd');
    const num = el('span', 'num ' + p.shape + (done ? ' done' : '') + (p.n.length > 3 ? ' long' : ''), p.n);
    const txt = el('div', 'txt'); txt.append(el('div', 'st', p.st || '—'), subEl(p, r.groups.length > 1, true));
    hd.append(num, txt);
    if (d != null && !done) hd.append(el('div', 'dist', fmtDist(d)));
    card.append(hd);
    if (p.note) card.append(el('p', 'note', p.note));
    if (p.ph && p.ph.length) {
      const ph = el('div', 'phones');
      for (const [lbl2, num2] of p.ph) {
        const a = el('a', 'btn tel'); a.href = 'tel:' + num2.replace(/[^+0-9]/g, '');
        a.innerHTML = ICON.tel + '<span></span>'; a.lastChild.textContent = lbl2 + ' · ' + fmtPhone(num2);
        ph.append(a);
      }
      card.append(ph);
    }
    const bk = brokenOf(p.id);
    if (bk) {
      const w = el('div', 'brkinfo'); w.innerHTML = ICON.warn + '<span></span>';
      w.lastChild.textContent = 'Счупена кофа' + (bk.kind ? ': ' + bk.kind : '') + ' · ' + (bk.pending ? 'изпраща се…' : (bk.by ? bk.by + ', ' : '') + fmtWhen(bk.at)) + (bk.note ? ' – ' + bk.note : '');
      card.append(w);
    }
    const acts = el('div', 'acts');
    const tg = el('button', 'btn' + (done ? '' : ' primary')); tg.type = 'button'; tg.dataset.act = 'toggle'; tg.dataset.id = p.id;
    tg.innerHTML = (done ? ICON.undo : ICON.on) + '<span></span>'; tg.lastChild.textContent = done ? 'Върни' : 'Минах';
    if (other) { tg.dataset.act = 'xfer'; tg.dataset.key = p.route; tg.innerHTML = ICON.xfer + '<span></span>'; tg.lastChild.textContent = 'Към ' + p.routeName; }
    const nv = el('a', 'btn'); setLink(nv, navUrl(p)); nv.dataset.nav = p.id; nv.innerHTML = ICON.nav + '<span>Навигация</span>';
    acts.append(tg, nv); card.append(acts);
    if (other) return;
    const rb = el('button', 'btn brkbtn'); rb.type = 'button'; rb.dataset.act = 'broken'; rb.dataset.id = p.id;
    rb.innerHTML = ICON.warn + '<span>Счупена кофа</span>';
    if (p.kind === 'turg') {
      const bb = el('button', 'btn binsbtn'); bb.type = 'button'; bb.dataset.act = 'bins'; bb.dataset.id = p.id;
      bb.append(el('span', null, 'Кофи'));
      const dt = dotsEl(p); if (dt) bb.append(dt); else bb.append(el('span', 'muted', 'няма'));
      rb.lastChild.textContent = 'Счупена';
      const two = el('div', 'acts two'); two.append(bb, rb); card.append(two);
    } else card.append(rb);
  }
  function rowEl(p, withGroup, grip) {
    const li = el('li', 'row ' + p.shape + (V.has(p.id) ? ' done' : '') + (S.sel === p.id ? ' sel' : '') + (grip ? ' drag' : '')); li.dataset.id = p.id;
    if (grip) { const g = el('span', 'grip'); g.innerHTML = ICON.grip; g.title = 'Задръж и плъзни, за да смениш реда'; g.setAttribute('aria-hidden', 'true'); li.append(g); }
    const m = el('button', 'rowmain'); m.type = 'button'; m.dataset.act = 'select'; m.dataset.id = p.id;
    const txt = el('span', 'txt'); txt.append(el('span', 'st', p.st || '—'), subEl(p, withGroup));
    m.append(el('span', 'num' + (p.n.length > 3 ? ' long' : ''), p.n), txt);
    const nav = el('a', 'nav'); setLink(nav, navUrl(p)); nav.dataset.nav = p.id; nav.setAttribute('aria-label', 'Навигация до точка ' + p.n); nav.innerHTML = ICON.nav;
    const ck = el('button', 'check'); ck.type = 'button'; ck.dataset.act = 'toggle'; ck.dataset.id = p.id;
    const d = V.has(p.id); ck.setAttribute('aria-pressed', String(d)); ck.setAttribute('aria-label', (d ? 'Върни точка ' : 'Минах точка ') + p.n); ck.innerHTML = d ? ICON.on : ICON.off;
    li.append(m, nav, ck);
    return li;
  }
  function renderFilters() {
    const r = cur(), done = r.pts.filter(p => V.has(p.id)).length;
    $('#fLeft').textContent = 'Остават ' + (r.pts.length - done);
    $('#fAll').textContent = 'Всички ' + r.pts.length;
    $('#fDone').textContent = 'Минати ' + done;
    document.querySelectorAll('[data-f]').forEach(c => c.setAttribute('aria-pressed', String(c.dataset.f === S.filter)));
    $('#sRoute').hidden = !chainOf(r);
    const so = sortOf(r);
    document.querySelectorAll('[data-s]').forEach(c => c.setAttribute('aria-pressed', String(c.dataset.s === so)));
  }
  const sortOf = r => (S.sort === 'route' && !chainOf(r) ? 'num' : S.sort);
  function renderList() {
    if (drag) { listDirty = true; return; }   // не пречим на плъзгането – ще се обнови след него
    const r = cur(), ul = $('#list'); ul.textContent = '';
    if (r.kind === 'turg') ordBar(r, ul);
    let pts = r.ordered;
    if (S.filter === 'left') pts = pts.filter(p => !V.has(p.id));
    if (S.filter === 'done') pts = pts.filter(p => V.has(p.id));
    if (!pts.length) {
      ul.append(el('li', 'empty', !r.pts.length ? (r.kind === 'turg' ? 'Няма обекти в този наряд.' : 'Няма точки.') : (S.filter === 'left' ? 'Всички точки са минати.' : (S.filter === 'done' ? 'Още няма минати точки.' : 'Няма точки.'))));
      return;
    }
    const multi = r.groups.length > 1;
    if (sortOf(r) === 'route') {
      const inList = new Set(pts);
      trkSeq(chainOf(r)).filter(p => inList.has(p)).forEach(p => ul.append(rowEl(p, multi)));
      return;
    }
    if (S.sort === 'near' && S.pos) {
      pts.slice().sort((a, b) => (a.ll ? distM(S.pos, a) : 1e12) - (b.ll ? distM(S.pos, b) : 1e12)).forEach(p => ul.append(rowEl(p, multi)));
      return;
    }
    const grip = canDrag(r) && pts.length > 1;
    for (const g of r.groups) {
      const gp = pts.filter(p => p.grp === g); if (!gp.length) continue;
      if (multi) ul.append(el('li', 'grp', g + ' · ' + gp.length));
      gp.forEach(p => ul.append(rowEl(p, false, grip)));
    }
  }

  // ---------- търговски: редът на каране се сменя с плъзгане (само Ники и Тошко – с ПИН) ----------
  let drag = null, listDirty = false, tplArm = 0;
  const canDrag = r => r.kind === 'turg' && !!NAR && !!S.pin && !!S.turgDay && sortOf(r) === 'num';
  // ред над списъка: кой е сменил реда за датата; „За всеки <ден>“ (записва шаблона) и „Върни“
  function ordBar(r, ul) {
    const day = S.turgDay && dayOf(S.turgDay); if (!day || !r.pts.length) return;
    const E = buildEffective(day), I = E.I, ord = I.order;
    const tpl = I.items.map(it => canonKey(it.name)), tset = new Set(tpl);
    const same = E.pts.map(p => p.okey).filter(k => tset.has(k)).join('|') === tpl.join('|');
    const bar = el('li', 'ordbar');
    if (ord && !same) {
      bar.append(el('span', 'otxt', 'Редът за ' + fmtDay(I.date) + ' е сменен' + (ord.by ? ' от ' + ord.by : '') + (ord.pending ? ' · записва се…' : '')));
      if (S.pin) {
        const a = el('button', 'obtn' + (tplArm > Date.now() ? ' arm' : ''), tplArm > Date.now() ? 'Сигурно? Запази' : 'За ' + everyDay(day.name)); a.type = 'button'; a.dataset.act = 'ordtpl';
        const b = el('button', 'obtn'); b.type = 'button'; b.dataset.act = 'ordreset'; b.innerHTML = ICON.undo + '<span>Върни</span>';
        bar.append(a, b);
      }
    } else if (S.pin && sortOf(r) === 'num') {
      const t = el('span', 'otxt hint'); t.innerHTML = 'Задръж ' + ICON.grip + ' и плъзни обекта, за да смениш реда на каране.'; bar.append(t);
    } else if (S.pin) bar.append(el('span', 'otxt hint', 'За смяна на реда избери „По номер“.'));
    else if (S.name && narEditors().has(S.name)) {
      // Ники/Тошко на телефон, където още не са въвели ПИН (напр. току-що инсталирано) – иначе не биха разбрали защо няма точки
      bar.append(el('span', 'otxt hint', 'Редът на каране се сменя с плъзгане – първо въведи ПИН кода си.'));
      const b = el('button', 'obtn'); b.type = 'button'; b.dataset.act = 'ordpin'; b.innerHTML = ICON.lock + '<span>Въведи ПИН</span>';
      bar.append(b);
    } else return;
    if (ord && !same && !S.pin && S.name && narEditors().has(S.name)) {
      const b = el('button', 'obtn'); b.type = 'button'; b.dataset.act = 'ordpin'; b.innerHTML = ICON.lock + '<span>Въведи ПИН</span>';
      bar.append(b);
    }
    ul.append(bar);
  }
  // кой е променял наряда (скриптът записва там само хора с валиден ПИН)
  const narEditors = () => new Set(((NAR && NAR.changes) || []).map(c => c.by).filter(Boolean));
  const everyDay = n => { n = normName(n); return (/^(сряда|събота|неделя)$/.test(n) ? 'всяка ' : 'всеки ') + n; };
  function scrollerOf(n) {
    for (let x = n.parentElement; x && x !== document.body; x = x.parentElement) {
      const o = getComputedStyle(x).overflowY; if ((o === 'auto' || o === 'scroll') && x.scrollHeight > x.clientHeight) return x;
    }
    return document.scrollingElement || document.documentElement;
  }
  $('#list').addEventListener('pointerdown', e => {
    const g = e.target.closest('.grip'); if (!g || drag || e.button > 0) return;
    const li = g.closest('li.row'), ul = $('#list'), rows = Array.from(ul.querySelectorAll('li.row'));
    if (!li || rows.length < 2) return;
    e.preventDefault();
    try { g.setPointerCapture(e.pointerId); } catch (err) {}
    const ur = ul.getBoundingClientRect();
    const geo = rows.map(x => { const b = x.getBoundingClientRect(); return { top: b.top - ur.top, h: b.height }; });
    const i0 = rows.indexOf(li);
    drag = { li, rows, geo, i0, idx: i0, pid: e.pointerId, y0: e.clientY - ur.top, y: e.clientY, sc: scrollerOf(ul), raf: 0, moved: false };
    li.classList.add('dragging'); ul.classList.add('sorting');
    if (navigator.vibrate) try { navigator.vibrate(12); } catch (err) {}
    dragLoop();
  });
  $('#list').addEventListener('pointermove', e => { if (drag && e.pointerId === drag.pid) { drag.y = e.clientY; e.preventDefault(); } });
  $('#list').addEventListener('pointerup', e => { if (drag && e.pointerId === drag.pid) dragEnd(true); });
  $('#list').addEventListener('pointercancel', e => { if (drag && e.pointerId === drag.pid) dragEnd(false); });
  $('#list').addEventListener('lostpointercapture', e => { if (drag && e.pointerId === drag.pid) dragEnd(true); });
  function dragPos() {
    const d = drag, ur = $('#list').getBoundingClientRect();
    const dy = (d.y - ur.top) - d.y0;    // движението в координатите на списъка (с превъртането)
    if (Math.abs(dy) > 4) d.moved = true;
    const me = d.geo[d.i0], step = me.h + 6, mid = me.top + me.h / 2 + dy;
    let idx = 0; d.geo.forEach((gm, i) => { if (i !== d.i0 && gm.top + gm.h / 2 < mid) idx++; });
    d.idx = idx;
    d.li.style.transform = 'translateY(' + dy + 'px)';
    d.rows.forEach((x, i) => {
      if (i === d.i0) return;
      const sh = d.i0 < idx && i > d.i0 && i <= idx ? -step : (d.i0 > idx && i >= idx && i < d.i0 ? step : 0);
      x.style.transform = sh ? 'translateY(' + sh + 'px)' : '';
    });
  }
  function dragLoop() {
    const d = drag; if (!d) return;
    const sc = d.sc, r = sc === document.scrollingElement || sc === document.documentElement ? { top: 0, bottom: innerHeight } : sc.getBoundingClientRect();
    const edge = Math.min(56, (r.bottom - r.top) * 0.13); let v = 0;   // до ръба – списъкът се превърта
    if (d.y < r.top + edge) v = -(r.top + edge - d.y) / 3; else if (d.y > r.bottom - edge) v = (d.y - (r.bottom - edge)) / 3;
    if (v && d.moved) sc.scrollTop += Math.max(-22, Math.min(22, v));
    dragPos();
    d.raf = requestAnimationFrame(dragLoop);
  }
  function dragEnd(ok) {
    const d = drag; if (!d) return;
    drag = null; cancelAnimationFrame(d.raf);
    $('#list').classList.remove('sorting');
    d.rows.forEach(x => { x.style.transform = ''; }); d.li.classList.remove('dragging');
    const moved = ok && d.moved && d.idx !== d.i0;
    if (moved) {
      const vis = d.rows.map(x => x.dataset.id), id = vis.splice(d.i0, 1)[0];
      vis.splice(d.idx, 0, id);
      if (reorderTurg(id, vis)) return;
    }
    if (moved || listDirty) { listDirty = false; renderList(); }
  }
  // видимият ред (може да е само „Остават“) → целият ред за деня
  function reorderTurg(id, vis) {
    const all = TURG.pts.map(p => p.id).filter(x => x !== id), k = vis.indexOf(id);
    if (k < vis.length - 1) all.splice(all.indexOf(vis[k + 1]), 0, id); else all.splice(all.indexOf(vis[k - 1]) + 1, 0, id);
    const date = dayDate(S.turgDay), name = ptById[id].st;
    listDirty = false;
    if (!narEnqueue({ a: 'order', date, names: all.map(x => ptById[x].st) })) { renderList(); return false; }
    const p = TURG.pts.find(x => x.okey === canonKey(name));
    toast(name + (p ? ' е №\u00a0' + p.n : '') + ' за ' + fmtDay(date) + '.');
    return true;
  }
  // „За всеки <ден>“: шаблонът (листът „Наряд <ден>“) взема новия ред; махнатите за датата остават до съседите си
  function saveTplOrder() {
    const day = dayOf(S.turgDay); if (!day) return;
    const old = tplItems(day).filter(it => !isCand(it)), nm = new Map(old.map(it => [canonKey(it.name), it.name]));
    const out = TURG.pts.map(p => p.okey).filter(k => nm.has(k));
    old.map(it => canonKey(it.name)).forEach((k, i, arr) => {
      if (out.includes(k)) return;
      let j = i - 1; while (j >= 0 && !out.includes(arr[j])) j--;
      out.splice(j < 0 ? 0 : out.indexOf(arr[j]) + 1, 0, k);
    });
    if (narEnqueue({ a: 'tpl', day: day.name, date: dayDate(day.name), names: out.map(k => nm.get(k)) })) toast('Редът е запазен за ' + everyDay(day.name) + '.');
  }
  function updateListDistances() {
    if (!S.pos) return;
    document.querySelectorAll('.row').forEach(li => {
      const p = ptById[li.dataset.id]; const d = li.querySelector('.d');
      if (p && d && p.ll) d.textContent = fmtDist(distM(S.pos, p));
    });
  }
  function refresh() {
    computeVisits();
    tnext = trkOn(cur()) ? trkNext(chainOf(cur())) : null;
    renderRoutes(); renderWho(); renderSync(); renderSummary(); renderCard(); renderFilters(); renderList(); updateMarkers(); drawTrack();
    const ch = chainOf(cur()), grp = chainRoutes(ch);
    $('#trkFoot').hidden = !ch;
    if (ch) $('#trkFoot').textContent = 'Линията на картата е приблизителният маршрут по ' + ch.src + '.' + (grp.length > 1 ? ' ' + grp.map(x => x.name).join(' и ') + ' се карат заедно – когато следващата точка е в другия наряд, приложението те прехвърля там.' : '') + ' Линията се скрива с бутона вдясно на картата.';
  }

  // ---------- actions ----------
  function select(id, fromList) {
    S.sel = id;
    refresh();
    if (id) {
      const p = ptById[id];
      if (fromList) {
        if (S.follow) setFollow(false);
        if (window.innerWidth < 900) setSheet('peek');
        else { const c = $('#card'), sh = $('#sheet'); if (c.getBoundingClientRect().top < sh.getBoundingClientRect().top) sh.scrollTo({ top: 0, behavior: 'smooth' }); }
        if (p.ll) map.setView([p.lat, p.lon], Math.max(map.getZoom(), 17), { animate: true });
      }
    }
  }
  function toggle(id) {
    const p = ptById[id]; if (!p) return;
    if (!S.name) { openWho(); toast('Първо изберете кой сте.'); return; }
    const done = V.has(id);
    enqueue({ a: done ? 'unmark' : 'mark', pid: id, route: p.routeName, n: p.n, st: p.st, at: Date.now(), by: S.name });
    if (!done) {
      if (navigator.vibrate) navigator.vibrate(35);
      if (S.sel === id) S.sel = null;
      refresh();
      if (tnext && p.route === S.route && tnext.p.route !== S.route) {
        const to = tnext.p;
        transferTo(to.route);
        toast(`Следващата точка е в ${to.routeName} – т. ${to.n}. Прехвърлих те там.`);
      }
    }
  }
  function setRoute(key, noFit) {
    if (!byKey[key] || key === S.route) return;
    S.route = key; S.sel = null; LS.set('obhod.route', key);
    if (key === 'turg') { applyTurg(); loadNariad(Date.now() - narLast > 30000); }
    buildMarkers(); refresh();
    if (!noFit) fitTo(cur().pts.filter(p => !V.has(p.id)).length ? cur().pts.filter(p => !V.has(p.id)) : cur().pts);
  }
  function setSheet(state) { $('#sheet').dataset.state = state; if (state !== 'full') $('#sheet').scrollTop = 0; $('#grab').setAttribute('aria-label', state === 'full' ? 'Скрий списъка' : 'Покажи списъка'); setTimeout(() => map.invalidateSize(), 260); }

  // navigation: ask once which app to use
  function openUrl(url) {
    const a = document.createElement('a'); setLink(a, url);
    document.body.append(a); a.click(); a.remove();
  }
  function openNavPicker(pending) {
    S.pendingNav = pending || null;
    const box = $('#navApps'); box.textContent = '';
    for (const k of navOrder()) {
      const app = NAV_APPS[k];
      const b = el('button', 'navapp'); b.type = 'button'; b.setAttribute('aria-pressed', String(S.navApp === k));
      b.append(el('b', null, app.name));
      const sub = (IS_HUAWEI && k === 'petal') ? 'Препоръчано за този телефон' : app.sub;
      if (sub) b.append(el('span', null, sub));
      b.addEventListener('click', () => chooseNav(k));
      box.append(b);
    }
    $('#navModal').hidden = false;
  }
  function chooseNav(k) {
    S.navApp = k; LS.set('obhod.nav', k); $('#navModal').hidden = true;
    const pend = S.pendingNav; S.pendingNav = null;
    refresh();
    if (pend === 'route') { const u = routeUrl(S.routeSeq); if (u) openUrl(u); }
    else if (pend && ptById[pend]) openUrl(navUrl(ptById[pend]));
    else toast('Навигация с ' + NAV_APPS[k].name + '.');
  }
  document.addEventListener('click', e => {
    const n = e.target.closest('[data-nav],#routeNext');
    if (n && !navApp()) { e.preventDefault(); openNavPicker(n.id === 'routeNext' ? 'route' : n.dataset.nav); }
  }, true);
  $('#navModal').addEventListener('click', e => { if (e.target.id === 'navModal') $('#navModal').hidden = true; });

  document.addEventListener('click', e => {
    const t = e.target.closest('[data-act],[data-route],[data-f],[data-s],[data-day]');
    if (!t) return;
    if (t.dataset.route) { setRoute(t.dataset.route); return; }
    if (t.dataset.day) { setDay(t.dataset.day); return; }
    if (t.dataset.f) { S.filter = t.dataset.f; LS.set('obhod.filter', S.filter); renderFilters(); renderList(); return; }
    if (t.dataset.s) {
      if (t.dataset.s === 'near' && !S.pos) { toast(S.geoErr === 'denied' ? 'Няма достъп до местоположението. Разрешете го от настройките на браузъра.' : 'Изчаквам местоположението…'); }
      S.sort = t.dataset.s; LS.set('obhod.sort', S.sort); renderFilters(); renderList(); return;
    }
    const act = t.dataset.act;
    if (act === 'toggle') toggle(t.dataset.id);
    else if (act === 'select') select(t.dataset.id, true);
    else if (act === 'unselect') select(null, false);
    else if (act === 'navchange') openNavPicker(null);
    else if (act === 'install') openInstall(true);
    else if (act === 'broken') openBroken(t.dataset.id);
    else if (act === 'xfer') transferTo(t.dataset.key);
    else if (act === 'naredit') requirePin(openNarEditor);
    else if (act === 'ordtpl') { if (tplArm > Date.now()) { tplArm = 0; saveTplOrder(); } else { tplArm = Date.now() + 4000; renderList(); setTimeout(() => { if (tplArm && tplArm <= Date.now()) { tplArm = 0; renderList(); } }, 4100); } }
    else if (act === 'ordpin') requirePin(() => { refresh(); toast('Готово – задръж точките вляво от обекта и го плъзни.'); });
    else if (act === 'ordreset') { if (narEnqueue({ a: 'order', date: dayDate(S.turgDay), names: [] })) toast('Редът за ' + fmtDay(dayDate(S.turgDay)) + ' е върнат по наряда.'); }
    else if (act === 'bins') openBins(t.dataset.id);
    else if (act === 'nariad') { narErr = false; loadNariad(true); renderSummary(); }
  });
  $('#routeSel').addEventListener('change', e => { setRoute(e.target.value); e.target.blur(); });
  $('#grab').addEventListener('click', () => setSheet($('#sheet').dataset.state === 'full' ? 'peek' : 'full'));
  $('#locBtn').addEventListener('click', () => {
    if (!S.pos) {
      toast(S.geoErr === 'denied' ? 'Няма достъп до местоположението. Разрешете го за този сайт от настройките на браузъра.' : 'Търся местоположението…');
      startGeo(); return;
    }
    // като в Google Maps: 1-во натискане – следва колата, 2-ро – навигация (картата се върти), 3-то – пак само следва
    if (!S.follow) { setFollow(true); toast('Картата следва колата. Натисни пак за навигация.'); }
    else if (!S.nav) { setNav(true); toast('Навигация: картата се върти по посоката на движение.'); }
    else { setNav(false); setFollow(true); toast('Картата следва колата (север е горе).'); }
  });
  $('#trkBtn').addEventListener('click', () => {
    S.trk = !S.trk; LS.set('obhod.trk', S.trk);
    refresh();
    toast(S.trk ? 'Маршрутът е показан.' : 'Маршрутът е скрит.');
  });
  $('#fitBtn').addEventListener('click', () => {
    if (S.follow) setFollow(false);
    const left = cur().pts.filter(p => !V.has(p.id));
    fitTo(left.length ? left : cur().pts, true);
  });

  // reset – нарядите, които се карат заедно, може да се изчистят наведнъж
  function resetGroup() { const g = chainRoutes(chainOf(cur())); return g.length > 1 ? g : [cur()]; }
  const doneIn = r => r.pts.filter(p => V.has(p.id)).length;
  function resetRoutes(list) {
    const at = Date.now();
    for (const r of list) {
      const pids = r.pts.map(p => p.id).filter(id => V.has(id));
      if (pids.length) enqueue({ a: 'reset', pids, route: r.name, at, by: S.name || '' });
    }
    S.buzzed = {};
    toast(list.map(r => r.name).join(' и ') + ': новият курс започна.');
  }
  $('#resetBtn').addEventListener('click', () => {
    const r = cur(), g = resetGroup(), n = doneIn(r), nAll = g.reduce((t, x) => t + doneIn(x), 0); if (!nAll) return;
    const multi = g.length > 1;
    $('#confirmTxt').textContent = multi
      ? `${g.map(x => x.name).join(' и ')} се карат заедно. Да изчистя ли отметките и на ${g.length === 2 ? 'двата' : 'всички'} наряда (${nAll})? Изчиства се за всички шофьори.`
      : `Да изчистя ли всички ${n} ${plural(n, 'отметка', 'отметки')} за ${r.name}? Изчиства се за всички шофьори.`;
    $('#confirmAll').hidden = !multi;
    $('#confirmYes').hidden = multi && !n;
    $('#confirmYes').textContent = multi ? 'Само ' + r.name : 'Изчисти';
    $('#confirmYes').className = multi ? 'btn danger' : 'btn solid-danger';
    $('#confirmModal').hidden = false; (multi ? $('#confirmAll') : $('#confirmYes')).focus();
  });
  $('#confirmNo').addEventListener('click', () => { $('#confirmModal').hidden = true; });
  $('#confirmYes').addEventListener('click', () => { $('#confirmModal').hidden = true; resetRoutes([cur()]); });
  $('#confirmAll').addEventListener('click', () => { $('#confirmModal').hidden = true; resetRoutes(resetGroup()); });

  // who
  function openWho() {
    const box = $('#names'); box.textContent = '';
    const list = (S.drivers && S.drivers.length ? S.drivers : (CFG.drivers || []));
    for (const n of list) {
      const b = el('button', null, n); b.type = 'button'; b.setAttribute('aria-pressed', String(n === S.name));
      b.addEventListener('click', () => setName(n)); box.append(b);
    }
    $('#otherName').value = list.indexOf(S.name) < 0 ? S.name : '';
    $('#whoModal').hidden = false;
  }
  function setName(n) {
    n = String(n || '').trim().slice(0, 60); if (!n) return;
    S.name = n; LS.set('obhod.name', n); $('#whoModal').hidden = true; refresh();
    toast('Здравей, ' + n + '!');
  }
  $('#whoBtn').addEventListener('click', openWho);
  $('#otherForm').addEventListener('submit', e => { e.preventDefault(); setName($('#otherName').value); });
  $('#whoModal').addEventListener('click', e => { if (e.target.id === 'whoModal' && S.name) $('#whoModal').hidden = true; });
  $('#confirmModal').addEventListener('click', e => { if (e.target.id === 'confirmModal') $('#confirmModal').hidden = true; });

  // ---------- сигнал за счупена кофа (известие отива само до собственика на таблицата) ----------
  let brokenFor = null;
  function openBroken(id) {
    const p = ptById[id]; if (!p) return;
    if (!S.name) { openWho(); toast('Първо изберете кой сте.'); return; }
    brokenFor = id;
    $('#brokenWhere').textContent = (p.kind === 'turg' ? p.st : 'т. ' + p.n + (p.st ? ' – ' + p.st : '')) + ' · ' + p.routeName;
    document.querySelectorAll('#brokenKinds .chip').forEach(c => c.setAttribute('aria-pressed', 'false'));
    $('#brokenNote').value = '';
    $('#brokenModal').hidden = false;
  }
  $('#brokenKinds').addEventListener('click', e => {
    const c = e.target.closest('.chip'); if (!c) return;
    c.setAttribute('aria-pressed', String(c.getAttribute('aria-pressed') !== 'true'));
  });
  $('#brokenNo').addEventListener('click', () => { $('#brokenModal').hidden = true; });
  $('#brokenModal').addEventListener('click', e => { if (e.target.id === 'brokenModal') $('#brokenModal').hidden = true; });
  $('#brokenYes').addEventListener('click', () => {
    const p = ptById[brokenFor]; if (!p) return;
    const kinds = Array.from(document.querySelectorAll('#brokenKinds .chip[aria-pressed="true"]')).map(c => c.dataset.k);
    const note = $('#brokenNote').value.trim().slice(0, 300);
    if (!kinds.length && !note) { toast('Изберете коя кофа е счупена или напишете бележка.'); return; }
    const r = { id: uid(), pid: p.id, route: p.routeName, n: p.n, st: p.st, kind: kinds.join(', '), note, lat: p.ll ? p.lat : null, lon: p.ll ? p.lon : null, at: Date.now(), by: S.name };
    $('#brokenModal').hidden = true;
    if (!API) { S.broken.set(p.id, r); toast('Таблицата не е свързана – сигналът остава само на този телефон.'); refresh(); return; }
    S.reports.push(r); LS.set('obhod.reports', S.reports);
    if (navigator.vibrate) navigator.vibrate(35);
    toast('Сигналът е изпратен – Ники ще получи известие.');
    refresh(); scheduleSync(50);
  });

  // ---------- наряд за деня: добавяне (по заявка, нов обект) и махане ----------
  function narEnqueue(op) {
    if (!S.name) { openWho(); toast('Първо изберете кой сте.'); return false; }
    const isList = op.a !== 'bins';   // добавяне, махане, ред – само с ПИН
    if (isList && !S.pin) { requirePin(() => renderNarEditor()); return false; }
    op.id = uid(); op.at = Date.now(); op.by = isList ? S.pin.who : S.name;
    S.narq.push(op); LS.set('obhod.narq', S.narq);
    if (API) scheduleSync(50);
    applyTurg(); refresh();
    return true;
  }
  let narEditDay = null;
  function openNarEditor() {
    if (!NAR || !S.turgDay) return;
    narEditDay = S.turgDay;
    $('#narSearch').value = '';
    renderNarEditor();
    $('#narModal').hidden = false;
  }
  const matches = (c, q) => normName(c.name).includes(q) || normName(c.alias || '').includes(q);
  function narRow(name, sub, btnTxt, cls, onClick, extra) {
    const li = el('div', 'nrow' + (cls ? ' ' + cls : ''));
    const t = el('div', 'ntxt'); t.append(el('div', 'nname', name)); if (sub) t.append(el('div', 'nsub', sub));
    li.append(t);
    if (extra) li.append(extra);
    const b = el('button', 'nbtn ' + (cls || '')); b.type = 'button'; b.innerHTML = btnTxt; b.addEventListener('click', onClick);
    li.append(b);
    return li;
  }
  function renderNarEditor() {
    const day = dayOf(narEditDay); if (!day) return;
    const I = dayInfo(day), body = $('#narBody'); body.textContent = '';
    const isToday = I.date === ymd(new Date(shiftStart(Date.now())));
    const count = I.items.length + I.added.length;
    $('#narTitle').textContent = 'Наряд ' + day.name.toLowerCase() + ', ' + fmtDay(I.date);
    $('#narSub').textContent = (isToday ? 'Днес · ' : '') + count + ' ' + plural(count, 'обект', 'обекта') + '. Промените са само за тази дата и ги виждат всички шофьори.';
    $('#narWho').textContent = S.pin ? 'Променя: ' + S.pin.who : '';
    const sec = (title, rows) => { if (!rows.length) return; body.append(el('div', 'grp', title)); rows.forEach(r => body.append(r)); };
    const add = (name, extra) => () => { if (narEnqueue(Object.assign({ a: 'add', date: I.date, name }, extra || {}))) { $('#narSearch').value = ''; renderNarEditor(); } };
    const del = name => () => { if (narEnqueue({ a: 'del', date: I.date, name })) renderNarEditor(); };
    const catSub = c => [c && c.req ? 'по заявка' : '', c && !c.ll ? 'без точка на картата' : ''].filter(Boolean).join(' · ');
    const PLUS = ICON.plus + '<span>Добави</span>', CROSS = ICON.cross + '<span>Махни</span>';
    const q = normName($('#narSearch').value);
    // в реда на обхода (добавените – там, където са вмъкнати)
    const inList = buildEffective(day).pts.map(p => ({ name: p.st, added: p.added || null, n: p.n }));
    if (q) {
      const found = NAR.catList.filter(c => !I.keys.has(canonKey(c.name)) && matches(c, q)).slice(0, 40);
      sec('Добави за ' + fmtDay(I.date), found.map(c => narRow(c.name, catSub(c), PLUS, 'add', add(c.name))));
      sec('В наряда', inList.filter(x => normName(x.name).includes(q)).map(x => narRow(x.name, x.added ? 'добавен' : '', CROSS, 'del', del(x.name))));
      const raw = $('#narSearch').value.trim();
      if (raw.length >= 3 && !NAR_CAT.has(normName(raw))) {
        const box = el('label', 'nhere');
        const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!S.pos; cb.disabled = !S.pos;
        box.append(cb, el('span', null, S.pos ? 'точката е тук, където съм' : 'без точка на картата (няма местоположение)'));
        const row = narRow('Нов обект: „' + raw + '“', 'добавя се за ' + fmtDay(I.date) + ' и в списъка с обекти (по заявка)', PLUS, 'add', () => {
          add(raw, Object.assign({ isNew: true }, cb.checked && S.pos ? { lat: +S.pos.lat.toFixed(6), lon: +S.pos.lon.toFixed(6) } : {}))();
        }, box);
        body.append(el('div', 'grp', 'Нов обект'), row);
      }
      if (!body.childNodes.length) body.append(el('p', 'muted', 'Няма такъв обект.'));
      return;
    }
    sec('По заявка за ' + day.name.toLowerCase(), I.cands.map(it => narRow(it.name, 'не е включен сам – добави го, ако има заявка', PLUS, 'add', add(it.name))));
    sec('В наряда · ' + count, inList.map(x => narRow(x.n + '. ' + x.name, x.added ? 'добавен' + (x.added.by ? ' от ' + x.added.by : '') : '', CROSS, 'del', del(x.name))));
    sec('Махнати · ' + I.removed.length, I.removed.map(x => narRow(x.name, 'махнат' + (x.ch && x.ch.by ? ' от ' + x.ch.by : ''), ICON.undo + '<span>Върни</span>', 'add', add(x.name))));
    body.append(el('p', 'muted', 'За друг обект или нов по заявка – напиши името горе. Редът на каране се сменя в списъка („По номер“) – задръж точките вляво от обекта и го плъзни.'));
  }
  $('#narSearch').addEventListener('input', renderNarEditor);
  $('#narOut').addEventListener('click', () => { setPin(null); $('#narModal').hidden = true; toast('Излязохте – нарядът се променя само с ПИН.'); });

  // ---------- ПИН: търговският наряд се променя само от хората с ПИН в „Настройки“ (Ники, Тошко) ----------
  function setPin(v) { S.pin = v; if (v) LS.set('obhod.pin', v); else { try { localStorage.removeItem('obhod.pin'); } catch (e) {} } refresh(); }
  let pinThen = null;
  function requirePin(then) {
    if (S.pin && S.pin.pin) { then(); return; }
    pinThen = then;
    $('#pinInput').value = ''; $('#pinMsg').hidden = true;
    $('#pinModal').hidden = false;
    setTimeout(() => $('#pinInput').focus(), 50);
  }
  function pinMsg(t, neutral) { const m = $('#pinMsg'); m.textContent = t; m.hidden = false; m.classList.toggle('neutral', !!neutral); }
  $('#pinForm').addEventListener('submit', async e => {
    e.preventDefault();
    const pin = $('#pinInput').value.trim();
    if (!pin) return;
    if (!API) { pinMsg('Таблицата не е свързана – ПИН кодът не може да се провери.'); return; }
    const btn = $('#pinForm button'); btn.disabled = true; pinMsg('Проверявам…', true);
    try {
      const res = await fetchJSON(API, { method: 'POST', body: JSON.stringify({ ops: [], checkPin: 1, pin }) });
      if (res && res.ok && res.pin && res.pin.ok) {
        $('#pinModal').hidden = true;
        setPin({ pin, who: res.pin.who });
        toast('Влязохте като ' + res.pin.who + ' – може да променяте наряда.');
        const t = pinThen; pinThen = null; if (t) t();
      } else if (res && res.ok && !res.pin) pinMsg('Скриптът в таблицата трябва да се обнови, за да работят ПИН кодовете.');
      else if (res && res.ok) { pinMsg('Грешен ПИН.'); $('#pinInput').select(); }
      else pinMsg('Таблицата не отговаря. Опитайте пак.');
    } catch (err) { pinMsg('Няма връзка с таблицата. Опитайте пак.'); }
    btn.disabled = false;
  });
  $('#pinNo').addEventListener('click', () => { $('#pinModal').hidden = true; pinThen = null; });
  $('#pinModal').addEventListener('click', e => { if (e.target.id === 'pinModal') { $('#pinModal').hidden = true; pinThen = null; } });
  $('#narClose').addEventListener('click', () => { $('#narModal').hidden = true; });
  $('#narModal').addEventListener('click', e => { if (e.target.id === 'narModal') $('#narModal').hidden = true; });

  // ---------- кофи на търговски обект (по подразбиране 1 синя + 1 жълта) ----------
  let binsFor = null, binsVal = { b: 1, y: 1 };
  function openBins(id) {
    const p = ptById[id]; if (!p) return;
    if (!S.name) { openWho(); toast('Първо изберете кой сте.'); return; }
    binsFor = p; binsVal = { b: p.b || 0, y: p.y || 0 };
    $('#binsWhere').textContent = p.st;
    renderBins(); $('#binsModal').hidden = false;
  }
  function renderBins() { $('#binsB').textContent = binsVal.b; $('#binsY').textContent = binsVal.y; }
  $('#binsModal').addEventListener('click', e => {
    if (e.target.id === 'binsModal') { $('#binsModal').hidden = true; return; }
    const b = e.target.closest('[data-k]'); if (!b) return;
    binsVal[b.dataset.k] = Math.max(0, Math.min(30, binsVal[b.dataset.k] + Number(b.dataset.d)));
    renderBins();
  });
  $('#binsNo').addEventListener('click', () => { $('#binsModal').hidden = true; });
  $('#binsYes').addEventListener('click', () => {
    $('#binsModal').hidden = true;
    if (!binsFor) return;
    const c = NAR_CAT.get(normName(binsFor.st));
    if (narEnqueue({ a: 'bins', name: c ? c.name : binsFor.st, b: binsVal.b, y: binsVal.y })) toast(binsFor.st + ': ' + contTxt({ kind: 'turg', b: binsVal.b, y: binsVal.y }) + '.');
  });

  // ---------- дневна / нощна карта (сменя се само картата) ----------
  const darkMQ = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  const isMapDark = () => { const t = document.documentElement.dataset.map; return t ? t === 'dark' : !!(darkMQ && darkMQ.matches); };
  const syncMapBtn = () => $('#themeBtn').setAttribute('aria-label', isMapDark() ? 'Дневна карта' : 'Нощна карта');
  $('#themeBtn').addEventListener('click', () => {
    const t = isMapDark() ? 'light' : 'dark';
    document.documentElement.dataset.map = t; LS.set('obhod.map', t); syncMapBtn();
    toast(t === 'dark' ? 'Нощна карта' : 'Дневна карта');
  });
  if (darkMQ && darkMQ.addEventListener) darkMQ.addEventListener('change', syncMapBtn);
  syncMapBtn();

  // ---------- инсталиране: при отваряне в браузъра приложението само предлага да се инсталира ----------
  const UA = navigator.userAgent || '';
  const IS_IOS = /iphone|ipad|ipod/i.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const IS_MOBILE = IS_IOS || /android|mobile|huawei|harmonyos/i.test(UA);
  const isStandalone = () => (window.matchMedia && (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches)) || navigator.standalone === true;
  // Браузърът на Samsung прави приложението по стар начин и Google Play Protect го блокира („Блокирано е небезопасно приложение“) –
  // там пращаме към Chrome, откъдето се инсталира нормално.
  const IS_SAMSUNG = !IS_IOS && /SamsungBrowser/i.test(UA);
  const chromeIntent = path => 'intent://' + location.host + path + '#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=' + encodeURIComponent('https://play.google.com/store/apps/details?id=com.android.chrome') + ';end';
  let installEvt = null, installShown = false, installTimer = 0;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    if (IS_SAMSUNG) { $('#installRow').hidden = false; return; }
    installEvt = e;
    $('#installRow').hidden = false;
    clearTimeout(installTimer); maybeAskInstall(false);
  });
  window.addEventListener('appinstalled', () => {
    installEvt = null; $('#installModal').hidden = true; $('#installRow').hidden = true;
    toast('Приложението е инсталирано – вече е на началния екран.');
  });
  function installSnoozed() { const t = LS.get('obhod.installNo', 0); return t && Date.now() - t < 24 * 3600e3; }
  function openInstall(manual) {
    const steps = $('#installSteps'); steps.textContent = '';
    let txt = '„Обход“ ще е на началния екран и ще се отваря на цял екран като обикновено приложение.';
    if (!installEvt) {
      const lines = IS_IOS
        ? ['Натиснете бутона „Сподели“ (квадратче със стрелка нагоре) в долната лента.', 'Изберете „Добави към началния екран“.', 'Натиснете „Добави“.']
        : ['Отворете менюто на браузъра (трите точки или чертички).', 'Изберете „Инсталирай приложението“ или „Добави към началния екран“.', 'Потвърдете.'];
      for (const l of lines) steps.append(el('li', null, l));
      txt = 'Така „Обход“ ще е на началния екран и ще се отваря на цял екран:';
    }
    if (IS_SAMSUNG) txt = 'В браузъра на Samsung телефонът спира инсталирането („Блокирано е небезопасно приложение“). Отворете „Обход“ в Chrome – оттам се инсталира с едно натискане.';
    $('#installTxt').textContent = txt;
    steps.hidden = !!installEvt || IS_SAMSUNG;
    $('#installYes').textContent = IS_SAMSUNG ? 'Отвори в Chrome' : (installEvt ? 'Инсталирай' : 'Разбрах');
    $('#installNo').hidden = !installEvt && !!manual && !IS_SAMSUNG;
    $('#installModal').hidden = false; installShown = true;
  }
  function maybeAskInstall(fallback) {
    if (installShown || isStandalone() || installSnoozed()) return;
    if (!$('#whoModal').hidden || !$('#navModal').hidden || !$('#confirmModal').hidden) { installTimer = setTimeout(() => maybeAskInstall(fallback), 1500); return; }
    if (installEvt) { openInstall(false); return; }
    if (!fallback || !IS_MOBILE) return;
    // без beforeinstallprompt (iPhone, някои браузъри): ако вече е инсталирано, не питаме
    const check = navigator.getInstalledRelatedApps ? navigator.getInstalledRelatedApps().catch(() => []) : Promise.resolve([]);
    check.then(apps => { if (!apps.length && !installShown && !installEvt) openInstall(false); });
  }
  $('#installYes').addEventListener('click', async () => {
    $('#installModal').hidden = true;
    if (IS_SAMSUNG) { location.href = chromeIntent(location.pathname.replace(/[^/]*$/, '') + 'install/'); return; }
    if (!installEvt) { LS.set('obhod.installNo', Date.now()); return; }
    const e = installEvt; installEvt = null;
    try { await e.prompt(); const r = await e.userChoice; if (r && r.outcome !== 'accepted') LS.set('obhod.installNo', Date.now()); } catch (err) {}
  });
  $('#installNo').addEventListener('click', () => { $('#installModal').hidden = true; LS.set('obhod.installNo', Date.now()); });
  $('#installModal').addEventListener('click', e => { if (e.target.id === 'installModal') { $('#installModal').hidden = true; LS.set('obhod.installNo', Date.now()); } });
  if (!isStandalone()) {
    if (IS_MOBILE) $('#installRow').hidden = false;
    installTimer = setTimeout(() => maybeAskInstall(true), 4000);
  }

  // ---------- start ----------
  if (TURG) {
    const cached = LS.get('obhod.nariad', null);
    if (cached && cached.tabs && (!SNAP || (Number(cached.at) || 0) >= (Number(SNAP.at) || 0))) setNariad(cached);
    if (!NAR) NAR = builtinNariad();
    applyTurg();
  }
  started = true;
  buildMarkers();
  refresh();
  setTimeout(() => { map.invalidateSize(); const left = cur().pts.filter(p => !V.has(p.id)); fitTo(left.length ? left : cur().pts); }, 60);
  window.addEventListener('resize', () => { if (S.nav) { navSize(true); navUpdate(true); } else map.invalidateSize(); });
  startGeo();
  keepAwake();
  if (API) { sync(); loadNariad(true); }
  if (!S.name) openWho();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    // Нова версия: проверява при всяко връщане в приложението и на 10 мин.; презарежда само, когато никой не пипа нищо.
    navigator.serviceWorker.register('sw.js').then(reg => {
      const check = () => { if (navigator.onLine !== false) reg.update().catch(() => {}); };
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
      setInterval(check, 10 * 60e3);
    }).catch(() => {});
    let hadCtrl = !!navigator.serviceWorker.controller, wantReload = false, lastTouch = 0;
    ['pointerdown', 'keydown', 'input'].forEach(ev => document.addEventListener(ev, () => { lastTouch = Date.now(); }, { passive: true, capture: true }));
    const safeReload = () => {
      if (!wantReload) return;
      const busy = drag || S.nav || Array.from(document.querySelectorAll('.modal')).some(m => !m.hidden) ||
        (document.visibilityState === 'visible' && Date.now() - lastTouch < 8000);
      if (busy) { setTimeout(safeReload, 4000); return; }
      wantReload = false; location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadCtrl) { hadCtrl = true; return; }   // първо инсталиране – няма какво да се обновява
      wantReload = true; safeReload();
    });
  }
  setInterval(() => {
    renderSync();
    if (!TURG || !NAR) return;
    // нова смяна: денят по подразбиране се сменя сам, ако шофьорът не е избрал друг
    if (S.turgDay !== chosenDay()) { applyTurg(); refresh(); }
    if (S.route === 'turg' && document.visibilityState === 'visible') loadNariad(false);
  }, 15000);
})();
