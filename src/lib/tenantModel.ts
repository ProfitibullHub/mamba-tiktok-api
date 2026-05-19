/**
 * Mamba tenant data model (Phase 2+).
 *
 * ## `tenants` row
 *
 * | `type`    | `parent_tenant_id` | Meaning |
 * |-----------|-------------------|---------|
 * | `agency`  | **must be NULL**  | Management org (agency console, staff, linked sellers). |
 * | `seller`  | NULL or agency id | TikTok shop **organization**; 1:1 with `accounts.tenant_id`. |
 * | `platform`| NULL              | Internal Mamba operator context (Super Admin). |
 *
 * ## `parent_tenant_id` — agency hierarchy only
 *
 * Answers: **“Which agency manages this seller organization?”**
 *
 * - **Yes — agency hierarchy:** a linked seller’s `parent_tenant_id` points at the agency tenant.
 * - **No — multi-tenant permission inheritance:** roles/permissions live on `tenant_memberships`
 *   per tenant; parent does not auto-grant seller roles to agency users.
 * - **No — reseller / multi-level trees:** only one hop (agency → seller). Agencies cannot have a parent.
 *
 * ### Typical values
 *
 * - Standalone seller: `type = seller`, `parent_tenant_id IS NULL`
 * - Agency-linked seller: `type = seller`, `parent_tenant_id = <agency tenants.id>`
 * - Agency: `type = agency`, `parent_tenant_id IS NULL`
 *
 * ### How the link is established
 *
 * 1. Agency initiates seller link → `tenant_link_invitations` + seller `link_status = pending`
 * 2. Seller Admin accepts → RPC sets `parent_tenant_id` to the agency (and clears pending state)
 *
 * ### Why the app reads it
 *
 * `GET /rest/v1/tenants?select=parent_tenant_id&id=eq.<seller-tenant-id>` is used to learn whether
 * a seller is agency-managed (e.g. agency-branded console, parent agency for messaging/branding).
 *
 * Access control still goes through RLS (`tenant_is_visible_to_user`) and membership — not this GET alone.
 */

export type TenantType = 'agency' | 'seller' | 'platform';

export type TenantStatus = 'active' | 'inactive' | 'suspended';

/** Minimal tenant row shape for client-side context. */
export type TenantRow = {
    id: string;
    name: string;
    type: TenantType;
    status: TenantStatus;
    /**
     * Managing agency when `type === 'seller'` and the shop accepted an agency link; otherwise null.
     */
    parent_tenant_id: string | null;
};

/** True when this seller org is linked under an agency (not standalone). */
export function sellerTenantIsAgencyLinked(tenant: Pick<TenantRow, 'type' | 'parent_tenant_id'>): boolean {
    return tenant.type === 'seller' && tenant.parent_tenant_id != null;
}
