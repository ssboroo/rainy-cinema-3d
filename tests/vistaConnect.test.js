import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeVistaSessions, normalizeVistaSeatPlan, VistaConnectAdapter } from '../server/integrations/vista-connect.js';

test('normalizes Vista OData sessions without trusting missing identifiers', () => {
  const result = normalizeVistaSessions({
    d: { results: [
      { ID: 'c1-s1', CinemaId: 'c1', SessionId: 's1', Showtime: '2026-11-11T10:00:00', FilmName: 'Demo Film', ScreenName: 'Hall 1', IsAllocatedSeating: true, SeatsAvailable: 42, AllowTicketSales: true },
      { ID: null, Showtime: 'bad' }
    ] }
  });
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], {
    id: 's1', externalId: 's1', cinemaId: 'c1', startsAt: '2026-11-11T10:00:00',
    movieTitle: 'Demo Film', screenName: 'Hall 1', isAllocatedSeating: true,
    seatsAvailable: 42, canSellTickets: true, provider: 'vista-connect'
  });
});

test('normalizes structured Vista seat plans and preserves unknown seat states safely', () => {
  const result = normalizeVistaSeatPlan({
    SeatLayoutData: { Areas: [{ Number: 1, Rows: [{ PhysicalName: 'A', Seats: [
      { Position: { AreaNumber: 1, RowIndex: 0, ColumnIndex: 0 }, SeatLabel: '1', Status: 0, SeatStyle: 'Normal' },
      { Position: { AreaNumber: 1, RowIndex: 0, ColumnIndex: 1 }, SeatLabel: '2', Status: 1, SeatStyle: 'Normal' },
      { Position: { AreaNumber: 1, RowIndex: 0, ColumnIndex: 2 }, SeatLabel: '3', Status: 99, SeatStyle: 'Wheelchair' }
    ] }] }] }
  });
  assert.equal(result.length, 3);
  assert.equal(result[0].status, 'AVAILABLE');
  assert.equal(result[1].status, 'SOLD');
  assert.equal(result[2].status, 'UNKNOWN');
  assert.equal(result[2].type, 'ACCESSIBLE');
});

test('Vista adapter sends credentials only in headers and normalizes sessions', async () => {
  let captured;
  const adapter = new VistaConnectAdapter({
    baseUrl: 'https://booking.example/WSVistaWebClient/',
    apiToken: 'secret-token',
    cinemaId: 'cinema-1',
    regionCode: 'MN',
    fetchImpl: async (url, options) => {
      captured = { url: String(url), options };
      return new Response(JSON.stringify({ d: { results: [{ ID: 'cinema-1-1', CinemaId: 'cinema-1', SessionId: '1', Showtime: '2026-11-11T10:00:00', FilmName: 'Film' }] } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  const sessions = await adapter.getSessions();
  assert.equal(sessions[0].id, '1');
  assert.equal(captured.url, 'https://booking.example/WSVistaWebClient/OData.svc/Sessions?$format=json&$filter=CinemaId%20eq%20%27cinema-1%27');
  assert.equal(captured.options.headers.connectapitoken, 'secret-token');
  assert.equal(captured.options.headers['Connect-Region-Code'], 'MN');
  assert.equal(captured.url.includes('secret-token'), false);
});

test('Vista adapter rejects non-JSON and non-success provider responses', async () => {
  const adapter = new VistaConnectAdapter({
    baseUrl: 'https://booking.example/WSVistaWebClient',
    apiToken: 'secret-token',
    cinemaId: 'cinema-1',
    fetchImpl: async () => new Response('denied', { status: 403 })
  });
  await assert.rejects(adapter.getSessions(), { code: 'PROVIDER_AUTH_FAILED' });
});

test('Vista adapter requires server-side credentials and valid HTTPS origin', () => {
  assert.throws(() => new VistaConnectAdapter({ baseUrl: 'http://example.com', apiToken: 'secret', cinemaId: '1' }), { code: 'INVALID_PROVIDER_CONFIG' });
  assert.throws(() => new VistaConnectAdapter({ baseUrl: 'https://example.com', apiToken: '', cinemaId: '1' }), { code: 'INVALID_PROVIDER_CONFIG' });
});

test('Vista sessions are scoped to the configured cinema even if the provider returns mixed sites', async () => {
  const adapter = new VistaConnectAdapter({
    baseUrl: 'https://booking.example/WSVistaWebClient',
    apiToken: 'secret-token',
    cinemaId: 'cinema-1',
    fetchImpl: async () => new Response(JSON.stringify({ d: { results: [
      { SessionId: '1', CinemaId: 'cinema-1', Showtime: '2026-11-11T10:00:00' },
      { SessionId: '2', CinemaId: 'cinema-2', Showtime: '2026-11-11T11:00:00' },
      { SessionId: '3', Showtime: '2026-11-11T12:00:00' }
    ] } }), { status: 200 })
  });
  const sessions = await adapter.getSessions();
  assert.deepEqual(sessions.map(session => session.id), ['1']);
});
