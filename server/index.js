// Caritas — servidor: API + WebSocket (tiempo real) + web estática
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');

const PORT = Number(process.env.PORT) || 3010;
const TZ = 'Europe/Madrid';

const DATA_DIR = path.join(__dirname, '..', 'data');
const PHOTO_DIR = path.join(DATA_DIR, 'photos');
fs.mkdirSync(PHOTO_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, 'caritas.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS kids       (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS records (
    kid_id INTEGER NOT NULL, category_id INTEGER NOT NULL, date TEXT NOT NULL,
    value INTEGER, note TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL,
    PRIMARY KEY (kid_id, category_id, date)
  );
  CREATE TABLE IF NOT EXISTS extras (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kid_id INTEGER NOT NULL, date TEXT NOT NULL,
    value INTEGER NOT NULL, note TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

try { db.exec('ALTER TABLE kids ADD COLUMN photo TEXT'); } catch { /* ya existe */ }
try { db.exec('ALTER TABLE kids ADD COLUMN color TEXT'); } catch { /* ya existe */ }
try { db.exec('ALTER TABLE extras ADD COLUMN pts INTEGER'); } catch { /* ya existe */ }

const DEFAULT_REWARDS = [
  { name: 'Pizza el sábado', points: 8 },
  { name: 'Croissants el sábado', points: 12 },
  { name: 'Más tiempo dibujos fin de semana', points: 15 },
  { name: 'Más tiempo consola fin de semana', points: 20 },
];

if (db.prepare('SELECT COUNT(*) AS n FROM kids').get().n === 0) {
  const kid = db.prepare('INSERT INTO kids (name, sort) VALUES (?, ?)');
  kid.run('Martín', 0);
  kid.run('Ángel', 1);
  const cat = db.prepare('INSERT INTO categories (name, sort) VALUES (?, ?)');
  ['Comida', 'Comportamiento', 'Histerias', 'Orden de habitación'].forEach((n, i) => cat.run(n, i));
  const set = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
  set.run('pin', '1234'); // shortcut: PIN inicial por defecto, cambiarlo en Ajustes la primera vez
  set.run('pinEnabled', '1');
  set.run('points', JSON.stringify({ 2: 2, 1: 1, 0: 0 }));
  set.run('rewards', JSON.stringify(DEFAULT_REWARDS));
}

const getSetting = (k) => db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value;
const setSetting = (k, v) => db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
).run(k, String(v));
const getPoints = () => {
  try { return JSON.parse(getSetting('points')); } catch { return { 2: 2, 1: 1, 0: 0 }; }
};
const getRewards = () => {
  try {
    return JSON.parse(getSetting('rewards')).map((r) => {
      const modo = ['cada-uno', 'juntos', 'solo'].includes(r.modo) ? r.modo : (r.shared ? 'juntos' : 'cada-uno');
      return {
        name: r.name,
        points: r.points,
        modo,
        kid: modo === 'solo' && Number.isFinite(Number(r.kid)) ? Number(r.kid) : null,
      };
    }).sort((a, b) => a.points - b.points);
  } catch { return []; }
};

// migración: bases de datos creadas antes de existir los premios
if (!getSetting('rewards')) setSetting('rewards', JSON.stringify(DEFAULT_REWARDS));
if (getSetting('pinEnabled') == null) setSetting('pinEnabled', '1');

// Fecha de hoy en Madrid y su semana (lunes a domingo)
const madridToday = () => new Intl.DateTimeFormat('sv-SE', { timeZone: TZ }).format(new Date());
function weekRange(today) {
  const d = new Date(today + 'T12:00:00Z');
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const f = (x) => x.toISOString().slice(0, 10);
  return { from: f(monday), to: f(sunday) };
}

const SELECT_RECORDS = `
  SELECT r.* FROM records r
  JOIN kids k ON k.id = r.kid_id
  JOIN categories c ON c.id = r.category_id
  WHERE r.date BETWEEN ? AND ?
  ORDER BY r.date, r.kid_id, r.category_id`;

const SELECT_EXTRAS = `
  SELECT e.* FROM extras e
  JOIN kids k ON k.id = e.kid_id
  WHERE e.date BETWEEN ? AND ?
  ORDER BY e.date, e.kid_id, e.id`;

// los extras antiguos no tenían puntos propios: verde +2, roja 0
const mapExtra = (e) => Object.assign({}, e, { pts: e.pts == null ? (e.value === 2 ? 2 : 0) : e.pts });

function getState() {
  const { from, to } = weekRange(madridToday());
  return {
    today: madridToday(),
    week: { from, to },
    kids: db.prepare('SELECT * FROM kids ORDER BY sort, id').all(),
    categories: db.prepare('SELECT * FROM categories ORDER BY sort, id').all(),
    records: db.prepare(SELECT_RECORDS).all(from, to),
    extras: db.prepare(SELECT_EXTRAS).all(from, to).map(mapExtra),
    points: getPoints(),
    rewards: getRewards(),
    pinEnabled: getSetting('pinEnabled') === '1',
    tema: getSetting('tema') === 'claro' ? 'claro' : 'oscuro',
  };
}

const app = express();
app.use((req, res, next) => {
  if (req.path.startsWith('/api') || req.path === '/' || req.path.startsWith('/socket.io')) {
    console.log(new Date().toISOString(), req.method, req.path, 'desde', req.ip);
  }
  next();
});
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const broadcast = () => io.emit('state', getState());
io.on('connection', (socket) => {
  console.log(new Date().toISOString(), 'socket.io conectado desde', socket.handshake.address);
  socket.emit('state', getState());
});

app.use(express.json({ limit: '3mb' }));
app.use((req, res, next) => { // CORS abierto: la .ipk de la tele carga la web desde el origen de la app
  console.log('[req]', req.method, req.url);
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// index.html sin caché y los fuentes renombrados con su versión al arrancar:
// cualquier copia cacheada bajo un nombre viejo queda fuera de juego
const WEB_DIR = path.join(__dirname, '..', 'web');
const ASSET_VERSION = String(Math.round(Math.max(
  fs.statSync(path.join(WEB_DIR, 'app.js')).mtimeMs,
  fs.statSync(path.join(WEB_DIR, 'style.css')).mtimeMs
)));
for (const f of ['app.js', 'style.css']) {
  const origen = path.join(WEB_DIR, f);
  const versionado = path.join(WEB_DIR, f.replace('.', '.' + ASSET_VERSION + '.'));
  if (fs.existsSync(origen)) fs.renameSync(origen, versionado);
}
app.get('/', (req, res) => {
  const html = fs.readFileSync(path.join(WEB_DIR, 'index.html'), 'utf8')
    .split('app.js').join('app.' + ASSET_VERSION + '.js')
    .split('style.css').join('style.' + ASSET_VERSION + '.css');
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('Cache-Control', 'no-store');
  res.send(html);
});

function requirePin(req, res, next) {
  if (getSetting('pinEnabled') !== '1') return next(); // PIN desactivado en Ajustes
  if (req.body && req.body.pin === getSetting('pin')) return next();
  res.status(403).json({ error: 'PIN incorrecto' });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

app.get('/api/state', (req, res) => res.json(getState()));

app.get('/api/history', (req, res) => {
  const { from, to } = req.query;
  if (!DATE_RE.test(String(from)) || !DATE_RE.test(String(to))) {
    return res.status(400).json({ error: 'from/to deben ser YYYY-MM-DD' });
  }
  res.json({ from, to, records: db.prepare(SELECT_RECORDS).all(from, to), extras: db.prepare(SELECT_EXTRAS).all(from, to).map(mapExtra) });
});

// Marca una carita o guarda la nota de un hueco (peque × apartado × día)
app.post('/api/rate', requirePin, (req, res) => {
  const kid_id = Number(req.body.kid_id);
  const category_id = Number(req.body.category_id);
  const date = String(req.body.date || '');
  const value = req.body.value === null ? null : Number(req.body.value);
  const note = String(req.body.note ?? '');
  if (!DATE_RE.test(date)) return res.status(400).json({ error: 'Fecha inválida' });
  if (value !== null && ![2, 1, 0].includes(value)) return res.status(400).json({ error: 'Carita inválida' });
  if (!db.prepare('SELECT 1 FROM kids WHERE id = ?').get(kid_id)) return res.status(400).json({ error: 'Peque desconocido' });
  if (!db.prepare('SELECT 1 FROM categories WHERE id = ?').get(category_id)) return res.status(400).json({ error: 'Apartado desconocido' });
  if (value === null && !note) {
    // desconectar la carita o borrar nota vacía = quitar el registro
    db.prepare('DELETE FROM records WHERE kid_id = ? AND category_id = ? AND date = ?').run(kid_id, category_id, date);
  } else {
    db.prepare(`
      INSERT INTO records (kid_id, category_id, date, value, note, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(kid_id, category_id, date) DO UPDATE SET value = excluded.value, note = excluded.note, updated_at = excluded.updated_at
    `).run(kid_id, category_id, date, value, note, new Date().toISOString());
  }
  broadcast();
  res.json({ ok: true });
});

// Extra: cara verde o roja por un motivo no previsto (comentario libre)
app.post('/api/extra', requirePin, (req, res) => {
  const kid_id = Number(req.body.kid_id);
  const date = String(req.body.date || '');
  const value = Number(req.body.value);
  const note = String(req.body.note ?? '');
  let pts = req.body.pts === undefined || req.body.pts === null || req.body.pts === '' ? null : Number(req.body.pts);
  if (!DATE_RE.test(date)) return res.status(400).json({ error: 'Fecha inválida' });
  if (![2, 0].includes(value)) return res.status(400).json({ error: 'El extra solo puede ser verde o roja' });
  if (!db.prepare('SELECT 1 FROM kids WHERE id = ?').get(kid_id)) return res.status(400).json({ error: 'Peque desconocido' });
  if (pts === null || !Number.isFinite(pts)) pts = value === 2 ? (getPoints()[2] || 2) : 0;
  // verde suma, roja resta: el signo lo manda el color
  pts = Math.round(Math.abs(pts)) * (value === 2 ? 1 : -1);
  db.prepare('INSERT INTO extras (kid_id, date, value, note, pts, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(kid_id, date, value, note, pts, new Date().toISOString());
  broadcast();
  res.json({ ok: true });
});

app.delete('/api/extra', requirePin, (req, res) => {
  db.prepare('DELETE FROM extras WHERE id = ?').run(Number(req.body.id));
  broadcast();
  res.json({ ok: true });
});

// Foto de un peque: llega como data URL ya reducida desde el cliente
const PHOTO_RE = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/;
const photoFile = (kidId, ext) => path.join(PHOTO_DIR, `kid-${kidId}.${ext}`);

app.post('/api/photo/:id', requirePin, (req, res) => {
  const kid = db.prepare('SELECT id FROM kids WHERE id = ?').get(Number(req.params.id));
  if (!kid) return res.status(400).json({ error: 'Peque desconocido' });
  const m = PHOTO_RE.exec(String(req.body.data || ''));
  if (!m) return res.status(400).json({ error: 'Formato no soportado (usa JPG o PNG)' });
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 3_000_000) return res.status(400).json({ error: 'Imagen demasiado grande' });
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  for (const old of ['png', 'jpg', 'webp']) fs.rmSync(photoFile(kid.id, old), { force: true });
  fs.writeFileSync(photoFile(kid.id, ext), buf);
  // ?v= para que los navegadores pidan la foto nueva
  db.prepare('UPDATE kids SET photo = ? WHERE id = ?').run(`photos/kid-${kid.id}.${ext}?v=${Date.now()}`, kid.id);
  broadcast();
  res.json({ ok: true });
});

app.post('/api/photo/:id/remove', requirePin, (req, res) => {
  const kid = db.prepare('SELECT id FROM kids WHERE id = ?').get(Number(req.params.id));
  if (!kid) return res.status(400).json({ error: 'Peque desconocido' });
  for (const old of ['png', 'jpg', 'webp']) fs.rmSync(photoFile(kid.id, old), { force: true });
  db.prepare('UPDATE kids SET photo = NULL WHERE id = ?').run(kid.id);
  broadcast();
  res.json({ ok: true });
});

// Ajustes: peques, apartados, puntos, objetivo y PIN (cada lista se reemplaza de golpe)
app.post('/api/config', requirePin, (req, res) => {
  const { kids, categories, points, rewards, newPin, pinEnabled, tema } = req.body;

  const syncRows = (rows, table, extraCols) => {
    if (!Array.isArray(rows)) return;
    const ins = db.prepare(`INSERT INTO ${table} (name, sort) VALUES (?, ?)`);
    const upd = db.prepare(`UPDATE ${table} SET name = ?, sort = ? WHERE id = ?`);
    const del = db.prepare(`DELETE FROM ${table} WHERE id = ?`);
    const before = db.prepare(`SELECT id FROM ${table}`).all().map((r) => r.id);
    const kept = [];
    rows.forEach((row, i) => {
      const name = String(row?.name || '').trim();
      if (!name) return;
      const id = Number(row.id);
      if (before.includes(id)) { upd.run(name, i, id); kept.push(id); }
      else ins.run(name, i);
    });
    before.filter((id) => !kept.includes(id)).forEach((id) => del.run(id));
    // columnas opcionales (p. ej. kids.color)
    if (extraCols) {
      const setCol = db.prepare(`UPDATE ${table} SET ${extraCols.col} = ? WHERE id = ?`);
      for (const row of rows) {
        const id = Number(row.id);
        const val = extraCols.get(row);
        if (id && val != null) setCol.run(val, id);
      }
    }
  };

  db.transaction(() => {
    syncRows(kids, 'kids', { col: 'color', get: (row) => (row.color && /^#[0-9a-fA-F]{6}$/.test(row.color) ? row.color : null) });
    syncRows(categories, 'categories');
    if (points && [2, 1, 0].every((v) => Number.isFinite(Number(points[v])))) {
      setSetting('points', JSON.stringify({ 2: Number(points[2]), 1: Number(points[1]), 0: Number(points[0]) }));
    }
    if (Array.isArray(rewards)) {
      const list = rewards
        .map((r) => {
          const modo = ['cada-uno', 'juntos', 'solo'].includes(r?.modo) ? r.modo : 'cada-uno';
          return {
            name: String(r?.name || '').trim(),
            points: Number(r?.points),
            modo,
            kid: modo === 'solo' && Number.isFinite(Number(r?.kid)) ? Number(r?.kid) : null,
          };
        })
        .filter((r) => r.name && Number.isFinite(r.points) && r.points >= 0)
        .sort((a, b) => a.points - b.points);
      setSetting('rewards', JSON.stringify(list));
    }
    if (typeof pinEnabled === 'boolean') setSetting('pinEnabled', pinEnabled ? '1' : '0');
    if (tema === 'claro' || tema === 'oscuro') setSetting('tema', tema);
    if (newPin && String(newPin).trim()) setSetting('pin', String(newPin).trim());
  })();

  broadcast();
  res.json({ ok: true });
});

// red de seguridad: un índice viejo que pida los nombres sin versión recibe el código nuevo
app.get('/app.js', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(WEB_DIR, 'app.' + ASSET_VERSION + '.js'));
});
app.get('/style.css', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(WEB_DIR, 'style.' + ASSET_VERSION + '.css'));
});

app.use('/photos', express.static(PHOTO_DIR));
// no-store para html/js/css: nada de copias viejas de la interfaz; las fotos llevan su ?v= y se cachean normal
app.use(express.static(path.join(__dirname, '..', 'web'), { setHeaders: (res) => res.set('Cache-Control', 'no-store') }));

server.listen(PORT, () => console.log(`Caritas en el puerto ${PORT}`));
