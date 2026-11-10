import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCinemaProviderAdapter } from '../server/integrations/provider-contract.js';

test('provider contract exposes only implemented optional capabilities', () => {
  const provider = validateCinemaProviderAdapter('example', {
    health: async () => ({ status: 'connected' }),
    getSessions: async () => [],
    getSeatPlan: async () => [],
    createOrder: async () => ({ id: 'order-1' })
  });
  assert.deepEqual(provider.capabilities, ['sessions', 'seat-plan', 'createOrder']);
});

test('provider contract rejects missing required operations', () => {
  assert.throws(() => validateCinemaProviderAdapter('broken', {
    health: async () => ({ status: 'connected' })
  }), { code: 'INVALID_PROVIDER_ADAPTER' });
});
