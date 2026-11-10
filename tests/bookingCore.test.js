import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSeatIds, calculateTotal, createHold, isHoldActive, transitionBooking } from '../server/domain/booking.js';

test('normalizes seat IDs and rejects duplicate or invalid seats', () => {
  assert.deepEqual(normalizeSeatIds([' a1 ', 'H12']), ['A1', 'H12']);
  assert.throws(() => normalizeSeatIds(['A1', 'A1']), { code: 'DUPLICATE_SEAT' });
  assert.throws(() => normalizeSeatIds(['Z0']), { code: 'INVALID_SEAT' });
  assert.throws(() => normalizeSeatIds([]), { code: 'INVALID_SELECTION' });
  assert.throws(() => normalizeSeatIds(Array.from({ length: 7 }, (_, i) => `A${i + 1}`)), { code: 'SELECTION_LIMIT' });
});

test('calculates totals in integer MNT and rejects invalid prices', () => {
  assert.equal(calculateTotal([{ priceMnt: 18000 }, { priceMnt: 25000 }]), 43000);
  assert.throws(() => calculateTotal([{ priceMnt: -1 }]), { code: 'INVALID_PRICE' });
});

test('creates a time-bounded hold with server-controlled expiry', () => {
  const now = new Date('2026-11-10T04:00:00.000Z');
  const hold = createHold({ id: 'hold-1', seatIds: ['A1', 'A2'], ttlSeconds: 600 }, now);
  assert.equal(hold.expiresAt.toISOString(), '2026-11-10T04:10:00.000Z');
  assert.equal(isHoldActive(hold, now), true);
  assert.equal(isHoldActive(hold, new Date('2026-11-10T04:10:00.000Z')), false);
});

test('booking transitions require payment confirmation and cannot revive cancelled bookings', () => {
  assert.equal(transitionBooking('PENDING_PAYMENT', 'PAYMENT_SUCCEEDED'), 'CONFIRMED');
  assert.equal(transitionBooking('PENDING_PAYMENT', 'CANCEL'), 'CANCELLED');
  assert.throws(() => transitionBooking('PENDING_PAYMENT', 'CONFIRM'), { code: 'PAYMENT_NOT_VERIFIED' });
  assert.throws(() => transitionBooking('CANCELLED', 'PAYMENT_SUCCEEDED'), { code: 'INVALID_TRANSITION' });
});
