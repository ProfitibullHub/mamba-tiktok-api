import { supabase } from './supabase';

function apiBase(): string {
    return import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';
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
    const accessToken = await getAccessTokenForApi();
    const headers = new Headers(init?.headers);
    if (accessToken) {
        headers.set('Authorization', `Bearer ${accessToken}`);
    }
    if (init?.body != null && typeof init.body === 'string' && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }
    const prefix = path.startsWith('/') ? '' : '/';
    const url = path.startsWith('http') ? path : `${apiBase()}${prefix}${path}`;
    return fetch(url, { ...init, headers });
}
