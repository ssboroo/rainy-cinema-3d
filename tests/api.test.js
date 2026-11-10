import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../server/app.js';

function makeApp() {
  const pool = { query: async () => ({ rows: [{ ok: 1 }], rowCount: 1 }) };
  return buildApp({
    env: { JWT_SECRET: 'unit-test-secret-that-is-longer-than-32-characters', CORS_ORIGINS: 'http://localhost:5173' },
    pool,
    logger: false
  });
}

test('health endpoints expose liveness and database readiness', async () => {
  const app = makeApp();
  const live = await app.inject({ method: 'GET', url: '/health/live' });
  const ready = await app.inject({ method: 'GET', url: '/health/ready' });
  assert.equal(live.statusCode, 200);
  assert.deepEqual(live.json(), { status: 'ok' });
  assert.equal(ready.statusCode, 200);
  assert.deepEqual(ready.json(), { status: 'ready' });
  await app.close();
});

test('inventory endpoint rejects unauthenticated callers', async () => {
  const app = makeApp();
  const response = await app.inject({ method: 'GET', url: '/api/v1/showtimes/00000000-0000-4000-8000-000000000001/seats' });
  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.code, 'UNAUTHENTICATED');
  assert.ok(response.json().error.requestId);
  await app.close();
});

test('login validates input before touching persistence', async () => {
  const app = makeApp();
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'not-an-email' } });
  assert.equal(response.statusCode, 422);
  assert.equal(response.json().error.code, 'VALIDATION_ERROR');
  await app.close();
});

test('authenticated customers can enter the seat-hold flow without operator privileges', async () => {
  const app = makeApp();
  await app.ready();
  const token = app.jwt.sign({
    sub: '00000000-0000-4000-8000-000000000002',
    tenantId: '00000000-0000-4000-8000-000000000003',
    role: 'VIEWER'
  });
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/showtimes/00000000-0000-4000-8000-000000000001/holds',
    headers: { authorization: 'Bearer ' + token, 'idempotency-key': 'customer-test-001' },
    payload: { seatIds: [] }
  });
  assert.equal(response.statusCode, 422);
  assert.equal(response.json().error.code, 'VALIDATION_ERROR');
  await app.close();
});

test('cinema administration routes enforce operator role and validate payloads', async () => {
  const app = makeApp();
  await app.ready();
  const viewerToken = app.jwt.sign({
    sub: '00000000-0000-4000-8000-000000000002',
    tenantId: '00000000-0000-4000-8000-000000000003',
    role: 'VIEWER'
  });
  const forbidden = await app.inject({
    method: 'POST',
    url: '/api/v1/cinemas',
    headers: { authorization: `Bearer ${viewerToken}` },
    payload: { name: 'Cinema' }
  });
  assert.equal(forbidden.statusCode, 403);

  const operatorToken = app.jwt.sign({
    sub: '00000000-0000-4000-8000-000000000002',
    tenantId: '00000000-0000-4000-8000-000000000003',
    role: 'OPERATOR'
  });
  const invalid = await app.inject({
    method: 'POST',
    url: '/api/v1/cinemas',
    headers: { authorization: `Bearer ${operatorToken}` },
    payload: { name: 'X' }
  });
  assert.equal(invalid.statusCode, 422);
  assert.equal(invalid.json().error.code, 'VALIDATION_ERROR');
  await app.close();
});
