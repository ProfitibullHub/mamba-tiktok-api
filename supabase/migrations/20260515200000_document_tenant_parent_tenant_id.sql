-- Document tenants hierarchy for security reviews and SQL explorers.
-- See also src/lib/tenantModel.ts (app-side reference).

COMMENT ON TABLE public.tenants IS
    'Organization boundary in Mamba. Types: agency (root), seller (shop org), platform (internal ops). '
    'Accounts and TikTok shops hang off seller tenants; agency staff reach linked sellers via parent_tenant_id + assignments.';

COMMENT ON COLUMN public.tenants.type IS
    'agency — management org; parent_tenant_id MUST be NULL. '
    'seller — TikTok shop organization (1:1 with accounts.tenant_id). '
    'platform — internal Mamba operator context (Super Admin memberships).';

COMMENT ON COLUMN public.tenants.parent_tenant_id IS
    'Agency–seller link only (single level, not a reseller tree). '
    'For type=seller: UUID of the managing agency tenant when the seller accepted an agency link; NULL if standalone. '
    'For type=agency: always NULL (constraint tenants_agency_root). '
    'Not permission inheritance: RBAC uses tenant_memberships on each tenant; this column scopes which sellers an agency may see in SQL (e.g. get_assigned_seller_ids, tenant_is_visible_to_user). '
    'Set by accept_seller_link_invitation / platform link RPCs — not by arbitrary client UPDATE.';

COMMENT ON COLUMN public.tenants.status IS
    'active | inactive | suspended — lifecycle for the org; does not replace link_status on seller–agency workflows.';
