import crypto from 'crypto';
import { supabase } from '../config/supabase.js';

export type IngestionStream = 'shop' | 'ads';
export type IngestionStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'dead_letter';

export interface IngestionJobPayload {
    accountId: string;
    shopId?: string;
    syncType?: string;
    startDate?: string;
    endDate?: string;
    forceFullSync?: boolean;
    source?: string;
}

export interface EnqueueJobInput {
    stream: IngestionStream;
    accountId: string;
    shopDbId?: string;
    syncType: string;
    payload: IngestionJobPayload;
    priority?: number;
    maxAttempts?: number;
    idempotencyWindowMinutes?: number;
}

export interface IngestionJobRow {
    id: string;
    stream: IngestionStream;
    account_id: string;
    shop_id: string | null;
    sync_type: string;
    payload: IngestionJobPayload;
    status: IngestionStatus;
    attempt_count: number;
    max_attempts: number;
    next_retry_at: string;
    last_error: string | null;
    created_at: string;
    updated_at: string;
    completed_at: string | null;
}

export function buildIdempotencyKey(input: EnqueueJobInput): string {
    const now = new Date();
    const bucketMinutes = input.idempotencyWindowMinutes ?? 10;
    const bucket = Math.floor(now.getTime() / (bucketMinutes * 60_000));
    const raw = JSON.stringify({
        stream: input.stream,
        accountId: input.accountId,
        shopDbId: input.shopDbId ?? null,
        syncType: input.syncType,
        startDate: input.payload.startDate ?? null,
        endDate: input.payload.endDate ?? null,
        forceFullSync: !!input.payload.forceFullSync,
        bucket,
    });

    return crypto.createHash('sha256').update(raw).digest('hex');
}

export function computeBackoffSeconds(attemptCount: number): number {
    const base = Math.pow(2, Math.max(0, attemptCount - 1));
    return Math.min(900, base * 30); // 30s, 60s, 120s ... max 15m
}

const STALE_LOCK_MINUTES = Number(process.env.INGESTION_STALE_LOCK_MINUTES ?? 8);

async function reclaimStaleRunningJobs(stream: IngestionStream): Promise<void> {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const staleBeforeIso = new Date(now - Math.max(1, STALE_LOCK_MINUTES) * 60_000).toISOString();
    const staleMessage = `Worker heartbeat lost (>${Math.max(1, STALE_LOCK_MINUTES)}m); job re-queued`;

    const { data: staleRows, error } = await supabase
        .from('ingestion_jobs')
        .select('*')
        .eq('stream', stream)
        .eq('status', 'running')
        .not('locked_at', 'is', null)
        .lte('locked_at', staleBeforeIso)
        .limit(50);

    if (error) throw error;
    const jobs = (staleRows ?? []) as IngestionJobRow[];
    if (jobs.length === 0) return;

    for (const job of jobs) {
        const reachedMax = job.attempt_count >= job.max_attempts;
        await supabase
            .from('ingestion_jobs')
            .update({
                status: reachedMax ? 'dead_letter' : 'queued',
                next_retry_at: nowIso,
                locked_at: null,
                locked_by: null,
                updated_at: nowIso,
                completed_at: reachedMax ? nowIso : null,
                last_error: staleMessage,
            })
            .eq('id', job.id)
            .eq('status', 'running');

        await supabase
            .from('ingestion_job_attempts')
            .update({
                status: 'failed',
                finished_at: nowIso,
                error: staleMessage,
            })
            .eq('job_id', job.id)
            .eq('status', 'running')
            .is('finished_at', null);
    }
}

export async function enqueueIngestionJob(input: EnqueueJobInput): Promise<{ job: IngestionJobRow; deduped: boolean }> {
    const idempotencyKey = buildIdempotencyKey(input);

    const { data: existing } = await supabase
        .from('ingestion_jobs')
        .select('*')
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();

    if (existing) {
        return { job: existing as IngestionJobRow, deduped: true };
    }

    const { data, error } = await supabase
        .from('ingestion_jobs')
        .insert({
            stream: input.stream,
            provider: 'tiktok',
            account_id: input.accountId,
            shop_id: input.shopDbId ?? null,
            sync_type: input.syncType,
            payload: input.payload,
            idempotency_key: idempotencyKey,
            priority: input.priority ?? 100,
            max_attempts: input.maxAttempts ?? 5,
        })
        .select('*')
        .single();

    if (error) throw error;
    return { job: data as IngestionJobRow, deduped: false };
}

export async function claimIngestionJobs(workerId: string, stream: IngestionStream, limit = 5): Promise<IngestionJobRow[]> {
    await reclaimStaleRunningJobs(stream);
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
        .from('ingestion_jobs')
        .select('*')
        .eq('stream', stream)
        .eq('status', 'queued')
        .lte('next_retry_at', nowIso)
        .order('priority', { ascending: true })
        .order('created_at', { ascending: true })
        .limit(limit);

    if (error) throw error;
    const jobs = (data ?? []) as IngestionJobRow[];
    if (jobs.length === 0) return [];

    const claimed: IngestionJobRow[] = [];
    for (const job of jobs) {
        const { data: updated, error: upErr } = await supabase
            .from('ingestion_jobs')
            .update({
                status: 'running',
                locked_by: workerId,
                locked_at: nowIso,
                updated_at: nowIso,
                attempt_count: job.attempt_count + 1,
            })
            .eq('id', job.id)
            .eq('status', 'queued')
            .select('*')
            .maybeSingle();

        if (!upErr && updated) {
            claimed.push(updated as IngestionJobRow);
            await supabase.from('ingestion_job_attempts').insert({
                job_id: job.id,
                attempt_no: (job.attempt_count ?? 0) + 1,
                status: 'running',
                worker_id: workerId,
            });
        }
    }

    return claimed;
}

export async function markIngestionJobSucceeded(jobId: string, result: unknown): Promise<void> {
    const nowIso = new Date().toISOString();
    await supabase
        .from('ingestion_jobs')
        .update({
            status: 'succeeded',
            completed_at: nowIso,
            locked_at: null,
            locked_by: null,
            updated_at: nowIso,
            last_error: null,
        })
        .eq('id', jobId);

    await supabase
        .from('ingestion_job_attempts')
        .update({
            status: 'succeeded',
            finished_at: nowIso,
            result: result as object,
        })
        .eq('job_id', jobId)
        .is('finished_at', null);
}

export async function markIngestionJobFailed(
    job: IngestionJobRow,
    error: unknown,
    opts?: { forceDeadLetter?: boolean },
): Promise<void> {
    const nowIso = new Date().toISOString();
    const message = error instanceof Error ? error.message : String(error);
    const reachedMax = !!opts?.forceDeadLetter || job.attempt_count >= job.max_attempts;
    const status: IngestionStatus = reachedMax ? 'dead_letter' : 'queued';
    const nextRetryAt = reachedMax
        ? nowIso
        : new Date(Date.now() + computeBackoffSeconds(job.attempt_count) * 1000).toISOString();

    await supabase
        .from('ingestion_jobs')
        .update({
            status,
            next_retry_at: nextRetryAt,
            locked_at: null,
            locked_by: null,
            updated_at: nowIso,
            last_error: message,
            completed_at: reachedMax ? nowIso : null,
        })
        .eq('id', job.id);

    await supabase
        .from('ingestion_job_attempts')
        .update({
            status: 'failed',
            finished_at: nowIso,
            error: message,
        })
        .eq('job_id', job.id)
        .is('finished_at', null);
}

export async function updateIngestionJobProgress(jobId: string, progress: Record<string, unknown>): Promise<void> {
    await supabase
        .from('ingestion_job_attempts')
        .update({
            result: {
                progress,
                updated_at: new Date().toISOString(),
            } as object,
        })
        .eq('job_id', jobId)
        .eq('status', 'running')
        .is('finished_at', null);
}

export async function getIngestionJob(jobId: string): Promise<IngestionJobRow | null> {
    const { data, error } = await supabase
        .from('ingestion_jobs')
        .select('*')
        .eq('id', jobId)
        .maybeSingle();
    if (error) throw error;
    return (data as IngestionJobRow | null) ?? null;
}
