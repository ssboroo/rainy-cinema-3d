import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../server/app.js';

function makeApp(integrations = {}) {
  const pool = { query: async () => ({ rows: [{ ok: 1 }], rowCount: 1 }) };
  return buildApp({
    env: { JWT_SECRET: 'integration-test-secret-that-is-longer-than-32-chars', CORS_ORIGINS: 'http://localhost:5173' },
    pool,
    logger: false,
    integrations
  });
}
async function operatorToken(app) {
  await app.ready();
  return app.jwt.sign({
    sub: '00000000-0000-4000-8000-000000000002',
    tenantId: '00000000-0000-4000-8000-000000000003',
    role: 'OPERATOR'
  });
}

test('integration registry is protected and describes provider access requirements', async () => {
  const app = makeApp();
  const unauthorized = await app.inject({ method: 'GET', url: '/api/v1/integrations' });
  assert.equal(unauthorized.statusCode, 401);
  const token = await operatorToken(app);
  const response = await app.inject({ method: 'GET', url: '/api/v1/integrations', headers: { authorization: 'Bearer ' + token } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.find(item => item.id === 'vista-connect').status, 'NOT_CONFIGURED');
  assert.equal(response.json().data.find(item => item.id === 'tix').status, 'PARTNER_ACCESS_REQUIRED');
  await app.close();
});

test('configured Vista adapter exposes live provider data only to operators', async () => {
  const vista = {
    health: async () => ({ status: 'connected', provider: 'vista-connect', sessionsVisible: 1 }),
    getSessions: async () => [{ id: 's1', movieTitle: 'Demo' }],
    getSeatPlan: async () => [{ code: 'A1', status: 'AVAILABLE' }]
  };
  const app = makeApp({ vista });
  const token = await operatorToken(app);
  const headers = { authorization: 'Bearer ' + token };
  const health = await app.inject({ method: 'GET', url: '/api/v1/integrations/vista-connect/health', headers });
  const sessions = await app.inject({ method: 'GET', url: '/api/v1/integrations/vista-connect/sessions', headers });
  const seats = await app.inject({ method: 'GET', url: '/api/v1/integrations/vista-connect/sessions/s1/seats', headers });
  assert.equal(health.json().status, 'connected');
  assert.equal(sessions.json().data[0].id, 's1');
  assert.equal(seats.json().data[0].code, 'A1');
  await app.close();
});

test('Vista routes return a clear setup error when credentials are absent', async () => {
  const app = makeApp();
  const token = await operatorToken(app);
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/integrations/vista-connect/sessions',
    headers: { authorization: 'Bearer ' + token }
  });
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().error.code, 'PROVIDER_NOT_CONFIGURED');
  await app.close();
});
