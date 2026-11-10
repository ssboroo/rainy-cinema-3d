const SEAT_ID = /^[A-H](?:[1-9]|1[0-2])$/;
const MAX_SELECTION = 6;
const DEFAULT_TTL_SECONDS = 600;
const MAX_TTL_SECONDS = 900;

function domainError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function normalizeSeatIds(input) {
  if (!Array.isArray(input) || input.length < 1) {
    throw domainError('INVALID_SELECTION', 'Select at least one seat.');
  }
  if (input.length > MAX_SELECTION) {
    throw domainError('SELECTION_LIMIT', `You can select up to ${MAX_SELECTION} seats.`);
  }
  const ids = input.map(value => typeof value === 'string' ? value.trim().toUpperCase() : '');
  if (ids.some(id => !SEAT_ID.test(id))) {
    throw domainError('INVALID_SEAT', 'One or more seat identifiers are invalid.');
  }
  if (new Set(ids).size !== ids.length) {
    throw domainError('DUPLICATE_SEAT', 'A seat can only be included once.');
  }
  return ids;
}

export function calculateTotal(seats) {
  if (!Array.isArray(seats)) throw domainError('INVALID_PRICE', 'Seat prices are invalid.');
  return seats.reduce((total, seat) => {
    const price = seat?.priceMnt;
    if (!Number.isSafeInteger(price) || price < 0) {
      throw domainError('INVALID_PRICE', 'Seat prices must be non-negative integer MNT amounts.');
    }
    const next = total + price;
    if (!Number.isSafeInteger(next)) throw domainError('INVALID_PRICE', 'Total exceeds the supported amount.');
    return next;
  }, 0);
}

export function createHold({ id, seatIds, ttlSeconds = DEFAULT_TTL_SECONDS }, now = new Date()) {
  const normalizedSeatIds = normalizeSeatIds(seatIds);
  const ttl = Number.isInteger(ttlSeconds) ? ttlSeconds : DEFAULT_TTL_SECONDS;
  if (ttl < 60 || ttl > MAX_TTL_SECONDS) {
    throw domainError('INVALID_HOLD_TTL', 'Hold duration must be between 60 and 900 seconds.');
  }
  const createdAt = new Date(now);
  if (Number.isNaN(createdAt.getTime())) throw domainError('INVALID_TIME', 'Invalid hold creation time.');
  return {
    id,
    seatIds: normalizedSeatIds,
    createdAt,
    expiresAt: new Date(createdAt.getTime() + ttl * 1000),
    status: 'ACTIVE'
  };
}

export function isHoldActive(hold, now = new Date()) {
  return Boolean(hold && hold.status === 'ACTIVE' && hold.expiresAt instanceof Date &&
    Number.isFinite(hold.expiresAt.getTime()) && hold.expiresAt.getTime() > new Date(now).getTime());
}

export function transitionBooking(status, event) {
  const transitions = {
    PENDING_PAYMENT: { PAYMENT_SUCCEEDED: 'CONFIRMED', CANCEL: 'CANCELLED', PAYMENT_FAILED: 'PAYMENT_FAILED' },
    PAYMENT_FAILED: { RETRY_PAYMENT: 'PENDING_PAYMENT', CANCEL: 'CANCELLED' },
    CONFIRMED: { CANCEL: 'CANCELLED' },
    CANCELLED: {}
  };
  if (event === 'CONFIRM' && status === 'PENDING_PAYMENT') {
    throw domainError('PAYMENT_NOT_VERIFIED', 'A booking can only be confirmed by a verified payment event.');
  }
  const next = transitions[status]?.[event];
  if (!next) throw domainError('INVALID_TRANSITION', `Cannot apply ${event} to booking in ${status} state.`);
  return next;
}
