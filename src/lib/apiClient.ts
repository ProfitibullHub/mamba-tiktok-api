import { supabase } from './supabase';

/**
 * Backend origin only (scheme + host + optional port). No path.
 * If `VITE_API_BASE_URL` is set to `http://localhost:3001/api`, requests that already
 * include `/api/...` become `/api/api/...` and return 404 — we strip a trailing `/api`.
 */
export function getApiOrigin(): string {
    let raw = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001').trim();
    raw = raw.replace(/\/+$/, '');
    if (raw.endsWith('/api')) {
        raw = raw.slice(0, -4);
    }
    return raw;
}

function apiBase(): string {
    return getApiOrigin();
}

/** Ensures we have a JWT before calling the backend (avoids PATCH/POST without Bearer). */
export async function getAccessTokenForApi(): Promise<string | null> {
    let { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) return session.access_token;

    // Reconcile with Supabase (e.g. tab backgrounded, storage race after sign-in)
    await supabase.auth.getUser();
    ({ data: { session } } = await supabase.auth.getSession());
    if (session?.access_token) return session.access_token;

    const { data: ref } = await supabase.auth.refreshSession();
    return ref.session?.access_token ?? null;
}

/** Authenticated calls to the Mamba API (enforces tenant/account access on the server). */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
    const buildHeaders = (accessToken: string | null): Headers => {
        const headers = new Headers(init?.headers);
        if (accessToken) {
            headers.set('Authorization', `Bearer ${accessToken}`);
        }
        if (init?.body != null && typeof init.body === 'string' && !headers.has('Content-Type')) {
            headers.set('Content-Type', 'application/json');
        }
        return headers;
    };

    const accessToken = await getAccessTokenForApi();
    const prefix = path.startsWith('/') ? '' : '/';
    const url = path.startsWith('http') ? path : `${apiBase()}${prefix}${path}`;
    // Avoid stale cached API responses after mutations (branding PATCH, etc.).
    const cache = init?.cache !== undefined ? init.cache : 'no-store';
    let resp = await fetch(url, { ...init, headers: buildHeaders(accessToken), cache });

    // Session can expire between UI state and API calls (especially invite/login redirects).
    // Retry once with a freshly refreshed token before surfacing 401.
    if (resp.status === 401) {
        const { data: refreshed } = await supabase.auth.refreshSession();
        const retryToken = refreshed.session?.access_token ?? (await getAccessTokenForApi());
        if (retryToken) {
            resp = await fetch(url, { ...init, headers: buildHeaders(retryToken), cache });
        }
    }

    return resp;
}
