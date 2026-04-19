# TikTok Ingestion Audit (SOW 3.5 Baseline)

This document freezes the pre-redesign baseline for TikTok ingestion before queue-based rollout.

## Read-path endpoints (dashboard-serving)

- Shop cached read path:
  - `GET /api/tiktok-shop/shop-data/:accountId`
  - `GET /api/tiktok-shop/orders/synced/:accountId/batch`
  - `GET /api/tiktok-shop/cache-status/:accountId`
- Ads dashboard path:
  - `GET /api/tiktok-ads/dashboard/:accountId` (currently mixed DB + live TikTok fetch behavior pre-redesign)

## Ingestion entrypoints (write/sync)

- Manual Shop sync:
  - `POST /api/tiktok-shop/sync/:accountId`
- Scheduled Shop sync:
  - `GET /api/tiktok-shop/sync/cron`
  - `GET /api/tiktok-shop/sync/cron-settlements`
  - `GET /api/tiktok-shop/sync/refresh-tokens`
- Webhook-triggered updates:
  - `POST /api/tiktok-shop/webhook` (single-order and selective background sync flows)
- Ads polling:
  - `POST /api/tiktok-ads/poll-all`
  - `POST /api/tiktok-ads/sync/:accountId`

## Current characteristics

- Retry behavior exists in route/service helpers (exponential backoff and selective retries).
- Idempotency partially exists through DB upsert keys (`onConflict`) and webhook dedupe IDs.
- Dashboard flow still triggers sync in some frontend stale-data paths.
- Background work is mostly in-process Promise execution (not durable queue worker jobs).
- Monitoring is mostly request/app logs and endpoint responses; no durable run history table.

## SOW 3.5 implementation intent

- Move sync orchestration onto durable queued jobs.
- Keep dashboard read routes DB-first and independent from real-time API round trips.
- Add ingestion run history, retry scheduling, dead-letter outcomes, and token-health warnings.
