/**
 * Ads Polling Service
 *
 * Fetches today's metrics (and optionally recent days) for a single TikTok
 * advertiser and upserts the results into Supabase.
 *
 * Designed to run frequently (every 5 min). Scoped to a short date range so
 * each poll is fast (~2-5 sec per advertiser, vs 30+ sec for a full sync).
 */

import { tiktokBusinessApi } from './tiktok-business-api.service.js';
import { supabase } from '../config/supabase.js';
import { randomUUID } from 'crypto';
import { logSystemEvent } from './system-logger.js';

export type PollRange = 'today' | '7d';

interface Advertiser {
    id: string;                 // internal UUID
    advertiser_id: string;      // TikTok advertiser ID
    access_token: string;
    currency: string;
    account_id: string;
}

// The PollResult interface encapsulates the result of a single advertiser poll
export interface PollResult {
    success: boolean;
    advertiser_id: string; // The UUID from tiktok_advertisers
    account_id: string; // The Mamba account_id
    rows_upserted: number;
    error?: string;
    token_revoked?: boolean;
}

async function recordAdsPollActivity(range: PollRange, result: PollResult): Promise<void> {
    if (!result.account_id) {
        console.warn('[Ads Poll Activity] Missing account_id, skipping activity record', {
            advertiser_id: result.advertiser_id,
        });
        return;
    }

    const nowIso = new Date().toISOString();
    const syncType = `poll_all_${range}`;
    const status = result.success ? 'succeeded' : 'failed';
    const { data: job, error: jobErr } = await supabase
        .from('ingestion_jobs')
        .insert({
            stream: 'ads',
            provider: 'tiktok',
            account_id: result.account_id,
            sync_type: syncType,
            payload: {
                source: 'poll_all',
                range,
                advertiserId: result.advertiser_id,
                tokenRevoked: !!result.token_revoked,
            },
            idempotency_key: randomUUID(),
            status,
            attempt_count: 1,
            max_attempts: 1,
            next_retry_at: nowIso,
            completed_at: nowIso,
            last_error: result.error ?? null,
            updated_at: nowIso,
        })
        .select('id')
        .single();
    if (jobErr || !job?.id) {
        console.error('[Ads Poll Activity] Failed to insert ingestion_jobs row', {
            advertiser_id: result.advertiser_id,
            account_id: result.account_id,
            error: jobErr?.message,
        });
        return;
    }

    const { error: attemptErr } = await supabase.from('ingestion_job_attempts').insert({
        job_id: job.id,
        attempt_no: 1,
        status,
        started_at: nowIso,
        finished_at: nowIso,
        error: result.error ?? null,
        result: {
            rows_upserted: result.rows_upserted,
            token_revoked: !!result.token_revoked,
        },
        worker_id: 'ads-poll',
    });
    if (attemptErr) {
        console.error('[Ads Poll Activity] Failed to insert ingestion_job_attempts row', {
            job_id: job.id,
            advertiser_id: result.advertiser_id,
            account_id: result.account_id,
            error: attemptErr.message,
        });
    }
}

/**
 * Helper – return today and N days back as YYYY-MM-DD strings.
 */
function getDateRange(daysBack: number): { startDate: string; endDate: string } {
    const now = new Date();
    const end = now.toISOString().split('T')[0];
    const start = new Date(now.getTime() - daysBack * 86_400_000)
        .toISOString()
        .split('T')[0];
    return { startDate: start, endDate: end };
}

/**
 * Poll a single advertiser. Fetches spend + campaign metrics for the given
 * range, merges them, and upserts into tiktok_ad_spend_daily.
 */
export async function pollAdvertiserMetrics(
    advertiser: Advertiser,
    range: PollRange = 'today',
): Promise<PollResult> {
    // We use a 3-day overlap (daysBack = 2) for the "today" poll to prevent
    // timezone rollovers from leaving "yesterday" with incomplete metrics
    // until the hourly 7d cron runs.
    const daysBack = range === 'today' ? 2 : 7;
    const { startDate, endDate } = getDateRange(daysBack);

    console.log(
        `[Ads Poll] Polling advertiser ${advertiser.advertiser_id} (${advertiser.account_id}) for ${startDate} → ${endDate}`,
    );

    try {
        // Fetch shops for GMV Max
        const { data: shops } = await supabase
            .from('tiktok_shops')
            .select('shop_id')
            .eq('account_id', advertiser.account_id);

        const storeIds: string[] = (shops || []).map((s: any) => s.shop_id).filter(Boolean);
        let isRevoked = false;

        const handleApiError = (e: any, label: string) => {
            console.error(`[Ads Poll] ${label}:`, e.message);
            if (e.message && e.message.includes('40105')) {
                isRevoked = true;
            }
            logSystemEvent({
                level: 'error',
                scope: 'ads',
                event: 'ads.poll.fetch_failed',
                stream: 'ads',
                accountId: advertiser.account_id,
                message: `${label}: ${e?.message || 'unknown error'}`,
                data: {
                    advertiserId: advertiser.advertiser_id,
                    internalAdvertiserId: advertiser.id,
                    range,
                    startDate,
                    endDate,
                    tokenRevokedCode40105: !!(e?.message && String(e.message).includes('40105')),
                },
            });
            return [];
        };

        // Parallel fetch: consolidated overview (spend) + GMV Max report
        const [dailySpendRes, gmvSpendRes] = await Promise.all([
            tiktokBusinessApi
                .getConsolidatedOverview(
                    advertiser.access_token,
                    advertiser.advertiser_id,
                    startDate,
                    endDate,
                )
                .then((r: any) => r.list || [])
                .catch((e: any) => handleApiError(e, 'Daily spend error')),

            storeIds.length > 0
                ? tiktokBusinessApi
                    .getGmvMaxReport(
                        advertiser.access_token,
                        advertiser.advertiser_id,
                        startDate,
                        endDate,
                        storeIds,
                    )
                    .then((r: any) => r.list || [])
                    .catch((e: any) => handleApiError(e, 'GMV Max error'))
                : Promise.resolve([]),
        ]);

        if (isRevoked) {
            console.warn(`[Ads Poll] Token revoked for advertiser ${advertiser.advertiser_id}. Auto-deactivating in database.`);
            logSystemEvent({
                level: 'error',
                scope: 'ads',
                event: 'ads.token.revoked_detected',
                stream: 'ads',
                accountId: advertiser.account_id,
                message: 'TikTok Ads token appears revoked (40105); advertiser auto-deactivated.',
                data: {
                    advertiserId: advertiser.advertiser_id,
                    internalAdvertiserId: advertiser.id,
                    range,
                    startDate,
                    endDate,
                },
            });
            const { error: deactivateError } = await supabase
                .from('tiktok_advertisers')
                .update({ is_active: false })
                .eq('id', advertiser.id);
                
            if (deactivateError) {
                console.error(`[Ads Poll] Failed to deactivate advertiser ${advertiser.advertiser_id}:`, deactivateError.message);
            }

            return {
                success: false,
                advertiser_id: advertiser.advertiser_id,
                account_id: advertiser.account_id,
                rows_upserted: 0,
                error: 'Token revoked (40105)',
                token_revoked: true,
            };
        }

        // ── Merge GMV into spend (same logic as the full sync) ──────────────
        const spendMap = new Map<string, any>();

        for (const day of dailySpendRes) {
            const dateStr = day.dimensions?.stat_time_day;
            if (dateStr) spendMap.set(dateStr, day);
        }

        for (const gmvDay of gmvSpendRes) {
            const dateStr = gmvDay.dimensions?.stat_time_day || gmvDay.metrics?.stat_time_day;
            if (!dateStr) continue;

            const gm = gmvDay.metrics || {};
            const costToAdd = parseFloat(gm.cost || gm.spend || '0');
            const ordersToAdd = parseInt(gm.orders || gm.complete_payment || '0');
            const roiVal = parseFloat(gm.roi || '0');
            const convVal = costToAdd * roiVal;

            const existing = spendMap.get(dateStr);
            if (existing) {
                if (!existing._gmvFlag) {
                    existing._gmvFlag = true;
                    const m = existing.metrics || {};
                    existing.metrics = {
                        ...m,
                        spend: parseFloat(m.spend || m.cost || '0'),
                        cost: parseFloat(m.cost || m.spend || '0'),
                        complete_payment: parseInt(m.complete_payment || '0'),
                        impressions: parseInt(m.impressions || '0'),
                        clicks: parseInt(m.clicks || '0'),
                        _gmv_revenue: 0,
                    };
                }
                existing.metrics.spend += costToAdd;
                existing.metrics.cost += costToAdd;
                existing.metrics.complete_payment += ordersToAdd;
                existing.metrics.impressions += parseInt(gm.impressions || '0');
                existing.metrics.clicks += parseInt(gm.clicks || '0');
                existing.metrics._gmv_revenue += convVal;
                if (existing.metrics.spend > 0) {
                    existing.metrics.roi = String(existing.metrics._gmv_revenue / existing.metrics.spend);
                }
            } else {
                spendMap.set(dateStr, {
                    dimensions: { stat_time_day: dateStr },
                    metrics: {
                        spend: costToAdd,
                        cost: costToAdd,
                        complete_payment: ordersToAdd,
                        roi: roiVal ? String(roiVal) : '0',
                        _gmv_revenue: convVal,
                    },
                    _gmvFlag: true,
                });
            }
        }

        const merged = Array.from(spendMap.values());
        if (merged.length === 0) {
            return { success: true, advertiser_id: advertiser.advertiser_id, account_id: advertiser.account_id, rows_upserted: 0 };
        }

        // ── Build upsert records ────────────────────────────────────────────
        const spendRecords = merged.map((day) => {
            const dims = day.dimensions || {};
            const m = day.metrics || {};
            const statDate = dims.stat_time_day || m.stat_time_day;
            const spend = parseFloat(String(m.spend || m.cost || '0'));
            const conversionVal =
                m._gmv_revenue !== undefined
                    ? m._gmv_revenue
                    : m.roi
                        ? spend * parseFloat(m.roi || '0')
                        : parseFloat(m.value_per_complete_payment || '0') *
                          parseInt(m.complete_payment || '0');

            return {
                advertiser_id: advertiser.id,
                account_id: advertiser.account_id,
                spend_date: statDate,
                total_spend: spend,
                total_impressions: parseInt(m.impressions || '0'),
                total_clicks: parseInt(m.clicks || '0'),
                total_conversions: parseInt(m.complete_payment || m.orders || '0'),
                conversion_value: conversionVal,
                currency: advertiser.currency,
            };
        });

        // ── Upsert ─────────────────────────────────────────────────────────
        const { error } = await supabase
            .from('tiktok_ad_spend_daily')
            .upsert(spendRecords, { onConflict: 'advertiser_id, spend_date' });

        if (error) {
            throw error;
        }

        // Update last_synced_at timestamp on the advertiser row
        await supabase
            .from('tiktok_advertisers')
            .update({ last_synced_at: new Date().toISOString() })
            .eq('id', advertiser.id);

        console.log(
            `[Ads Poll] ✅ Upserted ${spendRecords.length} rows for advertiser ${advertiser.advertiser_id}`,
        );

        return {
            success: true,
            advertiser_id: advertiser.advertiser_id,
            account_id: advertiser.account_id,
            rows_upserted: spendRecords.length,
        };
    } catch (err: any) {
        console.error(
            `[Ads Poll] ❌ Failed for advertiser ${advertiser.advertiser_id}:`,
            err.message,
        );
        return {
            success: false,
            advertiser_id: advertiser.advertiser_id,
            account_id: advertiser.account_id,
            rows_upserted: 0,
            error: err.message,
        };
    }
}

/**
 * Poll ALL active advertisers with a concurrency limit.
 * Returns a summary of results.
 */
export async function pollAllAdvertisers(range: PollRange = 'today'): Promise<{
    total: number;
    succeeded: number;
    failed: number;
    results: PollResult[];
}> {
    const { data: advertisers, error } = await supabase
        .from('tiktok_advertisers')
        .select('id, advertiser_id, access_token, currency, account_id')
        .eq('is_active', true);

    if (error || !advertisers || advertisers.length === 0) {
        console.log('[Ads Poll] No active advertisers found to poll.');
        return { total: 0, succeeded: 0, failed: 0, results: [] };
    }

    console.log(`[Ads Poll] Polling ${advertisers.length} active advertiser(s), range=${range}`);

    // Run with max 5 concurrent requests to avoid overloading the TikTok API
    const CONCURRENCY = 5;
    const results: PollResult[] = [];

    for (let i = 0; i < advertisers.length; i += CONCURRENCY) {
        const batch = advertisers.slice(i, i + CONCURRENCY);
        const batchResults = await Promise.all(
            batch.map((adv: any) => pollAdvertiserMetrics(adv, range)),
        );
        results.push(...batchResults);
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    await Promise.all(results.map((r) => recordAdsPollActivity(range, r)));

    console.log(`[Ads Poll] Done. ${succeeded} succeeded, ${failed} failed.`);

    return {
        total: results.length,
        succeeded,
        failed,
        results,
    };
}
