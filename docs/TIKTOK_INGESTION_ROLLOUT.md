# TikTok Ingestion Rollout (SOW 3.5)

## Phase 1: Database + Queue Primitives

1. Apply migration `20260415110000_ingestion_jobs.sql`.
2. Verify new tables: `ingestion_jobs`, `ingestion_job_attempts`.
3. Verify new token health columns on `tiktok_shops`.

## Phase 2: Worker Activation

1. Deploy backend with queue endpoints:
   - `POST /api/tiktok-shop/sync/:accountId` (enqueue)
   - `POST /api/tiktok-shop/sync/run-worker` (worker runner)
   - `GET /api/tiktok-shop/sync/job/:jobId` (job status)
2. Confirm cron schedules in `server/vercel.json`:
   - `/api/tiktok-shop/sync/run-worker`
   - `/api/tiktok-shop/sync/refresh-tokens`
   - `/api/tiktok-ads/poll-all`

## Phase 3: Dashboard Cutover

1. Validate frontend `useShopStore` queue flow:
   - enqueue, poll, refresh DB-backed data.
2. Validate Ads dashboard route is DB-first and does not call live APIs in the read path.
3. Verify sync buttons still refresh data via explicit sync endpoints.

## Phase 4: Monitoring and Alerting

1. Use `GET /api/tiktok-shop/sync/monitoring/status` for ingestion health.
2. Watch for:
   - growth in `dead_letter` jobs
   - stale shop sync timestamps
   - token statuses `warning` and `reauth_required`

## Validation Checklist

- `npm --prefix server run typecheck` passes.
- `npm --prefix server run test:ingestion` passes.
- Shop dashboard loads without waiting on live TikTok API.
- Ads dashboard responds from DB cache even during TikTok API outage.
