const assert = require('node:assert/strict');
const { before, test } = require('node:test');

let worker;
before(async () => {
  worker = (await import('../worker.js')).default;
});

const origin = 'https://garaciku.example.test';
const profile = {
  id: 'profile-123',
  username: 'EMP001',
  full_name: 'Test User',
  role: 1,
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
};

function envFor(role = profile.role) {
  return {
    APP_ORIGIN: origin,
    APP_JWT_SECRET: 'a-long-test-secret-for-worker-hmac-signing',
    SUPABASE_URL: 'https://supabase.example.test',
    SUPABASE_ANON_KEY: 'test-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    RENTAL_AUTOMATION_URL: 'https://automation.example.test/hook',
    ASSETS: { fetch: async () => new Response('asset') },
    testRole: role,
  };
}

function makeRequest(path, body, token) {
  return new Request(`https://garaciku.example.test${path}`, {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function mockFetch(role, databaseRows = []) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input);
    calls.push({ url, options });
    if (url.pathname === '/rest/v1/rpc/auth_login') {
      return Response.json([{ ...profile, role }]);
    }
    if (url.pathname === '/rest/v1/users') {
      return Response.json([{ ...profile, role }]);
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      if (options.method === 'PATCH' && role === 3) return Response.json({ message: 'must not reach this route' }, { status: 403 });
      return Response.json(databaseRows, { status: 200 });
    }
    if (url.href.startsWith('https://automation.example.test/')) return new Response(null, { status: 202 });
    throw new Error(`Unexpected fetch ${url.href}`);
  };
  return { calls, restore: () => { globalThis.fetch = originalFetch; } };
}

async function login(env, calls) {
  const response = await worker.fetch(makeRequest('/api/auth/login', { username: 'EMP001', password: 'valid-password' }), env);
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.ok(result.token);
  assert.equal(result.user.username, 'EMP001');
  return result.token;
}

test('table-user login verifies through the private RPC and returns a signed session', async () => {
  const mock = mockFetch(1);
  try {
    const token = await login(envFor(1), mock.calls);
    const rpcCall = mock.calls.find((call) => call.url.pathname === '/rest/v1/rpc/auth_login');
    assert.equal(rpcCall.options.headers.apikey, 'test-service-role-key');
    assert.match(token, /^[^.]+\.[^.]+\.[^.]+$/);
  } finally {
    mock.restore();
  }
});

test('login identifies missing runtime binding names without exposing values', async () => {
  const mock = mockFetch(1);
  try {
    const env = envFor(1);
    delete env.SUPABASE_SERVICE_ROLE_KEY;
    const response = await worker.fetch(makeRequest('/api/auth/login', {
      username: 'EMP001',
      password: 'valid-password',
    }), env);
    const result = await response.json();
    assert.equal(response.status, 503);
    assert.equal(result.error, 'Authentication service is not configured. Missing: SUPABASE_SERVICE_ROLE_KEY.');
    assert.equal(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});

test('authenticated data query is proxied and returned in the expected envelope', async () => {
  const mock = mockFetch(1, [{ id: 'car-1', name: 'Zenix' }]);
  try {
    const token = await login(envFor(1), mock.calls);
    const response = await worker.fetch(makeRequest('/api/data/query', { table: 'cars', select: '*', filters: [], single: false }, token), envFor(1));
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(result.data, [{ id: 'car-1', name: 'Zenix' }]);
    assert.equal(mock.calls.some((call) => call.url.pathname === '/rest/v1/cars'), true);
  } finally {
    mock.restore();
  }
});

test('query projection forwards only the requested rental columns', async () => {
  const mock = mockFetch(3, [{ car_id: 'car-1', status: 'active' }]);
  try {
    const token = await login(envFor(3), mock.calls);
    const response = await worker.fetch(makeRequest('/api/data/query', {
      table: 'rental_records',
      select: 'car_id, status',
      filters: [{ column: 'status', operator: 'in', value: ['active', 'approved', 'overdue'] }],
      single: false,
    }, token), envFor(3));
    const result = await response.json();
    const query = mock.calls.find((call) => call.url.pathname === '/rest/v1/rental_records');
    assert.equal(response.status, 200);
    assert.equal(query.url.searchParams.get('select'), 'car_id,status');
    assert.deepEqual(result.data, [{ car_id: 'car-1', status: 'active' }]);
  } finally {
    mock.restore();
  }
});

test('role 3 cannot update daily notes through the Worker', async () => {
  const mock = mockFetch(3);
  try {
    const token = await login(envFor(3), mock.calls);
    const before = mock.calls.length;
    const response = await worker.fetch(makeRequest('/api/data/update', {
      table: 'daily_notes',
      filters: [{ column: 'id', operator: 'eq', value: 'note-1' }],
      values: { content: 'tampered' },
      single: true,
    }, token), envFor(3));
    assert.equal(response.status, 403);
    assert.equal(mock.calls.slice(before).some((call) => call.options.method === 'PATCH'), false);
  } finally {
    mock.restore();
  }
});

test('role 2 can create and delete completeness items', async () => {
  const mock = mockFetch(2, [{ id: 'item-1' }]);
  try {
    const token = await login(envFor(2), mock.calls);
    const createResponse = await worker.fetch(makeRequest('/api/data/insert', {
      table: 'completeness_items',
      values: { car_id: 'car-1', name: 'Spare tire' },
      single: true,
    }, token), envFor(2));
    assert.equal(createResponse.status, 200);

    const deleteResponse = await worker.fetch(makeRequest('/api/data/delete', {
      table: 'completeness_items',
      filters: [{ column: 'id', operator: 'eq', value: 'item-1' }],
    }, token), envFor(2));
    assert.equal(deleteResponse.status, 200);
    assert.equal(mock.calls.some((call) => call.options.method === 'POST' && call.url.pathname === '/rest/v1/completeness_items'), true);
    assert.equal(mock.calls.some((call) => call.options.method === 'DELETE' && call.url.pathname === '/rest/v1/completeness_items'), true);
  } finally {
    mock.restore();
  }
});

test('role 1 can update damage status', async () => {
  const mock = mockFetch(1, [{ id: 'damage-1', status: 'fixed' }]);
  try {
    const token = await login(envFor(1), mock.calls);
    const response = await worker.fetch(makeRequest('/api/data/update', {
      table: 'damages',
      filters: [{ column: 'id', operator: 'eq', value: 'damage-1' }],
      values: { status: 'fixed' },
      single: true,
    }, token), envFor(1));
    assert.equal(response.status, 200);
    assert.equal(mock.calls.some((call) => call.options.method === 'PATCH' && call.url.pathname === '/rest/v1/damages'), true);
  } finally {
    mock.restore();
  }
});

test('role 2 cannot delete damages through the Worker', async () => {
  const mock = mockFetch(2);
  try {
    const token = await login(envFor(2), mock.calls);
    const before = mock.calls.length;
    const response = await worker.fetch(makeRequest('/api/data/delete', {
      table: 'damages',
      filters: [{ column: 'id', operator: 'eq', value: 'damage-1' }],
    }, token), envFor(2));
    assert.equal(response.status, 403);
    assert.equal(mock.calls.slice(before).some((call) => call.options.method === 'DELETE'), false);
  } finally {
    mock.restore();
  }
});
