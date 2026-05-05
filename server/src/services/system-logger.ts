import { supabase } from '../config/supabase.js';

export type SystemLogLevel = 'info' | 'warn' | 'error';

export type SystemLogInput = {
    level: SystemLogLevel;
    scope: string;
    event: string;
    message?: string | null;
    stream?: 'shop' | 'ads' | null;
    jobId?: string | null;
    accountId?: string | null;
    shopId?: string | null;
    data?: Record<string, unknown>;
};

/**
 * Readable terminal lines for local work. JSON when NODE_ENV=production or LOG_FORMAT=json.
 * (tsx watch often leaves NODE_ENV unset — we still pretty-print unless production.)
 */
function usePrettyConsole(): boolean {
    if (process.env.LOG_FORMAT === 'json') return false;
    if (process.env.LOG_PRETTY === '1') return true;
    if (process.env.NODE_ENV === 'production') return false;
    return true;
}

function formatPrettyLine(payload: Record<string, unknown>): string {
    const ts = typeof payload.ts === 'string' ? payload.ts : new Date().toISOString();
    const time = ts.slice(11, 23); // HH:MM:SS.mmm
    const level = String(payload.level ?? 'info').toUpperCase();
    const scope = String(payload.scope ?? '');
    const event = String(payload.event ?? '');
    const msg = payload.message != null && payload.message !== '' ? String(payload.message) : '';

    if (event === 'request.completed') {
        const summary =
            msg ||
            `${String(payload.method ?? '?')} ${String(payload.path ?? '?')} -> ${String(payload.status ?? '?')}`;
        const ms = typeof payload.durationMs === 'number' ? ` ${payload.durationMs}ms` : '';
        const rid = typeof payload.requestId === 'string' ? payload.requestId : '';
        const reqShort = rid.length > 12 ? `${rid.slice(0, 8)}…` : rid;
        const reqPart = reqShort ? `  req=${reqShort}` : '';
        return `[${time}] ${level.padEnd(5)} ${summary}${ms}${reqPart}`;
    }

    if (scope === 'frontend' && (event.includes('error') || payload.level === 'error')) {
        const route = payload.route != null ? String(payload.route) : '';
        const user = payload.userId != null ? String(payload.userId).slice(0, 8) : '';
        const bits = [msg || event];
        if (route) bits.push(`route=${route}`);
        if (user) bits.push(`user=${user}…`);
        return `[${time}] ${level.padEnd(5)} [${scope}] ${bits.join('  ·  ')}`;
    }

    const head = `[${time}] ${level.padEnd(5)} [${scope}] ${event}`;
    return msg ? `${head} — ${msg}` : head;
}

function writeConsole(level: SystemLogLevel, payload: Record<string, unknown>) {
    const line = usePrettyConsole() ? formatPrettyLine(payload) : JSON.stringify(payload);
    if (level === 'error') {
        console.error(line);
    } else if (level === 'warn') {
        console.warn(line);
    } else {
        console.log(line);
    }
}

export function logSystemEvent(input: SystemLogInput): void {
    const payload = {
        ts: new Date().toISOString(),
        level: input.level,
        scope: input.scope,
        event: input.event,
        stream: input.stream ?? null,
        jobId: input.jobId ?? null,
        accountId: input.accountId ?? null,
        shopId: input.shopId ?? null,
        message: input.message ?? null,
        ...(input.data ?? {}),
    };
    writeConsole(input.level, payload);

    void (async () => {
        try {
            const { error } = await supabase
                .from('system_logs')
                .insert({
                    level: input.level,
                    scope: input.scope,
                    event: input.event,
                    stream: input.stream ?? null,
                    job_id: input.jobId ?? null,
                    account_id: input.accountId ?? null,
                    shop_id: input.shopId ?? null,
                    message: input.message ?? null,
                    data: input.data ?? {},
                });
            if (error) {
                console.error('[systemLogger] Failed to persist system log:', error.message);
            }
        } catch (e: any) {
            console.error('[systemLogger] Unexpected logger failure:', e?.message ?? 'unknown');
        }
    })();
}
