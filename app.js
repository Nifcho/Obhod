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
    off: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/></svg>',
    on: '<svg viewBox="0 0 24 24" aria-hidden="true" style="stroke-width:2.6"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    undo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/></svg>'
  };

  const byKey = {}, ptById = {};
  for (const r of ROUTES) {
    byKey[r.key] = r;
    r.ordered = [];
    r.groups.forEach(g => r.pts.filter(p => p.grp === g).forEach(p => r.ordered.push(p)));
    for (const p of r.pts) {
      p.route = r.key; p.routeName = r.name;
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
    drivers: LS.get('obhod.drivers', CFG.drivers || []),
    navApp: LS.get('obhod.nav', ''), routeSeq: [], pendingNav: null,
    sel: null, lastSync: 0, syncErr: false, pos: null, geoErr: null, follow: false, buzzed: {}
  };
  let V = new Map();
  const cur = () => byKey[S.route];

  // ---------- visits (server + pending) ----------
  function applyOp(m, op) {
    if (op.a === 'mark') { const c = m.get(op.pid); if (!c || c.at < op.at) m.set(op.pid, { at: op.at, by: op.by }); }
    else if (op.a === 'unmark') { const c = m.get(op.pid); if (c && c.at <= op.at) m.delete(op.pid); }
    else if (op.a === 'reset') { for (const pid of op.pids || []) { const c = m.get(pid); if (c && c.at <= op.at) m.delete(pid); } }
  }
  function computeVisits() { const m = new Map(S.server); for (const op of S.queue) applyOp(m, op); V = m; }
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
      if (S.queue.length) {
        const ops = S.queue.slice(0, 40);
        res = await fetchJSON(API, { method: 'POST', body: JSON.stringify({ ops }) });
        if (res && res.ok) {
          const done = new Set(res.applied && res.applied.length ? res.applied : ops.map(o => o.id));
          S.queue = S.queue.filter(o => !done.has(o.id));
          LS.set('obhod.queue', S.queue);
        }
      } else {
        res = await fetchJSON(API + (API.indexOf('?') >= 0 ? '&' : '?') + 'action=state&t=' + Date.now());
      }
      if (res && res.ok) {
        S.server = new Map((res.visits || []).filter(v => ptById[v.pid]).map(v => [v.pid, { at: Number(v.at), by: v.by || '' }]));
        saveServer();
        if (res.drivers && res.drivers.length) { S.drivers = res.drivers; LS.set('obhod.drivers', S.drivers); }
        S.lastSync = Date.now(); S.syncErr = false;
      } else { S.syncErr = true; }
    } catch (e) { S.syncErr = true; }
    syncing = false;
    refresh();
    scheduleSync(S.queue.length ? (S.syncErr ? 8000 : 1500) : (Number(CFG.pollSec) || 10) * 1000);
  }
  function scheduleSync(ms) {
    if (!API) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      if (document.visibilityState === 'visible' || S.queue.length) sync(); else scheduleSync(20000);
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
  function contTxt(p) {
    if (p.y == null && p.g == null) return 'бройката не се вижда';
    const a = [];
    if (p.y) a.push(p.y + ' ' + plural(p.y, 'жълт', 'жълти'));
    if (p.g) a.push(p.g + ' ' + plural(p.g, 'зелен', 'зелени'));
    return a.join(' + ');
  }
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function dotsEl(p) {
    const s = el('span', 'dots'); s.title = contTxt(p); s.setAttribute('aria-label', contTxt(p));
    if (p.y == null && p.g == null) { s.textContent = '?'; return s; }
    for (let i = 0; i < (p.y || 0); i++) s.append(el('i', 'dot y'));
    for (let i = 0; i < (p.g || 0); i++) s.append(el('i', 'dot g'));
    return s;
  }
  // ---------- navigation apps ----------
  const IS_HUAWEI = /huawei|honor|harmonyos|hmscore/i.test(navigator.userAgent || '');
  const NAV_APPS = {
    google: { name: 'Google Maps', sub: 'Може маршрут през няколко точки', url: p => `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${p.lat},${p.lon}` },
    waze: { name: 'Waze', sub: 'По една точка наведнъж', url: p => `https://waze.com/ul?ll=${p.lat},${p.lon}&navigate=yes` },
    petal: { name: 'Petal Maps', sub: 'Картите на Huawei, по една точка наведнъж', url: p => `https://www.petalmaps.com/navigation/?daddr=${p.lat},${p.lon}&type=drive&coordinateType=0&utm_source=obhod` },
    geo: { name: 'Друго приложение', sub: 'Телефонът пита с какво да отвори', url: p => `geo:${p.lat},${p.lon}?q=${p.lat},${p.lon}(${encodeURIComponent('Точка ' + p.n)})` }
  };
  const navOrder = () => IS_HUAWEI ? ['petal', 'waze', 'geo', 'google'] : ['google', 'waze', 'petal', 'geo'];
  const navApp = () => NAV_APPS[S.navApp] ? S.navApp : null;
  const navUrl = p => NAV_APPS[navApp() || 'google'].url(p);
  function routeUrl(list) {
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
  let nearInfo = null;

  function iconFor(p) {
    const d = V.has(p.id);
    const cls = ['pin', p.shape, d ? 'done' : '', S.sel === p.id ? 'sel' : '', (!d && nearInfo && nearInfo.p === p) ? 'near' : '', p.n.length > 3 ? 'n5' : (p.n.length > 2 ? 'n3' : '')].join(' ');
    return L.divIcon({ className: '', html: `<div class="pinbox"><div class="${cls}"><span>${p.n}</span></div></div>`, iconSize: [32, 32], iconAnchor: [16, 16] });
  }
  function buildMarkers() {
    markerLayer.clearLayers(); markers = {};
    for (const p of cur().pts) {
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
    if (!includeFar) { const near = pts.filter(p => !p.far); if (near.length) pts = near; }
    if (!pts.length) return;
    const b = L.latLngBounds(pts.map(p => [p.lat, p.lon]));
    if (S.pos && includeFar === 'withMe') b.extend([S.pos.lat, S.pos.lon]);
    map.fitBounds(b, { paddingTopLeft: [24, 64], paddingBottomRight: [70, window.innerWidth >= 900 ? 30 : 30], maxZoom: 17 });
  }
  map.on('dragstart', () => { if (S.follow) setFollow(false); });
  function zoomClass() { const z = map.getZoom(), c = map.getContainer(); c.classList.toggle('zlow', z < 15.5); c.classList.toggle('zmid', z >= 15.5 && z < 16.5); }
  map.on('zoomend', zoomClass); zoomClass();

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
    for (const p of cur().pts) { if (V.has(p.id)) continue; const d = distM(S.pos, p); if (d < bd) { bd = d; best = p; } }
    return best ? { p: best, d: bd } : null;
  }
  function renderRoutes() {
    const nav = $('#routes'); nav.textContent = '';
    for (const r of ROUTES) {
      const b = el('button'); b.type = 'button'; b.setAttribute('role', 'tab'); b.dataset.route = r.key;
      b.setAttribute('aria-selected', String(r.key === S.route));
      b.append(r.name);
      const left = r.pts.filter(p => !V.has(p.id)).length;
      const s = el('span', 'left', String(left)); s.title = 'остават'; b.append(s);
      nav.append(b);
    }
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
    $('#resetBtn').disabled = !done;
    // route through next remaining points: nearest-first from my position, else by number
    const left = r.ordered.filter(p => !V.has(p.id));
    let seq = [];
    if (S.pos && left.length) {
      let here = S.pos; const pool = left.slice();
      while (seq.length < 4 && pool.length) {
        let bi = 0, bd = Infinity; pool.forEach((p, i) => { const d = distM(here, p); if (d < bd) { bd = d; bi = i; } });
        here = pool[bi]; seq.push(pool.splice(bi, 1)[0]);
      }
    } else seq = left.slice(0, 4);
    S.routeSeq = seq;
    const a = $('#routeNext'), u = routeUrl(seq);
    const multi = seq.length > 1 && (!navApp() || navApp() === 'google');
    if (u) { setLink(a, u); a.removeAttribute('aria-disabled'); $('#routeTxt').textContent = multi ? `Маршрут: следващите ${seq.length}` : `Навигация до т. ${seq[0].n}`; }
    else { a.removeAttribute('href'); a.setAttribute('aria-disabled', 'true'); $('#routeTxt').textContent = 'Всички са минати'; }
    $('#navName').textContent = navApp() ? NAV_APPS[navApp()].name : 'не е избрано';
  }
  function subEl(p, withGroup, noDist) {
    const sub = el('span', 'sub');
    sub.append(dotsEl(p));
    if (withGroup) sub.append(el('span', null, p.grp));
    const v = V.get(p.id);
    if (v) sub.append(el('span', 'when', 'Минато ' + fmtWhen(v.at) + (v.by ? ' · ' + (v.by === S.name ? 'ти' : v.by) : '')));
    else if (S.pos && !noDist) sub.append(el('span', 'd', fmtDist(distM(S.pos, p))));
    return sub;
  }
  function renderCard() {
    const card = $('#card'); card.textContent = '';
    const r = cur();
    nearInfo = nearestRemaining();
    let p = null, label = '', d = null, selected = false;
    if (S.sel && ptById[S.sel] && ptById[S.sel].route === S.route) { p = ptById[S.sel]; label = 'Избрана точка'; selected = true; }
    else if (nearInfo) { p = nearInfo.p; label = 'Най-близо'; }
    else { p = r.ordered.find(q => !V.has(q.id)) || null; label = 'Следваща'; }
    if (!p) {
      card.className = 'card';
      card.append(el('div', 'empty-card', 'Всички точки в маршрута са минати. Натиснете „Нов курс“ преди следващия обход.'));
      return;
    }
    if (S.pos) d = distM(S.pos, p);
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
    const acts = el('div', 'acts');
    const tg = el('button', 'btn' + (done ? '' : ' primary')); tg.type = 'button'; tg.dataset.act = 'toggle'; tg.dataset.id = p.id;
    tg.innerHTML = (done ? ICON.undo : ICON.on) + '<span></span>'; tg.lastChild.textContent = done ? 'Върни' : 'Минах';
    const nv = el('a', 'btn'); setLink(nv, navUrl(p)); nv.dataset.nav = p.id; nv.innerHTML = ICON.nav + '<span>Навигация</span>';
    acts.append(tg, nv); card.append(acts);
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
    document.querySelectorAll('[data-s]').forEach(c => c.setAttribute('aria-pressed', String(c.dataset.s === S.sort)));
  }
  function renderList() {
    const r = cur(), ul = $('#list'); ul.textContent = '';
    let pts = r.ordered;
    if (S.filter === 'left') pts = pts.filter(p => !V.has(p.id));
    if (S.filter === 'done') pts = pts.filter(p => V.has(p.id));
    if (!pts.length) {
      ul.append(el('li', 'empty', S.filter === 'left' ? 'Всички точки са минати.' : (S.filter === 'done' ? 'Още няма минати точки.' : 'Няма точки.')));
      return;
    }
    const multi = r.groups.length > 1;
    if (S.sort === 'near' && S.pos) {
      pts.slice().sort((a, b) => distM(S.pos, a) - distM(S.pos, b)).forEach(p => ul.append(rowEl(p, multi)));
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
      if (p && d) d.textContent = fmtDist(distM(S.pos, p));
    });
  }
  function refresh() {
    computeVisits();
    renderRoutes(); renderWho(); renderSync(); renderSummary(); renderCard(); renderFilters(); renderList(); updateMarkers();
  }

  // ---------- actions ----------
  function select(id, fromList) {
    S.sel = id;
    refresh();
    if (id) {
      const p = ptById[id];
      if (fromList) {
        if (window.innerWidth < 900) setSheet('peek');
        map.setView([p.lat, p.lon], Math.max(map.getZoom(), 17), { animate: true });
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
    }
  }
  function setRoute(key) {
    if (!byKey[key] || key === S.route) return;
    S.route = key; S.sel = null; LS.set('obhod.route', key);
    buildMarkers(); refresh(); fitTo(cur().pts.filter(p => !V.has(p.id)).length ? cur().pts.filter(p => !V.has(p.id)) : cur().pts);
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
    const t = e.target.closest('[data-act],[data-route],[data-f],[data-s]');
    if (!t) return;
    if (t.dataset.route) { setRoute(t.dataset.route); return; }
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
  });
  $('#grab').addEventListener('click', () => setSheet($('#sheet').dataset.state === 'full' ? 'peek' : 'full'));
  $('#locBtn').addEventListener('click', () => {
    if (!S.pos) {
      toast(S.geoErr === 'denied' ? 'Няма достъп до местоположението. Разрешете го за този сайт от настройките на браузъра.' : 'Търся местоположението…');
      startGeo(); return;
    }
    setFollow(!S.follow);
    if (S.follow) toast('Картата следва колата.');
  });
  $('#fitBtn').addEventListener('click', () => {
    const left = cur().pts.filter(p => !V.has(p.id));
    fitTo(left.length ? left : cur().pts, true);
    if (S.follow) setFollow(false);
  });

  // reset
  $('#resetBtn').addEventListener('click', () => {
    const r = cur(), n = r.pts.filter(p => V.has(p.id)).length; if (!n) return;
    $('#confirmTxt').textContent = `Да изчистя ли всички ${n} ${plural(n, 'отметка', 'отметки')} за ${r.name}? Изчиства се за всички шофьори.`;
    $('#confirmModal').hidden = false; $('#confirmYes').focus();
  });
  $('#confirmNo').addEventListener('click', () => { $('#confirmModal').hidden = true; });
  $('#confirmYes').addEventListener('click', () => {
    $('#confirmModal').hidden = true;
    const r = cur(); const pids = r.pts.map(p => p.id).filter(id => V.has(id));
    enqueue({ a: 'reset', pids, route: r.name, at: Date.now(), by: S.name || '' });
    S.buzzed = {};
    toast(`${r.name}: новият курс започна.`);
  });

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

  // ---------- start ----------
  buildMarkers();
  refresh();
  setTimeout(() => { map.invalidateSize(); const left = cur().pts.filter(p => !V.has(p.id)); fitTo(left.length ? left : cur().pts); }, 60);
  window.addEventListener('resize', () => map.invalidateSize());
  startGeo();
  keepAwake();
  if (API) sync();
  if (!S.name) openWho();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded && navigator.serviceWorker.controller) { reloaded = true; } });
  }
  setInterval(() => { renderSync(); }, 15000);
})();
