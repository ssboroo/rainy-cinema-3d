# Production readiness checklist

## Implemented in this repository
- Tenant-aware PostgreSQL schema with composite tenant foreign keys.
- Password hashing with Argon2id and short-lived signed access tokens.
- Exact-origin CORS configuration, security headers, request limits and rate limiting.
- Tenant-scoped inventory reads and row-locked seat holds.
- 10-minute holds, expiry cleanup during hold creation, safe release, and 24-hour idempotency records.
- Audit log records for seat holds and releases.
- Explicit API error contract and liveness/readiness endpoints.
- Docker and Railway deployment configuration.
- Automated domain tests and GitHub Actions validation.

## Must be configured before a real launch
- PostgreSQL service, DATABASE_URL, JWT_SECRET and exact CORS_ORIGINS.
- Apply migrations and provision an owner using the bootstrap script.
- Create cinemas, auditoriums, seat layouts, showtimes and per-showtime inventory using a controlled admin workflow (not yet shipped).
- Configure a real cinema operator/ticketing adapter using that provider's official API specification and sandbox credentials.
- Configure a payment provider, signed webhook verification, payment reconciliation, refunds and cancellation rules.
- Add refresh-token rotation, password reset, MFA for operators, account invitation and session revocation.
- Add operational monitoring, backups/PITR, alerting, load testing and security review.

## Important
A production database and verified provider credentials were not supplied for this implementation. Therefore real-world booking/payment, operator synchronization, production deployment and compliance certification are not claimed as complete. The API refuses to create a confirmed booking while payment/provider verification is absent.
