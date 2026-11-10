import { z } from 'zod';

const cinemaSchema = z.object({
  name: z.string().trim().min(2).max(120),
  timezone: z.string().trim().min(3).max(80).default('Asia/Ulaanbaatar'),
  currency: z.string().trim().length(3).default('MNT')
});
const auditoriumSchema = z.object({ name: z.string().trim().min(1).max(80) });
const layoutSchema = z.object({
  seats: z.array(z.object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z]{1,3}[1-9][0-9]{0,2}$/),
    rowLabel: z.string().trim().toUpperCase().regex(/^[A-Z]{1,3}$/),
    seatNumber: z.number().int().min(1).max(999),
    seatType: z.enum(['STANDARD','VIP','ACCESSIBLE','LOVE']).default('STANDARD'),
    x: z.number().finite().min(-1000).max(1000),
    z: z.number().finite().min(-1000).max(1000)
  })).min(1).max(1000)
}).superRefine((value, ctx) => {
  const codes = value.seats.map(seat => seat.code);
  if (new Set(codes).size !== codes.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Seat codes must be unique.' });
  const positions = value.seats.map(seat => seat.rowLabel + ':' + seat.seatNumber);
  if (new Set(positions).size !== positions.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Seat positions must be unique.' });
  if (value.seats.some(seat => seat.code !== seat.rowLabel + seat.seatNumber)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Seat code must match its row and number.' });
});
const showtimeSchema = z.object({
  cinemaId: z.string().uuid(),
  auditoriumId: z.string().uuid(),
  movieTitle: z.string().trim().min(1).max(200),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  standardPriceMnt: z.number().int().min(0).max(100000000),
  vipPriceMnt: z.number().int().min(0).max(100000000),
  status: z.enum(['SCHEDULED','ON_SALE']).default('SCHEDULED')
}).refine(value => new Date(value.endsAt) > new Date(value.startsAt), { message: 'Showtime end must be after start.' })
  .refine(value => new Date(value.startsAt) > new Date(), { message: 'Showtime must start in the future.' });

export function registerAdminRoutes(app, { db, operatorOnly, apiError, uuidSchema }) {
  app.post('/api/v1/cinemas', { preHandler: [app.authenticate, operatorOnly] }, async (request, reply) => {
    const parsed = cinemaSchema.safeParse(request.body);
    if (!parsed.success) throw apiError(422, 'VALIDATION_ERROR', 'Cinema details are invalid.');
    const result = await db.query(
      "INSERT INTO cinemas (tenant_id,name,timezone,currency) VALUES ($1,$2,$3,$4) RETURNING id,name,timezone,currency,is_active AS \"isActive\",created_at AS \"createdAt\"",
      [request.user.tenantId, parsed.data.name, parsed.data.timezone, parsed.data.currency.toUpperCase()]
    );
    return reply.code(201).send(result.rows[0]);
  });

  app.post('/api/v1/cinemas/:cinemaId/auditoriums', { preHandler: [app.authenticate, operatorOnly] }, async (request, reply) => {
    const cinemaId = uuidSchema.safeParse(request.params.cinemaId);
    const parsed = auditoriumSchema.safeParse(request.body);
    if (!cinemaId.success || !parsed.success) throw apiError(422, 'VALIDATION_ERROR', 'Auditorium details are invalid.');
    const result = await db.query(
      "INSERT INTO auditoriums (tenant_id,cinema_id,name) SELECT $1,id,$3 FROM cinemas WHERE tenant_id=$1 AND id=$2 AND is_active=true RETURNING id,cinema_id AS \"cinemaId\",name,layout_version AS \"layoutVersion\"",
      [request.user.tenantId, cinemaId.data, parsed.data.name]
    );
    if (!result.rowCount) throw apiError(404, 'CINEMA_NOT_FOUND', 'Cinema was not found.');
    return reply.code(201).send(result.rows[0]);
  });

  app.put('/api/v1/auditoriums/:auditoriumId/seats', { preHandler: [app.authenticate, operatorOnly] }, async (request, reply) => {
    const auditoriumId = uuidSchema.safeParse(request.params.auditoriumId);
    const parsed = layoutSchema.safeParse(request.body);
    if (!auditoriumId.success || !parsed.success) throw apiError(422, 'VALIDATION_ERROR', 'Seat layout is invalid or contains duplicate positions.');
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const auditorium = await client.query(
        'SELECT id FROM auditoriums WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
        [request.user.tenantId, auditoriumId.data]
      );
      if (!auditorium.rowCount) throw apiError(404, 'AUDITORIUM_NOT_FOUND', 'Auditorium was not found.');
      const scheduled = await client.query(
        "SELECT id FROM showtimes WHERE tenant_id=$1 AND auditorium_id=$2 AND status IN ('SCHEDULED','ON_SALE') AND ends_at > now() LIMIT 1 FOR UPDATE",
        [request.user.tenantId, auditoriumId.data]
      );
      if (scheduled.rowCount) throw apiError(409, 'LAYOUT_IN_USE', 'The auditorium has an active or upcoming showtime.');
      await client.query(
        'UPDATE seats SET is_active=false WHERE tenant_id=$1 AND auditorium_id=$2',
        [request.user.tenantId, auditoriumId.data]
      );
      for (const seat of parsed.data.seats) {
        await client.query(
          "INSERT INTO seats (tenant_id,auditorium_id,code,row_label,seat_number,seat_type,x,z,is_active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true) ON CONFLICT (tenant_id,auditorium_id,code) DO UPDATE SET row_label=EXCLUDED.row_label,seat_number=EXCLUDED.seat_number,seat_type=EXCLUDED.seat_type,x=EXCLUDED.x,z=EXCLUDED.z,is_active=true",
          [request.user.tenantId, auditoriumId.data, seat.code, seat.rowLabel, seat.seatNumber, seat.seatType, seat.x, seat.z]
        );
      }
      const updated = await client.query(
        'UPDATE auditoriums SET layout_version=layout_version+1 WHERE tenant_id=$1 AND id=$2 RETURNING layout_version',
        [request.user.tenantId, auditoriumId.data]
      );
      await client.query(
        "INSERT INTO audit_logs (tenant_id,actor_user_id,action,resource_type,resource_id,metadata) VALUES ($1,$2,'SEAT_LAYOUT_UPDATED','AUDITORIUM',$3,$4::jsonb)",
        [request.user.tenantId, request.user.sub, auditoriumId.data, JSON.stringify({ seatCount: parsed.data.seats.length, layoutVersion: updated.rows[0].layout_version })]
      );
      await client.query('COMMIT');
      return reply.send({ auditoriumId: auditoriumId.data, seatCount: parsed.data.seats.length, layoutVersion: updated.rows[0].layout_version });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  });

  app.post('/api/v1/showtimes', { preHandler: [app.authenticate, operatorOnly] }, async (request, reply) => {
    const parsed = showtimeSchema.safeParse(request.body);
    if (!parsed.success) throw apiError(422, 'VALIDATION_ERROR', 'Showtime details are invalid.');
    const input = parsed.data;
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const auditorium = await client.query(
        'SELECT a.id FROM auditoriums a JOIN cinemas c ON c.id=a.cinema_id AND c.tenant_id=a.tenant_id WHERE a.tenant_id=$1 AND a.id=$2 AND a.cinema_id=$3 AND c.is_active=true FOR SHARE OF a',
        [request.user.tenantId, input.auditoriumId, input.cinemaId]
      );
      if (!auditorium.rowCount) throw apiError(404, 'AUDITORIUM_NOT_FOUND', 'Auditorium does not belong to the selected cinema.');
      const seatCount = await client.query(
        'SELECT count(*)::int AS count FROM seats WHERE tenant_id=$1 AND auditorium_id=$2 AND is_active=true',
        [request.user.tenantId, input.auditoriumId]
      );
      if (!seatCount.rows[0].count) throw apiError(409, 'EMPTY_AUDITORIUM', 'Add a seat layout before creating a showtime.');
      const showtime = await client.query(
        'INSERT INTO showtimes (tenant_id,cinema_id,auditorium_id,movie_title,starts_at,ends_at,status) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id,status,starts_at AS "startsAt",ends_at AS "endsAt"',
        [request.user.tenantId, input.cinemaId, input.auditoriumId, input.movieTitle, input.startsAt, input.endsAt, input.status]
      );
      await client.query(
        "INSERT INTO showtime_seats (tenant_id,showtime_id,seat_id,status,price_amount) SELECT $1,$2,id,'AVAILABLE',CASE WHEN seat_type='VIP' THEN $3 ELSE $4 END FROM seats WHERE tenant_id=$1 AND auditorium_id=$5 AND is_active=true",
        [request.user.tenantId, showtime.rows[0].id, input.vipPriceMnt, input.standardPriceMnt, input.auditoriumId]
      );
      await client.query(
        "INSERT INTO audit_logs (tenant_id,actor_user_id,action,resource_type,resource_id,metadata) VALUES ($1,$2,'SHOWTIME_CREATED','SHOWTIME',$3,$4::jsonb)",
        [request.user.tenantId, request.user.sub, showtime.rows[0].id, JSON.stringify({ movieTitle: input.movieTitle, seatCount: seatCount.rows[0].count })]
      );
      await client.query('COMMIT');
      return reply.code(201).send({ ...showtime.rows[0], seatCount: seatCount.rows[0].count });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  });

  app.patch('/api/v1/showtimes/:showtimeId', { preHandler: [app.authenticate, operatorOnly] }, async (request, reply) => {
    const showtimeId = uuidSchema.safeParse(request.params.showtimeId);
    const body = z.object({ status: z.enum(['SCHEDULED','ON_SALE','CANCELLED','COMPLETED']) }).safeParse(request.body);
    if (!showtimeId.success || !body.success) throw apiError(422, 'VALIDATION_ERROR', 'Showtime status is invalid.');
    const result = await db.query(
      'UPDATE showtimes SET status=$3 WHERE tenant_id=$1 AND id=$2 RETURNING id,status,starts_at AS "startsAt",ends_at AS "endsAt"',
      [request.user.tenantId, showtimeId.data, body.data.status]
    );
    if (!result.rowCount) throw apiError(404, 'SHOWTIME_NOT_FOUND', 'Showtime was not found.');
    return reply.send(result.rows[0]);
  });
}
