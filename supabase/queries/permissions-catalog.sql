-- Run against staging/prod (service role or SQL editor). Pairs with scripts/dump-permissions-catalog.mjs.

SELECT action, description
FROM public.permissions
ORDER BY action;

-- Duplicate / synonymous actions (manual review; keep in sync with application aliases).
-- roles.manage (legacy) vs manage_roles / assign_roles (RBAC v2)
