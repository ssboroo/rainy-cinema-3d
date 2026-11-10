import { VistaConnectAdapter } from './vista-connect.js';

function configuredVista(env) {
  if (!env.VISTA_CONNECT_BASE_URL || !env.VISTA_CONNECT_API_TOKEN || !env.VISTA_CONNECT_CINEMA_ID) return null;
  return new VistaConnectAdapter({
    baseUrl: env.VISTA_CONNECT_BASE_URL,
    apiToken: env.VISTA_CONNECT_API_TOKEN,
    cinemaId: env.VISTA_CONNECT_CINEMA_ID,
    regionCode: env.VISTA_CONNECT_REGION_CODE || '',
    timeoutMs: Number(env.VISTA_CONNECT_TIMEOUT_MS || 10000)
  });
}

export function registerIntegrationRoutes(app, { env = process.env, operatorOnly, apiError, adapters = {} }) {
  const vista = adapters.vista ?? configuredVista(env);

  app.get('/api/v1/integrations', { preHandler: [app.authenticate, operatorOnly] }, async () => ({
    data: [
      {
        id: 'vista-connect',
        name: 'Vista Connect',
        status: vista ? 'CONFIGURED' : 'NOT_CONFIGURED',
        capabilities: ['sessions', 'seat-plan'],
        accessMode: 'READ_ONLY',
        docsUrl: 'https://booking.urgoo.mn/WSVistaWebClient/api-docs/general/introduction'
      },
      {
        id: 'tix',
        name: 'TIX Mongolia',
        status: 'PARTNER_ACCESS_REQUIRED',
        capabilities: ['sessions', 'seat-plan', 'booking', 'payments', 'tickets'],
        accessMode: 'PARTNER_API_ONLY',
        websiteUrl: 'https://www.tix.mn/'
      },
      {
        id: 'custom-rest',
        name: 'Cinema custom REST API',
        status: 'AVAILABLE_FOR_CONFIGURATION',
        capabilities: ['sessions', 'seat-plan', 'booking', 'webhooks'],
        accessMode: 'SERVER_TO_SERVER'
      }
    ]
  }));

  app.get('/api/v1/integrations/vista/health', { preHandler: [app.authenticate, operatorOnly] }, async () => {
    if (!vista) throw apiError(503, 'PROVIDER_NOT_CONFIGURED', 'Vista Connect credentials have not been configured.');
    return vista.health();
  });

  app.get('/api/v1/integrations/vista/sessions', { preHandler: [app.authenticate, operatorOnly] }, async () => {
    if (!vista) throw apiError(503, 'PROVIDER_NOT_CONFIGURED', 'Vista Connect credentials have not been configured.');
    const sessions = await vista.getSessions();
    return { provider: 'vista-connect', freshness: 'PROVIDER_CACHE_POLICY', data: sessions };
  });

  app.get('/api/v1/integrations/vista/sessions/:sessionId/seats', { preHandler: [app.authenticate, operatorOnly] }, async (request, reply) => {
    if (!vista) throw apiError(503, 'PROVIDER_NOT_CONFIGURED', 'Vista Connect credentials have not been configured.');
    const seats = await vista.getSeatPlan(request.params.sessionId);
    return reply.send({
      provider: 'vista-connect',
      freshness: 'NEAR_REAL_TIME_PROVIDER_CACHE',
      data: seats
    });
  });
}
