const express = require('express');
const crypto = require('crypto');
require('dotenv').config();
const pool = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'garasiku-dev-secret';

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

// Middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
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
      'SELECT * FROM users WHERE username = $1 AND password = $2 AND is_active = true LIMIT 1',
      [username, password]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Username atau password tidak valid.' });
    }

    const user = result.rows[0];
    const { password: _password, ...safeUser } = user;
    const issuedAt = Date.now();
    const expiresAt = issuedAt + (8 * 60 * 60 * 1000);

    const token = createJwt({
      sub: safeUser.id,
      username: safeUser.username,
      role: safeUser.role,
      exp: expiresAt,
      iat: issuedAt,
    });

    return res.json({
      token,
      expiresAt,
      user: safeUser,
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: error.message });
  }
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
    const { car_id, note_date, content } = req.body;
    const result = await pool.query(
      'INSERT INTO daily_notes (car_id, note_date, content) VALUES ($1, $2, $3) RETURNING *',
      [car_id, note_date, content]
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
    const result = await pool.query(
      'UPDATE daily_notes SET content = $1, note_date = $2 WHERE id = $3 RETURNING *',
      [req.body.content, req.body.note_date, req.params.id]
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
