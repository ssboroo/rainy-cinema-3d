const PROVIDER = 'vista-connect';
const STATUS = new Map([[0, 'AVAILABLE'], [1, 'SOLD'], [2, 'BLOCKED'], [3, 'BLOCKED']]);

function integrationError(code, message, statusCode = 502) {
  return Object.assign(new Error(message), { code, statusCode });
}
function firstDefined(...values) {
  return values.find(value => value !== undefined && value !== null);
}
function safeText(value, fallback = '') {
  return typeof value === 'string' ? value.trim().slice(0, 500) : fallback;
}
function validBaseUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}

export function normalizeVistaSessions(payload) {
  const rows = payload?.d?.results ?? payload?.value ?? payload?.results;
  if (!Array.isArray(rows)) throw integrationError('PROVIDER_INVALID_RESPONSE', 'Vista returned an unexpected sessions response.');
  return rows.flatMap(row => {
    if (!row || typeof row !== 'object') return [];
    const sessionId = firstDefined(row.SessionId, row.sessionId, row.ID, row.id);
    const cinemaId = firstDefined(row.CinemaId, row.cinemaId);
    const startsAt = firstDefined(row.Showtime, row.StartTime, row.startTime, row.startsAt);
    if (sessionId === undefined || startsAt === undefined) return [];
    const available = firstDefined(row.SeatsAvailable, row.seatsAvailable);
    return [{
      id: String(sessionId),
      externalId: String(sessionId),
      cinemaId: cinemaId == null ? null : String(cinemaId),
      startsAt: String(startsAt),
      movieTitle: safeText(firstDefined(row.FilmName, row.Title, row.ScheduledFilmTitle, row.filmName), 'Untitled session'),
      screenName: safeText(firstDefined(row.ScreenName, row.screenName)),
      isAllocatedSeating: Boolean(firstDefined(row.IsAllocatedSeating, row.isAllocatedSeating, false)),
      seatsAvailable: Number.isFinite(Number(available)) ? Number(available) : null,
      canSellTickets: Boolean(firstDefined(row.AllowTicketSales, row.allowTicketSales, false)),
      provider: PROVIDER
    }];
  });
}

export function normalizeVistaSeatPlan(payload) {
  const layout = payload?.SeatLayoutData ?? payload?.seatLayoutData ?? payload?.d?.SeatLayoutData;
  const areas = layout?.Areas ?? layout?.areas;
  if (!Array.isArray(areas)) throw integrationError('PROVIDER_INVALID_RESPONSE', 'Vista returned an unexpected seat-plan response.');
  const seats = [];
  for (const area of areas) {
    for (const row of area?.Rows ?? area?.rows ?? []) {
      for (const seat of row?.Seats ?? row?.seats ?? []) {
        const position = seat?.Position ?? seat?.position ?? {};
        const rawStatus = firstDefined(seat.Status, seat.status);
        const status = typeof rawStatus === 'number' ? (STATUS.get(rawStatus) ?? 'UNKNOWN') :
          (['AVAILABLE', 'SOLD', 'BLOCKED', 'HELD'].includes(String(rawStatus).toUpperCase()) ? String(rawStatus).toUpperCase() : 'UNKNOWN');
        const style = String(firstDefined(seat.SeatStyle, seat.seatStyle, '')).toLowerCase();
        const rowLabel = safeText(firstDefined(row.PhysicalName, row.physicalName, row.Name, row.name));
        const seatLabel = safeText(firstDefined(seat.SeatLabel, seat.seatLabel, seat.SeatNumber, seat.seatNumber, seat.Number, seat.number));
        seats.push({
          id: String(firstDefined(seat.Id, seat.ID, seat.id, String(position.AreaNumber ?? area.Number ?? 0) + ':' + String(position.RowIndex ?? 0) + ':' + String(position.ColumnIndex ?? 0))),
          code: rowLabel && seatLabel ? rowLabel + seatLabel : null,
          row: rowLabel,
          number: seatLabel,
          areaNumber: Number(firstDefined(position.AreaNumber, area.Number, 0)),
          rowIndex: Number(firstDefined(position.RowIndex, 0)),
          columnIndex: Number(firstDefined(position.ColumnIndex, 0)),
          x: Number(firstDefined(position.ColumnIndex, 0)),
          z: Number(firstDefined(position.RowIndex, 0)),
          status,
          type: /wheelchair|accessible/i.test(style) ? 'ACCESSIBLE' : /sofa|love/i.test(style) ? 'LOVE' : /vip/i.test(style) ? 'VIP' : 'STANDARD',
          provider: PROVIDER
        });
      }
    }
  }
  return seats;
}

export class VistaConnectAdapter {
  constructor({ baseUrl, apiToken, cinemaId, regionCode = '', fetchImpl = globalThis.fetch, timeoutMs = 10000 }) {
    if (!validBaseUrl(baseUrl) || typeof apiToken !== 'string' || apiToken.trim().length < 8 ||
        typeof cinemaId !== 'string' || !cinemaId.trim() || typeof regionCode !== 'string' || typeof fetchImpl !== 'function' ||
        !Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) {
      throw integrationError('INVALID_PROVIDER_CONFIG', 'Vista Connect requires an HTTPS base URL, API token, cinema ID and valid timeout.', 500);
    }
    this.baseUrl = new URL(baseUrl.endsWith('/') ? baseUrl : baseUrl + '/');
    this.apiToken = apiToken;
    this.cinemaId = cinemaId.trim();
    this.regionCode = regionCode.trim();
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async request(path, { method = 'GET', body } = {}) {
    const url = new URL(path.replace(/^\/+/, ''), this.baseUrl);
    if (url.origin !== this.baseUrl.origin || !url.pathname.startsWith(this.baseUrl.pathname)) {
      throw integrationError('INVALID_PROVIDER_PATH', 'Provider request path is outside the configured Vista API base URL.', 500);
    }
    let response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          accept: 'application/json',
          connectapitoken: this.apiToken,
          ...(this.regionCode ? { 'Connect-Region-Code': this.regionCode } : {}),
          ...(body ? { 'content-type': 'application/json' } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw integrationError('PROVIDER_TIMEOUT', 'Vista Connect did not respond before the request timed out.');
      }
      throw integrationError('PROVIDER_UNAVAILABLE', 'Vista Connect could not be reached.');
    }
    if (!response.ok) {
      const code = response.status === 401 || response.status === 403 ? 'PROVIDER_AUTH_FAILED' :
        response.status === 429 ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_REQUEST_FAILED';
      throw integrationError(code, 'Vista Connect returned HTTP ' + response.status + '.');
    }
    try { return await response.json(); }
    catch { throw integrationError('PROVIDER_INVALID_RESPONSE', 'Vista Connect returned invalid JSON.'); }
  }

  async getSessions() {
    const payload = await this.request('OData.svc/Sessions?$format=json');
    return normalizeVistaSessions(payload).filter(session => !session.cinemaId || session.cinemaId === this.cinemaId);
  }

  async getSeatPlan(sessionId) {
    if (typeof sessionId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(sessionId)) {
      throw integrationError('INVALID_SESSION_ID', 'Invalid Vista session ID.', 422);
    }
    const path = 'restdata.svc/cinemas/' + encodeURIComponent(this.cinemaId) + '/sessions/' + encodeURIComponent(sessionId) +
      '/seat-plan?SeatDataFormat=2&IncludeBrokenSeats=true&IncludeHouseSpecialSeats=true&IncludeGreyAndSofaSeats=true&IncludeAllSeatPriorities=true&IncludeSeatNumbers=true&IncludeCompanionSeats=true';
    const payload = await this.request(path);
    return normalizeVistaSeatPlan(payload);
  }

  async health() {
    const sessions = await this.getSessions();
    return { status: 'connected', provider: PROVIDER, cinemaId: this.cinemaId, sessionsVisible: sessions.length };
  }
}
