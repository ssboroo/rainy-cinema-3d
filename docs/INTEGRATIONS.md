# Cinema provider integrations

RAINY CINEMA uses a provider-adapter architecture. Each external cinema system is an independent server-side connector that implements the same normalized contract. The browser never receives provider credentials.

## Verified provider landscape

| Provider | What is verified | RAINY connector state | Required before live sales |
|---|---|---|---|
| Vista Connect / Urgoo | Urgoo publishes a Vista Connect API documentation portal. The documented API exposes showtimes, structured seat plans and order/ticketing operations. | Read-only sessions and seat-plan adapter implemented | Urgoo/Vista-issued client token, cinema ID, region/sales-channel details and sandbox approval |
| TIX Mongolia | TIX publicly operates web, mobile, App Clip, Messenger and WebView ticketing channels and lists multiple cinema partners. | Partner connector not activated; no public developer API contract verified | Written TIX partner/API agreement, sandbox credentials, webhook contract, sales channel and settlement rules |
| Prime Cineplex | Public website and ticketing flows are available. | No official public developer API contract verified | Prime-issued API/partner access and sandbox specification |
| Other cinema software | Many systems provide vendor-specific APIs or partner SDKs. | Adapter extension point available | Vendor API documentation and authorized credentials |

A public website or mobile app does not imply permission to automate its private endpoints. RAINY will not reverse-engineer login-only APIs, replay app tokens, scrape private customer data or simulate a successful booking.

## Adapter contract

Every provider adapter should implement:

- \`health()\` — authenticated connectivity and provider status
- \`getSessions()\` — normalized movie sessions and sales availability
- \`getSeatPlan(sessionId)\` — provider seat layout and status
- \`createOrder(input)\` — optional, only when officially supported
- \`setTickets(orderId, input)\` — optional, provider-side seat/ticket selection
- \`completeOrder(orderId, paymentReference)\` — optional, only after payment is independently verified
- \`getBooking(bookingReference)\` — optional, provider-side booking reconciliation
- \`cancelBooking(bookingReference)\` / \`refundBooking(...)\` — optional, only when provider policy/API supports it

Capabilities must be declared per provider. Unsupported methods must fail explicitly; they must never return demo success.

## Vista Connect: first connector

Official documentation:

- Urgoo Connect API: https://booking.urgoo.mn/WSVistaWebClient/api-docs/general/introduction
- Sessions: https://booking.urgoo.mn/WSVistaWebClient/api-docs/reference-data/sessions
- Seat data: https://booking.urgoo.mn/WSVistaWebClient/api-docs/seating/seat-data
- Vista Digital platform access: https://developer.vista.co/digital-platform/getting-started

The current implementation is deliberately read-only:

- \`GET /api/v1/integrations\` — provider readiness and capabilities
- \`GET /api/v1/integrations/:providerId/health\`
- \`GET /api/v1/integrations/:providerId/sessions\`
- \`GET /api/v1/integrations/:providerId/sessions/:sessionId/seats\`

Vista's Connect seat-plan endpoint is near-real-time and may be short-term cached. The connector exposes that freshness limitation. It does not promise an atomic reservation based on a seat-map response.

### Configure one Vista circuit

Set these variables in Railway (or local \`.env\`) after the cinema grants access:

- \`VISTA_CONNECT_BASE_URL=https://booking.urgoo.mn/WSVistaWebClient\`
- \`VISTA_CONNECT_API_TOKEN\` — issued by the cinema/Vista; never commit it
- \`VISTA_CONNECT_CINEMA_ID\` — exact cinema/site ID issued by the operator
- \`VISTA_CONNECT_REGION_CODE\` — only when required by the operator
- \`VISTA_CONNECT_TIMEOUT_MS=10000\`

### Configure multiple Vista circuits

Set \`CINEMA_PROVIDERS_JSON\` as a Railway secret/environment variable. Example structure (replace all placeholders; never commit real secrets):

\`\`\`json
[
  {
    "id": "urgoo",
    "provider": "vista-connect",
    "baseUrl": "https://booking.urgoo.mn/WSVistaWebClient",
    "apiToken": "<issued-secret>",
    "cinemaId": "<issued-cinema-id>",
    "regionCode": "MN"
  },
  {
    "id": "another-cinema",
    "provider": "vista-connect",
    "baseUrl": "https://<vendor-host>/WSVistaWebClient",
    "apiToken": "<issued-secret>",
    "cinemaId": "<issued-cinema-id>"
  }
]
\`\`\`

Maximum 20 provider instances. Provider IDs are lowercase slugs. Only HTTPS origins are accepted.

## Booking, payment and ticket issuance

The next connector milestone is an authorized end-to-end sandbox flow:

1. Read sessions and current seat plan from the cinema system.
2. Create an order in the cinema provider.
3. Select ticket types and seats using the provider's own transaction/hold semantics.
4. Create a payment request using the configured payment gateway (for Mongolia, QPay can be added after merchant/API credentials are approved).
5. Verify the payment server-to-server using the provider's signature/status API.
6. Complete the cinema order with the verified external payment reference.
7. Retrieve the completed booking and ticket/QR details from the cinema provider.
8. Reconcile uncertain outcomes, duplicate callbacks, refunds and cancellation rules.

Never mark a ticket as confirmed from a browser redirect alone. A timeout after payment is an unknown outcome: query the payment provider and cinema order before retrying or releasing seats.

## Partner onboarding checklist

Ask each cinema/vendor for:

- API specification and sandbox base URL
- client ID / API token and allowed IP/origin rules
- cinema/site IDs, region code and sales-channel configuration
- supported endpoints for films, sessions, seat plans, orders, payments, booking lookup, QR/tickets, cancellations and refunds
- seat hold expiry and inventory consistency guarantees
- webhook event names, signature algorithm, retry policy and replay protection
- payment ownership, settlement, commission, taxes and refund responsibility
- test accounts, test payment methods and go-live approval

## Current limits

The Vista connector currently synchronizes showtimes and seat plans only. It does not create or pay for a real ticket. TIX and Prime are listed as partner-access-required, not connected. Full multi-cinema sales must wait for each provider's authorized sandbox credentials and successful contract tests.
