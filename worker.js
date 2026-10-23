const TABLES = new Set([
  'users',
  'cars',
  'daily_notes',
  'completeness_items',
  'damages',
  'service_records',
  'rental_records',
]);

const COLUMNS = {
  users: new Set(['id', 'username', 'full_name', 'email', 'phone', 'role', 'is_active', 'must_reset_password', 'created_at']),
  cars: new Set(['id', 'name', 'brand', 'model', 'year', 'plate_number', 'color', 'photo_url', 'created_at']),
  daily_notes: new Set(['id', 'car_id', 'name', 'section', 'note_date', 'start_date', 'end_date', 'start_km', 'end_km', 'start_fuel', 'end_fuel', 'content', 'created_at']),
  completeness_items: new Set(['id', 'car_id', 'name', 'is_present', 'reminder_type', 'next_due_date', 'created_at']),
  damages: new Set(['id', 'car_id', 'description', 'severity', 'status', 'reported_date', 'resolved_date', 'created_at']),
  service_records: new Set(['id', 'car_id', 'service_date', 'service_type', 'description', 'cost', 'mileage', 'workshop', 'status', 'next_service_date', 'next_service_mileage', 'reminder_enabled', 'reminder_interval_months', 'reminder_interval_mileage', 'created_at']),
  rental_records: new Set(['id', 'car_id', 'user_id', 'renter_name', 'renter_email', 'renter_phone', 'start_date', 'start_time', 'end_date', 'end_time', 'total_cost', 'purpose', 'status', 'approved_by', 'approved_at', 'return_confirmed_by', 'return_confirmed_at', 'notes', 'created_at']),
};

const CORS_METHODS = 'POST, OPTIONS';
const CORS_HEADERS = 'Authorization, Content-Type';

function base64UrlEncode(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(input) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized + '='.repeat((4 - (normalized.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function serviceHeaders(env, extra = {}) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured.');
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra,
  };
}

async function signingKey(secret, usages) {
  if (!secret || new TextEncoder().encode(secret).length < 32) {
    throw new Error('APP_JWT_SECRET must be configured with at least 32 bytes.');
  }
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, usages);
}

async function signToken(payload, secret) {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64UrlEncode(JSON.stringify(payload));
  const content = `${header}.${body}`;
  const key = await signingKey(secret, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(content));
  return `${content}.${base64UrlEncode(new Uint8Array(signature))}`;
}

async function verifyToken(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, signaturePart] = parts;
  try {
    const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(headerPart)));
    if (header.alg !== 'HS256' || header.typ !== 'JWT') return null;
    const key = await signingKey(secret, ['verify']);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      base64UrlDecode(signaturePart),
      new TextEncoder().encode(`${headerPart}.${payloadPart}`),
    );
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadPart)));
    if (typeof payload.sub !== 'string' || !Number.isInteger(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

async function getUserById(env, userId) {
  const url = new URL(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/users`);
  url.searchParams.set('id', `eq.${userId}`);
  url.searchParams.set('select', 'id,username,full_name,email,phone,role,is_active,must_reset_password,created_at');
  url.searchParams.set('limit', '1');
  const response = await fetch(url, { headers: serviceHeaders(env) });
  if (!response.ok) throw new Error('User profile lookup failed.');
  const [user] = await response.json();
  return user ?? null;
}

async function authenticate(request, env) {
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return null;
  const claims = await verifyToken(authorization.slice('Bearer '.length), env.APP_JWT_SECRET);
  if (!claims) return null;
  const user = await getUserById(env, claims.sub);
  if (!user?.is_active || ![1, 2, 3, 4].includes(user.role)) return null;
  return user;
}

function userCanRead(table, role) {
  if (table === 'users' || table === 'service_records') return [1, 2].includes(role);
  return [1, 2, 3, 4].includes(role);
}

function userCanWrite(table, operation, role) {
  if (table === 'cars') return [1, 2].includes(role);
  if (table === 'users') return false;
  if (table === 'daily_notes') {
    if (operation === 'insert') return [1, 2, 3, 4].includes(role);
    if (operation === 'update') return role === 1;
    if (operation === 'delete') return [1, 2].includes(role);
  }
  if (table === 'completeness_items') return [1, 2].includes(role);
  if (table === 'damages') {
    if (operation === 'insert') return [1, 2, 3, 4].includes(role);
    if (operation === 'update') return [1, 2].includes(role);
    if (operation === 'delete') return role === 1;
  }
  if (table === 'service_records') return [1, 2].includes(role);
  if (table === 'rental_records') {
    if (operation === 'insert') return [1, 2, 3, 4].includes(role);
    if (operation === 'update') return role === 1;
    if (operation === 'delete') return [1, 2].includes(role);
  }
  return false;
}

function validateFilters(table, filters, required = false) {
  if (!Array.isArray(filters)) return null;
  if (required && filters.length === 0) return null;
  const columns = COLUMNS[table];
  for (const filter of filters) {
    if (!filter || !columns.has(filter.column) || !['eq', 'in'].includes(filter.operator)) return null;
    if (filter.operator === 'in' && (!Array.isArray(filter.value) || filter.value.length > 100)) return null;
    if (filter.operator === 'eq' && (filter.value === null || ['object', 'function'].includes(typeof filter.value))) return null;
  }
  return filters;
}

function encodeFilter(filter) {
  if (filter.operator === 'eq') return `eq.${String(filter.value)}`;
  const values = filter.value.map((value) => {
    const stringValue = String(value);
    if (/[(),"\\]/.test(stringValue)) throw new Error('Invalid filter value.');
    return typeof value === 'string' ? `"${stringValue}"` : stringValue;
  });
  return `in.(${values.join(',')})`;
}

function safeSelection(table, requested) {
  if (table === 'users') return 'id,username,full_name,email,phone,role,is_active,must_reset_password,created_at';
  if (typeof requested !== 'string') return '*';
  if (requested.replace(/\s/g, '') === '*,cars(name)') {
    return ['rental_records', 'daily_notes', 'service_records', 'completeness_items', 'damages'].includes(table)
      ? '*,cars(name)'
      : '*';
  }
  const columns = requested.split(',').map((column) => column.trim());
  if (columns.length > 0 && columns.every((column) => COLUMNS[table].has(column))) return columns.join(',');
  return '*';
}

function buildPostgrestUrl(env, table, body) {
  if (!TABLES.has(table)) throw new Error('Table is not available through the application API.');
  const url = new URL(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${table}`);
  url.searchParams.set('select', safeSelection(table, body.select));
  const filters = validateFilters(table, body.filters ?? []);
  if (!filters) throw new Error('Invalid query filters.');
  for (const filter of filters) url.searchParams.set(filter.column, encodeFilter(filter));

  if (body.order) {
    if (!COLUMNS[table].has(body.order.column) || typeof body.order.ascending !== 'boolean') throw new Error('Invalid order parameter.');
    url.searchParams.set('order', `${body.order.column}.${body.order.ascending ? 'asc' : 'desc'}`);
  }
  return url;
}

async function proxyQuery(env, user, body) {
  const { table } = body;
  if (!TABLES.has(table) || !userCanRead(table, user.role)) return { status: 403, error: 'Role is not allowed to read this table.' };
  let query = body;
  if (table === 'rental_records' && [3, 4].includes(user.role)) {
    const filters = validateFilters(table, body.filters ?? []);
    if (!filters) throw new Error('Invalid query filters.');
    const requestedSelection = body.select?.replace(/\s/g, '');
    const isAvailabilityQuery = requestedSelection === 'car_id,status' || requestedSelection === 'car_id,status,start_date,end_date';
    const isDateAvailabilityQuery = requestedSelection === 'car_id,status,start_date,end_date';
    query = {
      ...body,
      filters: [
        ...filters.filter((filter) => filter.column !== 'user_id' && (!isAvailabilityQuery || filter.column !== 'status')),
        ...(isAvailabilityQuery
          ? [{ column: 'status', operator: 'in', value: ['pending', 'active', 'approved', 'overdue'] }]
          : [{ column: 'user_id', operator: 'eq', value: user.id }]),
      ],
      ...(isAvailabilityQuery ? { select: isDateAvailabilityQuery ? 'car_id,status,start_date,end_date' : 'car_id,status' } : {}),
    };
  }
  const url = buildPostgrestUrl(env, table, query);
  const response = await fetch(url, { headers: serviceHeaders(env) });
  const result = await response.json().catch(() => null);
  if (!response.ok) return { status: response.status, error: result?.message ?? 'Database query failed.' };
  if (body.single) {
    if (!Array.isArray(result) || result.length === 0) return { status: 404, error: 'Record not found.' };
    return { status: 200, data: result[0] };
  }
  return { status: 200, data: result };
}

async function proxyMutation(env, user, body) {
  const { table, operation } = body;
  if (!TABLES.has(table) || !['insert', 'update', 'delete'].includes(operation) || !userCanWrite(table, operation, user.role)) {
    return { status: 403, error: 'Role is not allowed to perform this operation.' };
  }
  if (table === 'rental_records' && operation === 'insert') {
    return { status: 400, error: 'Rental records must be created through the cycle endpoint.' };
  }

  const requiredFilters = operation !== 'insert';
  const filters = validateFilters(table, body.filters ?? [], requiredFilters);
  if (!filters) return { status: 400, error: 'Invalid mutation filters.' };
  if (operation !== 'delete' && (!body.values || typeof body.values !== 'object' || Array.isArray(body.values))) {
    return { status: 400, error: 'Mutation data is invalid.' };
  }

  const values = operation === 'insert' ? { ...body.values } : body.values;
  if (table === 'rental_records' && operation === 'insert') {
    delete values.approved_by;
    delete values.approved_at;
    delete values.return_confirmed_by;
    delete values.return_confirmed_at;
    values.start_time ??= '00:00';
    if (user.role === 3 || user.role === 4) {
      values.user_id = user.id;
      values.status = 'pending';
    }
  }

  const url = buildPostgrestUrl(env, table, { select: body.select, filters: filters.map((filter) => ({ ...filter, value: filter.value })) });
  const method = operation === 'insert' ? 'POST' : operation === 'update' ? 'PATCH' : 'DELETE';
  const headers = serviceHeaders(env, { Prefer: 'return=representation' });
  if (operation !== 'delete') headers['Content-Type'] = 'application/json';
  const response = await fetch(url, {
    method,
    headers,
    ...(operation === 'delete' ? {} : { body: JSON.stringify(values) }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) return { status: response.status, error: result?.message ?? 'Database mutation failed.' };
  if (body.single) {
    if (!Array.isArray(result) || result.length === 0) return { status: 404, error: 'Record not found.' };
    return { status: 200, data: result[0] };
  }
  return { status: 200, data: result };
}

async function login(request, env) {
  const missingBindings = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'APP_JWT_SECRET', 'AUTH_IP_LIMITER', 'AUTH_USERNAME_LIMITER']
    .filter((name) => !env[name]);
  if (missingBindings.length > 0) {
    return { status: 503, error: `Authentication service is not configured. Missing: ${missingBindings.join(', ')}.` };
  }
  const ipLimit = await env.AUTH_IP_LIMITER.limit({ key: request.headers.get('CF-Connecting-IP') || 'unknown' });
  if (!ipLimit.success) return { status: 429, error: 'Too many login attempts. Try again shortly.' };

  let body;
  try {
    body = await request.json();
  } catch {
    return { status: 400, error: 'Invalid JSON body.' };
  }
  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!username || !password) return { status: 400, error: 'Username and password are required.' };
  const usernameLimit = await env.AUTH_USERNAME_LIMITER.limit({ key: username.toLowerCase() });
  if (!usernameLimit.success) return { status: 429, error: 'Too many login attempts. Try again shortly.' };

  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/auth_login`, {
    method: 'POST',
    headers: serviceHeaders(env, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ _username: username, _password: password }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(result) || !result[0]) return { status: 401, error: 'Username or password is invalid.' };
  const user = result[0];
  const expiresAt = Math.floor(Date.now() / 1000) + 8 * 60 * 60;
  const token = await signToken({ sub: user.id, exp: expiresAt }, env.APP_JWT_SECRET);
  return { status: 200, data: { user, token, expiresAt: expiresAt * 1000 } };
}

async function register(request, env) {
  const missingBindings = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'APP_JWT_SECRET', 'AUTH_IP_LIMITER', 'AUTH_USERNAME_LIMITER']
    .filter((name) => !env[name]);
  if (missingBindings.length > 0) {
    return { status: 503, error: `Authentication service is not configured. Missing: ${missingBindings.join(', ')}.` };
  }
  const ipLimit = await env.AUTH_IP_LIMITER.limit({ key: request.headers.get('CF-Connecting-IP') || 'unknown' });
  if (!ipLimit.success) return { status: 429, error: 'Too many registration attempts. Try again shortly.' };

  let body;
  try {
    body = await request.json();
  } catch {
    return { status: 400, error: 'Invalid JSON body.' };
  }
  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  const fullName = typeof body?.fullName === 'string' ? body.fullName.trim() : '';
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!/^[a-zA-Z0-9._-]{3,30}$/.test(username)) return { status: 400, error: 'Username must be 3-30 characters and use only letters, numbers, dots, underscores, or hyphens.' };
  if (!fullName || fullName.length > 100) return { status: 400, error: 'Full name is required and must be at most 100 characters.' };
  if (email.length > 254 || !/^\S+@\S+\.\S+$/.test(email)) return { status: 400, error: 'A valid email address is required.' };
  if (phone.length > 30 || phone.replace(/\D/g, '').length < 7) return { status: 400, error: 'A valid phone number is required.' };
  if (password.length < 8 || password.length > 128) return { status: 400, error: 'Password must be between 8 and 128 characters.' };

  const usernameLimit = await env.AUTH_USERNAME_LIMITER.limit({ key: `register:${username.toLowerCase()}` });
  if (!usernameLimit.success) return { status: 429, error: 'Too many registration attempts. Try again shortly.' };

  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/auth_register`, {
    method: 'POST',
    headers: serviceHeaders(env, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ _username: username, _full_name: fullName, _email: email, _phone: phone, _password: password }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error('Account registration failed.');
  if (!Array.isArray(result) || !result[0]) return { status: 409, error: 'Username is already taken.' };
  const user = result[0];
  const expiresAt = Math.floor(Date.now() / 1000) + 8 * 60 * 60;
  const token = await signToken({ sub: user.id, exp: expiresAt }, env.APP_JWT_SECRET);
  return { status: 201, data: { user, token, expiresAt: expiresAt * 1000 } };
}

async function updateUserProfile(request, env, user) {
  let body;
  try {
    body = await request.json();
  } catch {
    return { status: 400, error: 'Invalid JSON body.' };
  }

  const fullName = typeof body?.full_name === 'string' ? body.full_name.trim() : '';
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';
  if (!fullName || fullName.length > 100) return { status: 400, error: 'Nama lengkap wajib diisi dan maksimal 100 karakter.' };
  if (email.length > 254 || !/^\S+@\S+\.\S+$/.test(email)) return { status: 400, error: 'Alamat email tidak valid.' };
  if (phone.length > 30 || phone.replace(/\D/g, '').length < 7) return { status: 400, error: 'Nomor telepon tidak valid.' };

  const url = new URL(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/users`);
  url.searchParams.set('id', `eq.${user.id}`);
  url.searchParams.set('select', 'id,username,full_name,email,phone,role,is_active,created_at');
  const response = await fetch(url, {
    method: 'PATCH',
    headers: serviceHeaders(env, { 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify({ full_name: fullName, email, phone }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) return { status: 400, error: result?.message ?? 'Profile update failed.' };
  if (!Array.isArray(result) || !result[0]) return { status: 404, error: 'Profil pengguna tidak ditemukan.' };
  return { status: 200, data: result[0] };
}

async function completeFirstLogin(request, env, user) {
  if (!user.must_reset_password) return { status: 409, error: 'Akun ini tidak memerlukan onboarding.' };

  let body;
  try {
    body = await request.json();
  } catch {
    return { status: 400, error: 'Invalid JSON body.' };
  }

  const fullName = typeof body?.full_name === 'string' ? body.full_name.trim() : '';
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';
  const newPassword = typeof body?.new_password === 'string' ? body.new_password : '';
  if (!fullName || fullName.length > 100) return { status: 400, error: 'Nama lengkap wajib diisi dan maksimal 100 karakter.' };
  if (email.length > 254 || !/^\S+@\S+\.\S+$/.test(email)) return { status: 400, error: 'Alamat email tidak valid.' };
  if (phone.length > 30 || phone.replace(/\D/g, '').length < 7) return { status: 400, error: 'Nomor telepon tidak valid.' };
  if (newPassword.length < 8 || newPassword.length > 128) return { status: 400, error: 'Password baru harus 8 sampai 128 karakter.' };

  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/complete_user_first_login`, {
    method: 'POST',
    headers: serviceHeaders(env, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      _user_id: user.id,
      _full_name: fullName,
      _email: email,
      _phone: phone,
      _new_password: newPassword,
    }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(result) || !result[0]) {
    return { status: 409, error: typeof result?.message === 'string' ? result.message : 'Onboarding akun gagal disimpan.' };
  }
  return { status: 200, data: result[0] };
}

async function proxyNotification(request, env, user, path, headers) {
  const allowed = path === '/api/rental-created'
    ? [1, 3, 4].includes(user.role)
    : path === '/api/rental-approved' && user.role === 1;
  if (!allowed) return Response.json({ error: 'Role is not allowed to send this notification.' }, { status: 403, headers });
  if (!env.RENTAL_AUTOMATION_URL) return Response.json({ error: 'Rental automation is not configured.' }, { status: 503, headers });

  let payload;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400, headers });
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return Response.json({ error: 'Invalid notification payload.' }, { status: 400, headers });

  try {
    const response = await fetch(env.RENTAL_AUTOMATION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) return Response.json({ error: `Webhook returned ${response.status}.` }, { status: 502, headers });
    return Response.json({ ok: true }, { headers });
  } catch {
    return Response.json({ error: 'Webhook request failed.' }, { status: 502, headers });
  }
}

async function createRentalCycle(request, env, user, headers) {
  if (![1, 2, 3, 4].includes(user.role)) return { status: 403, error: 'Role is not allowed to create rental cycles.' };

  let body;
  try {
    body = await request.json();
  } catch {
    return { status: 400, error: 'Invalid JSON body.' };
  }

  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const timePattern = /^\d{2}:\d{2}(?::\d{2})?$/;
  const renterName = typeof user.full_name === 'string' ? user.full_name.trim() : '';
  const renterEmail = typeof user.email === 'string' ? user.email.trim().toLowerCase() : '';
  const renterPhone = typeof user.phone === 'string' ? user.phone.trim() : '';
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || !Array.isArray(body.car_ids) || body.car_ids.length === 0 || body.car_ids.length > 25
    || body.car_ids.some((carId) => typeof carId !== 'string' || !uuidPattern.test(carId))
    || new Set(body.car_ids).size !== body.car_ids.length
    || !renterName
    || !/^\S+@\S+\.\S+$/.test(renterEmail)
    || renterPhone.replace(/\D/g, '').length < 7
    || typeof body.start_date !== 'string' || !datePattern.test(body.start_date)
    || (body.end_date !== null && (typeof body.end_date !== 'string' || !datePattern.test(body.end_date)))
    || typeof body.start_time !== 'string' || !timePattern.test(body.start_time)
    || (body.end_time !== null && (typeof body.end_time !== 'string' || !timePattern.test(body.end_time)))
    || (body.end_date !== null && body.end_date < body.start_date)
    || (body.end_date === body.start_date && body.end_time !== null && body.end_time <= body.start_time)) {
    return { status: 400, error: 'Data siklus peminjaman tidak valid.' };
  }

  const rpcUrl = new URL(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/create_rental_cycle`);
  const rpcResponse = await fetch(rpcUrl, {
    method: 'POST',
    headers: serviceHeaders(env, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      _user_id: user.id,
      _user_role: user.role,
      _car_ids: body.car_ids,
      _renter_name: renterName,
      _renter_email: renterEmail,
      _renter_phone: renterPhone,
      _start_date: body.start_date,
      _start_time: body.start_time,
      _end_date: body.end_date ?? null,
      _end_time: body.end_time,
      _purpose: typeof body.purpose === 'string' ? body.purpose.trim() : '',
      _notes: typeof body.notes === 'string' ? body.notes.trim() : '',
    }),
  });
  const result = await rpcResponse.json().catch(() => null);
  if (!rpcResponse.ok) {
    const error = typeof result?.message === 'string' ? result.message : 'Rental cycle creation failed.';
    const isConflict = /Siklus peminjaman|Unit sudah terbooking/i.test(error);
    return { status: isConflict ? 409 : 400, error };
  }
  return { status: 201, data: result };
}

async function confirmRentalReturn(request, env, user) {
  if (![1, 2].includes(user.role)) return { status: 403, error: 'Hanya Role 1 atau 2 yang dapat mengonfirmasi pengembalian.' };

  let body;
  try {
    body = await request.json();
  } catch {
    return { status: 400, error: 'Invalid JSON body.' };
  }

  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!body || typeof body.rental_id !== 'string' || !uuidPattern.test(body.rental_id)) {
    return { status: 400, error: 'ID rental tidak valid.' };
  }

  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/confirm_rental_return`, {
    method: 'POST',
    headers: serviceHeaders(env, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ _rental_id: body.rental_id, _confirmed_by: user.id, _user_role: user.role }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) return { status: 409, error: typeof result?.message === 'string' ? result.message : 'Konfirmasi pengembalian gagal.' };
  return { status: 200, data: result };
}

async function approveRentalCycleUnit(request, env, user) {
  if (user.role !== 1) return { status: 403, error: 'Hanya Super Admin (Role 1) yang dapat menyetujui rental.' };

  let body;
  try {
    body = await request.json();
  } catch {
    return { status: 400, error: 'Invalid JSON body.' };
  }

  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!body || typeof body.rental_id !== 'string' || !uuidPattern.test(body.rental_id)
    || typeof body.car_id !== 'string' || !uuidPattern.test(body.car_id)) {
    return { status: 400, error: 'ID rental atau unit tidak valid.' };
  }

  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/approve_rental_cycle_unit`, {
    method: 'POST',
    headers: serviceHeaders(env, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ _rental_id: body.rental_id, _car_id: body.car_id, _approved_by: user.id, _user_role: user.role }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) return { status: 409, error: typeof result?.message === 'string' ? result.message : 'Approval rental gagal.' };
  return { status: 200, data: result };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const routes = new Set([
      '/api/auth/login',
      '/api/auth/register',
      '/api/auth/complete-profile',
      '/api/profile/update',
      '/api/data/query',
      '/api/data/insert',
      '/api/data/update',
      '/api/data/delete',
      '/api/rentals/create-cycle',
      '/api/rentals/confirm-return',
      '/api/rentals/approve-unit',
      '/api/rental-created',
      '/api/rental-approved',
    ]);
    if (!routes.has(url.pathname)) return env.ASSETS.fetch(request);

    const origin = request.headers.get('Origin');
    const headers = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Methods': CORS_METHODS,
      'Access-Control-Allow-Headers': CORS_HEADERS,
      'Vary': 'Origin',
      ...(env.APP_ORIGIN ? { 'Access-Control-Allow-Origin': env.APP_ORIGIN } : {}),
    };
    if (origin && (!env.APP_ORIGIN || origin !== env.APP_ORIGIN)) return Response.json({ error: 'Origin not allowed.' }, { status: 403, headers });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return Response.json({ error: 'Method not allowed.' }, { status: 405, headers });

    if (url.pathname === '/api/auth/login' || url.pathname === '/api/auth/register') {
      try {
        const result = url.pathname === '/api/auth/login'
          ? await login(request, env)
          : await register(request, env);
        return Response.json(result.data ?? { error: result.error }, { status: result.status, headers });
      } catch (error) {
        console.error('Authentication failed:', error);
        return Response.json({ error: 'Authentication service failed.' }, { status: 503, headers });
      }
    }

    let user;
    try {
      user = await authenticate(request, env);
    } catch (error) {
      console.error('Authentication failed:', error);
      return Response.json({ error: 'Authentication service failed.' }, { status: 503, headers });
    }
    if (!user) return Response.json({ error: 'Session is invalid or expired.' }, { status: 401, headers });

    if (url.pathname === '/api/auth/complete-profile') {
      try {
        const result = await completeFirstLogin(request, env, user);
        return Response.json(result.status >= 400 ? { error: result.error } : { data: result.data }, { status: result.status, headers });
      } catch (error) {
        console.error('First login setup failed:', error);
        return Response.json({ error: 'First login setup failed.' }, { status: 503, headers });
      }
    }

    if (user.must_reset_password) {
      return Response.json({ error: 'Selesaikan penggantian password dan profil sebelum menggunakan aplikasi.' }, { status: 403, headers });
    }

    if (url.pathname === '/api/rentals/create-cycle') {
      try {
        const result = await createRentalCycle(request, env, user, headers);
        return Response.json(result.status >= 400 ? { error: result.error } : { data: result.data }, { status: result.status, headers });
      } catch (error) {
        console.error('Rental cycle creation failed:', error);
        return Response.json({ error: 'Rental cycle creation failed.' }, { status: 503, headers });
      }
    }

    if (url.pathname === '/api/profile/update') {
      try {
        const result = await updateUserProfile(request, env, user);
        return Response.json(result.status >= 400 ? { error: result.error } : { data: result.data }, { status: result.status, headers });
      } catch (error) {
        console.error('Profile update failed:', error);
        return Response.json({ error: 'Profile update failed.' }, { status: 503, headers });
      }
    }

    if (url.pathname === '/api/rentals/confirm-return') {
      try {
        const result = await confirmRentalReturn(request, env, user);
        return Response.json(result.status >= 400 ? { error: result.error } : { data: result.data }, { status: result.status, headers });
      } catch (error) {
        console.error('Rental return confirmation failed:', error);
        return Response.json({ error: 'Rental return confirmation failed.' }, { status: 503, headers });
      }
    }

    if (url.pathname === '/api/rentals/approve-unit') {
      try {
        const result = await approveRentalCycleUnit(request, env, user);
        return Response.json(result.status >= 400 ? { error: result.error } : { data: result.data }, { status: result.status, headers });
      } catch (error) {
        console.error('Rental approval failed:', error);
        return Response.json({ error: 'Rental approval failed.' }, { status: 503, headers });
      }
    }

    if (url.pathname === '/api/data/query' || url.pathname === '/api/data/insert' || url.pathname === '/api/data/update' || url.pathname === '/api/data/delete') {
      let body;
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: 'Invalid JSON body.' }, { status: 400, headers });
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({ error: 'Invalid request.' }, { status: 400, headers });
      try {
        const result = url.pathname.endsWith('/query')
          ? await proxyQuery(env, user, body)
          : await proxyMutation(env, user, { ...body, operation: url.pathname.split('/').at(-1) });
        return Response.json(result.status >= 400 ? { error: result.error } : { data: result.data }, { status: result.status, headers });
      } catch (error) {
        console.error('Data proxy failed:', error);
        return Response.json({ error: error instanceof Error ? error.message : 'Data request failed.' }, { status: 400, headers });
      }
    }

    return proxyNotification(request, env, user, url.pathname, headers);
  },
};
