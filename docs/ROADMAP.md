# Development roadmap

## Phase 0 — visual prototype (included)
- 3D auditorium, 2D fallback, seat state UI, totals, responsive layout, basic tests.
- User experience and technical feasibility validation.

## Phase 1 — shared contracts and layout editor
- Move source into workspaces only when packages actually have working boundaries.
- Versioned Cinema, Hall, Showtime, Seat, SeatMap schema using TypeScript/Zod.
- Auditorium designer: add/move/delete rows and seats; CSV import; JSON export; versioned layout persistence.
- Proper per-seat camera preview, configurable measurements/estimates.

## Phase 2 — backend and adapters
- Fastify API, PostgreSQL migrations, RBAC/tenant isolation, audit log.
- Adapter SDK, registry and configurable generic REST mappings.
- Capabilities: availability, hold/release, create/cancel booking; explicit unsupported capability handling.
- Verified operator API integration only once real operator specs and test credentials are available.

## Phase 3 — booking safety and synchronization
- Strict booking state machine, idempotency, stale inventory handling, webhook signature checking, reconciliation/poll fallback, WebSocket updates.
- Provider remains source of truth. No fake success on missing provider confirmation.

## Phase 4 — embeddable product
- Framework-neutral JS loader, React/Vue SDKs, allowed-origin/session security, themes, accessibility, localization.
- Operator admin dashboard and operator integration playground.

## Phase 5 — commercial readiness
- Cloud and Docker self-hosted deployment, metrics, backups, CI/CD, auth hardening, benchmarks, threat model, documentation, paid licensing.

### Acceptance gate
Each phase must have real tests and an explicit list of unfinished features. The project must never advertise production readiness before a real provider integration has been verified.
