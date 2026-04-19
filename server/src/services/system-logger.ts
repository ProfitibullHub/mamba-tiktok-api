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

function writeConsole(level: SystemLogLevel, payload: Record<string, unknown>) {
    const message = JSON.stringify(payload);
    if (level === 'error') {
        console.error(message);
    } else if (level === 'warn') {
        console.warn(message);
    } else {
        console.log(message);
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
