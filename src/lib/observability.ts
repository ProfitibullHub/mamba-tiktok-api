import { apiFetch } from './apiClient';

type ClientErrorPayload = {
    event?: string;
    message: string;
    route?: string;
    source?: string;
    stack?: string;
    accountId?: string;
    metadata?: Record<string, unknown>;
};

export async function reportClientError(payload: ClientErrorPayload): Promise<void> {
    try {
        await apiFetch('/api/observability/client-error', {
            method: 'POST',
            body: JSON.stringify(payload),
        });
    } catch {
        // Never throw from telemetry path.
    }
}
