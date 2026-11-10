export const REQUIRED_PROVIDER_METHODS = Object.freeze(['health', 'getSessions', 'getSeatPlan']);
export const OPTIONAL_PROVIDER_METHODS = Object.freeze([
  'createOrder', 'setTickets', 'completeOrder', 'getBooking', 'cancelBooking', 'refundBooking'
]);

export function validateCinemaProviderAdapter(id, adapter) {
  if (!adapter || typeof adapter !== 'object') {
    throw Object.assign(new Error('Cinema provider adapter must be an object.'), { code: 'INVALID_PROVIDER_ADAPTER', statusCode: 500 });
  }
  const missing = REQUIRED_PROVIDER_METHODS.filter(method => typeof adapter[method] !== 'function');
  if (missing.length) {
    throw Object.assign(new Error('Cinema provider adapter is missing required methods: ' + missing.join(', ')), {
      code: 'INVALID_PROVIDER_ADAPTER',
      statusCode: 500
    });
  }
  return Object.freeze({
    id,
    adapter,
    capabilities: Object.freeze([
      'sessions',
      'seat-plan',
      ...OPTIONAL_PROVIDER_METHODS.filter(method => typeof adapter[method] === 'function')
    ])
  });
}
