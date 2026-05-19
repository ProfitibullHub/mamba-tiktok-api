import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    Activity,
    AlertTriangle,
    CheckCircle2,
    Clock3,
    Database,
    Loader2,
    Play,
    RefreshCw,
    ShieldAlert,
    Timer,
    Wifi,
    WifiOff,
    ListFilter,
    PanelRightOpen,
    X,
} from 'lucide-react';
import { apiFetch, getAccessTokenForApi, getApiOrigin } from '../../lib/apiClient';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'dead_letter';
type Stream = 'shop' | 'ads';
type LogLevel = 'info' | 'warn' | 'error';

type MonitoringJob = {
    id: string;
    status: JobStatus;
    created_at?: string;
    updated_at: string;
    last_error: string | null;
    stream: Stream;
    sync_type?: string;
    payload?: Record<string, unknown>;
    account_id?: string | null;
};

type MonitoringStaleShop = {
    id: string;
    shop_id: string;
    shop_name: string;
    orders_last_synced_at: string | null;
    products_last_synced_at: string | null;
    settlements_last_synced_at: string | null;
};

type MonitoringTokenWarning = {
    id: string;
    shop_id: string;
    shop_name: string;
    token_status: string;
    token_warning_level: string | null;
    last_token_error: string | null;
    token_last_checked_at: string | null;
};

type MonitoringResponse = {
    success: boolean;
    asOf: string;
    jobs: {
        queuedOrRunning: number;
        queued?: number;
        running?: number;
        deadLetter: number;
        rows: MonitoringJob[];
        insights24h?: {
            enqueuedTotal: number;
            completed: number;
            failed: number;
            deadLetter: number;
            retried: number;
            oldestQueuedMs: number | null;
            bySource: Record<string, number>;
            bySyncType: Record<string, number>;
            byStream: Record<string, number>;
        };
    };
    staleness: {
        staleOrUnknown: number;
        rows: MonitoringStaleShop[];
    };
    tokenHealth: {
        warnings: number;
        rows: MonitoringTokenWarning[];
    };
    recentActivity: Array<{
        job_id: string;
        stream: Stream;
        sync_type: string;
        source?: string;
        account_id: string | null;
        shop_id: string | null;
        shop_name: string | null;
        advertiser_id: string | null;
        advertiser_name: string | null;
        attempt_no: number;
        status: string;
        error: string | null;
        started_at: string;
        finished_at: string | null;
        result?: Record<string, unknown> | null;
    }>;
    observability?: {
        systemLogs24h: {
            total: number;
            errors: number;
            warnings: number;
            rows?: LogEntry[];
            errorsRows: LogEntry[];
            warningRows: LogEntry[];
        };
        performance: {
            requests24h: number;
            error5xx24h: number;
            warn4xx24h: number;
            p50Ms: number | null;
            p95Ms: number | null;
            p99Ms: number | null;
            maxMs: number | null;
            recent: Array<{ created_at: string; data: Record<string, unknown>; message: string | null; level: string }>;
        };
        audit: {
            totalFetched: number;
            billingAndPermissionRows: Array<{
                id: string;
                created_at: string;
                action: string;
                resource_type: string;
                resource_id?: string | null;
                actor_user_id?: string | null;
                actor_email: string | null;
                tenant_id: string | null;
                account_id: string | null;
                ip_address: string | null;
                metadata?: Record<string, unknown>;
                before_state?: Record<string, unknown> | null;
                after_state?: Record<string, unknown> | null;
                /** Server-computed PRD bucket for dashboard grouping */
                prd_category?: string | null;
            }>;
        };
    };
};

type LogEntry = {
    id: string;
    level: LogLevel;
    scope: string;
    event: string;
    stream: string | null;
    job_id: string | null;
    account_id: string | null;
    shop_id: string | null;
    message: string | null;
    data: Record<string, unknown>;
    created_at: string;
};

/** Mirrors server `MonitoringAuditPrdCategory` for ingestion audit grouping */
type MonitoringAuditPrdCategory =
    | 'tiktok_ingestion'
    | 'rbac_permissions_plans'
    | 'financial_visibility'
    | 'exports'
    | 'tenancy'
    | 'branding'
    | 'pl'
    | 'tasks'
    | 'other';

type MonitoringAuditTabId = 'all' | MonitoringAuditPrdCategory;

const MONITORING_AUDIT_TABS: { id: MonitoringAuditTabId; label: string; shortHint: string }[] = [
    { id: 'all', label: 'All', shortHint: 'Included audit rows' },
    {
        id: 'tiktok_ingestion',
        label: 'TikTok ingestion',
        shortHint: 'Shop & ads sync: enqueue, worker start/success/fail, counts in after_state',
    },
    {
        id: 'rbac_permissions_plans',
        label: 'RBAC & subscriptions',
        shortHint: 'Roles, assignments, denials, plans, billing, finance API auth',
    },
    {
        id: 'financial_visibility',
        label: 'Financial visibility',
        shortHint: 'Restriction rules, seller visibility policy, DB restriction changes',
    },
    { id: 'exports', label: 'Exports', shortHint: 'Dashboard / data exports' },
    {
        id: 'tenancy',
        label: 'Multi-tenant',
        shortHint: 'Tenant lifecycle, agency–seller links, user–seller assignments',
    },
    { id: 'branding', label: 'White-label', shortHint: 'Branding create/update' },
    { id: 'pl', label: 'P&L custom', shortHint: 'Custom line items & scoped values' },
    { id: 'tasks', label: 'Agency tasks', shortHint: 'Kanban task audit trail' },
    { id: 'other', label: 'Other', shortHint: 'Unclassified included rows' },
];

// ─────────────────────────────────────────────────────────────────────────────
// API helpers
// ─────────────────────────────────────────────────────────────────────────────

const REFETCH_INTERVAL_MS = 20_000;
const MAX_LOG_ENTRIES = 500;

async function fetchMonitoringStatus(): Promise<MonitoringResponse> {
    const res = await apiFetch('/api/tiktok-shop/sync/monitoring/status');
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to load monitoring status');
    return data;
}

async function triggerWorkerRun(): Promise<{ claimed: number; results: any[] }> {
    const res = await apiFetch('/api/tiktok-shop/sync/run-worker?limit=5', { method: 'POST' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to run worker');
    return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function formatTs(ts: string | null | undefined): string {
    if (!ts) return '—';
    return new Date(ts).toLocaleString();
}

function formatAge(ts: string | null | undefined): string {
    if (!ts) return '—';
    const diffMs = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diffMs / 60_000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
}

function formatDurationMs(ms: number | null | undefined): string {
    if (!ms || ms < 0) return '—';
    const mins = Math.floor(ms / 60_000);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;
    return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
}

function formatLogTime(ts: string): string {
    return new Date(ts).toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}

/** One-line summary from ingestion_job_attempts.result for monitoring table */
function formatIngestionAttemptSummary(
    status: string,
    result: Record<string, unknown> | null | undefined,
): string {
    if (!result || typeof result !== 'object') {
        return status === 'running' ? '…running' : '—';
    }
    if (status === 'running' && 'progress' in result && result.progress && typeof result.progress === 'object') {
        const p = result.progress as Record<string, unknown>;
        const phase = typeof p.phase === 'string' ? p.phase : 'run';
        const processed = typeof p.processed === 'number' ? p.processed : null;
        const total = typeof p.total === 'number' ? p.total : null;
        if (processed != null && total != null) return `${phase} ${processed}/${total}`;
        return phase;
    }
    const stats = result.stats;
    if (stats && typeof stats === 'object') {
        const parts: string[] = [];
        if (result.isFirstSync === true) parts.push('first');
        else if (result.isFirstSync === false) parts.push('incr');
        for (const [k, v] of Object.entries(stats as Record<string, unknown>)) {
            if (!v || typeof v !== 'object') continue;
            const o = v as Record<string, unknown>;
            const bits: string[] = [];
            if (typeof o.upserted === 'number') bits.push(`↑${o.upserted}`);
            if (typeof o.fetched === 'number' && o.fetched !== o.upserted) bits.push(`f${o.fetched}`);
            if (o.isIncremental === true) bits.push('Δ');
            if (o.isIncremental === false) bits.push('full');
            if (bits.length) parts.push(`${k}:${bits.join('/')}`);
        }
        return parts.length ? parts.join(' · ') : 'ok';
    }
    if (result.success === true && result.summary && typeof result.summary === 'object') {
        const s = result.summary as Record<string, unknown>;
        const c = typeof s.campaigns === 'number' ? s.campaigns : 0;
        const ag = typeof s.adGroups === 'number' ? s.adGroups : 0;
        const ads = typeof s.ads === 'number' ? s.ads : 0;
        const m = typeof s.metricsRecords === 'number' ? s.metricsRecords : 0;
        return `ads c${c}/ag${ag}/a${ads}/m${m}`;
    }
    if (typeof result.message === 'string') {
        return result.message.length > 72 ? `${result.message.slice(0, 69)}…` : result.message;
    }
    return '—';
}

function formatAuditJson(value: unknown): string {
    if (value === null || value === undefined) return 'null';
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

/** One-line hint for list view (full JSON opens in drawer). */
function auditSnapshotHint(r: {
    before_state?: Record<string, unknown> | null;
    after_state?: Record<string, unknown> | null;
    metadata?: Record<string, unknown>;
}): string {
    const hb = r.before_state != null;
    const ha = r.after_state != null;
    if (hb && ha) return 'Before + after';
    if (ha) return 'After only';
    if (hb) return 'Before only';
    const meta = r.metadata;
    if (meta && typeof meta === 'object' && Object.keys(meta).length > 0) {
        return `Metadata (${Object.keys(meta).length})`;
    }
    return '—';
}

type MonitoringAuditLogRow = NonNullable<
    NonNullable<MonitoringResponse['observability']>['audit']['billingAndPermissionRows']
>[number];

function AuditLogDetailDrawer({
    row,
    onClose,
}: {
    row: MonitoringAuditLogRow | null;
    onClose: () => void;
}) {
    if (!row) return null;
    const meta = row.metadata && typeof row.metadata === 'object' ? (row.metadata as Record<string, unknown>) : null;
    const block = (title: string, body: string) => (
        <div className="mb-5">
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-2">{title}</h4>
            <pre className="max-h-[38vh] overflow-auto rounded-lg border border-white/10 bg-black/60 p-3 text-[11px] leading-relaxed text-gray-200 font-mono whitespace-pre-wrap break-words">
                {body}
            </pre>
        </div>
    );

    return (
        <div className="fixed inset-0 z-[60] flex justify-end" role="presentation">
            <button
                type="button"
                className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
                aria-label="Close audit detail"
                onClick={onClose}
            />
            <div
                className="relative z-10 flex h-full w-full max-w-xl flex-col border-l border-white/10 bg-[#0c0d12] shadow-2xl"
                role="dialog"
                aria-modal="true"
                aria-labelledby="audit-drawer-title"
            >
                <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3 shrink-0">
                    <div className="min-w-0">
                        <p id="audit-drawer-title" className="text-sm font-bold text-white truncate">
                            Audit entry
                        </p>
                        <p className="text-xs text-cyan-300 mt-0.5 font-mono truncate">{row.action}</p>
                        <p className="text-[11px] text-gray-500 mt-1">{formatTs(row.created_at)}</p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="shrink-0 rounded-lg border border-white/15 p-2 text-gray-400 hover:bg-white/10 hover:text-white transition-colors"
                        aria-label="Close"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto px-4 py-4">
                    <div className="space-y-2 text-xs mb-6">
                        <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-2 items-start">
                            <span className="text-gray-500">Resource</span>
                            <span className="font-mono text-gray-200 break-all">
                                {row.resource_type}
                                {row.resource_id ? ` · ${row.resource_id}` : ''}
                            </span>
                        </div>
                        <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-2 items-start">
                            <span className="text-gray-500">Actor</span>
                            <span className="text-gray-200 break-all">{row.actor_email || row.actor_user_id || '—'}</span>
                        </div>
                        <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-2 items-start">
                            <span className="text-gray-500">Tenant</span>
                            <span className="font-mono text-gray-200 break-all">{row.tenant_id || '—'}</span>
                        </div>
                        <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-2 items-start">
                            <span className="text-gray-500">Account</span>
                            <span className="font-mono text-gray-200 break-all">{row.account_id || '—'}</span>
                        </div>
                        <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-2 items-start">
                            <span className="text-gray-500">IP</span>
                            <span className="font-mono text-gray-200 break-all">{row.ip_address || '—'}</span>
                        </div>
                    </div>
                    {meta && Object.keys(meta).length > 0 ? block('Metadata', formatAuditJson(meta)) : null}
                    {row.before_state != null || row.after_state != null ? (
                        <>
                            {block('Before state', formatAuditJson(row.before_state ?? null))}
                            {block('After state', formatAuditJson(row.after_state ?? null))}
                        </>
                    ) : null}
                </div>
            </div>
        </div>
    );
}

/** One row for the ingestion monitoring audit table (PRD-aligned columns). */
function buildMonitoringAuditTableRow(r: {
    id: string;
    created_at: string;
    action: string;
    resource_type: string;
    resource_id?: string | null;
    actor_user_id?: string | null;
    actor_email: string | null;
    tenant_id: string | null;
    account_id: string | null;
    ip_address: string | null;
    metadata?: Record<string, unknown>;
    before_state?: Record<string, unknown> | null;
    after_state?: Record<string, unknown> | null;
}): ReactNode[] {
    const meta = r.metadata && typeof r.metadata === 'object' ? (r.metadata as Record<string, unknown>) : {};
    const sellerSnake = typeof meta.seller_tenant_id === 'string' ? meta.seller_tenant_id : null;
    const sellerCamel = typeof meta.sellerTenantId === 'string' ? meta.sellerTenantId : null;
    const agencyCamel = typeof meta.agencyTenantId === 'string' ? meta.agencyTenantId : null;
    const userCamel = typeof meta.userId === 'string' ? meta.userId : null;
    const staffUser = typeof meta.staffUserId === 'string' ? meta.staffUserId : null;
    const acceptedBy = typeof meta.acceptedBy === 'string' ? meta.acceptedBy : null;
    const unassignedBy = typeof meta.unassignedBy === 'string' ? meta.unassignedBy : null;
    const seller = sellerSnake || sellerCamel;
    const agency = agencyCamel;
    const userPart = userCamel || staffUser || acceptedBy || unassignedBy;
    const tenantOrAccount =
        [r.tenant_id, agency, r.account_id, seller, userPart && `user:${userPart}`].filter(Boolean).join(' · ') || '—';

    const actorLabel =
        r.actor_email ||
        (typeof r.actor_user_id === 'string' && r.actor_user_id.length > 0
            ? `${r.actor_user_id.slice(0, 8)}…`
            : null) ||
        '—';
    const actorTitle =
        [r.actor_email, r.actor_user_id].filter((x): x is string => typeof x === 'string' && x.length > 0).join(' · ') ||
        undefined;

    return [
        <span key={`at-${r.id}`} className="text-xs text-gray-400 whitespace-nowrap">{formatTs(r.created_at)}</span>,
        <span key={`aa-${r.id}`} className="text-xs text-cyan-300">{r.action}</span>,
        <span key={`ar-${r.id}`} className="text-xs text-gray-300">{r.resource_type}</span>,
        <span key={`ari-${r.id}`} className="text-xs text-gray-400 font-mono truncate max-w-[120px]" title={r.resource_id || ''}>
            {r.resource_id || '—'}
        </span>,
        <span key={`ae-${r.id}`} className="text-xs text-gray-300" title={actorTitle}>
            {actorLabel}
        </span>,
        <span key={`ax-${r.id}`} className="text-xs text-gray-400 break-all" title={tenantOrAccount}>
            {tenantOrAccount}
        </span>,
        <span key={`as-${r.id}`} className="text-xs text-gray-500">
            {auditSnapshotHint(r)}
        </span>,
        <span key={`ai-${r.id}`} className="text-xs text-gray-500">{r.ip_address || '—'}</span>,
    ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Live log hook — fetch-based SSE with proper Authorization header
// (EventSource doesn't support custom headers, so we use fetch + ReadableStream)
// ─────────────────────────────────────────────────────────────────────────────

function useLiveLogStream(enabled: boolean) {
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [connected, setConnected] = useState(false);
    const [lastError, setLastError] = useState<string | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    const cursorRef = useRef<string>(new Date(Date.now() - 60_000).toISOString());
    const enabledRef = useRef(enabled);
    useEffect(() => { enabledRef.current = enabled; }, [enabled]);

    const connect = useCallback(async () => {
        abortRef.current?.abort();
        const ac = new AbortController();
        abortRef.current = ac;

        setConnected(false);

        const token = await getAccessTokenForApi();
        const url = `${getApiOrigin()}/api/tiktok-shop/sync/monitoring/log-stream?since=${encodeURIComponent(cursorRef.current)}`;

        let response: Response;
        try {
            response = await fetch(url, {
                headers: {
                    Authorization: token ? `Bearer ${token}` : '',
                    Accept: 'text/event-stream',
                },
                signal: ac.signal,
            });
        } catch (e: any) {
            if (ac.signal.aborted) return;
            const msg = `Network error: ${e?.message ?? 'fetch failed'}`;
            console.error('[LiveLog]', msg);
            setLastError(msg);
            if (enabledRef.current) setTimeout(connect, 2000);
            return;
        }

        if (!response.ok || !response.body) {
            const msg = `HTTP ${response.status} ${response.statusText}`;
            console.error('[LiveLog]', msg, url);
            setLastError(msg);
            setConnected(false);
            if (enabledRef.current) setTimeout(connect, 3000);
            return;
        }

        setLastError(null);
        setConnected(true);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (ac.signal.aborted) break;

                buffer += decoder.decode(value, { stream: true });
                const frames = buffer.split('\n\n');
                buffer = frames.pop() ?? '';

                for (const frame of frames) {
                    const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
                    if (!dataLine) continue;

                    const raw = dataLine.slice(5).trim();
                    try {
                        const row = JSON.parse(raw) as LogEntry & {
                            __control?: string;
                            since?: string;
                        };

                        if (row.__control === 'reconnect') {
                            if (row.since) cursorRef.current = row.since;
                            break;
                        }

                        if (row.created_at) {
                            const ts = new Date(row.created_at);
                            if (ts > new Date(cursorRef.current)) {
                                cursorRef.current = row.created_at;
                            }
                        }

                        setLogs((prev) => {
                            const next = [...prev, row as LogEntry];
                            return next.length > MAX_LOG_ENTRIES
                                ? next.slice(next.length - MAX_LOG_ENTRIES)
                                : next;
                        });
                    } catch { /* malformed frame — skip */ }
                }
            }
        } catch (e: any) {
            if (e?.name === 'AbortError') return;
        } finally {
            reader.cancel().catch(() => undefined);
        }

        setConnected(false);
        if (!ac.signal.aborted && enabledRef.current) {
            setTimeout(connect, 1500);
        }
    }, []);

    useEffect(() => {
        if (enabled) {
            connect();
        } else {
            abortRef.current?.abort();
            abortRef.current = null;
            setConnected(false);
            setLastError(null);
        }
        return () => {
            abortRef.current?.abort();
            abortRef.current = null;
        };
    }, [enabled, connect]);

    const clearLogs = useCallback(() => setLogs([]), []);
    return { logs, connected, lastError, clearLogs };
}

// ─────────────────────────────────────────────────────────────────────────────
// Confirmation modal
// ─────────────────────────────────────────────────────────────────────────────

function ConfirmModal({
    open,
    title,
    body,
    confirmLabel,
    onConfirm,
    onCancel,
}: {
    open: boolean;
    title: string;
    body: string;
    confirmLabel: string;
    onConfirm: () => void;
    onCancel: () => void;
}) {
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-gray-900 p-6 shadow-2xl">
                <h3 className="text-lg font-bold text-white mb-2">{title}</h3>
                <p className="text-sm text-gray-400 mb-6">{body}</p>
                <div className="flex gap-3 justify-end">
                    <button
                        onClick={onCancel}
                        className="px-4 py-2 rounded-lg text-sm font-semibold text-gray-300 border border-white/15 bg-white/5 hover:bg-white/10 transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onConfirm}
                        className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-500 transition-colors"
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Countdown hook
// ─────────────────────────────────────────────────────────────────────────────

function useCountdown(periodMs: number, resetTrigger: number): number {
    const [remaining, setRemaining] = useState(periodMs);
    const start = useRef(Date.now());

    useEffect(() => {
        start.current = Date.now();
        setRemaining(periodMs);
        const id = setInterval(() => {
            const elapsed = Date.now() - start.current;
            const left = Math.max(0, periodMs - elapsed);
            setRemaining(left);
        }, 500);
        return () => clearInterval(id);
    }, [periodMs, resetTrigger]);

    return remaining;
}

// ─────────────────────────────────────────────────────────────────────────────
// Live Log Terminal
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Main view
// ─────────────────────────────────────────────────────────────────────────────

export function IngestionMonitoringView() {
    const queryClient = useQueryClient();
    const [showWorkerConfirm, setShowWorkerConfirm] = useState(false);
    const [liveEnabled, setLiveEnabled] = useState(false);

    const { data, isLoading, isFetching, error, dataUpdatedAt } = useQuery({
        queryKey: ['ingestion-monitoring-status'],
        queryFn: fetchMonitoringStatus,
        refetchInterval: REFETCH_INTERVAL_MS,
        retry: 2,
    });

    // Countdown to next auto-refresh
    const nextRefreshCountdown = useCountdown(REFETCH_INTERVAL_MS, dataUpdatedAt);
    const countdownSec = Math.ceil(nextRefreshCountdown / 1000);

    const handleManualRefresh = useCallback(() => {
        queryClient.invalidateQueries({ queryKey: ['ingestion-monitoring-status'] });
    }, [queryClient]);

    const runWorker = useMutation({
        mutationFn: triggerWorkerRun,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['ingestion-monitoring-status'] });
        },
    });

    const { logs, connected, lastError, clearLogs } = useLiveLogStream(liveEnabled);
    const [monitorView, setMonitorView] = useState<'overview' | 'logs'>('overview');
    const [logLevelFilter, setLogLevelFilter] = useState<'all' | LogLevel>('all');
    const [logQuery, setLogQuery] = useState('');
    const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
    const [logsClearedAt, setLogsClearedAt] = useState<string | null>(null);
    const [auditCategoryTab, setAuditCategoryTab] = useState<MonitoringAuditTabId>('all');
    const [selectedAuditLogId, setSelectedAuditLogId] = useState<string | null>(null);

    const snapshotLogs = data?.observability?.systemLogs24h.rows || [];
    const rawExplorerLogs = logs.length > 0 ? logs : snapshotLogs;
    const explorerLogs = useMemo(() => {
        if (!logsClearedAt) return rawExplorerLogs;
        const threshold = new Date(logsClearedAt).getTime();
        return rawExplorerLogs.filter((row) => new Date(row.created_at).getTime() > threshold);
    }, [rawExplorerLogs, logsClearedAt]);
    const filteredExplorerLogs = useMemo(() => {
        const q = logQuery.trim().toLowerCase();
        return explorerLogs.filter((row) => {
            if (logLevelFilter !== 'all' && row.level !== logLevelFilter) return false;
            if (!q) return true;
            const hay = [
                row.event,
                row.scope,
                row.message || '',
                row.stream || '',
                row.job_id || '',
                row.account_id || '',
                JSON.stringify(row.data || {}),
            ].join(' ').toLowerCase();
            return hay.includes(q);
        });
    }, [explorerLogs, logLevelFilter, logQuery]);

    const selectedLog = useMemo(
        () => filteredExplorerLogs.find((l) => l.id === selectedLogId) || filteredExplorerLogs[0] || null,
        [filteredExplorerLogs, selectedLogId],
    );

    const deadLetterRows = useMemo(
        () => (data?.jobs.rows || []).filter((j) => j.status === 'dead_letter'),
        [data?.jobs.rows],
    );

    const auditRowsAll = data?.observability?.audit.billingAndPermissionRows ?? [];
    const auditTabCounts = useMemo(() => {
        const counts: Partial<Record<MonitoringAuditTabId, number>> = { all: auditRowsAll.length };
        for (const tab of MONITORING_AUDIT_TABS) {
            if (tab.id !== 'all') counts[tab.id] = 0;
        }
        for (const r of auditRowsAll) {
            const cat = (r.prd_category as MonitoringAuditPrdCategory | undefined) || 'other';
            counts[cat] = (counts[cat] || 0) + 1;
        }
        return counts as Record<MonitoringAuditTabId, number>;
    }, [auditRowsAll]);

    const filteredAuditRows = useMemo(() => {
        if (auditCategoryTab === 'all') return auditRowsAll;
        return auditRowsAll.filter(
            (r) => ((r.prd_category as MonitoringAuditPrdCategory | undefined) || 'other') === auditCategoryTab,
        );
    }, [auditRowsAll, auditCategoryTab]);

    const auditTableRows = useMemo(() => filteredAuditRows.slice(0, 80), [filteredAuditRows]);

    const selectedAuditRow = useMemo((): MonitoringAuditLogRow | null => {
        if (!selectedAuditLogId) return null;
        return auditRowsAll.find((r) => r.id === selectedAuditLogId) ?? null;
    }, [auditRowsAll, selectedAuditLogId]);

    useEffect(() => {
        if (selectedAuditLogId && !selectedAuditRow) {
            setSelectedAuditLogId(null);
        }
    }, [selectedAuditLogId, selectedAuditRow]);

    useEffect(() => {
        setSelectedAuditLogId(null);
    }, [auditCategoryTab]);

    useEffect(() => {
        if (!selectedAuditLogId) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setSelectedAuditLogId(null);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [selectedAuditLogId]);

    const systemHealthy =
        !error &&
        !isLoading &&
        data &&
        data.jobs.deadLetter === 0 &&
        data.tokenHealth.warnings === 0;

    return (
        <>
            <ConfirmModal
                open={showWorkerConfirm}
                title="Run Worker Now?"
                body="This will claim up to 5 queued jobs and process them immediately. Only do this if you understand the current queue state."
                confirmLabel="Run Worker"
                onConfirm={() => {
                    setShowWorkerConfirm(false);
                    runWorker.mutate();
                }}
                onCancel={() => setShowWorkerConfirm(false)}
            />

            <div className="space-y-6">
                {/* ── Header ── */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                        <h1 className="text-3xl font-extrabold text-white flex items-center gap-3">
                            <div className="p-2 rounded-xl border border-mamba-green/30 bg-mamba-green/10">
                                <Activity className="w-6 h-6 text-mamba-neon" />
                            </div>
                            Ingestion Monitoring
                        </h1>
                        <p className="text-sm text-gray-400 mt-2">
                            Real-time queue health, stale sync detection, and token reauth risk.
                        </p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                        {/* Next-refresh countdown badge */}
                        <span className="text-xs text-gray-500 flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/[0.03]">
                            <Timer className="w-3.5 h-3.5" />
                            Refreshes in {countdownSec}s
                        </span>

                        <button
                            type="button"
                            onClick={handleManualRefresh}
                            className="px-3 py-2 rounded-lg border border-white/15 bg-white/5 text-gray-200 hover:bg-white/10 text-sm font-semibold flex items-center gap-2 transition-colors"
                        >
                            <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
                            Refresh
                        </button>
                        <button
                            type="button"
                            onClick={() => setShowWorkerConfirm(true)}
                            disabled={runWorker.isPending}
                            className="px-3 py-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 text-sm font-semibold flex items-center gap-2 disabled:opacity-60 transition-colors"
                        >
                            {runWorker.isPending ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                                <Play className="w-4 h-4" />
                            )}
                            Run Worker
                        </button>
                    </div>
                </div>

                <div className="inline-flex rounded-xl border border-white/10 bg-white/[0.02] p-1 w-fit">
                    <button
                        type="button"
                        onClick={() => setMonitorView('overview')}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${monitorView === 'overview' ? 'bg-mamba-green/20 text-mamba-text border border-mamba-green/30' : 'text-gray-400 hover:text-gray-200'}`}
                    >
                        Overview
                    </button>
                    <button
                        type="button"
                        onClick={() => setMonitorView('logs')}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 ${monitorView === 'logs' ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-500/30' : 'text-gray-400 hover:text-gray-200'}`}
                    >
                        <ListFilter className="w-3.5 h-3.5" />
                        Logs Explorer
                    </button>
                </div>

                {/* ── Error banner ── */}
                {error && (
                    <div className="px-4 py-3 rounded-xl border border-red-500/40 bg-red-500/10 text-red-300 text-sm flex items-center gap-2">
                        <WifiOff className="w-4 h-4 shrink-0" />
                        {(error as Error).message}
                    </div>
                )}

                {/* ── Worker success banner ── */}
                {runWorker.isSuccess && (
                    <div className="px-4 py-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-sm flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        Worker run complete — claimed {runWorker.data?.claimed ?? 0} job(s).
                    </div>
                )}

                {/* ── Overall health badge ── */}
                {!isLoading && !error && data && (
                    <div
                        className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-semibold w-fit ${
                            systemHealthy
                                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                                : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                        }`}
                    >
                        {systemHealthy ? (
                            <>
                                <Wifi className="w-4 h-4" />
                                All systems healthy
                            </>
                        ) : (
                            <>
                                <AlertTriangle className="w-4 h-4" />
                                Attention required
                            </>
                        )}
                    </div>
                )}

                {monitorView === 'overview' && (
                <>
                {/* ── Metric cards ── */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <MetricCard
                        label="Active Jobs"
                        value={data?.jobs.queuedOrRunning ?? 0}
                        icon={<Timer className="w-5 h-5 text-cyan-300" />}
                        tone="cyan"
                        loading={isLoading}
                        alertWhen={0}
                        alertTone="cyan"
                    />
                    <MetricCard
                        label="Dead-letter Jobs"
                        value={data?.jobs.deadLetter ?? 0}
                        icon={<AlertTriangle className="w-5 h-5 text-amber-300" />}
                        tone="amber"
                        loading={isLoading}
                        alertWhen={1}
                        alertTone="amber"
                    />
                    <MetricCard
                        label="Token Warnings"
                        value={data?.tokenHealth.warnings ?? 0}
                        icon={<ShieldAlert className="w-5 h-5 text-rose-300" />}
                        tone="rose"
                        loading={isLoading}
                        alertWhen={1}
                        alertTone="rose"
                    />
                </div>

                <Panel title="Queue Insights (24h)" subtitle="What is creating jobs and how the queue is behaving">
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 mb-4">
                        <MiniStat label="Queued now" value={String(data?.jobs.queued ?? 0)} tone="cyan" />
                        <MiniStat label="Running now" value={String(data?.jobs.running ?? 0)} tone="cyan" />
                        <MiniStat label="Enqueued 24h" value={String(data?.jobs.insights24h?.enqueuedTotal ?? 0)} />
                        <MiniStat label="Completed" value={String(data?.jobs.insights24h?.completed ?? 0)} tone="cyan" />
                        <MiniStat label="Retried" value={String(data?.jobs.insights24h?.retried ?? 0)} tone="amber" />
                        <MiniStat label="Failed" value={String(data?.jobs.insights24h?.failed ?? 0)} tone="amber" />
                        <MiniStat label="Dead-letter" value={String(data?.jobs.insights24h?.deadLetter ?? 0)} tone="rose" />
                        <MiniStat label="Oldest queued" value={formatDurationMs(data?.jobs.insights24h?.oldestQueuedMs)} tone="amber" />
                    </div>
                    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                        <SimpleTable
                            headers={['Source', 'Jobs']}
                            rows={Object.entries(data?.jobs.insights24h?.bySource || {})
                                .sort((a, b) => b[1] - a[1])
                                .map(([k, v]) => [
                                    <span key={`src-${k}`} className="text-xs text-gray-300">{k}</span>,
                                    <span key={`srcv-${k}`} className="text-xs text-cyan-300">{v}</span>,
                                ])}
                            emptyText="No source data."
                            loading={isLoading}
                        />
                        <SimpleTable
                            headers={['Sync Type', 'Jobs']}
                            rows={Object.entries(data?.jobs.insights24h?.bySyncType || {})
                                .sort((a, b) => b[1] - a[1])
                                .map(([k, v]) => [
                                    <span key={`st-${k}`} className="text-xs text-gray-300">{k}</span>,
                                    <span key={`stv-${k}`} className="text-xs text-cyan-300">{v}</span>,
                                ])}
                            emptyText="No sync-type data."
                            loading={isLoading}
                        />
                        <SimpleTable
                            headers={['Stream', 'Jobs']}
                            rows={Object.entries(data?.jobs.insights24h?.byStream || {})
                                .sort((a, b) => b[1] - a[1])
                                .map(([k, v]) => [
                                    <span key={`ss-${k}`} className="text-xs text-gray-300">{k}</span>,
                                    <span key={`ssv-${k}`} className="text-xs text-cyan-300">{v}</span>,
                                ])}
                            emptyText="No stream data."
                            loading={isLoading}
                        />
                    </div>
                </Panel>

                {/* ── Recent activity ── */}
                <Panel title="Recent Activity" subtitle="Latest ingestion attempts (newest first); summary shows counts / incremental flags from attempt result">
                    <SimpleTable
                        headers={['Job', 'Shop / Advertiser', 'Stream', 'Type', 'Source', 'Status', 'Summary', 'Started', 'Age', 'Error']}
                        rows={(data?.recentActivity || []).map((r) => {
                            const res = r.result && typeof r.result === 'object' ? (r.result as Record<string, unknown>) : null;
                            const summary = formatIngestionAttemptSummary(r.status, res);
                            return [
                            <span key="job" className="font-mono text-xs text-gray-400">{r.job_id.slice(0, 8)}…</span>,
                            <div key="shop" className="text-xs">
                                <p className="text-white font-medium leading-tight">
                                    {r.stream === 'ads'
                                        ? (r.advertiser_name || r.advertiser_id || '—')
                                        : (r.shop_name || '—')}
                                </p>
                                <p className="text-gray-500 leading-tight">
                                    {r.stream === 'ads' ? (r.advertiser_id || '') : (r.shop_id || '')}
                                </p>
                                {r.account_id ? (
                                    <p className="text-[10px] text-gray-600 font-mono leading-tight mt-0.5" title={r.account_id}>
                                        acct {r.account_id.slice(0, 8)}…
                                    </p>
                                ) : null}
                            </div>,
                            <StreamBadge key="stream" stream={r.stream} />,
                            <span key="type" className="text-xs text-gray-300">{r.sync_type}</span>,
                            <span key="source" className="text-xs text-cyan-300">{r.source || 'unknown'}</span>,
                            <StatusBadge key="status" status={r.status} />,
                            <span
                                key="sum"
                                className="text-xs text-gray-400 max-w-[220px] truncate"
                                title={summary}
                            >
                                {summary}
                            </span>,
                            <span key="started" className="text-xs text-gray-400 whitespace-nowrap">{formatTs(r.started_at)}</span>,
                            <span key="age" className="text-xs text-gray-500 whitespace-nowrap">{formatAge(r.finished_at || r.started_at)}</span>,
                            <ErrorCell key="error" error={r.error} />,
                            ];
                        })}
                        emptyText="No ingestion attempts yet."
                        loading={isLoading}
                    />
                </Panel>

                {/* ── Dead-letter + Stale shops ── */}
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                    <Panel title="Dead-letter Queue" subtitle="Jobs that reached max retry attempts">
                        {!isLoading && deadLetterRows.length === 0 ? (
                            <EmptyState
                                icon={<CheckCircle2 className="w-8 h-8 text-emerald-400" />}
                                title="Dead-letter queue is empty"
                                subtitle="All jobs completed or retrying normally."
                            />
                        ) : (
                            <SimpleTable
                                headers={['Job ID', 'Stream', 'Updated', 'Error']}
                                rows={deadLetterRows.map((r) => [
                                    <span key="id" className="font-mono text-xs text-gray-400">{r.id.slice(0, 8)}…</span>,
                                    <StreamBadge key="stream" stream={r.stream} />,
                                    <span key="ts" className="text-xs text-gray-400 whitespace-nowrap">{formatTs(r.updated_at)}</span>,
                                    <ErrorCell key="error" error={r.last_error} />,
                                ])}
                                emptyText=""
                                loading={isLoading}
                            />
                        )}
                    </Panel>

                    <Panel title="Stale / Unsynced Shops" subtitle="Shops with no sync in 2+ hours">
                        <SimpleTable
                            headers={['Shop', 'Orders synced', 'Products synced', 'Settlements synced']}
                            rows={(data?.staleness.rows || []).map((r) => [
                                <div key="shop" className="text-sm">
                                    <p className="text-white font-semibold leading-tight">{r.shop_name || r.shop_id}</p>
                                    <p className="text-xs text-gray-500 leading-tight">{r.shop_id}</p>
                                </div>,
                                <SyncAgeCell key="orders" ts={r.orders_last_synced_at} />,
                                <SyncAgeCell key="products" ts={r.products_last_synced_at} />,
                                <SyncAgeCell key="settlements" ts={r.settlements_last_synced_at} />,
                            ])}
                            emptyText="No stale shops — all synced recently."
                            loading={isLoading}
                        />
                    </Panel>
                </div>

                {/* ── Token risk ── */}
                <Panel title="Token Risk Queue" subtitle="Shops requiring attention for reauthorization">
                    <SimpleTable
                        headers={['Shop', 'Status', 'Level', 'Last Checked', 'Last Error']}
                        rows={(data?.tokenHealth.rows || []).map((r) => [
                            <div key="shop" className="text-sm">
                                <p className="text-white font-semibold leading-tight">{r.shop_name || r.shop_id}</p>
                                <p className="text-xs text-gray-500 leading-tight">{r.shop_id}</p>
                            </div>,
                            <span key="status" className="text-xs uppercase font-semibold text-amber-300">{r.token_status}</span>,
                            <span key="level" className={`text-xs uppercase font-semibold ${r.token_warning_level === 'critical' ? 'text-rose-400' : 'text-amber-300'}`}>
                                {r.token_warning_level || '—'}
                            </span>,
                            <span key="checked" className="text-xs text-gray-400 whitespace-nowrap">{formatTs(r.token_last_checked_at)}</span>,
                            <ErrorCell key="error" error={r.last_token_error} />,
                        ])}
                        emptyText="No token warnings."
                        loading={isLoading}
                    />
                </Panel>


                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                    <Panel title="API Performance (24h)" subtitle="In-house HTTP latency and status telemetry">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                            <MiniStat label="Requests" value={String(data?.observability?.performance.requests24h ?? 0)} />
                            <MiniStat label="4xx" value={String(data?.observability?.performance.warn4xx24h ?? 0)} tone="amber" />
                            <MiniStat label="5xx" value={String(data?.observability?.performance.error5xx24h ?? 0)} tone="rose" />
                            <MiniStat label="P95" value={`${data?.observability?.performance.p95Ms ?? '—'}ms`} tone="cyan" />
                        </div>
                        <SimpleTable
                            headers={['Time', 'Method', 'Path', 'Status', 'Duration']}
                            rows={(data?.observability?.performance.recent || []).slice(0, 30).map((r, idx) => [
                                <span key={`t-${idx}`} className="text-xs text-gray-400 whitespace-nowrap">{formatTs(r.created_at)}</span>,
                                <span key={`m-${idx}`} className="text-xs text-cyan-300">{String(r.data?.method || '—')}</span>,
                                <span key={`p-${idx}`} className="text-xs text-gray-300 max-w-[260px] truncate" title={String(r.data?.path || '')}>{String(r.data?.path || '—')}</span>,
                                <span key={`s-${idx}`} className={`text-xs font-semibold ${(Number(r.data?.status) >= 500) ? 'text-rose-300' : (Number(r.data?.status) >= 400) ? 'text-amber-300' : 'text-emerald-300'}`}>{String(r.data?.status ?? '—')}</span>,
                                <span key={`d-${idx}`} className="text-xs text-gray-300">{String(r.data?.durationMs ?? '—')}ms</span>,
                            ])}
                            emptyText="No HTTP telemetry yet."
                            loading={isLoading}
                        />
                    </Panel>

                    <Panel title="Error Tracking" subtitle="Every logged application error (in-house)">
                        <SimpleTable
                            headers={['Time', 'Scope', 'Event', 'Message']}
                            rows={(data?.observability?.systemLogs24h.errorsRows || []).slice(0, 60).map((r) => [
                                <span key={`et-${r.id}`} className="text-xs text-gray-400 whitespace-nowrap">{formatTs(r.created_at)}</span>,
                                <span key={`es-${r.id}`} className="text-xs uppercase text-rose-300">{r.scope}</span>,
                                <span key={`ee-${r.id}`} className="text-xs text-gray-300">{r.event}</span>,
                                <ErrorCell key={`em-${r.id}`} error={r.message || (typeof r.data?.error === 'string' ? r.data.error : null)} />,
                            ])}
                            emptyText="No errors in the last 24h."
                            loading={isLoading}
                        />
                    </Panel>
                </div>

                <Panel
                    title="Immutable audit trail"
                    subtitle="Click a row for full metadata and before/after JSON. Grouped by product area (TikTok ingestion, RBAC, financial visibility, tenancy, branding, P&L, tasks, exports)."
                >
                    <div className="flex flex-wrap gap-2 mb-3">
                        {MONITORING_AUDIT_TABS.map((tab) => {
                            const count = auditTabCounts[tab.id] ?? 0;
                            const active = auditCategoryTab === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    type="button"
                                    onClick={() => setAuditCategoryTab(tab.id)}
                                    title={tab.shortHint}
                                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                                        active
                                            ? 'border-cyan-400/50 bg-cyan-500/15 text-cyan-100'
                                            : 'border-white/10 bg-white/[0.03] text-gray-400 hover:border-white/20 hover:text-gray-200'
                                    }`}
                                >
                                    <span>{tab.label}</span>
                                    <span className={`tabular-nums ${active ? 'text-cyan-200/90' : 'text-gray-500'}`}>
                                        {count}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                    <p className="text-xs text-gray-500 mb-4 leading-relaxed">
                        {MONITORING_AUDIT_TABS.find((t) => t.id === auditCategoryTab)?.shortHint}
                    </p>
                    <SimpleTable
                        headers={['Time', 'Action', 'Resource', 'Resource ID', 'Actor', 'Tenant / targets', 'Snapshot', 'IP']}
                        rows={auditTableRows.map((r) => buildMonitoringAuditTableRow(r))}
                        rowIds={auditTableRows.map((r) => r.id)}
                        selectedRowId={selectedAuditLogId}
                        onRowClick={(id) => setSelectedAuditLogId((prev) => (prev === id ? null : id))}
                        emptyText={
                            auditCategoryTab === 'all'
                                ? 'No matching audit records yet.'
                                : `No rows in “${MONITORING_AUDIT_TABS.find((t) => t.id === auditCategoryTab)?.label ?? auditCategoryTab}” for this window.`
                        }
                        loading={isLoading}
                    />
                </Panel>
                </>
                )}

                {monitorView === 'logs' && (
                    <div className="grid grid-cols-1 xl:grid-cols-[340px_minmax(0,1fr)] gap-4">
                        <Panel title="Log Filters" subtitle="Search and scope logs like your Vercel view">
                            <div className="space-y-3">
                                <div>
                                    <label className="block text-xs text-gray-400 mb-1">Search</label>
                                    <input
                                        value={logQuery}
                                        onChange={(e) => setLogQuery(e.target.value)}
                                        placeholder="event, path, request id, message..."
                                        className="w-full rounded-lg bg-gray-900 border border-white/10 px-3 py-2 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:border-cyan-500/40"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs text-gray-400 mb-1">Level</label>
                                    <div className="grid grid-cols-4 gap-2">
                                        {(['all','info','warn','error'] as const).map((lvl) => (
                                            <button
                                                key={lvl}
                                                onClick={() => setLogLevelFilter(lvl as any)}
                                                className={`px-2 py-1.5 rounded-md text-xs border ${logLevelFilter === lvl ? 'border-cyan-400/40 bg-cyan-500/10 text-cyan-200' : 'border-white/10 text-gray-400 hover:text-gray-200'}`}
                                            >
                                                {lvl.toUpperCase()}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div className="text-xs text-gray-500">
                                    Showing {filteredExplorerLogs.length} of {explorerLogs.length} logs.
                                </div>
                            </div>
                        </Panel>

                        <div className="rounded-2xl border border-white/10 overflow-hidden bg-[#0b0c11]">
                            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px]">
                                <div className="border-r border-white/10">
                                    <div className="px-3 py-2 border-b border-white/10 text-xs text-gray-400 flex items-center justify-between gap-2">
                                        <span>Logs</span>
                                        <div className="flex items-center gap-2">
                                            {liveEnabled && (
                                                <span className="text-[11px] text-gray-500">
                                                    {connected ? 'Connected' : (lastError || 'Reconnecting…')}
                                                </span>
                                            )}
                                            {filteredExplorerLogs.length > 0 && (
                                                <button
                                                    onClick={() => {
                                                        clearLogs();
                                                        setLogsClearedAt(new Date().toISOString());
                                                        setSelectedLogId(null);
                                                    }}
                                                    className="px-2 py-1 rounded-md border border-white/10 text-gray-400 hover:text-gray-200 hover:bg-white/5"
                                                >
                                                    Clear
                                                </button>
                                            )}
                                            <button
                                                onClick={() => setLiveEnabled((v) => !v)}
                                                className={`px-2 py-1 rounded-md border text-[11px] font-semibold ${liveEnabled ? 'border-rose-500/40 text-rose-300 bg-rose-500/10' : 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10'}`}
                                            >
                                                {liveEnabled ? 'Stop' : 'Live'}
                                            </button>
                                        </div>
                                    </div>
                                    <div className="max-h-[620px] overflow-y-auto" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                                        {filteredExplorerLogs.map((entry) => (
                                            <button
                                                key={entry.id}
                                                onClick={() => setSelectedLogId(entry.id)}
                                                className={`w-full text-left px-3 py-2 border-b border-white/5 hover:bg-white/[0.03] ${selectedLog?.id === entry.id ? 'bg-cyan-500/10' : ''}`}
                                            >
                                                <div className="flex items-center gap-2 text-[11px]">
                                                    <span className="text-gray-500">{formatLogTime(entry.created_at)}</span>
                                                    <span className={`uppercase font-bold ${entry.level === 'error' ? 'text-rose-400' : entry.level === 'warn' ? 'text-amber-300' : 'text-cyan-300'}`}>{entry.level}</span>
                                                    <span className="text-gray-300 truncate">{entry.event}</span>
                                                </div>
                                                <div className="text-[11px] text-gray-500 truncate mt-1">
                                                    {entry.message || (typeof entry.data?.path === 'string' ? entry.data.path : '—')}
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div className="p-3">
                                    <div className="text-xs text-gray-400 mb-2 flex items-center gap-1.5"><PanelRightOpen className="w-3.5 h-3.5" /> Details</div>
                                    {selectedLog ? (
                                        <div className="space-y-2 text-xs">
                                            <KV label="Time" value={formatTs(selectedLog.created_at)} />
                                            <KV label="Level" value={selectedLog.level} />
                                            <KV label="Scope" value={selectedLog.scope} />
                                            <KV label="Event" value={selectedLog.event} />
                                            <KV label="Stream" value={selectedLog.stream || '—'} />
                                            <KV label="Job ID" value={selectedLog.job_id || '—'} mono />
                                            <KV label="Account ID" value={selectedLog.account_id || '—'} mono />
                                            <KV label="Message" value={selectedLog.message || '—'} />
                                            <div className="pt-2">
                                                <p className="text-gray-400 mb-1">Payload</p>
                                                <pre className="max-h-[320px] overflow-auto rounded-lg bg-black/40 border border-white/10 p-2 text-[11px] text-gray-300">
{JSON.stringify(selectedLog.data || {}, null, 2)}
                                                </pre>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="text-xs text-gray-500">No log selected.</div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* ── Footer timestamp ── */}
                <p className="text-xs text-gray-500 flex items-center gap-2">
                    <Clock3 className="w-3.5 h-3.5" />
                    Snapshot as of: {data ? formatTs(data.asOf) : '—'}
                </p>
            </div>
            <AuditLogDetailDrawer row={selectedAuditRow} onClose={() => setSelectedAuditLogId(null)} />
        </>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function MetricCard({
    label,
    value,
    icon,
    tone,
    loading,
    alertWhen,
    alertTone,
}: {
    label: string;
    value: number;
    icon: ReactNode;
    tone: 'cyan' | 'amber' | 'rose';
    loading?: boolean;
    alertWhen?: number;
    alertTone?: 'cyan' | 'amber' | 'rose';
}) {
    const baseGradient =
        tone === 'cyan'
            ? 'from-cyan-500/20 border-cyan-500/20'
            : tone === 'amber'
              ? 'from-amber-500/20 border-amber-500/20'
              : 'from-rose-500/20 border-rose-500/20';

    const isAlert = alertWhen !== undefined && value >= alertWhen && value > 0;
    const alertBorder =
        alertTone === 'cyan'
            ? 'border-cyan-400/60 shadow-cyan-500/20 shadow-lg animate-pulse'
            : alertTone === 'amber'
              ? 'border-amber-400/60 shadow-amber-500/20 shadow-lg animate-pulse'
              : 'border-rose-400/60 shadow-rose-500/20 shadow-lg animate-pulse';

    return (
        <div className={`rounded-2xl border bg-gradient-to-br ${baseGradient} to-transparent p-4 transition-all duration-300 ${isAlert ? alertBorder : ''}`}>
            <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-wider text-gray-400 font-semibold">{label}</p>
                {icon}
            </div>
            <p className="mt-3 text-3xl font-extrabold text-white">
                {loading ? <span className="text-gray-600 animate-pulse">…</span> : value.toLocaleString()}
            </p>
        </div>
    );
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
    return (
        <div className="rounded-2xl border border-white/10 bg-white/[0.02]">
            <div className="px-4 py-3 border-b border-white/10">
                <h2 className="text-sm font-bold text-white">{title}</h2>
                {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
            </div>
            <div className="p-3">{children}</div>
        </div>
    );
}

function EmptyState({ icon, title, subtitle }: { icon: ReactNode; title: string; subtitle?: string }) {
    return (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
            <div className="mb-1">{icon}</div>
            <p className="text-sm font-semibold text-white">{title}</p>
            {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
        </div>
    );
}

function StreamBadge({ stream }: { stream: Stream }) {
    const cls =
        stream === 'shop'
            ? 'bg-mamba-green/15 text-mamba-neon border-mamba-green/20'
            : 'bg-cyan-500/15 text-cyan-300 border-cyan-500/20';
    return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${cls}`}>
            {stream}
        </span>
    );
}

function StatusBadge({ status }: { status: string }) {
    const cls =
        status === 'succeeded'
            ? 'text-emerald-300'
            : status === 'failed' || status === 'dead_letter'
              ? 'text-rose-300'
              : 'text-cyan-300';
    return <span className={`text-xs uppercase font-bold ${cls}`}>{status}</span>;
}

function ErrorCell({ error }: { error: string | null | undefined }) {
    if (!error) return <span className="text-xs text-gray-600">—</span>;
    const short = error.length > 50 ? error.slice(0, 50) + '…' : error;
    return (
        <span className="text-xs text-rose-300 cursor-help" title={error}>
            {short}
        </span>
    );
}

function SyncAgeCell({ ts }: { ts: string | null }) {
    if (!ts) {
        return <span className="text-xs text-amber-400 font-medium">Never</span>;
    }
    const age = Date.now() - new Date(ts).getTime();
    const tooOld = age > 2 * 60 * 60 * 1000;
    return (
        <span className={`text-xs ${tooOld ? 'text-amber-400 font-medium' : 'text-gray-300'}`} title={new Date(ts).toLocaleString()}>
            {formatAge(ts)}
        </span>
    );
}

function KV({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
    return (
        <div className="grid grid-cols-[86px_minmax(0,1fr)] gap-2 items-start">
            <span className="text-gray-500">{label}</span>
            <span className={`${mono ? 'font-mono' : ''} text-gray-200 break-all`}>{value}</span>
        </div>
    );
}

function MiniStat({ label, value, tone = 'gray' }: { label: string; value: string; tone?: 'gray' | 'cyan' | 'amber' | 'rose' }) {
    const cls = tone === 'cyan' ? 'text-cyan-300 border-cyan-500/20 bg-cyan-500/10'
        : tone === 'amber' ? 'text-amber-300 border-amber-500/20 bg-amber-500/10'
        : tone === 'rose' ? 'text-rose-300 border-rose-500/20 bg-rose-500/10'
        : 'text-gray-200 border-white/10 bg-white/[0.03]';
    return (
        <div className={`rounded-lg border px-3 py-2 ${cls}`}>
            <p className="text-[10px] uppercase tracking-wider opacity-80">{label}</p>
            <p className="text-sm font-bold mt-1">{value}</p>
        </div>
    );
}

function SimpleTable({
    headers,
    rows,
    emptyText,
    loading,
    rowIds,
    selectedRowId,
    onRowClick,
}: {
    headers: string[];
    rows: ReactNode[][];
    emptyText: string;
    loading?: boolean;
    /** When set (same length as `rows`), each row is clickable for drill-down UIs */
    rowIds?: string[];
    selectedRowId?: string | null;
    onRowClick?: (rowId: string) => void;
}) {
    const rowClickable = typeof onRowClick === 'function' && Array.isArray(rowIds) && rowIds.length === rows.length;

    return (
        <div className="overflow-x-auto">
            <table className="w-full text-left">
                <thead>
                    <tr className="border-b border-white/10">
                        {headers.map((h) => (
                            <th key={h} className="px-3 py-2 text-[10px] uppercase tracking-wider text-gray-500 font-bold whitespace-nowrap">
                                {h}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                    {loading ? (
                        <tr>
                            <td colSpan={headers.length} className="px-3 py-8 text-center">
                                <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
                                    <Database className="w-4 h-4 animate-pulse" />
                                    Loading…
                                </div>
                            </td>
                        </tr>
                    ) : rows.length === 0 ? (
                        <tr>
                            <td colSpan={headers.length} className="px-3 py-8 text-center text-sm text-gray-500">
                                {emptyText}
                            </td>
                        </tr>
                    ) : (
                        rows.map((row, i) => {
                            const rid = rowIds?.[i];
                            return (
                                <tr
                                    key={rid ?? i}
                                    className={`transition-colors ${
                                        rowClickable
                                            ? `cursor-pointer select-none ${
                                                  rid && selectedRowId && rid === selectedRowId
                                                      ? 'bg-cyan-500/15'
                                                      : 'hover:bg-white/[0.06]'
                                              }`
                                            : 'hover:bg-white/[0.03]'
                                    }`}
                                    onClick={rowClickable && rid ? () => onRowClick!(rid) : undefined}
                                    onKeyDown={
                                        rowClickable && rid
                                            ? (e) => {
                                                if (e.key === 'Enter' || e.key === ' ') {
                                                    e.preventDefault();
                                                    onRowClick!(rid);
                                                }
                                            }
                                            : undefined
                                    }
                                    tabIndex={rowClickable && rid ? 0 : undefined}
                                    role={rowClickable && rid ? 'button' : undefined}
                                >
                                    {row.map((cell, c) => (
                                        <td key={c} className="px-3 py-2 align-middle">
                                            {cell}
                                        </td>
                                    ))}
                                </tr>
                            );
                        })
                    )}
                </tbody>
            </table>
        </div>
    );
}
