# Premium entitlements and Worldbuilding

Reader and Writer Premium are independent source records in `user_premium_entitlements`. Effective access is the union of active, started, unpaused, unrevoked, permanent or unexpired records. Permanent records use `is_permanent=true` and `expires_at=NULL`. The legacy `users.is_premium` field remains a Reader-only compatibility projection.

The lazy browser workspace is available at `/novels/:novelId/worldbuilding` and dedicated section routes ending in `/overview`, `/universe-graph`, `/maps`, `/lore-wiki`, `/artifacts`, `/power-systems`, `/timelines`, `/relationships`, and `/settings`. A direct authorized resource can be opened with `?resource=:resourceId`.

Worldbuilding APIs:

- `GET /api/worldbuilding/:novelId/resources?type=lore`
- `GET /api/worldbuilding/:novelId/resources/:id`
- `GET /api/worldbuilding/:novelId/resources/:id/revisions`
- `POST /api/worldbuilding/:novelId/resources`
- `POST /api/worldbuilding/:novelId/resources/reorder`
- `PATCH /api/worldbuilding/:novelId/resources/:id`
- `DELETE /api/worldbuilding/:novelId/resources/:id`

Mutations require authentication, ownership or a management collaborator grant, and active Writer Premium. Platform owners have an administrative override. Public lists return only published resources with published visibility. Published unlisted resources are available only through their direct endpoint. Every reference is validated against the same novel.

Redis keys separate novels, versions, resource types, and authorization scope:

- `app:v1:worldbuilding:novel:{novelId}:v{version}:{type}:published`
- `app:v1:worldbuilding:novel:{novelId}:v{version}:{type}:preview:user:{userId}`
- `app:v1:user:{userId}:entitlements:v{version}`

Worldbuilding TTL is configured by `WORLDBUILDING_CACHE_TTL_SECONDS` and receives jitter. Premium TTL is configured by `PREMIUM_CACHE_TTL_SECONDS`. Mutations and their durable cache-version increments commit in the same PostgreSQL transaction; only the Redis projection is published after commit. A configured but unavailable Redis is bypassed for authoritative entitlement checks. Redis failures therefore fall back to PostgreSQL and cannot preserve revoked Writer access.

Map images reuse `/api/upload/upload`, including content detection, malware scanning, metadata stripping, image validation, and the 10 MB limit. Attaching an uploaded image to a map is protected by the Writer-gated PATCH route.

Apply migrations 024 through 028 in order as the PostgreSQL table owner. Migration 024 imports valid legacy Reader Premium but never grants Writer Premium. Migration 027 adds durable Worldbuilding versions and relationship uniqueness; migration 028 adds durable entitlement-cache versions.

Verification commands:

```sh
npm run lint
npm run test:worldbuilding
npm run test:smoke
npm run test:e2e:worldbuilding
npm run build
```

## Pricing

Advertised prices live in `shared/premiumPricing.ts`, which the plan page and the
checkout endpoint both read so they cannot drift apart:

- **Reader Premium** — $2 / month.
- **Writer Premium** — $2 / month, currently discounted to $1.50 / month. The
  plan page shows the list price struck through beside the promotional one.
- Multi-month commitments apply on top: 13% for 3 months, 20% for 6 months.

Stripe holds the money, so a price change here must be mirrored on the Stripe
Price object. Prefer the per-plan variables
`STRIPE_PRICE_PREMIUM_READER_{1,3,6}M` and `STRIPE_PRICE_PREMIUM_WRITER_{1,3,6}M`;
the older shared `STRIPE_PRICE_PREMIUM_{1,3,6}M` is still accepted as a fallback
for deployments that have not split the two plans yet. Before redirecting to
Stripe the endpoint fetches the Price and refuses the checkout with
`PREMIUM_PRICE_MISMATCH` if its amount disagrees with the quote, so a stale Price
can never bill a customer an amount they were not shown. The quoted figure is
stored on the order (`premium_orders.quoted_amount_cents`) for later disputes.

Reader and Writer create separate entitlement records; a customer may hold either
or both.

Main implementation files:

- `src/components/worldbuilding/WorldbuildingWorkspace.tsx`
- `server/api/routes/worldbuilding.ts`
- `server/utils/worldbuilding.ts`
- `server/utils/premiumEntitlements.ts`
- `src/components/PremiumManagementCards.tsx`
- `src/components/PremiumBulkManagement.tsx`
- `server/api/routes/premiumManagement.ts`

For production, back up PostgreSQL, apply migrations in order, deploy client and server together, persist the uploads directory or object storage, configure Redis, and restart workers. The premium audit trigger rejects normal UPDATE and DELETE operations.
