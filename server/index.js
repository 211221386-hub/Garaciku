const express = require('express');
const crypto = require('crypto');
require('dotenv').config();
const pool = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.APP_JWT_SECRET;
const APP_ORIGIN = process.env.APP_ORIGIN;

if (!JWT_SECRET || Buffer.byteLength(JWT_SECRET) < 32) {
  throw new Error('APP_JWT_SECRET must be configured with at least 32 bytes.');
}

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function createJwt(payload) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(signingInput)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return `${signingInput}.${signature}`;
}

function verifyJwt(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [encodedHeader, encodedPayload, signature] = parts;
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const expected = crypto.createHmac('sha256', JWT_SECRET).update(signingInput).digest();
  const actual = Buffer.from(signature.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    return Number.isInteger(payload.exp) && payload.exp > Math.floor(Date.now() / 1000) ? payload : null;
  } catch {
    return null;
  }
}

// Middleware
app.use((req, res, next) => {
  if (req.headers.origin && (!APP_ORIGIN || req.headers.origin !== APP_ORIGIN)) {
    return res.status(403).json({ error: 'Origin not allowed.' });
  }
  if (APP_ORIGIN) res.header('Access-Control-Allow-Origin', APP_ORIGIN);
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.header('Vary', 'Origin');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});
app.use(express.json());

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({ error: 'Username dan password wajib diisi.' });
    }

    const result = await pool.query(
      `SELECT id, username, full_name, role, is_active, created_at
       FROM users
       WHERE username = $1
         AND is_active = true
         AND password_hash = extensions.crypt($2, password_hash)
       LIMIT 1`,
      [username, password]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Username atau password tidak valid.' });
    }

    const safeUser = result.rows[0];
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresAt = issuedAt + (8 * 60 * 60);

    const token = createJwt({
      sub: safeUser.id,
      username: safeUser.username,
      exp: expiresAt,
      iat: issuedAt,
    });

    return res.json({
      token,
      expiresAt: expiresAt * 1000,
      user: safeUser,
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: error.message });
  }
});

app.use('/api', async (req, res, next) => {
  if (req.path === '/auth/login') return next();

  const authorization = req.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) return res.status(401).json({ error: 'Authentication is required.' });
  const claims = verifyJwt(authorization.slice('Bearer '.length));
  if (!claims?.sub) return res.status(401).json({ error: 'Session is invalid or expired.' });

  try {
    const result = await pool.query('SELECT id, role, is_active FROM users WHERE id = $1 LIMIT 1', [claims.sub]);
    const user = result.rows[0];
    if (!user?.is_active || ![1, 2, 3, 4].includes(user.role)) return res.status(401).json({ error: 'User is inactive or not authorized.' });
    req.authUser = user;
  } catch (error) {
    console.error('Authentication lookup failed:', error);
    return res.status(503).json({ error: 'Authentication service is unavailable.' });
  }

  const role = req.authUser.role;
  const path = req.path;
  const method = req.method;
  const admins = [1, 2];
  let allowed = true;

  if (/^\/cars(?:\/[^/]+)?$/.test(path) && method !== 'GET') allowed = admins.includes(role);
  else if (path === '/notes' && method === 'POST') allowed = [1, 2, 3, 4].includes(role);
  else if (/^\/notes\/[^/]+$/.test(path) && method === 'PUT') allowed = role === 1;
  else if (/^\/notes\/[^/]+$/.test(path) && method === 'DELETE') allowed = admins.includes(role);
  else if (/^\/completeness(?:\/[^/]+)?$/.test(path) && method !== 'GET') allowed = admins.includes(role);
  else if (path === '/damages' && method === 'POST') allowed = [1, 2, 3, 4].includes(role);
  else if (/^\/damages\/[^/]+$/.test(path) && method === 'PUT') allowed = admins.includes(role);
  else if (/^\/damages\/[^/]+$/.test(path) && method === 'DELETE') allowed = role === 1;
  else if (path === '/rentals' && method === 'POST') allowed = [1, 3, 4].includes(role);
  else if (/^\/rentals\/[^/]+$/.test(path) && method === 'PUT') allowed = role === 1;
  else if (/^\/rentals\/[^/]+$/.test(path) && method === 'DELETE') allowed = admins.includes(role);

  if (!allowed) return res.status(403).json({ error: 'Role is not allowed to perform this action.' });
  if (path === '/rentals' && method === 'POST' && [3, 4].includes(role)) {
    req.body.user_id = req.authUser.id;
    req.body.status = 'pending';
  }
  next();
});

// ============ CARS ENDPOINTS ============

// GET all cars
app.get('/api/cars', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM cars ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching cars:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET single car by ID
app.get('/api/cars/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM cars WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Car not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST new car
app.post('/api/cars', async (req, res) => {
  try {
    const { name, brand, model, year, plate_number, color, photo_url } = req.body;
    const result = await pool.query(
      'INSERT INTO cars (name, brand, model, year, plate_number, color, photo_url) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [name, brand, model, year, plate_number, color, photo_url]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update car
app.put('/api/cars/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, brand, model, year, plate_number, color, photo_url } = req.body;
    const result = await pool.query(
      'UPDATE cars SET name = $1, brand = $2, model = $3, year = $4, plate_number = $5, color = $6, photo_url = $7 WHERE id = $8 RETURNING *',
      [name, brand, model, year, plate_number, color, photo_url, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Car not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE car
app.delete('/api/cars/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM cars WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Car not found' });
    }
    res.json({ message: 'Car deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ RENTAL RECORDS ENDPOINTS ============

// GET all rental records for a car
app.get('/api/cars/:car_id/rentals', async (req, res) => {
  try {
    const { car_id } = req.params;
    const result = await pool.query(
      'SELECT * FROM rental_records WHERE car_id = $1 ORDER BY created_at DESC',
      [car_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/rentals', async (req, res) => {
  try {
    const result = await pool.query(`SELECT r.*, c.name AS car_name
      FROM rental_records r JOIN cars c ON c.id = r.car_id
      ORDER BY r.start_date DESC, r.created_at DESC`);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST new rental record
app.post('/api/rentals', async (req, res) => {
  try {
    const { car_id, renter_name, renter_email, renter_phone, start_date, end_date, purpose, total_cost, status, notes } = req.body;
    if (!renter_email || !/^\S+@\S+\.\S+$/.test(renter_email)) {
      return res.status(400).json({ error: 'Email penyewa wajib diisi dengan format yang valid' });
    }
    const result = await pool.query(
      'INSERT INTO rental_records (car_id, renter_name, renter_email, renter_phone, start_date, end_date, purpose, total_cost, status, notes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *',
      [car_id, renter_name, renter_email, renter_phone, start_date, end_date, purpose, total_cost, status, notes]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update rental record
app.put('/api/rentals/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { renter_name, renter_email, start_date, end_date, purpose, total_cost, status, notes } = req.body;
    if (!renter_email || !/^\S+@\S+\.\S+$/.test(renter_email)) {
      return res.status(400).json({ error: 'Email penyewa wajib diisi dengan format yang valid' });
    }
    const result = await pool.query(
      'UPDATE rental_records SET renter_name = $1, renter_email = $2, start_date = $3, end_date = $4, purpose = $5, total_cost = $6, status = $7, notes = $8 WHERE id = $9 RETURNING *',
      [renter_name, renter_email, start_date, end_date, purpose, total_cost, status, notes, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Rental record not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE rental record
app.delete('/api/rentals/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM rental_records WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Rental record not found' });
    }
    res.json({ message: 'Rental record deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ DAILY NOTES ENDPOINTS ============

// GET all daily notes for a car
app.get('/api/cars/:car_id/notes', async (req, res) => {
  try {
    const { car_id } = req.params;
    const result = await pool.query(
      'SELECT * FROM daily_notes WHERE car_id = $1 ORDER BY note_date DESC',
      [car_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST new daily note
app.post('/api/notes', async (req, res) => {
  try {
    const {
      car_id,
      name = '',
      section = '',
      note_date,
      start_date,
      end_date,
      start_km,
      end_km,
      start_fuel,
      end_fuel,
      content = '',
    } = req.body;

    const insertDate = note_date || start_date || new Date().toISOString().slice(0, 10);
    const startDate = start_date || insertDate;
    const endDate = end_date || startDate;

    const result = await pool.query(
      `INSERT INTO daily_notes (
        car_id, name, section, note_date, start_date, end_date,
        start_km, end_km, start_fuel, end_fuel, content
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [car_id, name, section, insertDate, startDate, endDate, start_km ?? null, end_km ?? null, start_fuel ?? null, end_fuel ?? null, content]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/notes', async (req, res) => {
  try {
    const result = await pool.query(`SELECT n.*, c.name AS car_name
      FROM daily_notes n JOIN cars c ON c.id = n.car_id
      ORDER BY n.note_date DESC, n.created_at DESC`);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/notes/:id', async (req, res) => {
  try {
    const {
      name,
      section,
      note_date,
      start_date,
      end_date,
      start_km,
      end_km,
      start_fuel,
      end_fuel,
      content,
    } = req.body;

    const updates = [];
    const values = [];

    const pushValue = (column, value) => {
      values.push(value);
      updates.push(`${column} = $${values.length}`);
    };

    if (name !== undefined) pushValue('name', name);
    if (section !== undefined) pushValue('section', section);
    if (note_date !== undefined) pushValue('note_date', note_date);
    if (start_date !== undefined) pushValue('start_date', start_date);
    if (end_date !== undefined) pushValue('end_date', end_date);
    if (start_km !== undefined) pushValue('start_km', start_km ?? null);
    if (end_km !== undefined) pushValue('end_km', end_km ?? null);
    if (start_fuel !== undefined) pushValue('start_fuel', start_fuel ?? null);
    if (end_fuel !== undefined) pushValue('end_fuel', end_fuel ?? null);
    if (content !== undefined) pushValue('content', content);

    if (!updates.length) {
      return res.status(400).json({ error: 'Tidak ada data yang diupdate.' });
    }

    values.push(req.params.id);
    const result = await pool.query(
      `UPDATE daily_notes SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Note not found' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/notes/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM daily_notes WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Note not found' });
    res.json({ message: 'Note deleted successfully' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============ COMPLETENESS ITEMS ENDPOINTS ============

// GET all completeness items for a car
app.get('/api/cars/:car_id/completeness', async (req, res) => {
  try {
    const { car_id } = req.params;
    const result = await pool.query(
      'SELECT * FROM completeness_items WHERE car_id = $1 ORDER BY created_at DESC',
      [car_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST new completeness item
app.post('/api/completeness', async (req, res) => {
  try {
    const { car_id, name, is_present, reminder_type, next_due_date } = req.body;
    const result = await pool.query(
      'INSERT INTO completeness_items (car_id, name, is_present, reminder_type, next_due_date) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [car_id, name, is_present, reminder_type || 'general', next_due_date || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/completeness', async (req, res) => {
  try {
    const result = await pool.query(`SELECT i.*, c.name AS car_name
      FROM completeness_items i JOIN cars c ON c.id = i.car_id ORDER BY i.created_at DESC`);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/completeness/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE completeness_items SET name = COALESCE($1, name), is_present = COALESCE($2, is_present), reminder_type = COALESCE($3, reminder_type), next_due_date = COALESCE($4, next_due_date) WHERE id = $5 RETURNING *',
      [req.body.name, req.body.is_present, req.body.reminder_type, req.body.next_due_date, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Completeness item not found' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/completeness/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM completeness_items WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Completeness item not found' });
    res.json({ message: 'Completeness item deleted successfully' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============ DAMAGES ENDPOINTS ============

// GET all damages for a car
app.get('/api/cars/:car_id/damages', async (req, res) => {
  try {
    const { car_id } = req.params;
    const result = await pool.query(
      'SELECT * FROM damages WHERE car_id = $1 ORDER BY created_at DESC',
      [car_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST new damage record
app.post('/api/damages', async (req, res) => {
  try {
    const { car_id, description, severity, status, reported_date, resolved_date } = req.body;
    const result = await pool.query(
      'INSERT INTO damages (car_id, description, severity, status, reported_date, resolved_date) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [car_id, description, severity, status, reported_date, resolved_date]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/damages', async (req, res) => {
  try {
    const result = await pool.query(`SELECT d.*, c.name AS car_name
      FROM damages d JOIN cars c ON c.id = d.car_id
      ORDER BY d.reported_date DESC, d.created_at DESC`);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/damages/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE damages SET description = COALESCE($1, description), severity = COALESCE($2, severity), status = COALESCE($3, status), reported_date = COALESCE($4, reported_date), resolved_date = $5 WHERE id = $6 RETURNING *',
      [req.body.description, req.body.severity, req.body.status, req.body.reported_date, req.body.resolved_date, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Damage not found' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/damages/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM damages WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Damage not found' });
    res.json({ message: 'Damage deleted successfully' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: '✅ Server running' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log(`📍 API Base URL: http://localhost:${PORT}/api`);
});
