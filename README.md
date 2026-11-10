# RAINY CINEMA 3D

A modern 3D cinema experience and multi-tenant ticketing platform foundation.

## Experience

- Interactive 3D auditorium built with React, Three.js and React Three Fiber
- 2D accessible seat-map fallback
- Seat selection, seat categories, availability states and MNT price totals
- Mongolian / English interface
- Responsive layouts for desktop, tablet and mobile

## Platform foundation

- Fastify 5 API and PostgreSQL schema
- Tenant-scoped cinema, auditorium, seat, showtime and booking data
- Argon2id password hashing and short-lived JWT access tokens
- Transactional seat holds with row-level locks and expiry
- Idempotency protection for seat-hold requests
- Audit events, rate limiting, CORS allowlist and security headers
- Docker image and Railway configuration

## Requirements

- Node.js 22.12+
- PostgreSQL 16+
- npm

## Local development

```bash
npm install
cp .env.example .env
# Configure DATABASE_URL and a random JWT_SECRET (32+ characters)
npm run db:migrate
npm run db:bootstrap
npm run dev
```

Start the API in another terminal:

```bash
npm run dev:api
```

The Vite app runs on port 5173; the API runs on port 3001. Set `CORS_ORIGINS=http://localhost:5173`.

## Validation

```bash
npm test
npm run build
```

## API

See [API setup and endpoint guide](server/README.md), [cinema provider integrations](docs/INTEGRATIONS.md), [OpenAPI contract](docs/openapi.yaml), [architecture](docs/ARCHITECTURE.md), and [production readiness checklist](docs/PRODUCTION_READINESS.md).

## Important integration boundary

The current seat experience includes demo inventory. The backend provides tenant-aware inventory and seat-hold primitives, but an actual cinema operator's inventory, confirmed ticket booking, payment collection, refunds and webhook reconciliation require the operator/payment provider's official API documentation, sandbox credentials and merchant configuration. The confirmation endpoint deliberately refuses to claim success until those integrations are verified.

Never place database credentials, JWT secrets, provider secrets or payment keys in frontend code.
