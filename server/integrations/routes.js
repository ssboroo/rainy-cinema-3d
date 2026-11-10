import { VistaConnectAdapter } from './vista-connect.js';
import { validateCinemaProviderAdapter } from './provider-contract.js';

function configuredAdapters(env) {
  const result = {};
  if (env.CINEMA_PROVIDERS_JSON) {
    let entries;
    try { entries = JSON.parse(env.CINEMA_PROVIDERS_JSON); }
    catch { throw Object.assign(new Error('CINEMA_PROVIDERS_JSON must be valid JSON.'), { code: 'INVALID_PROVIDER_CONFIG', statusCode: 500 }); }
    if (!Array.isArray(entries) || entries.length > 20) {
      throw Object.assign(new Error('CINEMA_PROVIDERS_JSON must contain at most 20 provider entries.'), { code: 'INVALID_PROVIDER_CONFIG', statusCode: 500 });
    }
    for (const entry of entries) {
      if (!entry || typeof entry.id !== 'string' || !/^[a-z0-9][a-z0-9-]{1,39}$/.test(entry.id) || entry.provider !== 'vista-connect' || result[entry.id]) {
        throw Object.assign(new Error('Each provider entry needs a unique id and a supported provider type.'), { code: 'INVALID_PROVIDER_CONFIG', statusCode: 500 });
      }
      result[entry.id] = new VistaConnectAdapter({
        baseUrl: entry.baseUrl,
        apiToken: entry.apiToken,
        cinemaId: entry.cinemaId,
        regionCode: entry.regionCode || '',
        timeoutMs: Number(entry.timeoutMs || env.VISTA_CONNECT_TIMEOUT_MS || 10000)
      });
    }
  } else if (env.VISTA_CONNECT_BASE_URL && env.VISTA_CONNECT_API_TOKEN && env.VISTA_CONNECT_CINEMA_ID) {
    result.vista = new VistaConnectAdapter({
      baseUrl: env.VISTA_CONNECT_BASE_URL,
      apiToken: env.VISTA_CONNECT_API_TOKEN,
      cinemaId: env.VISTA_CONNECT_CINEMA_ID,
      regionCode: env.VISTA_CONNECT_REGION_CODE || '',
      timeoutMs: Number(env.VISTA_CONNECT_TIMEOUT_MS || 10000)
    });
  }
  return result;
}

export function registerIntegrationRoutes(app, { env = process.env, operatorOnly, apiError, adapters = {} }) {
  const configured = configuredAdapters(env);
  const providers = { ...configured, ...adapters };
  const providerContracts = Object.fromEntries(Object.entries(providers).map(([id, adapter]) => [id, validateCinemaProviderAdapter(id, adapter)]));
  const vista = providers.vista ?? providers['vista-connect'] ?? null;
  const tix = providerContracts.tix;
  const prime = providerContracts['prime-cineplex'];
  const customRest = providerContracts['custom-rest'];
  const resolveProvider = id => providerContracts[id]?.adapter ?? (id === 'vista-connect' ? vista : null);
  const missing = () => apiError(503, 'PROVIDER_NOT_CONFIGURED', 'This cinema provider has not been configured with approved API credentials.');

  app.get('/api/v1/integrations', { preHandler: [app.authenticate, operatorOnly] }, async () => ({
    data: [
      {
        id: 'vista-connect',
        name: 'Vista Connect',
        status: vista ? 'CONFIGURED' : Object.values(providers).some(Boolean) ? 'SEE_CONFIGURED_INSTANCES' : 'NOT_CONFIGURED',
        capabilities: ['sessions', 'seat-plan'],
        accessMode: 'READ_ONLY',
        docsUrl: 'https://booking.urgoo.mn/WSVistaWebClient/api-docs/general/introduction'
      },
      ...Object.values(providerContracts).map(({ id, capabilities }) => ({
        id,
        name: id === 'vista' ? 'Vista Connect (default)' : 'Cinema provider (' + id + ')',
        status: 'CONFIGURED',
        capabilities,
        accessMode: 'SERVER_TO_SERVER'
      })),
      {
        id: 'tix',
        name: 'TIX Mongolia',
        status: tix ? 'CONFIGURED' : 'PARTNER_ACCESS_REQUIRED',
        capabilities: tix ? tix.capabilities : ['sessions', 'seat-plan', 'booking', 'payments', 'tickets'],
        accessMode: tix ? 'SERVER_TO_SERVER' : 'PARTNER_API_ONLY',
        websiteUrl: 'https://www.tix.mn/'
      },
      {
        id: 'prime-cineplex',
        name: 'Prime Cineplex',
        status: prime ? 'CONFIGURED' : 'OFFICIAL_API_ACCESS_UNCONFIRMED',
        capabilities: prime ? prime.capabilities : ['sessions', 'seat-plan', 'booking', 'tickets'],
        accessMode: prime ? 'SERVER_TO_SERVER' : 'OFFICIAL_PARTNER_API_REQUIRED',
        websiteUrl: 'https://www.primecineplex.mn/'
      },
      {
        id: 'custom-rest',
        name: 'Other cinema systems',
        status: customRest ? 'CONFIGURED' : 'AVAILABLE_FOR_ADAPTER_DEVELOPMENT',
        capabilities: customRest ? customRest.capabilities : ['sessions', 'seat-plan', 'booking', 'webhooks'],
        accessMode: 'SERVER_TO_SERVER'
      }
    ]
  }));

  app.get('/api/v1/integrations/:providerId/health', { preHandler: [app.authenticate, operatorOnly] }, async (request) => {
    const adapter = resolveProvider(request.params.providerId);
    if (!adapter) throw missing();
    return adapter.health();
  });

  app.get('/api/v1/integrations/:providerId/sessions', { preHandler: [app.authenticate, operatorOnly] }, async (request) => {
    const adapter = resolveProvider(request.params.providerId);
    if (!adapter) throw missing();
    const sessions = await adapter.getSessions();
    return { provider: request.params.providerId, freshness: 'PROVIDER_CACHE_POLICY', data: sessions };
  });

  app.get('/api/v1/integrations/:providerId/sessions/:sessionId/seats', { preHandler: [app.authenticate, operatorOnly] }, async (request, reply) => {
    const adapter = resolveProvider(request.params.providerId);
    if (!adapter) throw missing();
    const seats = await adapter.getSeatPlan(request.params.sessionId);
    return reply.send({
      provider: request.params.providerId,
      freshness: 'NEAR_REAL_TIME_PROVIDER_CACHE',
      data: seats
    });
  });

}
