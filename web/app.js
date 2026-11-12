'use strict';

const FACES = [
  { value: 2, name: 'verde' },
  { value: 1, name: 'amarillo' },
  { value: 0, name: 'rojo' },
];

// Luces del semáforo con cara: feliz, neutra y enfadada
const LIGHT_SVG = {
  2: '<svg viewBox="0 0 100 100" aria-hidden="true"><circle class="bg" cx="50" cy="50" r="46"/><circle class="f" cx="35" cy="40" r="7"/><circle class="f" cx="65" cy="40" r="7"/><path class="f" d="M31 58 Q50 78 69 58" fill="none" stroke-width="8" stroke-linecap="round"/></svg>',
  1: '<svg viewBox="0 0 100 100" aria-hidden="true"><circle class="bg" cx="50" cy="50" r="46"/><circle class="f" cx="35" cy="40" r="7"/><circle class="f" cx="65" cy="40" r="7"/><path class="f" d="M33 66 L67 66" fill="none" stroke-width="8" stroke-linecap="round"/></svg>',
  0: '<svg viewBox="0 0 100 100" aria-hidden="true"><circle class="bg" cx="50" cy="50" r="46"/><circle class="f" cx="35" cy="42" r="7"/><circle class="f" cx="65" cy="42" r="7"/><path class="f" d="M31 72 Q50 52 69 72" fill="none" stroke-width="8" stroke-linecap="round"/></svg>',
};

// Iconos de línea (nada de emoticonos)
const ICONS = {
  camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8a2 2 0 0 1 2-2h2l2-2h6l2 2h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20l4.5-1L20 7.5a2.1 2.1 0 0 0-3-3L5.5 16z"/><path d="M13.5 6.5l4 4"/></svg>',
  swap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 8h10l-3-3M17 16H7l3 3"/></svg>',
};

function icon(name) {
  const s = node('span', 'ic');
  s.innerHTML = ICONS[name] || '';
  return s;
}

let state = null;
let view = 'hoy';
let histMonth = null; // {y, m} con m de 1 a 12
let monthData = { records: [], extras: [] };
let pin = localStorage.getItem('caritas_pin') || '';
let pendingFn = null;
let ajustesDirty = false;
let modalDay = null; // {date} del editor de día abierto

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const app = $('#app');
const modal = $('#modal');
const modalBox = $('#modal-box');

function node(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

// ---------- API y PIN ----------

function api(path, body, method) {
  return fetch(path, {
    method: method || 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin, ...body }),
  }).then((res) => {
    if (res.status === 403) {
      pin = '';
      localStorage.removeItem('caritas_pin');
      const e = new Error('pin');
      e.isPin = true;
      throw e;
    }
    return res.json().catch(() => ({})).then((data) => {
      if (!res.ok) throw new Error(data.error || 'Error del servidor');
      return data;
    });
  });
}

function withPin(fn) {
  const attempt = () => fn().catch((e) => {
    if (e && e.isPin) { pendingFn = attempt; askPin('PIN incorrecto'); }
    else if (e && e.message !== 'pin') alert(e.message || 'Error');
  });
  // con el PIN desactivado en Ajustes se pasa directo
  if (pin || (state && state.pinEnabled === false)) return attempt();
  pendingFn = attempt;
  askPin();
}

function askPin(msg) {
  modalDay = null;
  modalBox.textContent = '';
  if (msg) modalBox.append(node('p', 'pin-error', msg));
  modalBox.append(node('h2', '', 'PIN para poder marcar'));
  const input = node('input', 'pin-input');
  input.type = 'password';
  input.inputMode = 'numeric';
  input.placeholder = 'PIN';
  const btn = node('button', 'btn primary', 'Entrar');
  const submit = () => {
    pin = input.value.trim();
    if (!pin) return;
    localStorage.setItem('caritas_pin', pin);
    closeModal();
    const f = pendingFn;
    pendingFn = null;
    if (f) f();
  };
  btn.onclick = submit;
  input.onkeydown = (e) => { if (e.key === 'Enter') submit(); };
  modalBox.append(input, btn);
  modal.classList.remove('hidden');
  input.focus();
}

function closeModal() {
  modal.classList.add('hidden');
  modalDay = null;
  modalBox.textContent = '';
}
modal.onclick = (e) => { if (e.target === modal) closeModal(); };

// ---------- Datos ----------

const recordFor = (kidId, catId, date) =>
  state.records.concat(monthData.records).find((r) => r.kid_id === kidId && r.category_id === catId && r.date === date);

function weekPoints(kidId) {
  let sum = 0;
  for (const r of state.records) if (r.kid_id === kidId) sum += state.points[r.value] || 0;
  for (const e of state.extras || []) if (e.kid_id === kidId) sum += e.pts || 0;
  return sum;
}

const monthOf = (today) => {
  const [y, m] = today.split('-').map(Number);
  return { y, m };
};

// Confeti: partículas que salen de la cara verde al marcarla
const CONFETTI_COLORS = ['#45D183', '#F5C34B', '#F1634C', '#F2EBDB', '#E7B75F'];

function confettiAt(x, y) {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (let i = 0; i < 24; i++) {
    const p = document.createElement('span');
    p.className = 'confetti';
    const size = 5 + Math.random() * 6;
    p.style.width = size + 'px';
    p.style.height = (i % 3 === 0 ? size * .5 : size) + 'px';
    p.style.left = x + 'px';
    p.style.top = y + 'px';
    p.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    p.style.borderRadius = i % 2 ? '50%' : '2px';
    document.body.appendChild(p);
    const angle = Math.random() * Math.PI * 2;
    const dist = 50 + Math.random() * 90;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist - 50; // sesgo hacia arriba
    const rot = Math.round(Math.random() * 720 - 360);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        p.style.transform = 'translate(' + dx + 'px,' + dy + 'px) rotate(' + rot + 'deg)';
        p.style.opacity = '0';
      });
    });
    setTimeout(() => { if (p.parentNode) p.parentNode.removeChild(p); }, 950);
  }
}

// La cara roja sacude el panel del peque (o el editor de día abierto)
function shakeKidPanel(kidId) {
  const target = modalDay ? modalBox : document.querySelector('.kid[data-kid="' + kidId + '"]');
  if (!target) return;
  target.classList.add('shake');
  setTimeout(() => target.classList.remove('shake'), 550);
}

// Reduce una foto a JPEG de 512px antes de subirla
function shrink(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const max = 512;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * scale));
      c.height = Math.max(1, Math.round(img.height * scale));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen')); };
    img.src = url;
  });
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const p2 = (n) => (n < 10 ? '0' + n : String(n));
const monthLabel = ({ y, m }) =>
  cap(new Date(y, m - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }));
const dayLabel = (date) =>
  cap(new Date(date + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }));

function loadMonth() {
  const { y, m } = histMonth;
  const from = `${y}-${p2(m)}-01`;
  const to = `${y}-${p2(m)}-${new Date(y, m, 0).getDate()}`;
  fetch(`/api/history?from=${from}&to=${to}`)
    .then((r) => r.json())
    .then((data) => {
      monthData = { records: data.records, extras: data.extras || [] };
      if (view === 'hist') renderHist();
      if (modalDay) openDay(modalDay.date, modalDay.kidId);
    })
    .catch((e) => { /* sin conexión: se reintenta en el siguiente evento */ });
}

// ---------- Render ----------

// antirrebote: el mando de la tele a veces dispara el clic dos veces y
// el segundo caía sobre la cara ya repintada, volviéndola a marcar
const tapTimes = {};
function tapOk(key) {
  const now = Date.now();
  if (now - (tapTimes[key] || 0) < 700) return false;
  tapTimes[key] = now;
  return true;
}

// aplica el tema guardado en Ajustes a toda la página
function applyTheme() {
  if (!state) return;
  const claro = state.tema === 'claro';
  document.documentElement.classList.toggle('tema-claro', claro);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = claro ? '#F3F1EA' : '#141519';
}

let lastRenderKey = '';

function render(force) {
  applyTheme();
  if (!state || !state.kids.length) return;
  const json = view + '|' + JSON.stringify([state.kids, state.categories, state.records, state.extras, state.points, state.rewards, state.pinEnabled]);
  if (!force && json === lastRenderKey) return; // nada cambió: no repintar (evita parpadeos)
  if (view === 'ajustes' && ajustesDirty) return; // no reconstruir el formulario mientras se edita
  lastRenderKey = json;
  if (view === 'hoy') renderHoy();
  else if (view === 'hist') renderHist();
  else if (view === 'graf') renderGraf();
  else if (view === 'ajustes') renderAjustes();
}

function renderHoy() {
  app.textContent = '';
  app.append(node('p', 'today', dayLabel(state.today)));
  const grid = node('div', 'kids');
  state.kids.forEach((kid) => grid.append(kidCard(kid, state.today)));
  app.append(grid);
}

function kidCard(kid, date) {
  const card = node('div', 'kid');
  card.dataset.kid = kid.id;
  const pts = weekPoints(kid.id);
  const head = node('div', 'kid-head');
  if (kid.photo) {
    const img = node('img', 'avatar');
    img.src = '/' + kid.photo;
    img.alt = '';
    head.append(img);
  } else {
    head.append(node('span', 'avatar ph', kid.name.charAt(0)));
  }
  const idBox = node('div', 'kid-id');
  idBox.append(node('h2', '', kid.name));
  const lamps = node('div', 'week-lamps');
  const maxInPlay = state.categories.length * (state.points[2] || 0);
  for (let i = 0; i < 7; i++) {
    const d = new Date(state.week.from + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + i);
    const dstr = d.toISOString().slice(0, 10);
    const marked = state.records.filter((r) => r.kid_id === kid.id && r.date === dstr && r.value !== null);
    let cls = 'dayl';
    // bombilla por puntos del día frente a los que había en juego:
    // verde ≥ 85% del máximo, amarillo ≥ 40%, rojo por debajo (15 en juego: 13-15 / 6-12 / <6).
    // solo se colorea el día completo; los extras suman aunque no estén "en juego"
    if (marked.length === state.categories.length && maxInPlay > 0) {
      const pts = marked.reduce((s, r) => s + (state.points[r.value] || 0), 0)
        + state.extras.filter((e) => e.kid_id === kid.id && e.date === dstr)
            .reduce((s, e) => s + (e.pts || 0), 0);
      const ratio = pts / maxInPlay;
      cls += ratio >= 0.85 ? ' d2' : ratio >= 0.4 ? ' d1' : ' d0';
    } else if (dstr === state.today) cls += ' dt';
    const lamp = node('span', cls);
    lamp.title = new Date(dstr + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric' })
      + (marked.length === state.categories.length ? '' : ' · sin completar');
    lamps.append(lamp);
  }
  idBox.append(lamps);
  head.append(idBox);
  const score = node('div', 'score');
  score.append(node('b', '', String(pts)));
  score.append(node('span', '', 'pts'));
  head.append(score);
  card.append(head);
  card.append(rewardsBlock(kid));

  const rows = node('div', 'rows');
  for (const cat of state.categories) rows.append(catRow(kid.id, cat, date));
  card.append(rows);
  card.append(extrasBlock(kid, date));
  return card;
}

function rewardsBlock(kid) {
  const pts = weekPoints(kid.id);
  const pool = state.kids.reduce((s, k) => s + weekPoints(k.id), 0); // puntos de los dos juntos
  const wrap = node('div', 'rewards');
  // los premios "solo" de otro peque no aparecen en esta tarjeta
  const rewards = (state.rewards || []).filter((r) => r.modo !== 'solo' || r.kid === kid.id);
  if (!rewards.length) return wrap;
  const reached = (r) => (r.modo === 'juntos' ? pool : pts) >= r.points;
  const next = rewards.find((r) => !reached(r));
  for (const r of rewards) {
    const row = node('div', 'rw' + (reached(r) ? ' ok' : ''));
    row.append(node('span', 'rw-name', r.name));
    if (r.modo === 'juntos') {
      const chip = node('span', 'rw-shared');
      chip.append(icon('swap'), node('span', '', 'juntos'));
      row.append(chip);
    } else if (r.modo === 'solo') {
      const k = state.kids.find((x) => x.id === r.kid);
      row.append(node('span', 'rw-shared', 'solo ' + (k ? k.name : '')));
    }
    row.append(node('span', 'rw-pts', `${r.points} pts`), node('span', 'rw-mark', reached(r) ? '✓' : '·'));
    wrap.append(row);
  }
  const done = rewards.filter(reached);
  const base = done.length ? done[done.length - 1].points : 0;
  const goal = next ? next.points : (rewards[rewards.length - 1] || {}).points || 0;
  const mine = next && next.modo === 'juntos' ? pool : pts;
  const pct = Math.max(0, Math.min(100, Math.round((100 * (mine - base)) / Math.max(1, goal - base))));
  const fill = node('i');
  fill.style.width = pct + '%';
  if (!next) fill.classList.add('ok');
  const bar = node('div', 'bar');
  bar.append(fill);
  wrap.append(bar);
  wrap.append(node('p', 'reward',
    next ? `A ${goal - mine} pts de: ${next.name}${next.modo === 'juntos' ? ' (juntos, puntúan los dos)' : ''}`
         : `Máximo conseguido: ${rewards[rewards.length - 1].name}`));
  return wrap;
}

function extrasBlock(kid, date) {
  const wrap = node('div', 'extras');
  wrap.append(node('h3', '', 'Extra (imprevistos)'));
  const list = node('div', 'extra-list');
  for (const e of (state.extras || []).filter((x) => x.kid_id === kid.id && x.date === date)) {
    const item = node('div', 'extra-item');
    const light = node('span', `extra-light light-${e.value}`);
    light.innerHTML = LIGHT_SVG[e.value];
    const del = node('button', 'btn danger icon');
    del.append(icon('x'));
    del.title = 'Quitar';
    del.onclick = () => withPin(() => api('/api/extra', { id: e.id }, 'DELETE'));
    const cls = e.pts > 0 ? 'g' : e.pts < 0 ? 'r' : 'mu';
    const sign = e.pts > 0 ? '+' : e.pts < 0 ? '−' : '±';
    item.append(light, node('span', 'extra-note', e.note || '(sin motivo)'),
      node('span', `extra-pts ${cls}`, sign + Math.abs(e.pts)), del);
    list.append(item);
  }
  wrap.append(list);

  const form = node('div', 'extra-form hidden');
  let choice = 2;
  const pick = node('div', 'faces');
  const bGreen = node('button', 'face light-2 sel');
  bGreen.innerHTML = LIGHT_SVG[2];
  bGreen.title = 'Verde: suma puntos';
  const bRed = node('button', 'face light-0');
  bRed.innerHTML = LIGHT_SVG[0];
  bRed.title = 'Roja: resta puntos';
  const wrapPts = node('div', 'ptswrap');
  const sign = node('span', 'pts-sign g', '+');
  const ptsIn = node('input', 'num');
  ptsIn.type = 'number';
  ptsIn.min = '0';
  ptsIn.step = '1';
  ptsIn.value = state.points[2] || 2;
  const setSign = () => {
    sign.textContent = choice === 2 ? '+' : '−';
    sign.classList.toggle('g', choice === 2);
    sign.classList.toggle('r', choice === 0);
  };
  bGreen.onclick = () => { choice = 2; bGreen.classList.add('sel'); bRed.classList.remove('sel'); setSign(); };
  bRed.onclick = () => { choice = 0; bRed.classList.add('sel'); bGreen.classList.remove('sel'); setSign(); };
  const input = node('input', 'note-input');
  input.placeholder = 'Motivo del extra…';
  const save = node('button', 'btn primary small', 'Añadir');
  save.onclick = () => withPin(() => {
    const r = bGreen.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const n = Math.abs(Math.round(Number(ptsIn.value) || 0));
    return api('/api/extra', { kid_id: kid.id, date, value: choice, pts: choice === 2 ? n : -n, note: input.value.trim() })
      .then(() => {
        input.value = '';
        ptsIn.value = state.points[2] || 2;
        setSign();
        form.classList.add('hidden');
        if (choice === 2) confettiAt(cx, cy);
        else shakeKidPanel(kid.id);
      });
  });
  input.onkeydown = (e) => { if (e.key === 'Enter') save.click(); };
  pick.append(bGreen, bRed);
  form.append(pick, wrapPts, input, save);

  const addBtn = node('button', 'btn small');
  addBtn.append(icon('plus'), node('span', '', 'Extra'));
  addBtn.onclick = () => { form.classList.toggle('hidden'); input.focus(); };
  wrap.append(addBtn, form);
  return wrap;
}

function catRow(kidId, cat, date) {
  const row = node('div', 'cat-row');
  row.append(node('span', 'cat-name', cat.name));
  const faces = node('div', 'faces');
  const rec = recordFor(kidId, cat.id, date);
  for (const f of FACES) {
    const b = node('button', `face light-${f.value}` + (rec && rec.value === f.value ? ' sel' : ''));
    b.innerHTML = LIGHT_SVG[f.value];
    b.title = f.name;
    b.setAttribute('aria-label', f.name);
    b.onclick = () => {
      if (!tapOk(kidId + ':' + cat.id + ':' + date)) return;
      const r = b.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const cur = recordFor(kidId, cat.id, date); // estado fresco al pulsar, no el del render
      const val = cur && cur.value === f.value ? null : f.value;
      withPin(() => api('/api/rate', {
        kid_id: kidId,
        category_id: cat.id,
        date,
        value: val,
        note: cur ? cur.note : '',
      }).then(() => {
        if (val === 2) confettiAt(cx, cy);
        if (val === 0) shakeKidPanel(kidId);
      }));
    };
    faces.append(b);
  }
  const noteBtn = node('button', 'note-btn' + (rec && rec.note ? ' has-note' : ''));
  noteBtn.title = 'Nota';
  noteBtn.append(icon('pencil'));
  noteBtn.onclick = () => toggleNoteInput(row, kidId, cat, date, rec);
  row.append(faces, noteBtn);
  return row;
}

function toggleNoteInput(row, kidId, cat, date, rec) {
  const existing = row.parentNode.querySelector('.note-input-row');
  if (existing) { existing.remove(); return; }
  const wrap = node('div', 'note-input-row');
  const input = node('input', 'note-input');
  input.placeholder = 'Nota (opcional)';
  input.value = rec ? rec.note : '';
  const save = node('button', 'btn primary', 'Guardar nota');
  save.onclick = () => withPin(() => api('/api/rate', {
    kid_id: kidId,
    category_id: cat.id,
    date,
    value: rec ? rec.value : null,
    note: input.value.trim(),
  }).then(() => wrap.remove()));
  input.onkeydown = (e) => { if (e.key === 'Enter') save.click(); };
  wrap.append(input, save);
  row.insertAdjacentElement('afterend', wrap);
  input.focus();
}

function renderHist() {
  app.textContent = '';
  const bar = node('div', 'hist-bar');
  const prev = node('button', 'btn', '‹');
  const next = node('button', 'btn', '›');
  prev.onclick = () => shiftMonth(-1);
  next.onclick = () => shiftMonth(1);
  const nav = node('div', 'month-nav');
  nav.append(prev, node('span', 'month-label', monthLabel(histMonth)), next);
  bar.append(nav);
  app.append(bar);

  const wrap = node('div', 'kids');
  for (const kid of state.kids) wrap.append(monthPanel(kid));
  app.append(wrap);
}

function monthPanel(kid) {
  const panel = node('div', 'kid');
  const head = node('div', 'cal-head');
  head.append(node('h3', 'cal-title', kid.name));
  const ptsMonth = monthData.records
    .filter((r) => r.kid_id === kid.id)
    .reduce((s, r) => s + (state.points[r.value] || 0), 0);
  head.append(node('span', 'cal-pts', ptsMonth + ' pts este mes'));
  panel.append(head);

  const grid = node('div', 'cal');
  for (const d of ['L', 'M', 'X', 'J', 'V', 'S', 'D']) grid.append(node('div', 'cal-dow', d));
  const lead = (new Date(histMonth.y, histMonth.m - 1, 1).getDay() + 6) % 7;
  for (let i = 0; i < lead; i++) grid.append(node('div', 'cal-cell empty'));
  const days = new Date(histMonth.y, histMonth.m, 0).getDate();
  for (let d = 1; d <= days; d++) {
    const date = `${histMonth.y}-${p2(histMonth.m)}-${p2(d)}`;
    const cell = node('button', 'cal-cell');
    cell.append(node('span', 'cal-day', String(d)));
    const dots = node('div', 'cal-dots');
    for (const cat of state.categories) {
      const rec = monthData.records.find((r) => r.kid_id === kid.id && r.category_id === cat.id && r.date === date);
      if (rec && rec.value !== null) {
        const dot = node('span', `dot dot-${rec.value}`);
        dot.title = cat.name;
        dots.append(dot);
      }
    }
    for (const e of monthData.extras) {
      if (e.kid_id === kid.id && e.date === date) {
        dots.append(node('span', `cal-extra ${e.value === 2 ? 'g' : 'r'}`, e.value === 2 ? '+' : '−'));
      }
    }
    cell.append(dots);
    cell.onclick = () => openDay(date, kid.id);
    grid.append(cell);
  }
  panel.append(grid);
  return panel;
}

function shiftMonth(delta) {
  let { y, m } = histMonth;
  m += delta;
  if (m < 1) { m = 12; y--; }
  if (m > 12) { m = 1; y++; }
  histMonth = { y, m };
  render(true);
  loadMonth();
}

function openDay(date, kidId) {
  modalDay = { date, kidId };
  const kid = state.kids.find((k) => k.id === kidId);
  modalBox.textContent = '';
  modalBox.append(node('h2', '', `${kid.name} — ${dayLabel(date)}`));
  const rows = node('div', 'rows');
  for (const cat of state.categories) rows.append(catRow(kidId, cat, date));
  modalBox.append(rows);
  modalBox.append(extrasBlock(kid, date));
  const close = node('button', 'btn', 'Cerrar');
  close.onclick = closeModal;
  modalBox.append(close);
  modal.classList.remove('hidden');
}

// ---------- Gráficas ----------

const KID_COLORS = ['#38bdf8', '#f472b6', '#fbbf24', '#34d399'];
let grafRecords = [];
let grafExtras = [];

function weekMonday(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

function loadGraf() {
  const t = new Date(state.today + 'T12:00:00Z');
  const back = new Date(t);
  back.setUTCDate(t.getUTCDate() - 49);
  fetch(`/api/history?from=${weekMonday(back.toISOString().slice(0, 10))}&to=${state.today}`)
    .then((r) => r.json())
    .then((data) => {
      grafRecords = data.records;
      grafExtras = data.extras || [];
      if (view === 'graf') renderGraf();
    })
    .catch((e) => { /* reintenta en el siguiente evento */ });
}

function renderGraf() {
  app.textContent = '';
  const t = new Date(state.today + 'T12:00:00Z');
  const back = new Date(t);
  back.setUTCDate(t.getUTCDate() - 29);
  const rec30 = grafRecords.filter((r) => r.date >= back.toISOString().slice(0, 10));

  // puntos por semana, últimas 8 semanas
  const weeks = new Map();
  for (const r of grafRecords) {
    const w = weekMonday(r.date);
    if (!weeks.has(w)) weeks.set(w, {});
    const m = weeks.get(w);
    m[r.kid_id] = (m[r.kid_id] || 0) + (state.points[r.value] || 0);
  }
  for (const e of grafExtras) {
    const w = weekMonday(e.date);
    if (!weeks.has(w)) weeks.set(w, {});
    const m = weeks.get(w);
    m[e.kid_id] = (m[e.kid_id] || 0) + (e.pts || 0);
  }
  const weekKeys = [...weeks.keys()].sort();
  const max = Math.max(1, ...weekKeys.map((w) => Math.max(1, ...state.kids.map((k) => weeks.get(w)[k.id] || 0))));

  const sec1 = node('section', 'graf-sec');
  sec1.append(node('h2', '', 'Puntos por semana'));
  const legend = node('div', 'legend');
  state.kids.forEach((k, i) => {
    const item = node('span', 'legend-item');
    const dot = node('span', 'legend-dot');
    dot.style.background = KID_COLORS[i % KID_COLORS.length];
    item.append(dot, node('span', '', k.name));
    legend.append(item);
  });
  sec1.append(legend);
  const bars = node('div', 'bars');
  for (const w of weekKeys) {
    const col = node('div', 'bar-col');
    const pair = node('div', 'bar-pair');
    state.kids.forEach((k, i) => {
      const v = weeks.get(w)[k.id] || 0;
      const b = node('div', 'b');
      b.style.height = Math.max(2, Math.round((100 * v) / max)) + '%';
      b.style.background = KID_COLORS[i % KID_COLORS.length];
      b.title = `${k.name}: ${v} pts`;
      pair.append(b);
    });
    col.append(pair, node('span', 'bar-label', w.slice(8) + '/' + w.slice(5, 7)));
    bars.append(col);
  }
  sec1.append(bars);
  if (!weekKeys.length) sec1.append(node('p', 'reward', 'Sin datos todavía'));
  app.append(sec1);

  // reparto de caritas por apartado, últimos 30 días
  const sec2 = node('section', 'graf-sec');
  sec2.append(node('h2', '', 'Reparto de caritas (últimos 30 días)'));
  for (const k of state.kids) {
    const block = node('div', 'stack-kid');
    const pts30 = rec30.filter((r) => r.kid_id === k.id).reduce((s, r) => s + (state.points[r.value] || 0), 0);
    block.append(node('h3', '', `${k.name} — ${pts30} pts en 30 días`));
    for (const cat of state.categories) {
      const c = { 2: 0, 1: 0, 0: 0 };
      for (const r of rec30) {
        if (r.kid_id === k.id && r.category_id === cat.id && r.value !== null) c[r.value]++;
      }
      const total = c[2] + c[1] + c[0];
      const row = node('div', 'stack-row');
      row.append(node('span', 'stack-name', cat.name));
      const bar = node('div', 'stack-bar');
      if (total === 0) {
        const empty = node('i');
        empty.style.width = '100%';
        bar.append(empty);
      } else {
        for (const v of [2, 1, 0]) {
          if (!c[v]) continue;
          const seg = node('i', `seg-${v}`);
          seg.style.width = (100 * c[v]) / total + '%';
          seg.title = `${cat.name}: ${c[v]} ${({ 2: 'verdes', 1: 'amarillas', 0: 'rojas' })[v]}`;
          bar.append(seg);
        }
      }
      row.append(bar);
      block.append(row);
    }
    sec2.append(block);
  }
  app.append(sec2);
}

// ---------- Ajustes ----------

function section(title) {
  const s = node('section', 'aj-sec');
  s.append(node('h2', '', title));
  return s;
}

let saveTimer = null;
let focusNewKind = null;
let pinMsg = '';

// guarda todo el formulario (el API reemplaza las listas de golpe)
function saveConfigNow(extra) {
  const kids = collect('kid');
  const cats = collect('cat');
  if (!kids.length || !cats.length) return; // sin peques o apartados no se guarda
  const points = {};
  for (const f of FACES) {
    const v = Number($(`input[data-pts="${f.value}"]`).value);
    if (!Number.isFinite(v)) return; // número a medias: se guardará al completarlo
    points[f.value] = v;
  }
  const rewards = [];
  for (const row of $$('.rw-row')) {
    if (row.classList.contains('removed')) continue;
    const name = $('.txt', row).value.trim();
    if (!name) continue;
    const p = Number($('.num', row).value);
    if (!Number.isFinite(p) || p < 0) return;
    const destVal = $('.destino', row).value;
    let modo = 'cada-uno';
    let kid = null;
    if (destVal === 'juntos') modo = 'juntos';
    else if (destVal.slice(0, 5) === 'solo:') { modo = 'solo'; kid = Number(destVal.slice(5)); }
    rewards.push({ name, points: p, modo, kid });
  }
  rewards.sort((a, b) => a.points - b.points);
  const pinEnabled = $('#pin-enabled').checked;
  const body = { kids, categories: cats, points, rewards, pinEnabled };
  if (extra && extra.newPin) body.newPin = extra.newPin;
  if (extra && extra.tema) body.tema = extra.tema;
  withPin(() => api('/api/config', body)
    .then(() => {
      if (extra && extra.newPin) {
        pin = extra.newPin;
        localStorage.setItem('caritas_pin', pin);
        pinMsg = 'PIN cambiado';
      }
      ajustesDirty = false;
      render(true);
    }));
}

function scheduleConfigSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveConfigNow(), 600);
}

function rowEdit(kind, id, name, placeholder) {
  const row = node('div', 'edit-row');
  const input = node('input', 'txt');
  input.value = name || '';
  if (placeholder) input.placeholder = placeholder;
  input.dataset[kind] = id == null ? 'new' : id;
  input.dataset.focuskey = kind + '-' + (id == null ? 'new' : id);
  if (id == null) {
    // fila "nuevo": se crea al pulsar Enter o al salir del campo con texto
    input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); focusNewKind = kind; saveConfigNow(); } };
    input.onblur = (e) => {
      if (input.value.trim() && !(e.relatedTarget && e.relatedTarget.closest('.ajustes'))) {
        focusNewKind = kind;
        saveConfigNow();
      }
    };
  } else {
    input.oninput = () => { ajustesDirty = true; scheduleConfigSave(); };
  }
  const del = node('button', 'btn danger icon');
  del.append(icon('x'));
  if (id == null) del.style.visibility = 'hidden';
  del.onclick = () => {
    const remaining = $$('input[data-' + kind + ']').filter((i) => !i.closest('.edit-row').classList.contains('removed') && i.value.trim()).length;
    if (remaining <= 1) return alert('No puede quedarse sin ' + (kind === 'kid' ? 'peques' : 'apartados'));
    row.classList.add('removed');
    del.disabled = true;
    input.disabled = true;
    ajustesDirty = true;
    saveConfigNow();
  };
  row.append(input);
  if (kind === 'kid' && id != null) {
    const kid = state.kids.find((k) => k.id === id);
    const cell = node('span', 'photo-cell');
    const file = node('input');
    file.type = 'file';
    file.accept = 'image/*';
    file.className = 'hidden';
    const paint = () => {
      cell.textContent = '';
      if (kid && kid.photo) {
        const img = node('img', 'avatar-thumb');
        img.src = '/' + kid.photo;
        img.alt = '';
        cell.append(img);
      } else {
        cell.append(node('span', 'avatar-thumb ph', kid ? kid.name.charAt(0) : '?'));
      }
      const up = node('button', 'btn icon');
      up.title = 'Cambiar foto';
      up.append(icon('camera'));
      cell.append(up);
      if (kid && kid.photo) {
        const rm = node('button', 'btn danger icon');
        rm.title = 'Quitar foto';
        rm.onclick = () => withPin(() => api(`/api/photo/${id}/remove`, {}));
        rm.append(icon('x'));
        cell.append(rm);
      }
    };
    paint();
    file.onchange = () => {
      const f = file.files && file.files[0];
      file.value = '';
      if (!f) return;
      withPin(() => shrink(f)
        .then((data) => api(`/api/photo/${id}`, { data }))
        .then(() => paint()));
    };
    row.append(cell, file);
  }
  row.append(del);
  return row;
}

function rowReward(r, isNew) {
  const row = node('div', 'edit-row rw-row');
  const input = node('input', 'txt');
  input.value = r.name;
  if (isNew) input.placeholder = 'Nuevo premio…';
  input.dataset.focuskey = 'rw-' + (isNew ? 'new' : r.id);
  if (isNew) {
    input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); focusNewKind = 'rw'; saveConfigNow(); } };
    input.onblur = (e) => {
      if (input.value.trim() && !(e.relatedTarget && e.relatedTarget.closest('.ajustes'))) {
        focusNewKind = 'rw';
        saveConfigNow();
      }
    };
  } else {
    input.oninput = () => { ajustesDirty = true; scheduleConfigSave(); };
  }
  const num = node('input', 'num');
  num.type = 'number';
  num.step = '1';
  num.value = r.points;
  num.placeholder = 'pts';
  if (!isNew) num.oninput = () => { ajustesDirty = true; scheduleConfigSave(); };
  const dest = node('select', 'destino');
  const cur = r.modo === 'juntos' ? 'juntos' : (r.modo === 'solo' && r.kid ? 'solo:' + r.kid : 'cada-uno');
  const opciones = [['cada-uno', 'Cada uno'], ['juntos', 'Juntos ⇄']].concat(
    state.kids.map((k) => ['solo:' + k.id, 'Solo ' + k.name])
  );
  for (const [val, label] of opciones) {
    const o = node('option', '', label);
    o.value = val;
    if (val === cur) o.selected = true;
    dest.append(o);
  }
  dest.dataset.focuskey = 'dest-' + (isNew ? 'new' : r.id);
  dest.onchange = () => { ajustesDirty = true; saveConfigNow(); };
  const del = node('button', 'btn danger icon');
  del.append(icon('x'));
  if (isNew) del.style.visibility = 'hidden';
  del.onclick = () => {
    row.classList.add('removed');
    del.disabled = true;
    input.disabled = true;
    num.disabled = true;
    dest.disabled = true;
    ajustesDirty = true;
    saveConfigNow();
  };
  row.append(input, num, dest, del);
  return row;
}

function renderAjustes() {
  // devolver el foco al campo que se estaba editando tras un autoguardado
  const active = document.activeElement;
  const restoreKey = active && active.dataset && active.dataset.focuskey ? active.dataset.focuskey : null;
  const restorePos = active && typeof active.selectionStart === 'number' ? active.selectionStart : null;
  ajustesDirty = false;
  app.textContent = '';
  const wrap = node('div', 'ajustes');

  const secTema = section('Tema');
  const seg = node('div', 'seg');
  [['oscuro', 'Oscuro'], ['claro', 'Claro']].forEach(([val, label]) => {
    const b = node('button', 'seg-btn' + ((state.tema || 'oscuro') === val ? ' active' : ''), label);
    b.onclick = () => { ajustesDirty = true; saveConfigNow({ tema: val }); };
    seg.append(b);
  });
  secTema.append(seg);

  const secKids = section('Peques');
  for (const k of state.kids) secKids.append(rowEdit('kid', k.id, k.name));
  secKids.append(rowEdit('kid', null, '', 'Nuevo peque…'));

  const secCats = section('Apartados');
  for (const c of state.categories) secCats.append(rowEdit('cat', c.id, c.name));
  secCats.append(rowEdit('cat', null, '', 'Nuevo apartado…'));

  const secPts = section('Puntos de cada carita');
  const ptsRow = node('div', 'pts-row');
  for (const f of FACES) {
    const lab = node('label', 'field pts-field');
    const face = node('span', 'pts-face light-' + f.value);
    face.innerHTML = LIGHT_SVG[f.value];
    const inp = node('input', 'num');
    inp.type = 'number';
    inp.step = '1';
    inp.value = state.points[f.value] || 0;
    inp.dataset.pts = f.value;
    inp.dataset.focuskey = 'pts-' + f.value;
    inp.oninput = () => { ajustesDirty = true; scheduleConfigSave(); };
    lab.append(face, inp);
    ptsRow.append(lab);
  }
  secPts.append(ptsRow);

  const secRw = section('Premios del fin de semana');
  for (const r of state.rewards) secRw.append(rowReward(r, false));
  secRw.append(rowReward({ name: '', points: '' }, true));

  const secPin = section('PIN');
  const sw = node('input');
  sw.type = 'checkbox';
  sw.id = 'pin-enabled';
  sw.dataset.focuskey = 'pin-sw';
  sw.checked = !!state.pinEnabled;
  sw.onchange = () => { ajustesDirty = true; saveConfigNow(); };
  const swRow = node('label', 'switchrow');
  swRow.append(sw, node('span', '', 'Pedir PIN para poder marcar'));
  secPin.append(swRow);
  const pinRow = node('div', 'pts-row');
  const labP = node('label', 'field');
  labP.append(node('span', '', 'PIN nuevo (Enter para aplicar)'));
  const inpP = node('input', 'num');
  inpP.type = 'password';
  inpP.id = 'newpin-input';
  inpP.dataset.focuskey = 'pin-new';
  inpP.oninput = () => { ajustesDirty = true; };
  inpP.onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (inpP.value.trim()) saveConfigNow({ newPin: inpP.value.trim() });
    }
  };
  labP.append(inpP);
  pinRow.append(labP);
  secPin.append(pinRow);
  if (pinMsg) {
    secPin.append(node('p', 'pin-ok', pinMsg));
    pinMsg = '';
  }

  wrap.append(secTema, secKids, secCats, secPts, secRw, secPin);
  app.append(wrap);

  if (focusNewKind) {
    const el = $(`input[data-focuskey="${focusNewKind}-new"]`);
    if (el) el.focus();
    focusNewKind = null;
  } else if (restoreKey) {
    const el = $(`[data-focuskey="${restoreKey}"]`);
    if (el) {
      el.focus();
      if (restorePos != null && typeof el.setSelectionRange === 'function') {
        try { el.setSelectionRange(restorePos, restorePos); } catch (e) { /* inputs numéricos no lo soportan */ }
      }
    }
  }
}

function collect(kind) {
  const out = [];
  for (const input of $$(`input[data-${kind}]`)) {
    if (input.closest('.edit-row').classList.contains('removed')) continue;
    const name = input.value.trim();
    if (!name) continue;
    const id = input.dataset[kind];
    out.push(id === 'new' ? { name } : { id: Number(id), name });
  }
  return out;
}

// ---------- Navegación y conexión ----------

$$('nav button').forEach((b) => {
  b.onclick = () => {
    view = b.dataset.view;
    $$('nav button').forEach((x) => x.classList.toggle('active', x === b));
    if (view === 'ajustes') ajustesDirty = false;
    if (view === 'hist') {
      if (!histMonth) histMonth = monthOf(state.today);
      loadMonth();
    }
    if (view === 'graf') loadGraf();
    render();
  };
});

// el cliente de socket.io puede no existir en navegadores muy antiguos: respaldo por sondeo
let socket = { connected: false, on() {} };
if (typeof io === 'function') {
  try { socket = io(); } catch (e) { /* seguimos con el sondeo */ }
}
socket.on('state', (s) => {
  state = s;
  if (view === 'hist' && !histMonth) histMonth = monthOf(state.today);
  render();
  if (view === 'hist') loadMonth();
  if (view === 'graf') loadGraf();
  if (modalDay) openDay(modalDay.date, modalDay.kidId);
});

// respaldo si el WebSocket se cae
setInterval(() => {
  if (!socket.connected && state) {
    fetch('/api/state').then((r) => r.json()).then((s) => { state = s; render(); }).catch(() => {});
  }
}, 10000);

fetch('/api/state').then((r) => r.json()).then((s) => {
  state = s;
  if (!histMonth) histMonth = monthOf(state.today);
  render();
}).catch(() => {});
