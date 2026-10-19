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
    xfer: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h14M13 6l6 6-6 6"/></svg>',
    undo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/></svg>'
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
      if (S.queue.length || S.reports.length) {
        const ops = S.queue.slice(0, 40), reports = S.reports.slice(0, 10);
        res = await fetchJSON(API, { method: 'POST', body: JSON.stringify(reports.length ? { ops, reports } : { ops }) });
        if (res && res.ok) {
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
    scheduleSync(S.queue.length ? (S.syncErr ? 8000 : 1500) : (S.reports.length && !S.reportsOld && !S.syncErr ? 3000 : (Number(CFG.pollSec) || 10) * 1000));
  }
  function scheduleSync(ms) {
    if (!API) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      if (document.visibilityState === 'visible' || S.queue.length || S.reports.length) sync(); else scheduleSync(20000);
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
    if (p.y == null && p.g == null) return 'бройката не се вижда';
    const a = [];
    if (p.y) a.push(p.y + ' ' + plural(p.y, 'жълт', 'жълти'));
    if (p.g) a.push(p.g + ' ' + plural(p.g, 'зелен', 'зелени'));
    return a.join(' + ');
  }
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function dotsEl(p) {
    if (p.y == null && p.g == null && p.kind) return null;   // търговски и маршрутите без бройки
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
        : /адрес/.test(h) ? 'addr' : /телефон/.test(h) ? 'ph' : /етикет/.test(h) ? 'tag' : /бележк/.test(h) ? 'note' : '';
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
      out.push({ name, ll, addr: g('addr'), ph: g('ph'), tag: g('tag'), note: g('note'), alias: g('alias') });
    }
    return out;
  }
  function buildDay(items, cat) {
    const pts = [], seen = {};
    items.forEach((it, i) => {
      const c = cat.get(normName(it.name)) || null;
      let id = slugId(c ? c.name : it.name);
      if (seen[id]) { seen[id]++; id += '-' + seen[id]; } else seen[id] = 1;
      const p = { id, n: String(i + 1), st: it.name, y: null, g: null, grp: 'Търговски' };
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
  function parseNariad(raw) {
    let catRows = []; const tabs = [];
    for (const t of (raw && raw.tabs) || []) {
      const nm = String(t.name || '').trim();
      if (normName(nm) === 'търговски обекти') catRows = parseTable(t.values);
      else if (/^наряд/i.test(nm)) tabs.push({ name: nm.replace(/^наряд[\s:–\-]*/i, '').trim() || nm, items: parseTable(t.values) });
    }
    const cat = new Map();
    for (const r of catRows) { const k = normName(r.name); if (k && !cat.has(k)) cat.set(k, r); }
    for (const r of catRows) for (const a of (r.alias || '').split(/[;\n]+/)) { const k = normName(a); if (k && !cat.has(k)) cat.set(k, r); }
    return { src: 'sheet', at: Number(raw.at) || Date.now(), days: withWeek(tabs.map(t => ({ name: t.name, pts: buildDay(t.items, cat) }))) };
  }
  // Винаги се показват всички дни от седмицата; листовете от таблицата ги попълват.
  const WEEK_ORDER = ['понеделник', 'вторник', 'сряда', 'четвъртък', 'петък', 'събота', 'неделя'];
  function withWeek(days) {
    const out = WEEK_ORDER.map(wd => days.find(x => normName(x.name) === wd) || { name: wd[0].toUpperCase() + wd.slice(1), pts: [] });
    for (const d of days) if (out.indexOf(d) < 0) out.push(d);
    return out;
  }
  let NAR = null, narSig = '', narBusy = false, narLast = 0, narErr = false, started = false;
  // Запис на листовете, вграден в data.js – ползва се, докато таблицата не е достъпна (или скриптът не е обновен).
  const SNAP = window.NARIAD_SNAPSHOT && window.NARIAD_SNAPSHOT.tabs ? window.NARIAD_SNAPSHOT : null;
  function builtinNariad() {
    if (SNAP) { const n = parseNariad(SNAP); n.src = 'snapshot'; n.at = Number(SNAP.at) || 0; return n; }
    return { src: 'builtin', at: 0, days: withWeek(TURG_BUILTIN.length ? [{ name: 'Сряда', pts: TURG_BUILTIN }] : []) };
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
    const day = dayOf(S.turgDay), pts = day ? day.pts : [];
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
    const icon = L.divIcon({ className: '', html: `<div class="trkflag">${txt}</div>`, iconSize: [0, 0], iconAnchor: [0, 0] });
    L.marker([p.lat, p.lon], { icon, interactive: false, keyboard: false, zIndexOffset: 900 }).addTo(trkLayer);
  }
  // точка от другия наряд, към/от която води маршрутът – натискане прехвърля там
  function trkXfer(q, out) {
    const lbl = (out ? '→ ' : '') + q.routeName + ' ' + q.n + (out ? '' : ' →');
    const icon = L.divIcon({ className: '', html: `<div class="trkxfer${out ? ' out' : ''}"><i></i><span></span></div>`, iconSize: [0, 0], iconAnchor: [0, 0] });
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
    S.follow = on;
    if (on && S.pos) map.setView([S.pos.lat, S.pos.lon], Math.max(map.getZoom(), 17), { animate: true });
    renderLocBtn();
  }
  function renderLocBtn() {
    const b = $('#locBtn');
    b.dataset.state = S.follow ? 'follow' : (S.pos ? 'on' : 'off');
    b.setAttribute('aria-label', S.follow ? 'Спри следването' : 'Следвай моето местоположение');
  }
  function drawMe() {
    if (!S.pos) return;
    const ll = [S.pos.lat, S.pos.lon];
    const moving = S.pos.heading != null && !isNaN(S.pos.heading) && (S.pos.speed || 0) > 1;
    const html = `<div class="me">${moving ? `<i class="dir" style="transform:rotate(${Math.round(S.pos.heading)}deg)"></i>` : ''}</div>`;
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
    if (S.follow) map.panTo([S.pos.lat, S.pos.lon], { animate: true });
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
    const yt = r.pts.reduce((s, p) => s + (p.y || 0), 0), yl = r.pts.filter(p => !V.has(p.id)).reduce((s, p) => s + (p.y || 0), 0);
    $('#yelTot').textContent = yt; $('#yelLeft').textContent = yl;
    const hasY = r.pts.some(p => p.y != null);
    $('.yel').hidden = !hasY;
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
    const txt = el('span', 'daytxt', warn ? 'Не е днешният ден' : (name ? 'Наряд ' + name.toLowerCase() : 'Няма наряд'));
    const st = el('button', 'stamp'); st.type = 'button'; st.dataset.act = 'nariad';
    st.title = 'Обнови наряда от таблицата';
    if (!API) st.hidden = true;
    else if (NAR.src === 'snapshot') st.textContent = '↻ запис ' + fmtWhen(NAR.at);
    else if (NAR.src !== 'sheet') st.textContent = narBusy ? '↻ …' : '↻ вграден';
    else st.textContent = (narErr === true ? '↻ без връзка ' : '↻ ') + fmtWhen(NAR.at);
    lbl.textContent = ''; lbl.append(txt, st);
    lbl.classList.toggle('warn', warn);
  }
  function subEl(p, withGroup, noDist) {
    const sub = el('span', 'sub');
    const dt = dotsEl(p); if (dt) sub.append(dt);
    if (withGroup) sub.append(el('span', null, p.grp));
    if (p.tag) sub.append(el('span', 'tag', p.tag));
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
    rb.innerHTML = ICON.warn + '<span>Счупена кофа</span>'; card.append(rb);
  }
  function rowEl(p, withGroup) {
    const li = el('li', 'row ' + p.shape + (V.has(p.id) ? ' done' : '') + (S.sel === p.id ? ' sel' : '')); li.dataset.id = p.id;
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
    const r = cur(), ul = $('#list'); ul.textContent = '';
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
    for (const g of r.groups) {
      const gp = pts.filter(p => p.grp === g); if (!gp.length) continue;
      if (multi) ul.append(el('li', 'grp', g + ' · ' + gp.length));
      gp.forEach(p => ul.append(rowEl(p, false)));
    }
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
    if (ch) $('#trkFoot').textContent = 'Лилавата линия е приблизителният маршрут по ' + ch.src + '.' + (grp.length > 1 ? ' ' + grp.map(x => x.name).join(' и ') + ' се карат заедно – когато следващата точка е в другия наряд, приложението те прехвърля там.' : '') + ' Линията се скрива с бутона вдясно на картата.';
  }

  // ---------- actions ----------
  function select(id, fromList) {
    S.sel = id;
    refresh();
    if (id) {
      const p = ptById[id];
      if (fromList) {
        if (window.innerWidth < 900) setSheet('peek');
        if (p.ll) map.setView([p.lat, p.lon], Math.max(map.getZoom(), 17), { animate: true });
        if (S.follow) setFollow(false);
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
  function setSheet(state) { $('#sheet').dataset.state = state; $('#grab').setAttribute('aria-label', state === 'full' ? 'Скрий списъка' : 'Покажи списъка'); setTimeout(() => map.invalidateSize(), 260); }

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
    else if (act === 'nariad') { narErr = false; loadNariad(true); renderSummary(); }
  });
  $('#routeSel').addEventListener('change', e => { setRoute(e.target.value); e.target.blur(); });
  $('#grab').addEventListener('click', () => setSheet($('#sheet').dataset.state === 'full' ? 'peek' : 'full'));
  $('#locBtn').addEventListener('click', () => {
    if (!S.pos) {
      toast(S.geoErr === 'denied' ? 'Няма достъп до местоположението. Разрешете го за този сайт от настройките на браузъра.' : 'Търся местоположението…');
      startGeo(); return;
    }
    setFollow(!S.follow);
    if (S.follow) toast('Картата следва колата.');
  });
  $('#trkBtn').addEventListener('click', () => {
    S.trk = !S.trk; LS.set('obhod.trk', S.trk);
    refresh();
    toast(S.trk ? 'Маршрутът е показан.' : 'Маршрутът е скрит.');
  });
  $('#fitBtn').addEventListener('click', () => {
    const left = cur().pts.filter(p => !V.has(p.id));
    fitTo(left.length ? left : cur().pts, true);
    if (S.follow) setFollow(false);
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
  let installEvt = null, installShown = false, installTimer = 0;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); installEvt = e;
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
    $('#installTxt').textContent = txt;
    steps.hidden = !!installEvt;
    $('#installYes').textContent = installEvt ? 'Инсталирай' : 'Разбрах';
    $('#installNo').hidden = !installEvt && !!manual;
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
  window.addEventListener('resize', () => map.invalidateSize());
  startGeo();
  keepAwake();
  if (API) { sync(); loadNariad(true); }
  if (!S.name) openWho();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded && navigator.serviceWorker.controller) { reloaded = true; } });
  }
  setInterval(() => {
    renderSync();
    if (!TURG || !NAR) return;
    // нова смяна: денят по подразбиране се сменя сам, ако шофьорът не е избрал друг
    if (S.turgDay !== chosenDay()) { applyTurg(); refresh(); }
    if (S.route === 'turg' && document.visibilityState === 'visible') loadNariad(false);
  }, 15000);
})();
