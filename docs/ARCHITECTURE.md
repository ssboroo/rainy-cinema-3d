# Architecture

## Chosen approach: modular monolith with ports-and-adapters boundaries

A single deployable keeps operating cost and failure modes manageable for an early-stage product. The domain layer remains independent of Fastify and PostgreSQL so provider adapters and additional clients can be introduced without splitting into premature microservices.

```text
Browser / Embed SDK
       |
       v
Fastify API (auth, validation, rate limits, CORS)
       |
       +---- Domain (seat rules, holds, booking state machine)
       |
       +---- PostgreSQL adapter (tenant-scoped transactions, row locks)
       |
       +---- Cinema provider port (not configured)
       |
       +---- Payment provider port (not configured)
```

## Core invariants

1. Tenant identity is derived from a verified JWT, never from user-controlled input.
2. Inventory reads and writes include tenant scope.
3. A seat hold is created in a transaction and locks the relevant inventory rows.
4. Hold expiration is enforced by server time, not the browser clock.
5. Idempotency keys are unique per tenant and user; key reuse with a different payload is rejected.
6. A booking cannot be confirmed by a browser request. It requires a verified payment/provider event.
7. External provider responses must be validated before changing booking state.

## Evolution path

- Add operator-specific cinema adapters behind a stable provider interface.
- Add signed webhook inbox + idempotent event processing and reconciliation.
- Add admin CRUD and layout editor after the provider and tenancy contracts are validated.
- Split services only when measured throughput, team ownership or independent scaling justifies it.
