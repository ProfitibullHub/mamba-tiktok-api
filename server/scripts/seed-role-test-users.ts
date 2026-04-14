/**
 * Local/staging only: create fixed test users for each RBAC role.
 *
 * Requires server/.env with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 *
 * Run from repo: cd server && npx tsx scripts/seed-role-test-users.ts
 *
 * Expects:
 * - Agency tenant whose name ILIKE '%Test Agency%'
 * - Earth Rated seller: accounts.name ILIKE '%Earth Rated%' (preferred) or seller tenants.name
 *
 * All accounts use password: test123 (set via Auth Admin API).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const TEST_PASSWORD = 'test123';
/** ILIKE pattern — matches tenant name containing this phrase */
const AGENCY_NAME_PATTERN = '%Test Agency%';
const EARTH_RATED_PATTERN = '%Earth Rated%';

type UserSpec = {
    email: string;
    fullName: string;
    /** System role name in public.roles (tenant_id IS NULL) */
    roleName: string;
    /** 'agency' = membership on agency tenant; 'seller' = membership on seller tenant */
    membershipTenant: 'agency' | 'seller';
    /** For Account Manager / Account Coordinator: grant access to Earth Rated seller */
    assignToEarthRatedSeller?: boolean;
};

const USER_SPECS: UserSpec[] = [
    {
        email: 'agencyadmin@test.com',
        fullName: 'Test Agency Admin',
        roleName: 'Agency Admin',
        membershipTenant: 'agency',
    },
    {
        email: 'agencyaccountmanager@test.com',
        fullName: 'Test Account Manager',
        roleName: 'Account Manager',
        membershipTenant: 'agency',
        assignToEarthRatedSeller: true,
    },
    {
        email: 'agencycoordinator@test.com',
        fullName: 'Test Account Coordinator',
        roleName: 'Account Coordinator',
        membershipTenant: 'agency',
        assignToEarthRatedSeller: true,
    },
    {
        email: 'selleradmin@test.com',
        fullName: 'Test Seller Admin',
        roleName: 'Seller Admin',
        membershipTenant: 'seller',
    },
    {
        email: 'selleruser@test.com',
        fullName: 'Test Seller User',
        roleName: 'Seller User',
        membershipTenant: 'seller',
    },
];

async function findUserIdByEmail(admin: SupabaseClient, email: string): Promise<string | null> {
    const normalized = email.trim().toLowerCase();
    let page = 1;
    const perPage = 200;
    for (;;) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
        if (error) throw error;
        const hit = data.users.find((u) => (u.email ?? '').toLowerCase() === normalized);
        if (hit) return hit.id;
        if (data.users.length < perPage) return null;
        page += 1;
    }
}

async function ensureAuthUser(supabase: SupabaseClient, email: string, fullName: string): Promise<string> {
    const existing = await findUserIdByEmail(supabase, email);
    if (existing) {
        const { error } = await supabase.auth.admin.updateUserById(existing, {
            password: TEST_PASSWORD,
            email_confirm: true,
            user_metadata: { full_name: fullName },
        });
        if (error) throw error;
        return existing;
    }
    const { data, error } = await supabase.auth.admin.createUser({
        email,
        password: TEST_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: fullName },
    });
    if (error) throw error;
    if (!data.user?.id) throw new Error(`createUser returned no id for ${email}`);
    return data.user.id;
}

async function ensureProfile(supabase: SupabaseClient, userId: string, email: string, fullName: string) {
    const { error } = await supabase.from('profiles').upsert(
        {
            id: userId,
            email,
            full_name: fullName,
            role: 'client',
            updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
    );
    if (error) throw error;
}

async function getSystemRoleId(supabase: SupabaseClient, roleName: string): Promise<string> {
    const { data, error } = await supabase
        .from('roles')
        .select('id')
        .is('tenant_id', null)
        .eq('name', roleName)
        .maybeSingle();
    if (error) throw error;
    if (!data?.id) throw new Error(`System role not found: "${roleName}"`);
    return data.id;
}

async function resolveAgencyTenantId(supabase: SupabaseClient): Promise<string> {
    const { data, error } = await supabase
        .from('tenants')
        .select('id, name')
        .eq('type', 'agency')
        .ilike('name', AGENCY_NAME_PATTERN)
        .limit(2);
    if (error) throw error;
    if (!data?.length) {
        throw new Error(`No agency tenant found with name matching ILIKE '${AGENCY_NAME_PATTERN}'`);
    }
    if (data.length > 1) {
        console.warn('[seed] Multiple agencies matched name; using first:', data[0].name, data[0].id);
    }
    return data[0].id;
}

async function resolveEarthRatedSeller(
    supabase: SupabaseClient
): Promise<{ sellerTenantId: string; accountId: string | null; label: string }> {
    const { data: fromAccount, error: accErr } = await supabase
        .from('accounts')
        .select('id, name, tenant_id')
        .ilike('name', EARTH_RATED_PATTERN)
        .limit(2);
    if (accErr) throw accErr;
    if (fromAccount?.length) {
        if (fromAccount.length > 1) {
            console.warn('[seed] Multiple accounts matched Earth Rated; using first:', fromAccount[0].name);
        }
        const row = fromAccount[0];
        if (!row.tenant_id) throw new Error('Earth Rated account has no tenant_id');
        return {
            sellerTenantId: row.tenant_id,
            accountId: row.id,
            label: row.name ?? 'Earth Rated',
        };
    }

    const { data: fromTenant, error: tenErr } = await supabase
        .from('tenants')
        .select('id, name')
        .eq('type', 'seller')
        .ilike('name', EARTH_RATED_PATTERN)
        .limit(2);
    if (tenErr) throw tenErr;
    if (!fromTenant?.length) {
        throw new Error(
            `No seller found: accounts.name ILIKE '${EARTH_RATED_PATTERN}' or tenants (seller) name ILIKE same`
        );
    }
    if (fromTenant.length > 1) {
        console.warn('[seed] Multiple seller tenants matched; using first:', fromTenant[0].name);
    }
    return {
        sellerTenantId: fromTenant[0].id,
        accountId: null,
        label: fromTenant[0].name ?? 'Earth Rated',
    };
}

async function main() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
        console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in server/.env');
        process.exit(1);
    }

    const supabase = createClient(url, key, {
        auth: { autoRefreshToken: false, persistSession: false },
    });

    const agencyTenantId = await resolveAgencyTenantId(supabase);
    const { sellerTenantId, accountId, label: sellerLabel } = await resolveEarthRatedSeller(supabase);

    console.log('Agency tenant (ILIKE', AGENCY_NAME_PATTERN + '):', agencyTenantId);
    console.log('Earth Rated seller:', sellerLabel, '→', sellerTenantId, accountId ? `(account ${accountId})` : '');

    const { data: sellerRow, error: sellerFetchErr } = await supabase
        .from('tenants')
        .select('id, parent_tenant_id, type')
        .eq('id', sellerTenantId)
        .single();
    if (sellerFetchErr) throw sellerFetchErr;
    if (sellerRow.type !== 'seller') throw new Error('Resolved tenant is not type seller');

    if (sellerRow.parent_tenant_id !== agencyTenantId) {
        const { error: linkErr } = await supabase
            .from('tenants')
            .update({ parent_tenant_id: agencyTenantId, updated_at: new Date().toISOString() })
            .eq('id', sellerTenantId);
        if (linkErr) throw linkErr;
        console.log('Linked seller tenant under Test Agency (parent_tenant_id set).');
    }

    for (const spec of USER_SPECS) {
        const userId = await ensureAuthUser(supabase, spec.email, spec.fullName);
        await ensureProfile(supabase, userId, spec.email, spec.fullName);
        const roleId = await getSystemRoleId(supabase, spec.roleName);

        const tenantId = spec.membershipTenant === 'agency' ? agencyTenantId : sellerTenantId;
        const { error: tmErr } = await supabase.from('tenant_memberships').upsert(
            {
                tenant_id: tenantId,
                user_id: userId,
                role_id: roleId,
                status: 'active',
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'tenant_id,user_id' }
        );
        if (tmErr) throw tmErr;

        if (spec.assignToEarthRatedSeller) {
            const { data: tmRow, error: tmSelErr } = await supabase
                .from('tenant_memberships')
                .select('id')
                .eq('tenant_id', agencyTenantId)
                .eq('user_id', userId)
                .single();
            if (tmSelErr) throw tmSelErr;
            const { error: asgErr } = await supabase.from('user_seller_assignments').upsert(
                {
                    tenant_membership_id: tmRow.id,
                    seller_tenant_id: sellerTenantId,
                },
                { onConflict: 'tenant_membership_id,seller_tenant_id' }
            );
            if (asgErr) throw asgErr;
        }

        if (spec.membershipTenant === 'seller' && accountId) {
            const { error: uaErr } = await supabase.from('user_accounts').upsert(
                { user_id: userId, account_id: accountId },
                { onConflict: 'user_id,account_id' }
            );
            if (uaErr) throw uaErr;
        }

        console.log('OK', spec.email, '→', spec.roleName, spec.membershipTenant === 'agency' ? '(agency)' : '(seller)');
    }

    console.log('\nDone. Password for all:', TEST_PASSWORD);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
