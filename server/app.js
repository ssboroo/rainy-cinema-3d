import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import argon2 from 'argon2';
import pg from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { normalizeSeatIds, calculateTotal } from './domain/booking.js';

const { Pool } = pg;
const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(10).max(256),
  tenantSlug: z.string().trim().min(2).max(80).regex(/^[a-z0-9-]+$/)
});
const holdSchema = z.object({ seatIds: z.array(z.string()).min(1).max(6) });
const uuidSchema = z.string().uuid();
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const apiError = (statusCode, code, message) => Object.assign(new Error(message), { statusCode, code });

export function buildApp({ env = process.env, pool = null, logger = true } = {}) {
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters.');
  if (!pool && !env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  const db = pool || new Pool({
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
    max: Number(env.DB_POOL_MAX || 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  });
  const app = Fastify({
    logger,
    trustProxy: env.TRUST_PROXY === 'true',
    bodyLimit: 64 * 1024,
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID()
  });
  app.decorate('db', db);
  app.register(helmet, { contentSecurityPolicy: false });
  const origins = (env.CORS_ORIGINS || 'http://localhost:5173').split(',').map(v => v.trim()).filter(Boolean);
  app.register(cors, { origin: origins, credentials: true, methods: ['GET','POST','DELETE','OPTIONS'] });
  app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  app.register(jwt, { secret: env.JWT_SECRET, sign: { expiresIn: '15m' } });

  app.decorate('authenticate', async request => {
    try { await request.jwtVerify(); }
    catch { throw apiError(401, 'UNAUTHENTICATED', 'Please sign in to continue.'); }
    if (!request.user?.sub || !request.user?.tenantId || !request.user?.role) {
      throw apiError(401, 'INVALID_TOKEN', 'The access token is invalid.');
    }
  });

  app.setErrorHandler((error, request, reply) => {
    const status = Number.isInteger(error.statusCode) ? error.statusCode : 500;
    if (status >= 500) request.log.error({ err: error, requestId: request.id }, 'Request failed');
    reply.code(status).send({
      error: {
        code: error.code || (status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR'),
        message: status >= 500 ? 'An unexpected error occurred.' : error.message,
        requestId: request.id
      }
    });
  });

  app.get('/health/live', async () => ({ status: 'ok' }));
  app.get('/health/ready', async (_request, reply) => {
    try { await db.query('SELECT 1'); return { status: 'ready' }; }
    catch { return reply.code(503).send({ status: 'not_ready' }); }
  });

  app.post('/api/v1/auth/login', { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) throw apiError(422, 'VALIDATION_ERROR', 'Enter a valid email, password and tenant slug.');
    const { email, password, tenantSlug } = parsed.data;
    const result = await db.query(
      `SELECT u.id, u.tenant_id, u.password_hash, u.role, u.is_active, t.status AS tenant_status
       FROM users u JOIN tenants t ON t.id = u.tenant_id
       WHERE lower(u.email) = lower($1) AND t.slug = $2 LIMIT 1`,
      [email, tenantSlug]
    );
    const user = result.rows[0];
    if (!user || !user.is_active || user.tenant_status !== 'ACTIVE' ||
        !(await argon2.verify(user.password_hash, password).catch(() => false))) {
      throw apiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    }
    const accessToken = app.jwt.sign({ sub: user.id, tenantId: user.tenant_id, role: user.role });
    return reply.send({ accessToken, tokenType: 'Bearer', expiresIn: 900, user: { id: user.id, role: user.role } });
  });

  app.get('/api/v1/showtimes/:showtimeId/seats', { preHandler: app.authenticate }, async (request, reply) => {
    const showtimeId = uuidSchema.safeParse(request.params.showtimeId);
    if (!showtimeId.success) throw apiError(422, 'VALIDATION_ERROR', 'Invalid showtime ID.');
    const result = await db.query(
      `SELECT s.code, s.row_label AS "row", s.seat_number AS "number", s.seat_type AS "type",
              s.x, s.z, ss.status, ss.price_amount AS "priceMnt", ss.hold_expires_at AS "holdExpiresAt"
       FROM showtime_seats ss JOIN seats s ON s.id = ss.seat_id AND s.tenant_id = ss.tenant_id
       JOIN showtimes st ON st.id=ss.showtime_id AND st.tenant_id=ss.tenant_id AND st.status='ON_SALE'\n       WHERE ss.tenant_id = $1 AND ss.showtime_id = $2 AND s.is_active = true
       ORDER BY s.row_label, s.seat_number`,
      [request.user.tenantId, showtimeId.data]
    );
    return reply.send({ data: result.rows });
  });

  app.post('/api/v1/showtimes/:showtimeId/holds', { preHandler: app.authenticate }, async (request, reply) => {
    const showtime = uuidSchema.safeParse(request.params.showtimeId);
    const body = holdSchema.safeParse(request.body);
    const key = request.headers['idempotency-key'];
    if (!showtime.success || !body.success || typeof key !== 'string' || key.length < 8 || key.length > 128) {
      throw apiError(422, 'VALIDATION_ERROR', 'A valid showtime, 1–6 seat IDs and Idempotency-Key are required.');
    }
    const seatIds = normalizeSeatIds(body.data.seatIds);
    const tenantId = request.user.tenantId;
    const userId = request.user.sub;
    const requestHash = hash({ showtimeId: showtime.data, seatIds: [...seatIds].sort() });
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM idempotency_keys WHERE expires_at < now()');
      const claimed = await client.query(
        `INSERT INTO idempotency_keys (tenant_id,user_id,idempotency_key,request_hash,expires_at)
         VALUES ($1,$2,$3,$4,now()+interval '24 hours') ON CONFLICT DO NOTHING RETURNING idempotency_key`,
        [tenantId,userId,key,requestHash]
      );
      if (!claimed.rowCount) {
        const previous = await client.query(
          `SELECT request_hash,response_status,response_body FROM idempotency_keys
           WHERE tenant_id=$1 AND user_id=$2 AND idempotency_key=$3 FOR UPDATE`,
          [tenantId,userId,key]
        );
        const record = previous.rows[0];
        if (!record || record.request_hash !== requestHash) throw apiError(422, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was already used for a different request.');
        if (!record.response_body) throw apiError(409, 'REQUEST_IN_PROGRESS', 'An identical request is still being processed.');
        await client.query('COMMIT');
        return reply.code(record.response_status).send(record.response_body);
      }

      await client.query(
        `UPDATE showtime_seats SET status='AVAILABLE',hold_id=NULL,hold_expires_at=NULL,updated_at=now()
         WHERE tenant_id=$1 AND showtime_id=$2 AND status='HELD' AND hold_expires_at <= now()`,
        [tenantId,showtime.data]
      );
      await client.query(
        `UPDATE seat_holds SET status='EXPIRED' WHERE tenant_id=$1 AND showtime_id=$2 AND status='ACTIVE' AND expires_at <= now()`,
        [tenantId,showtime.data]
      );
      const inventory = await client.query(
        `SELECT s.id,s.code,ss.status,ss.price_amount
         FROM showtime_seats ss JOIN seats s ON s.id=ss.seat_id AND s.tenant_id=ss.tenant_id
         WHERE ss.tenant_id=$1 AND ss.showtime_id=$2 AND s.code=ANY($3::text[])
         ORDER BY s.code FOR UPDATE OF ss`,
        [tenantId,showtime.data,seatIds]
      );
      if (inventory.rowCount !== seatIds.length || inventory.rows.some(row => row.status !== 'AVAILABLE')) {
        throw apiError(409, 'SEAT_UNAVAILABLE', 'One or more selected seats are no longer available.');
      }
      const totalAmount = calculateTotal(inventory.rows.map(row => ({ priceMnt: Number(row.price_amount) })));
      const holdId = randomUUID();
      const hold = await client.query(
        `INSERT INTO seat_holds (id,tenant_id,showtime_id,user_id,expires_at)
         VALUES ($1,$2,$3,$4,now()+interval '10 minutes') RETURNING expires_at`,
        [holdId,tenantId,showtime.data,userId]
      );
      await client.query(
        `UPDATE showtime_seats ss SET status='HELD',hold_id=$1,hold_expires_at=$2,updated_at=now()
         FROM seats s WHERE ss.tenant_id=$3 AND ss.showtime_id=$4 AND ss.seat_id=s.id
         AND s.tenant_id=ss.tenant_id AND s.code=ANY($5::text[])`,
        [holdId,hold.rows[0].expires_at,tenantId,showtime.data,seatIds]
      );
      await client.query(
        `INSERT INTO audit_logs (tenant_id,actor_user_id,action,resource_type,resource_id,metadata)
         VALUES ($1,$2,'SEATS_HELD','SEAT_HOLD',$3,$4::jsonb)`,
        [tenantId,userId,holdId,JSON.stringify({ showtimeId: showtime.data, seatIds, totalAmount })]
      );
      const response = { holdId, showtimeId: showtime.data, seatIds, totalAmount, currency: 'MNT', expiresAt: hold.rows[0].expires_at };
      await client.query(
        `UPDATE idempotency_keys SET response_status=201,response_body=$4::jsonb
         WHERE tenant_id=$1 AND user_id=$2 AND idempotency_key=$3`,
        [tenantId,userId,key,JSON.stringify(response)]
      );
      await client.query('COMMIT');
      return reply.code(201).send(response);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  });

  app.delete('/api/v1/holds/:holdId', { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = uuidSchema.safeParse(request.params.holdId);
    if (!parsed.success) throw apiError(422, 'VALIDATION_ERROR', 'Invalid hold ID.');
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const hold = await client.query(
        `SELECT id,status FROM seat_holds WHERE id=$1 AND tenant_id=$2 AND user_id=$3 FOR UPDATE`,
        [parsed.data,request.user.tenantId,request.user.sub]
      );
      if (!hold.rowCount) throw apiError(404, 'HOLD_NOT_FOUND', 'Seat hold was not found.');
      if (hold.rows[0].status === 'ACTIVE') {
        await client.query(
          `UPDATE showtime_seats SET status='AVAILABLE',hold_id=NULL,hold_expires_at=NULL,updated_at=now()
           WHERE tenant_id=$1 AND hold_id=$2 AND status='HELD'`,
          [request.user.tenantId,parsed.data]
        );
        await client.query(`UPDATE seat_holds SET status='RELEASED' WHERE tenant_id=$1 AND id=$2`,[request.user.tenantId,parsed.data]);
        await client.query(
          `INSERT INTO audit_logs (tenant_id,actor_user_id,action,resource_type,resource_id)
           VALUES ($1,$2,'HOLD_RELEASED','SEAT_HOLD',$3)`,
          [request.user.tenantId,request.user.sub,parsed.data]
        );
      }
      await client.query('COMMIT');
      return reply.code(204).send();
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  });

  app.post('/api/v1/holds/:holdId/bookings', { preHandler: app.authenticate }, async () => {
    throw apiError(503, 'PAYMENT_PROVIDER_NOT_CONFIGURED', 'Booking confirmation is disabled until a verified cinema payment provider is configured. Your seats have not been booked or charged.');
  });

  app.addHook('onClose', async () => {
    if (!pool) await db.end();
  });
  return app;
}
