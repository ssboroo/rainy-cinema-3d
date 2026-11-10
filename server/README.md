# RAINY CINEMA API

Fastify 5 + PostgreSQL API. The API is tenant-scoped: tenant identity comes only from a verified JWT, never from request input.

## Endpoints

- `GET /health/live` — process liveness
- `GET /health/ready` — database readiness
- `POST /api/v1/auth/login` — tenant slug + email + password; returns a 15-minute bearer token
- `GET /api/v1/showtimes/:showtimeId/seats` — current seat inventory for an ON_SALE showtime
- `POST /api/v1/showtimes/:showtimeId/holds` — create a 10-minute seat hold; requires `Idempotency-Key`
- `DELETE /api/v1/holds/:holdId` — release the caller's active hold
- `POST /api/v1/holds/:holdId/bookings` — intentionally disabled until a verified payment provider is configured

All errors use `{ error: { code, message, requestId } }`. Seat holds are transactional, row-locked, tenant-scoped and idempotent. A reused idempotency key with a different request body is rejected.

## First setup

1. Create a PostgreSQL database.
2. Set `DATABASE_URL` and a random `JWT_SECRET` (at least 32 characters).
3. Run `npm run db:migrate`.
4. Set `BOOTSTRAP_TENANT_NAME`, `BOOTSTRAP_TENANT_SLUG`, `ADMIN_EMAIL`, and a strong `ADMIN_PASSWORD` (16+ chars); run `npm run db:bootstrap`.
5. Set `CORS_ORIGINS` to exact trusted frontend origins, comma-separated.
6. Run `npm run start:api`.

Do not expose the database, JWT secret, provider keys, or bootstrap password to browser code. Rotate/delete bootstrap credentials after initial provisioning.

## Payment and ticketing boundary

The app does not claim a reservation or accept payment without a verified operator/payment adapter. The booking endpoint returns an explicit `503 PAYMENT_PROVIDER_NOT_CONFIGURED` until a real provider adapter, webhook signature verification, reconciliation and refund policy have been configured. No fake booking success is returned.

## Tenant administration endpoints

All administration endpoints require a bearer token with OWNER, ADMIN or OPERATOR role.

- `POST /api/v1/cinemas` — create a cinema.
- `POST /api/v1/cinemas/:cinemaId/auditoriums` — add an auditorium.
- `PUT /api/v1/auditoriums/:auditoriumId/seats` — replace the current seat layout (1–1000 seats; unique seat codes and positions).
- `POST /api/v1/showtimes` — create a showtime and snapshot its active seat inventory and MNT prices.
- `PATCH /api/v1/showtimes/:showtimeId` — change a showtime between SCHEDULED, ON_SALE, CANCELLED and COMPLETED.

A showtime is created as SCHEDULED by default. An operator must explicitly switch it to ON_SALE before inventory can be queried or seats held. Layout changes should only be made when there are no active/upcoming showtimes in that auditorium; existing ticket inventory must not be silently rewritten.
