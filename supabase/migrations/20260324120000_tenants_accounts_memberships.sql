-- Phase 2 (foundation): tenants, accounts.tenant_id, tenant_memberships, RBAC primitives,
-- user_seller_assignments. Preserves legacy user_accounts for backward compatibility.

-- ---------------------------------------------------------------------------
-- 1. Tenants (agency = root; seller = optional parent agency)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('agency', 'seller')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT tenants_agency_root CHECK (
        type = 'seller'
        OR (type = 'agency' AND parent_tenant_id IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_tenants_parent ON tenants(parent_tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenants_type ON tenants(type);

-- ---------------------------------------------------------------------------
-- 2. Permissions & roles (system roles have tenant_id IS NULL)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT permissions_action_unique UNIQUE (action)
);

CREATE TABLE IF NOT EXISTS roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    type TEXT NOT NULL DEFAULT 'custom' CHECK (type IN ('system', 'custom')),
    scope TEXT NOT NULL CHECK (scope IN ('platform', 'agency', 'seller')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT roles_tenant_name_unique UNIQUE NULLS NOT DISTINCT (tenant_id, name),
    CONSTRAINT roles_custom_must_have_tenant CHECK (
        type = 'system' OR tenant_id IS NOT NULL
    )
);

-- Older drafts used `level` instead of `scope`. CREATE TABLE IF NOT EXISTS skips DDL when `roles` already exists.
DO $normalize_roles$
BEGIN
    IF to_regclass('public.roles') IS NULL THEN
        RETURN;
    END IF;
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'roles' AND column_name = 'level'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'roles' AND column_name = 'scope'
    ) THEN
        ALTER TABLE public.roles RENAME COLUMN level TO scope;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'roles' AND column_name = 'scope'
    ) THEN
        ALTER TABLE public.roles ADD COLUMN scope TEXT;
        UPDATE public.roles SET scope = 'seller' WHERE scope IS NULL;
        ALTER TABLE public.roles ALTER COLUMN scope SET NOT NULL;
        ALTER TABLE public.roles DROP CONSTRAINT IF EXISTS roles_scope_check;
        ALTER TABLE public.roles ADD CONSTRAINT roles_scope_check CHECK (scope IN ('platform', 'agency', 'seller'));
    END IF;
END
$normalize_roles$;

CREATE TABLE IF NOT EXISTS role_permissions (
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (role_id, permission_id)
);

-- ---------------------------------------------------------------------------
-- 3. Membership: one row per (user, tenant); role is RBAC role for that tenant
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenant_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'deactivated')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT tenant_memberships_user_tenant_unique UNIQUE (tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_memberships_user ON tenant_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_tenant_memberships_tenant ON tenant_memberships(tenant_id);

-- ---------------------------------------------------------------------------
-- 4. Agency AM/AC: which seller tenants a membership may access (in addition to RBAC rules)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_seller_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_membership_id UUID NOT NULL REFERENCES tenant_memberships(id) ON DELETE CASCADE,
    seller_tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT user_seller_assignments_unique UNIQUE (tenant_membership_id, seller_tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_user_seller_assignments_seller ON user_seller_assignments(seller_tenant_id);

-- Older drafts used tenant_user_id → tenant_users. Normalize to tenant_membership_id → tenant_memberships.
DO $normalize_user_seller_assignments$
DECLARE
    r RECORD;
BEGIN
    IF to_regclass('public.user_seller_assignments') IS NULL THEN
        RETURN;
    END IF;
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'user_seller_assignments' AND column_name = 'tenant_user_id'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'user_seller_assignments' AND column_name = 'tenant_membership_id'
    ) THEN
        FOR r IN
            SELECT c.conname AS conname
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public'
              AND t.relname = 'user_seller_assignments'
              AND c.contype = 'f'
              AND pg_get_constraintdef(c.oid) ILIKE '%tenant_user_id%'
        LOOP
            EXECUTE format('ALTER TABLE public.user_seller_assignments DROP CONSTRAINT %I', r.conname);
        END LOOP;

        FOR r IN
            SELECT c.conname AS conname
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public'
              AND t.relname = 'user_seller_assignments'
              AND c.contype = 'u'
        LOOP
            EXECUTE format('ALTER TABLE public.user_seller_assignments DROP CONSTRAINT %I', r.conname);
        END LOOP;

        ALTER TABLE public.user_seller_assignments RENAME COLUMN tenant_user_id TO tenant_membership_id;

        ALTER TABLE public.user_seller_assignments
            ADD CONSTRAINT user_seller_assignments_unique UNIQUE (tenant_membership_id, seller_tenant_id);

        ALTER TABLE public.user_seller_assignments
            ADD CONSTRAINT user_seller_assignments_tenant_membership_id_fkey
            FOREIGN KEY (tenant_membership_id) REFERENCES public.tenant_memberships(id) ON DELETE CASCADE;
    END IF;
END
$normalize_user_seller_assignments$;

-- ---------------------------------------------------------------------------
-- 5. accounts.tenant_id column (trigger added after backfill so UUIDs exist in tenants first)
-- ---------------------------------------------------------------------------
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS tenant_id UUID;

CREATE OR REPLACE FUNCTION enforce_account_tenant_is_seller()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.tenant_id IS NULL THEN
        RETURN NEW;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM tenants t
        WHERE t.id = NEW.tenant_id AND t.type = 'seller'
    ) THEN
        RAISE EXCEPTION 'accounts.tenant_id must reference a tenant with type seller';
    END IF;
    RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Seed permissions (idempotent)
-- ---------------------------------------------------------------------------
INSERT INTO permissions (action, description) VALUES
    ('users.manage', 'Invite and manage users for the tenant'),
    ('billing.view', 'View billing and subscription'),
    ('billing.manage', 'Change subscription and payment method'),
    ('tiktok.auth', 'Connect and refresh TikTok shops'),
    ('financials.view', 'View full financials including COGS'),
    ('financials.restricted', 'View restricted financial summaries only'),
    ('tasks.manage', 'Create and manage tasks'),
    ('messages.send', 'Send and read unified messages'),
    ('agency.sellers.link', 'Link or unlink seller tenants under agency'),
    ('agency.assignments.manage', 'Assign account managers/coordinators to sellers')
ON CONFLICT (action) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 7. Seed system roles (idempotent)
-- ---------------------------------------------------------------------------
-- Pre-existing `roles` tables may lack this name (CREATE TABLE IF NOT EXISTS skips inline constraint).
ALTER TABLE public.roles DROP CONSTRAINT IF EXISTS roles_tenant_name_unique;
ALTER TABLE public.roles
    ADD CONSTRAINT roles_tenant_name_unique UNIQUE NULLS NOT DISTINCT (tenant_id, name);

INSERT INTO roles (name, type, scope, description, tenant_id) VALUES
    ('Super Admin', 'system', 'platform', 'Internal platform operator', NULL),
    ('Agency Admin', 'system', 'agency', 'Full agency tenant administration', NULL),
    ('Account Manager', 'system', 'agency', 'Manage assigned sellers and coordinators', NULL),
    ('Account Coordinator', 'system', 'agency', 'Operate on assigned sellers only', NULL),
    ('Seller Admin', 'system', 'seller', 'Full access within seller tenant', NULL),
    ('Seller User', 'system', 'seller', 'Read-only within seller tenant', NULL)
ON CONFLICT (tenant_id, name) DO NOTHING;

-- Fix scope for system rows if they were backfilled with a default (e.g. after ADD COLUMN)
UPDATE roles r SET scope = v.scope
FROM (VALUES
    ('Super Admin', 'platform'),
    ('Agency Admin', 'agency'),
    ('Account Manager', 'agency'),
    ('Account Coordinator', 'agency'),
    ('Seller Admin', 'seller'),
    ('Seller User', 'seller')
) AS v(name, scope)
WHERE r.tenant_id IS NULL AND r.name = v.name;

-- ---------------------------------------------------------------------------
-- 8. Map system roles → permissions (idempotent inserts)
-- ---------------------------------------------------------------------------
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.tenant_id IS NULL
  AND r.name = 'Super Admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.action IN (
    'users.manage', 'billing.view', 'billing.manage', 'tiktok.auth', 'financials.view',
    'tasks.manage', 'messages.send', 'agency.sellers.link', 'agency.assignments.manage'
)
WHERE r.tenant_id IS NULL AND r.name = 'Agency Admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.action IN (
    'users.manage', 'financials.view', 'financials.restricted', 'tasks.manage',
    'messages.send', 'agency.assignments.manage', 'tiktok.auth'
)
WHERE r.tenant_id IS NULL AND r.name = 'Account Manager'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.action IN (
    'financials.restricted', 'tasks.manage', 'messages.send', 'tiktok.auth'
)
WHERE r.tenant_id IS NULL AND r.name = 'Account Coordinator'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.action IN (
    'users.manage', 'billing.view', 'billing.manage', 'tiktok.auth', 'financials.view',
    'tasks.manage', 'messages.send'
)
WHERE r.tenant_id IS NULL AND r.name = 'Seller Admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.action IN ('financials.view', 'messages.send')
WHERE r.tenant_id IS NULL AND r.name = 'Seller User'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 9. Backfill: one seller tenant per existing account; wire accounts.tenant_id
-- ---------------------------------------------------------------------------
UPDATE accounts
SET tenant_id = gen_random_uuid()
WHERE tenant_id IS NULL;

INSERT INTO tenants (id, name, type, status)
SELECT a.tenant_id, a.name, 'seller',
    CASE WHEN a.status = 'inactive' THEN 'inactive' ELSE 'active' END
FROM accounts a
WHERE NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = a.tenant_id);

ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_tenant_id_fkey;
ALTER TABLE accounts
    ADD CONSTRAINT accounts_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;

ALTER TABLE accounts ALTER COLUMN tenant_id SET NOT NULL;

DROP TRIGGER IF EXISTS trg_accounts_tenant_seller ON accounts;
CREATE TRIGGER trg_accounts_tenant_seller
    BEFORE INSERT OR UPDATE OF tenant_id ON accounts
    FOR EACH ROW
    EXECUTE FUNCTION enforce_account_tenant_is_seller();

-- ---------------------------------------------------------------------------
-- 10. Backfill memberships from legacy user_accounts (map profile.role → seller role)
-- ---------------------------------------------------------------------------
INSERT INTO tenant_memberships (tenant_id, user_id, role_id, status)
SELECT
    a.tenant_id,
    ua.user_id,
    CASE
        WHEN p.role = 'admin' THEN (SELECT id FROM roles WHERE tenant_id IS NULL AND name = 'Seller Admin' LIMIT 1)
        ELSE (SELECT id FROM roles WHERE tenant_id IS NULL AND name = 'Seller User' LIMIT 1)
    END,
    'active'
FROM user_accounts ua
JOIN accounts a ON a.id = ua.account_id
JOIN profiles p ON p.id = ua.user_id
ON CONFLICT (tenant_id, user_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 11. updated_at triggers (function expected to exist from prior migrations)
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS update_tenants_updated_at ON tenants;
CREATE TRIGGER update_tenants_updated_at
    BEFORE UPDATE ON tenants
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_roles_updated_at ON roles;
CREATE TRIGGER update_roles_updated_at
    BEFORE UPDATE ON roles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_tenant_memberships_updated_at ON tenant_memberships;
CREATE TRIGGER update_tenant_memberships_updated_at
    BEFORE UPDATE ON tenant_memberships
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 12. RLS (baseline; tighten in follow-up migrations)
-- ---------------------------------------------------------------------------
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_seller_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "permissions_select_authenticated" ON permissions;
DROP POLICY IF EXISTS "roles_select_authenticated" ON roles;
DROP POLICY IF EXISTS "role_permissions_select_authenticated" ON role_permissions;
DROP POLICY IF EXISTS "tenants_select_member" ON tenants;
DROP POLICY IF EXISTS "tenant_memberships_select_own" ON tenant_memberships;
DROP POLICY IF EXISTS "tenant_memberships_select_cotenant" ON tenant_memberships;
DROP POLICY IF EXISTS "user_seller_assignments_select" ON user_seller_assignments;

-- Permissions & role_permissions: readable by any authenticated user (catalog); writes via service role only
CREATE POLICY "permissions_select_authenticated" ON permissions FOR SELECT TO authenticated USING (true);
CREATE POLICY "roles_select_authenticated" ON roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "role_permissions_select_authenticated" ON role_permissions FOR SELECT TO authenticated USING (true);

-- Tenants: direct membership only for now; agency→child seller visibility comes in a follow-up migration
CREATE POLICY "tenants_select_member" ON tenants FOR SELECT TO authenticated
USING (
    id IN (SELECT tm.tenant_id FROM tenant_memberships tm WHERE tm.user_id = auth.uid() AND tm.status = 'active')
);

CREATE POLICY "tenant_memberships_select_own" ON tenant_memberships FOR SELECT TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "tenant_memberships_select_cotenant" ON tenant_memberships FOR SELECT TO authenticated
USING (
    tenant_id IN (
        SELECT tm.tenant_id FROM tenant_memberships tm
        WHERE tm.user_id = auth.uid() AND tm.status = 'active'
    )
);

CREATE POLICY "user_seller_assignments_select" ON user_seller_assignments FOR SELECT TO authenticated
USING (
    tenant_membership_id IN (
        SELECT tm.id FROM tenant_memberships tm
        WHERE tm.user_id = auth.uid() AND tm.status = 'active'
    )
);

COMMENT ON TABLE tenants IS 'Organization boundary: agency (root) or seller (optional parent agency).';
COMMENT ON TABLE tenant_memberships IS 'User membership in a tenant with one RBAC role; complements legacy user_accounts.';
COMMENT ON COLUMN accounts.tenant_id IS 'Seller tenant that owns this account; all shop data stays under this tenant.';
