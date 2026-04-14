import { apiFetch } from './apiClient';

export async function adminPatchTenant(tenantId: string, body: { name?: string; status?: string }): Promise<unknown> {
    const res = await apiFetch(`/api/admin/tenants/${tenantId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `Update failed (${res.status})`);
    return json.data;
}

export async function adminDeleteTenant(tenantId: string): Promise<unknown> {
    const res = await apiFetch(`/api/admin/tenants/${tenantId}`, { method: 'DELETE' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `Delete failed (${res.status})`);
    return json.data;
}

export async function patchAgencyTenantAsAdmin(tenantId: string, body: { name?: string; status?: string }): Promise<unknown> {
    const res = await apiFetch(`/api/team/agency-tenant/${tenantId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `Update failed (${res.status})`);
    return json.data;
}
