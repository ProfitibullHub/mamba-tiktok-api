import { logSystemEvent } from './system-logger.js';

interface IngestionLogContext {
    event: string;
    stream?: 'shop' | 'ads';
    jobId?: string;
    accountId?: string;
    shopId?: string;
    syncType?: string;
    attempt?: number;
    status?: string;
    error?: string;
    [key: string]: unknown;
}

function write(level: 'info' | 'warn' | 'error', context: IngestionLogContext): void {
    const { event, stream, jobId, accountId, shopId, ...rest } = context;
    logSystemEvent({
        level,
        scope: 'ingestion',
        event,
        stream: stream ?? null,
        jobId: jobId ?? null,
        accountId: accountId ?? null,
        shopId: shopId ?? null,
        message: typeof context.error === 'string' ? context.error : null,
        data: Object.keys(rest).length > 0 ? rest : {},
    });
}

export const ingestionLogger = {
    info: (context: IngestionLogContext) => write('info', context),
    warn: (context: IngestionLogContext) => write('warn', context),
    error: (context: IngestionLogContext) => write('error', context),
};
