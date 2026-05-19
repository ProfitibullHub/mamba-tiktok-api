import express from 'express';
import { randomUUID } from 'node:crypto';
import { supabase } from '../config/supabase.js';
import { resolveRequestUserId } from '../middleware/account-access.middleware.js';
import {
    deactivateAgencyLifecycle,
    tenantStatusTriggersLifecycle,
    unlinkSellerFromAgencyLifecycle,
} from '../services/tenant-lifecycle.service.js';
import { auditLog } from '../services/audit-logger.js';
import { sendHtmlEmail } from '../services/email.js';

const router = express.Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Agency Admin, platform super admin, or custom role with agency.sellers.link. */
async function actorMayInitiateAgencySellerLink(actorId: string, agencyTenantId: string): Promise<boolean> {
    const [{ data: isAa, error: aaErr }, { data: isSa, error: saErr }, { data: permRows, error: permErr }] =
        await Promise.all([
            supabase.rpc('user_is_agency_admin', { p_agency_tenant_id: agencyTenantId, p_user_id: actorId }),
            supabase.rpc('user_is_platform_super_admin', { p_user_id: actorId }),
            supabase.rpc('get_user_effective_permissions_on_tenant', {
                p_user_id: actorId,
                p_tenant_id: agencyTenantId,
            }),
        ]);
    if (aaErr || saErr) {
        console.error('[team] agency seller link permission', aaErr?.message || saErr?.message);
        return false;
    }
    if (isAa === true || isSa === true) return true;
    if (permErr) {
        console.error('[team] agency seller link perm rows', permErr.message);
        return false;
    }
    const rows = Array.isArray(permRows) ? permRows : [];
    return rows.some((r: { action?: string }) => r.action === 'agency.sellers.link');
}

/** Roster of seller–staff links for the agency console: active agency members, managers, or delegated link/unlink. */
async function actorMayViewAgencySellerAssignments(actorId: string, agencyTenantId: string): Promise<boolean> {
    if (await actorMayInitiateAgencySellerLink(actorId, agencyTenantId)) return true;
    const { data: manage, error: manageErr } = await supabase.rpc('user_can_manage_tenant_members', {
        p_tenant_id: agencyTenantId,
        p_actor_id: actorId,
    });
    if (manageErr) {
        console.error('[team] agency-seller-assignments manage check', manageErr.message);
    } else if (manage === true) {
        return true;
    }
    const { data: isAa } = await supabase.rpc('user_is_agency_admin', {
        p_agency_tenant_id: agencyTenantId,
        p_user_id: actorId,
    });
    if (isAa === true) return true;
    const { data: isSa } = await supabase.rpc('user_is_platform_super_admin', { p_user_id: actorId });
    if (isSa === true) return true;
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', actorId).maybeSingle();
    if (profile?.role === 'admin') return true;
    const { data: mem } = await supabase
        .from('tenant_memberships')
        .select('id')
        .eq('tenant_id', agencyTenantId)
        .eq('user_id', actorId)
        .eq('status', 'active')
        .maybeSingle();
    return !!mem;
}

/** Seller tenant search for link flow — team managers or delegated link/unlink permission. */
async function actorMaySearchSellersForAgency(actorId: string, agencyTenantId: string): Promise<boolean> {
    const { data: manage, error } = await supabase.rpc('user_can_manage_tenant_members', {
        p_tenant_id: agencyTenantId,
        p_actor_id: actorId,
    });
    if (error) {
        console.error('[team] seller-search manage check', error.message);
        return false;
    }
    if (manage === true) return true;
    return actorMayInitiateAgencySellerLink(actorId, agencyTenantId);
}
const FRONTEND_URL = (process.env.FRONTEND_URL || 'https://mamba.app').replace(/\/$/, '');

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function buildTeamInviteEmailHtml(acceptUrl: string, tenantLabel?: string): string {
    const tenantText = tenantLabel?.trim() ? ` to join <strong>${escapeHtml(tenantLabel)}</strong>` : '';
    const safeUrl = escapeHtml(acceptUrl);
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>You have been invited</title>
  </head>
  <body style="margin:0;padding:24px;background:#06141A;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;margin:0 auto;">
      <tr>
        <td style="background:#13262E;border:1px solid #1F3A43;border-radius:16px;padding:32px;">
          <p style="margin:0 0 12px;color:#8CAFB3;font-size:12px;letter-spacing:.4px;">MAMBA TEAM INVITE</p>
          <h1 style="margin:0 0 12px;color:#E6F3F1;font-size:28px;line-height:1.2;">You have been invited</h1>
          <p style="margin:0 0 20px;color:#8CAFB3;font-size:16px;line-height:1.6;">
            You have been invited${tenantText}. Use the button below to review and accept your invitation.
          </p>
          <p style="margin:0 0 20px;">
            <a href="${safeUrl}" style="display:inline-block;padding:14px 24px;border-radius:10px;background:#28D99E;color:#06141A;text-decoration:none;font-weight:700;">
              Accept Invitation
            </a>
          </p>
          <p style="margin:0;color:#8CAFB3;font-size:13px;line-height:1.6;">
            If the button doesn't work, copy this URL into your browser:<br />
            <a href="${safeUrl}" style="color:#49FFB7;text-decoration:underline;word-break:break-all;">${safeUrl}</a>
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** Paginated auth.users lookup by email (service role). */
async function findAuthUserIdByEmail(email: string): Promise<string | null> {
    const normalized = email.trim().toLowerCase();
    let page = 1;
    const perPage = 200;
    for (;;) {
        const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
        if (error) {
            console.error('[team] listUsers', error.message);
            return null;
        }
        const hit = data.users.find((u) => (u.email ?? '').toLowerCase() === normalized);
        if (hit) return hit.id;
        if (data.users.length < perPage) return null;
        page += 1;
    }
}

/**
 * Ensure an auth user exists for a team invite without triggering Supabase invite/OTP mail.
 * Returns the user id or null when creation and lookup both fail.
 */
async function ensureAuthUserForTeamInvite(email: string): Promise<string | null> {
    const normEmail = email.trim().toLowerCase();
    const created = await supabase.auth.admin.createUser({
        email: normEmail,
        email_confirm: false,
        user_metadata: { full_name: normEmail.split('@')[0] || 'User' },
    });
    if (!created.error && created.data?.user?.id) return created.data.user.id;

    const msg = created.error?.message || '';
    if (/already registered|already been registered|already exists/i.test(msg)) {
        return findAuthUserIdByEmail(normEmail);
    }
    console.error('[team] ensureAuthUserForTeamInvite', msg || 'createUser failed');
    return null;
}

/** Single team-invite email with org name and accept-invitation deep link (no Supabase Auth mailer). */
async function sendInvitationEmail(toEmail: string, acceptUrl: string, tenantLabel?: string): Promise<void> {
    const org = tenantLabel?.trim() || 'your organization';
    const html = buildTeamInviteEmailHtml(acceptUrl, org);
    const result = await sendHtmlEmail(toEmail, `You've been invited to join ${org} on Mamba`, html, {
        fromDisplayName: org,
    });
    if (!result.delivered) {
        throw new Error('Team invitation email was not delivered');
    }
}

function buildSellerLinkInviteEmailHtml(acceptUrl: string, agencyName?: string, sellerName?: string): string {
    const safeUrl = escapeHtml(acceptUrl);
    const safeAgency = agencyName ? escapeHtml(agencyName) : 'an agency';
    const safeSeller = sellerName ? escapeHtml(sellerName) : 'your shop';
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Seller Link Request</title>
  </head>
  <body style="margin:0;padding:24px;background:#06141A;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;margin:0 auto;">
      <tr>
        <td style="background:#13262E;border:1px solid #1F3A43;border-radius:16px;padding:32px;">
          <p style="margin:0 0 12px;color:#8CAFB3;font-size:12px;letter-spacing:.4px;">MAMBA SELLER LINK REQUEST</p>
          <h1 style="margin:0 0 12px;color:#E6F3F1;font-size:28px;line-height:1.2;">Agency Link Request</h1>
          <p style="margin:0 0 20px;color:#8CAFB3;font-size:16px;line-height:1.6;">
            <strong>${safeAgency}</strong> requested to link <strong>${safeSeller}</strong> to their agency.
            Review and accept or decline this request.
          </p>
          <p style="margin:0 0 20px;">
            <a href="${safeUrl}" style="display:inline-block;padding:14px 24px;border-radius:10px;background:#28D99E;color:#06141A;text-decoration:none;font-weight:700;">
              Review Request
            </a>
          </p>
          <p style="margin:0;color:#8CAFB3;font-size:13px;line-height:1.6;">
            If the button does not work, copy this URL into your browser:<br />
            <a href="${safeUrl}" style="color:#49FFB7;text-decoration:underline;word-break:break-all;">${safeUrl}</a>
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

async function sendSellerLinkInviteEmail(toEmail: string, acceptUrl: string, agencyName?: string, sellerName?: string): Promise<void> {
    const html = buildSellerLinkInviteEmailHtml(acceptUrl, agencyName, sellerName);
    const result = await sendHtmlEmail(toEmail, 'Agency seller link request on Mamba', html, {
        fromDisplayName: (agencyName || 'Mamba').trim() || 'Mamba',
    });
    if (!result.delivered) {
        throw new Error('Seller link invitation email was not delivered');
    }
}

function sanitizeIlikeQuery(q: string): string {
    return q.replace(/[%_\\]/g, '').trim().slice(0, 80);
}

/**
 * GET /api/team/agency-seller-assignments?agencyTenantId=
 * Agency Admin/Super Admin view of seller-to-staff assignments for this agency.
 */
router.get('/agency-seller-assignments', async (req, res) => {
    try {
        const actorId = await resolveRequestUserId(req);
        if (!actorId) {
            res.status(401).json({ success: false, error: 'Authorization required' });
            return;
        }

        const agencyTenantId = typeof req.query.agencyTenantId === 'string' ? req.query.agencyTenantId : '';
        if (!UUID_RE.test(agencyTenantId)) {
            res.status(400).json({ success: false, error: 'Valid agencyTenantId is required' });
            return;
        }

        let allowed = await actorMayViewAgencySellerAssignments(actorId, agencyTenantId);

        if (!allowed) {
            res.status(403).json({ success: false, error: 'Agency membership or appropriate permissions required' });
            return;
        }

        const { data: assignments, error: assignErr } = await supabase
            .from('user_seller_assignments')
            .select('seller_tenant_id,user_id')
            .eq('agency_tenant_id', agencyTenantId);
        if (assignErr) throw assignErr;

        const rows = assignments || [];
        const userIds = Array.from(new Set(rows.map((r: any) => r.user_id).filter(Boolean)));
        const profilesById = new Map<string, { full_name: string | null; email: string | null }>();
        const rolesById = new Map<string, string | null>();

        if (userIds.length > 0) {
            const [{ data: profRows, error: profErr }, { data: membershipRows, error: membershipErr }] = await Promise.all([
                supabase.from('profiles').select('id,full_name,email').in('id', userIds),
                supabase
                    .from('tenant_memberships')
                    .select('user_id, roles(name), membership_roles(revoked_at, roles(name))')
                    .eq('tenant_id', agencyTenantId)
                    .in('user_id', userIds)
                    .eq('status', 'active'),
            ]);
            if (profErr) throw profErr;
            if (membershipErr) throw membershipErr;

            for (const p of profRows || []) {
                profilesById.set(p.id as string, {
                    full_name: (p as any).full_name ?? null,
                    email: (p as any).email ?? null,
                });
            }
            for (const m of membershipRows || []) {
                const uid = (m as { user_id: string }).user_id;
                const primaryName = (m as { roles?: { name?: string } | null }).roles?.name ?? null;
                const mrList = ((m as { membership_roles?: Array<{ revoked_at: string | null; roles?: { name?: string } | null }> })
                    .membership_roles || []
                ).filter((mr) => !mr.revoked_at && mr.roles?.name);
                const fromMr = mrList.map((mr) => mr.roles!.name as string);
                const combined =
                    fromMr.length > 0
                        ? Array.from(new Set(fromMr))
                              .sort((a, b) => a.localeCompare(b))
                              .join(', ')
                        : primaryName;
                rolesById.set(uid, combined ?? null);
            }
        }

        const data = rows.map((r: any) => ({
            seller_tenant_id: r.seller_tenant_id,
            user_id: r.user_id,
            full_name: profilesById.get(r.user_id)?.full_name ?? null,
            email: profilesById.get(r.user_id)?.email ?? null,
            role_name: rolesById.get(r.user_id) ?? null,
        }));

        res.json({ success: true, data });
    } catch (e: any) {
        console.error('[team] agency-seller-assignments', e);
        res.status(500).json({ success: false, error: e.message || 'Internal error' });
    }
});

/**
 * GET /api/team/profile-search?tenantId=&q=
 * Tenant admins (agency/seller) and platform admins: search profiles by email or name.
 */
router.get('/profile-search', async (req, res) => {
    try {
        const actorId = await resolveRequestUserId(req);
        if (!actorId) {
            res.status(401).json({ success: false, error: 'Authorization required' });
            return;
        }

        const tenantId = typeof req.query.tenantId === 'string' ? req.query.tenantId : '';
        if (!UUID_RE.test(tenantId)) {
            res.status(400).json({ success: false, error: 'Valid tenantId is required' });
            return;
        }

        const rawQ = typeof req.query.q === 'string' ? req.query.q : '';
        const q = sanitizeIlikeQuery(rawQ);
        if (q.length < 2) {
            res.json({ success: true, data: [] });
            return;
        }

        const { data: allowed, error: permErr } = await supabase.rpc('user_can_manage_tenant_members', {
            p_tenant_id: tenantId,
            p_actor_id: actorId,
        });
        if (permErr) {
            console.error('[team] user_can_manage_tenant_members', permErr.message);
            res.status(500).json({ success: false, error: 'Permission check failed' });
            return;
        }
        if (allowed !== true) {
            res.status(403).json({ success: false, error: 'Access denied' });
            return;
        }

        const pattern = `%${q}%`;
        const [{ data: byEmail, error: e1 }, { data: byName, error: e2 }] = await Promise.all([
            supabase
                .from('profiles')
                .select('id, email, full_name')
                .ilike('email', pattern)
                .neq('role', 'admin')
                .limit(20),
            supabase
                .from('profiles')
                .select('id, email, full_name')
                .ilike('full_name', pattern)
                .neq('role', 'admin')
                .limit(20),
        ]);
        if (e1 || e2) {
            const err = e1 || e2;
            console.error('[team] profile search', err!.message);
            res.status(500).json({ success: false, error: err!.message });
            return;
        }
        const merged = new Map<string, { id: string; email: string; full_name: string | null }>();
        for (const r of [...(byEmail ?? []), ...(byName ?? [])]) {
            merged.set(r.id, r as { id: string; email: string; full_name: string | null });
        }

        // Exclude platform Super Admins (they hold a platform-scoped role, not assignable to tenants)
        const candidateIds = Array.from(merged.keys());
        if (candidateIds.length > 0) {
            const { data: superAdminRows } = await supabase
                .from('tenant_memberships')
                .select('user_id, tenants!inner(type), roles!inner(name)')
                .in('user_id', candidateIds)
                .eq('tenants.type', 'platform')
                .eq('roles.name', 'Super Admin')
                .eq('status', 'active');
            const superAdminIds = new Set((superAdminRows ?? []).map((r: any) => r.user_id));
            for (const id of superAdminIds) {
                merged.delete(id);
            }
        }

        res.json({ success: true, data: Array.from(merged.values()).slice(0, 20) });
    } catch (e: any) {
        console.error('[team] profile-search', e);
        res.status(500).json({ success: false, error: e.message || 'Internal error' });
    }
});

/**
 * GET /api/team/seller-search?agencyTenantId=&q=
 * Agency admins/super admins: search seller tenants by name or id.
 * Returns only sellers that are unlinked or already linked to this agency.
 */
router.get('/seller-search', async (req, res) => {
    try {
        const actorId = await resolveRequestUserId(req);
        if (!actorId) {
            res.status(401).json({ success: false, error: 'Authorization required' });
            return;
        }

        const agencyTenantId = typeof req.query.agencyTenantId === 'string' ? req.query.agencyTenantId.trim() : '';
        if (!UUID_RE.test(agencyTenantId)) {
            res.status(400).json({ success: false, error: 'Valid agencyTenantId is required' });
            return;
        }

        const rawQ = typeof req.query.q === 'string' ? req.query.q : '';
        const q = sanitizeIlikeQuery(rawQ);
        if (q.length < 2) {
            res.json({ success: true, data: [] });
            return;
        }

        const maySearch = await actorMaySearchSellersForAgency(actorId, agencyTenantId);
        if (!maySearch) {
            res.status(403).json({ success: false, error: 'Access denied' });
            return;
        }

        const pattern = `%${q}%`;
        const [nameSearch, uuidSearch] = await Promise.all([
            supabase
                .from('tenants')
                .select('id, name, status, parent_tenant_id, type')
                .eq('type', 'seller')
                .ilike('name', pattern)
                .order('name')
                .limit(20),
            UUID_RE.test(q)
                ? supabase
                      .from('tenants')
                      .select('id, name, status, parent_tenant_id, type')
                      .eq('type', 'seller')
                      .eq('id', q)
                      .limit(1)
                : Promise.resolve({ data: [], error: null } as { data: any[]; error: null }),
        ]);

        if (nameSearch.error || uuidSearch.error) {
            const err = nameSearch.error || uuidSearch.error;
            console.error('[team] seller-search', err?.message);
            res.status(500).json({ success: false, error: 'Seller search failed' });
            return;
        }

        const merged = new Map<string, any>();
        for (const row of [...(nameSearch.data || []), ...(uuidSearch.data || [])]) {
            merged.set(row.id, row);
        }

        const data = Array.from(merged.values())
            .map((row: any) => ({
                id: row.id as string,
                name: (row.name as string) || 'Unnamed seller',
                status: (row.status as string) || null,
                parent_tenant_id: (row.parent_tenant_id as string | null) ?? null,
                already_linked: row.parent_tenant_id === agencyTenantId,
                linkable: !row.parent_tenant_id || row.parent_tenant_id === agencyTenantId,
                not_linkable_reason:
                    row.parent_tenant_id && row.parent_tenant_id !== agencyTenantId
                        ? 'already_linked_to_another_agency'
                        : null,
            }));

        res.json({ success: true, data });
    } catch (e: any) {
        console.error('[team] seller-search', e);
        res.status(500).json({ success: false, error: e.message || 'Internal error' });
    }
});

/**
 * POST /api/team/link-seller
 * body: { agencyTenantId, sellerTenantId }
 * Creates pending seller-link invitation and notifies Seller Admins.
 */
router.post('/link-seller', async (req, res) => {
    try {
        const actorId = await resolveRequestUserId(req);
        if (!actorId) {
            res.status(401).json({ success: false, error: 'Authorization required' });
            return;
        }

        const { agencyTenantId, sellerTenantId } = req.body ?? {};
        if (!UUID_RE.test(agencyTenantId) || !UUID_RE.test(sellerTenantId)) {
            res.status(400).json({ success: false, error: 'Valid agencyTenantId and sellerTenantId are required' });
            return;
        }

        const mayLink = await actorMayInitiateAgencySellerLink(actorId, agencyTenantId);
        if (!mayLink) {
            res.status(403).json({
                success: false,
                error: 'You need Agency Admin access or the “link/unlink sellers” permission for this agency',
            });
            return;
        }

        const { data: agencyRowCheck, error: agencyErr } = await supabase
            .from('tenants')
            .select('id, type, name')
            .eq('id', agencyTenantId)
            .maybeSingle();
        if (agencyErr || !agencyRowCheck || agencyRowCheck.type !== 'agency') {
            res.status(400).json({ success: false, error: 'Invalid agency tenant' });
            return;
        }

        const { data: sellerRowCheck, error: sellerErr } = await supabase
            .from('tenants')
            .select('id, type, name, parent_tenant_id, link_status')
            .eq('id', sellerTenantId)
            .maybeSingle();
        if (sellerErr || !sellerRowCheck || sellerRowCheck.type !== 'seller') {
            res.status(400).json({ success: false, error: 'Invalid seller tenant' });
            return;
        }
        if (
            sellerRowCheck.parent_tenant_id &&
            sellerRowCheck.parent_tenant_id !== agencyTenantId &&
            sellerRowCheck.link_status === 'active'
        ) {
            res.status(400).json({ success: false, error: 'Seller tenant already linked to another agency' });
            return;
        }

        // Already linked to this agency: keep/restore active state, do not create a new pending invite.
        if (sellerRowCheck.parent_tenant_id === agencyTenantId) {
            if (sellerRowCheck.link_status !== 'active') {
                const { error: restoreErr } = await supabase
                    .from('tenants')
                    .update({ link_status: 'active', updated_at: new Date().toISOString() })
                    .eq('id', sellerTenantId);
                if (restoreErr) {
                    console.error('[team] link-seller restore active', restoreErr.message);
                }
            }
            res.json({
                success: true,
                data: {
                    token: '',
                    notifiedSellerAdmins: 0,
                    alreadyLinked: true,
                },
            });
            return;
        }

        const invitationToken = randomUUID();
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        const { error: upsertErr } = await supabase
            .from('tenant_link_invitations')
            .upsert(
                {
                    agency_tenant_id: agencyTenantId,
                    seller_tenant_id: sellerTenantId,
                    token: invitationToken,
                    invited_by_id: actorId,
                    expires_at: expiresAt,
                    accepted_at: null,
                },
                { onConflict: 'agency_tenant_id,seller_tenant_id' }
            );
        if (upsertErr) {
            console.error('[team] link-seller upsert invitation', upsertErr.message);
            res.status(400).json({ success: false, error: upsertErr.message || 'Failed to create seller link invitation' });
            return;
        }

        const { error: markPendingErr } = await supabase
            .from('tenants')
            .update({ link_status: 'pending', updated_at: new Date().toISOString() })
            .eq('id', sellerTenantId);
        if (markPendingErr) {
            console.error('[team] link-seller mark pending', markPendingErr.message);
            res.status(400).json({ success: false, error: markPendingErr.message || 'Failed to mark seller as pending' });
            return;
        }

        // App router mounts invitation UI at /accept-invitation; type=seller-link chooses seller-link flow.
        const acceptPath = `/accept-invitation?type=seller-link&token=${invitationToken}`;
        const acceptUrl = `${FRONTEND_URL}${acceptPath}`;
        const agencyName = typeof agencyRowCheck?.name === 'string' ? agencyRowCheck.name : 'Agency';
        const sellerName = typeof sellerRowCheck?.name === 'string' ? sellerRowCheck.name : 'Seller shop';

        const { data: sellerAdmins, error: adminsErr } = await supabase
            .from('tenant_memberships')
            .select('user_id, profiles!tenant_memberships_user_id_fkey(email), roles(name)')
            .eq('tenant_id', sellerTenantId)
            .eq('status', 'active');
        if (adminsErr) {
            console.error('[team] link-seller load seller admins', adminsErr.message);
        }

        const recipients = (sellerAdmins || []).filter((row: any) => row?.roles?.name === 'Seller Admin');
        for (const row of recipients) {
            const userId = row.user_id as string;
            const email = ((row.profiles as any)?.email || '').toString().trim().toLowerCase();

            // Avoid stacking identical pending-link notifications for the same action URL.
            const { error: cleanErr } = await supabase
                .from('user_notifications')
                .delete()
                .eq('user_id', userId)
                .eq('type', 'seller_link_invite')
                .eq('action_url', acceptPath);
            if (cleanErr) {
                console.warn('[team] link-seller cleanup previous notifications', cleanErr.message);
            }

            const { error: notifErr } = await supabase.rpc('create_user_notification', {
                p_user_id: userId,
                p_type: 'seller_link_invite',
                p_title: 'Agency Link Request',
                p_message: `${agencyName} requested to link ${sellerName}. Review and accept or decline.`,
                p_action_url: acceptPath,
            });
            if (notifErr) {
                console.error('[team] link-seller create_user_notification', notifErr.message);
            }

            if (email) {
                await sendSellerLinkInviteEmail(email, acceptUrl, agencyName, sellerName).catch((e: Error) => {
                    console.error('[team] link-seller send email', e?.message);
                });
            }
        }

        res.json({
            success: true,
            data: {
                token: invitationToken,
                notifiedSellerAdmins: recipients.length,
            },
        });
    } catch (e: any) {
        console.error('[team] link-seller', e);
        res.status(500).json({ success: false, error: e.message || 'Internal error' });
    }
});

/**
 * GET /api/team/pending-seller-links?agencyTenantId=
 * Returns pending seller-link invitations for one agency.
 */
router.get('/pending-seller-links', async (req, res) => {
    try {
        const actorId = await resolveRequestUserId(req);
        if (!actorId) {
            res.status(401).json({ success: false, error: 'Authorization required' });
            return;
        }

        const agencyTenantId = typeof req.query.agencyTenantId === 'string' ? req.query.agencyTenantId.trim() : '';
        if (!UUID_RE.test(agencyTenantId)) {
            res.status(400).json({ success: false, error: 'Valid agencyTenantId is required' });
            return;
        }

        const [{ data: isAgencyAdmin, error: aaErr }, { data: isPlatformSa, error: saErr }] = await Promise.all([
            supabase.rpc('user_is_agency_admin', {
                p_agency_tenant_id: agencyTenantId,
                p_user_id: actorId,
            }),
            supabase.rpc('user_is_platform_super_admin', {
                p_user_id: actorId,
            }),
        ]);
        if (aaErr || saErr) {
            console.error('[team] pending-seller-links permission', aaErr?.message || saErr?.message);
            res.status(500).json({ success: false, error: 'Permission check failed' });
            return;
        }
        if (isAgencyAdmin !== true && isPlatformSa !== true) {
            res.status(403).json({ success: false, error: 'Access denied' });
            return;
        }

        const { data: rows, error } = await supabase
            .from('tenant_link_invitations')
            .select('seller_tenant_id, token, expires_at, accepted_at, tenants!seller_tenant_id(id, name, type, status, parent_tenant_id, link_status)')
            .eq('agency_tenant_id', agencyTenantId)
            .is('accepted_at', null)
            .gt('expires_at', new Date().toISOString())
            .order('created_at', { ascending: false });
        if (error) {
            console.error('[team] pending-seller-links', error.message);
            res.status(500).json({ success: false, error: 'Failed to load pending links' });
            return;
        }

        const data = (rows || [])
            .map((row: any) => {
                const seller = row?.tenants;
                if (!seller || seller.type !== 'seller') return null;
                return {
                    seller_tenant_id: seller.id as string,
                    seller_name: (seller.name as string) || 'Unnamed seller',
                    seller_status: (seller.status as string) || null,
                    parent_tenant_id: (seller.parent_tenant_id as string | null) ?? null,
                    link_status: 'pending' as const,
                    token: row.token as string,
                    expires_at: row.expires_at as string,
                };
            })
            .filter(Boolean);

        res.json({ success: true, data });
    } catch (e: any) {
        console.error('[team] pending-seller-links', e);
        res.status(500).json({ success: false, error: e.message || 'Internal error' });
    }
});

/**
 * POST /api/team/invite-member
 * body: { tenantId, email, userId, roleId }
 * If the user already has a membership, it updates their role directly.
 * Otherwise, it creates a new membership as 'invited', generates a token, and emails them.
 */
router.post('/invite-member', async (req, res) => {
    try {
        const actorId = await resolveRequestUserId(req);
        if (!actorId) {
            res.status(401).json({ success: false, error: 'Authorization required' });
            return;
        }

        const { tenantId, email, userId, roleId } = req.body ?? {};
        if (!UUID_RE.test(tenantId) || !UUID_RE.test(roleId)) {
            res.status(400).json({ success: false, error: 'Valid tenantId and roleId are required' });
            return;
        }

        let targetUserId: string | null = userId && UUID_RE.test(userId) ? userId : null;
        const normEmail = String(email ?? '').trim().toLowerCase();

        if (!targetUserId && (!normEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normEmail))) {
            res.status(400).json({ success: false, error: 'Valid email or userId is required' });
            return;
        }

        const { data: allowed, error: permErr } = await supabase.rpc('user_can_manage_tenant_members', {
            p_tenant_id: tenantId,
            p_actor_id: actorId,
        });
        if (permErr) {
            console.error('[team] invite permission', permErr.message);
            res.status(500).json({ success: false, error: 'Permission check failed' });
            return;
        }
        if (allowed !== true) {
            res.status(403).json({ success: false, error: 'Access denied' });
            return;
        }

        if (!targetUserId && normEmail) {
            const { data: existingProfile } = await supabase
                .from('profiles')
                .select('id')
                .ilike('email', normEmail)
                .maybeSingle();

            if (existingProfile?.id) {
                targetUserId = existingProfile.id;
            } else {
                targetUserId = await ensureAuthUserForTeamInvite(normEmail);
                if (!targetUserId) {
                    res.status(400).json({ success: false, error: 'Could not create or resolve user for this email' });
                    return;
                }
            }
        }

        if (!targetUserId) {
            res.status(500).json({ success: false, error: 'Could not resolve user for this email' });
            return;
        }

        // Block assigning tenant roles to platform admins or Super Admins
        const { data: targetProfile } = await supabase
            .from('profiles')
            .select('role, tenant_id')
            .eq('id', targetUserId)
            .maybeSingle();
        if (targetProfile?.role === 'admin') {
            res.status(400).json({ success: false, error: 'Platform admins cannot be assigned tenant roles' });
            return;
        }
        if (targetProfile?.tenant_id && targetProfile.tenant_id !== tenantId) {
            res.status(400).json({
                success: false,
                error:
                    'This user already belongs to a different tenant. Each account can only be linked to one tenant at a time. To move them here, go to Admin → Users, open their account, and use Transfer tenant membership.',
            });
            return;
        }
        const { data: isSuperAdmin } = await supabase.rpc('user_is_platform_super_admin', {
            p_user_id: targetUserId,
        });
        if (isSuperAdmin === true) {
            res.status(400).json({ success: false, error: 'Super Admins cannot be assigned tenant roles' });
            return;
        }

        if (normEmail && targetUserId) {
            const displayName = normEmail.split('@')[0] || 'User';
            const { error: upErr } = await supabase.from('profiles').upsert(
                {
                    id: targetUserId,
                    email: normEmail,
                    full_name: displayName,
                    role: 'client',
                },
                { onConflict: 'id' }
            );
            if (upErr) {
                console.error('[team] profile upsert', upErr.message);
                // Do not hard fail here if we were using userId and upsert failed
            }
        }

        const { data: existingMembership } = await supabase
            .from('tenant_memberships')
            .select('id, status')
            .eq('tenant_id', tenantId)
            .eq('user_id', targetUserId)
            .maybeSingle();

        // Re-send invite for first-time, declined, or still-pending invited members so
        // they always receive a fresh accept token + in-app notification + email.
        const needsInvitationFlow =
            !existingMembership ||
            existingMembership.status === 'declined' ||
            existingMembership.status === 'invited';

        const { data: membershipId, error: roleErr } = await supabase.rpc('tenant_set_member_role_for_actor', {
            p_actor_id: actorId,
            p_tenant_id: tenantId,
            p_target_user_id: targetUserId,
            p_role_id: roleId,
        });

        if (roleErr) {
            console.error('[team] tenant_set_member_role_for_actor', roleErr.message);
            res.status(400).json({ success: false, error: roleErr.message });
            return;
        }

        if (needsInvitationFlow) {
            // New row, or prior decline: create a fresh invitation token so the invitee can accept again
            const { data: invToken, error: invErr } = await supabase.rpc('create_membership_invitation', {
                p_membership_id: membershipId,
                p_invited_by_id: actorId,
            });
            if (invErr) {
                console.error('[team] create_membership_invitation', invErr.message);
                // Non-fatal — membership exists as 'invited', token just failed
            }

            // Send accept-invitation email
            if (invToken) {
                const acceptUrl = `${FRONTEND_URL}/accept-invitation?token=${invToken}`;
                const { data: tenantRow } = await supabase.from('tenants').select('name').eq('id', tenantId).maybeSingle();
                const tenantLabel = typeof tenantRow?.name === 'string' ? tenantRow.name : undefined;

                let emailForInvite = normEmail;
                if (!emailForInvite && targetUserId) {
                    const { data: prof } = await supabase
                        .from('profiles')
                        .select('email')
                        .eq('id', targetUserId)
                        .maybeSingle();
                    emailForInvite = (prof?.email || '').trim().toLowerCase();
                }

                // 1. Email notification (skip if we have no address — in-app notification still fires)
                if (emailForInvite) {
                    await sendInvitationEmail(emailForInvite, acceptUrl, tenantLabel).catch((e: Error) => {
                        console.error('[team] send invitation email', e?.message);
                    });
                }

                // 2. In-app Console Notification
                const { error: notifErr } = await supabase.rpc('create_user_notification', {
                    p_user_id: targetUserId,
                    p_type: 'team_invite',
                    p_title: 'Team Invitation',
                    p_message: 'You have been invited to join a team. Click here to review and accept.',
                    p_action_url: `/accept-invitation?token=${invToken}`
                });
                if (notifErr) {
                    console.error('[team] create_user_notification error:', notifErr.message);
                }
            }

            res.json({
                success: true,
                data: { userId: targetUserId, membershipId, invited: true }
            });
        } else {
            // Existing active/deactivated member — role updated, no invite notification round-trip
            res.json({
                success: true,
                data: { userId: targetUserId, membershipId, invited: false }
            });
        }
    } catch (e: any) {
        console.error('[team] invite-member', e);
        res.status(500).json({ success: false, error: e.message || 'Internal error' });
    }
});

/**
 * POST /api/team/accept-invitation
 * body: { token: string }
 * The logged-in user accepts their membership invitation.
 */
router.post('/accept-invitation', async (req, res) => {
    try {
        const actorId = await resolveRequestUserId(req);
        if (!actorId) {
            res.status(401).json({ success: false, error: 'Authorization required' });
            return;
        }
        const { token } = req.body ?? {};
        if (!token || !UUID_RE.test(token)) {
            res.status(400).json({ success: false, error: 'Valid token is required' });
            return;
        }
        const { data, error } = await supabase.rpc('accept_tenant_membership_invitation', { 
            p_actor_id: actorId,
            p_token: token 
        });
        if (error) {
            console.error('[team] accept_tenant_membership_invitation', error.message);
            res.status(400).json({ success: false, error: error.message });
            return;
        }
        res.json({ success: true, data });
    } catch (e: any) {
        console.error('[team] accept-invitation', e);
        res.status(500).json({ success: false, error: e.message || 'Internal error' });
    }
});

/**
 * POST /api/team/decline-invitation
 * body: { token: string }
 */
router.post('/decline-invitation', async (req, res) => {
    try {
        const actorId = await resolveRequestUserId(req);
        if (!actorId) {
            res.status(401).json({ success: false, error: 'Authorization required' });
            return;
        }
        const { token } = req.body ?? {};
        if (!token || !UUID_RE.test(token)) {
            res.status(400).json({ success: false, error: 'Valid token is required' });
            return;
        }
        const { error } = await supabase.rpc('decline_tenant_membership_invitation', { 
            p_actor_id: actorId,
            p_token: token 
        });
        if (error) {
            console.error('[team] decline_tenant_membership_invitation', error.message);
            res.status(400).json({ success: false, error: error.message });
            return;
        }
        res.json({ success: true });
    } catch (e: any) {
        console.error('[team] decline-invitation', e);
        res.status(500).json({ success: false, error: e.message || 'Internal error' });
    }
});

/**
 * GET /api/team/invitation-info?token=
 * Public endpoint: Returns display metadata for any invitation token.
 * Used by the /accept-invitation page before the user logs in.
 */
router.get('/invitation-info', async (req, res) => {
    try {
        const token = typeof req.query.token === 'string' ? req.query.token : '';
        if (!token || !UUID_RE.test(token)) {
            res.status(400).json({ success: false, error: 'Valid token is required' });
            return;
        }
        const { data, error } = await supabase.rpc('get_membership_invitation_by_token', { p_token: token });
        if (error) {
            res.status(404).json({ success: false, error: error.message });
            return;
        }
        res.json({ success: true, data });
    } catch (e: any) {
        console.error('[team] invitation-info', e);
        res.status(500).json({ success: false, error: e.message || 'Internal error' });
    }
});

/**
 * GET /api/team/seller-link-info?token=
 * Returns display metadata for a seller link invitation.
 */
router.get('/seller-link-info', async (req, res) => {
    try {
        const token = typeof req.query.token === 'string' ? req.query.token : '';
        if (!token || !UUID_RE.test(token)) {
            res.status(400).json({ success: false, error: 'Valid token is required' });
            return;
        }
        const { data, error } = await supabase.rpc('get_seller_link_invitation_by_token', { p_token: token });
        if (error) {
            res.status(404).json({ success: false, error: error.message });
            return;
        }
        res.json({ success: true, data });
    } catch (e: any) {
        console.error('[team] seller-link-info', e);
        res.status(500).json({ success: false, error: e.message || 'Internal error' });
    }
});

/**
 * POST /api/team/accept-seller-link
 * body: { token: string }
 * Seller Admin accepts a pending agency→seller link invitation.
 */
router.post('/accept-seller-link', async (req, res) => {
    try {
        const actorId = await resolveRequestUserId(req);
        if (!actorId) {
            res.status(401).json({ success: false, error: 'Authorization required' });
            return;
        }
        const { token } = req.body ?? {};
        if (!token || !UUID_RE.test(token)) {
            res.status(400).json({ success: false, error: 'Valid token is required' });
            return;
        }
        const { data, error } = await supabase.rpc('accept_seller_link_invitation', { 
            p_actor_id: actorId,
            p_token: token 
        });
        if (error) {
            console.error('[team] accept_seller_link_invitation', error.message);
            res.status(400).json({ success: false, error: error.message });
            return;
        }
        auditLog(req, {
            action: 'tenant.link_created',
            resourceType: 'tenant_link',
            resourceId: String(token),
            tenantId: data?.agency_tenant_id ?? null,
            metadata: {
                agencyTenantId: data?.agency_tenant_id ?? null,
                sellerTenantId: data?.seller_tenant_id ?? null,
                acceptedBy: actorId,
            },
        }).catch(() => undefined);

        res.json({ success: true, data });
    } catch (e: any) {
        console.error('[team] accept-seller-link', e);
        res.status(500).json({ success: false, error: e.message || 'Internal error' });
    }
});

/**
 * POST /api/team/decline-seller-link
 * body: { token: string }
 */
router.post('/decline-seller-link', async (req, res) => {
    try {
        const actorId = await resolveRequestUserId(req);
        if (!actorId) {
            res.status(401).json({ success: false, error: 'Authorization required' });
            return;
        }
        const { token } = req.body ?? {};
        if (!token || !UUID_RE.test(token)) {
            res.status(400).json({ success: false, error: 'Valid token is required' });
            return;
        }
        const { error } = await supabase.rpc('decline_seller_link_invitation', { 
            p_actor_id: actorId,
            p_token: token 
        });
        if (error) {
            console.error('[team] decline_seller_link_invitation', error.message);
            res.status(400).json({ success: false, error: error.message });
            return;
        }
        res.json({ success: true });
    } catch (e: any) {
        console.error('[team] decline-seller-link', e);
        res.status(500).json({ success: false, error: e.message || 'Internal error' });
    }
});

router.post('/unlink-seller', async (req, res) => {
    try {
        const actorId = await resolveRequestUserId(req);
        if (!actorId) {
            res.status(401).json({ success: false, error: 'Authorization required' });
            return;
        }

        const { agencyTenantId, sellerTenantId } = req.body ?? {};
        if (!UUID_RE.test(agencyTenantId) || !UUID_RE.test(sellerTenantId)) {
            res.status(400).json({ success: false, error: 'Valid agencyTenantId and sellerTenantId are required' });
            return;
        }

        let allowed = false;

        const mayAgencyUnlink = await actorMayInitiateAgencySellerLink(actorId, agencyTenantId);
        if (mayAgencyUnlink) allowed = true;

        if (!allowed) {
            const { data: isSellerAdmin } = await supabase.rpc('user_can_manage_tenant_members', {
                p_tenant_id: sellerTenantId,
                p_actor_id: actorId,
            });
            if (isSellerAdmin === true) allowed = true;
        }

        if (!allowed) {
            const { data: isPlatformSa, error: saErr } = await supabase.rpc('user_is_platform_super_admin', {
                p_user_id: actorId,
            });
            if (saErr) console.error('[team] unlink-seller user_is_platform_super_admin', saErr.message);
            if (isPlatformSa === true) allowed = true;
        }

        if (!allowed) {
            const { data: profile } = await supabase.from('profiles').select('role').eq('id', actorId).maybeSingle();
            if (profile?.role === 'admin') allowed = true;
        }

        if (!allowed) {
            res.status(403).json({
                success: false,
                error:
                    'Agency unlink requires Agency Admin, delegated “link/unlink sellers”, Seller Admin on the seller, or Super Admin',
            });
            return;
        }

        await unlinkSellerFromAgencyLifecycle(agencyTenantId, sellerTenantId, actorId);

        auditLog(req, {
            action: 'tenant.link_revoked',
            resourceType: 'tenant_link',
            resourceId: `${agencyTenantId}:${sellerTenantId}`,
            tenantId: agencyTenantId,
            metadata: {
                agencyTenantId,
                sellerTenantId,
                revokedBy: actorId,
                source: 'team.unlink-seller',
            },
        }).catch(() => undefined);

        res.json({ success: true });
    } catch (e: any) {
        console.error('[team] unlink-seller', e);
        res.status(500).json({ success: false, error: e.message || 'Internal error' });
    }
});

/**
 * POST /api/team/unassign-seller-access
 * body: { agencyTenantId, sellerTenantId, staffUserId }
 * Removes one AM/AC assignment to one linked seller.
 */
router.post('/unassign-seller-access', async (req, res) => {
    try {
        const actorId = await resolveRequestUserId(req);
        if (!actorId) {
            res.status(401).json({ success: false, error: 'Authorization required' });
            return;
        }

        const { agencyTenantId, sellerTenantId, staffUserId } = req.body ?? {};
        if (!UUID_RE.test(agencyTenantId) || !UUID_RE.test(sellerTenantId) || !UUID_RE.test(staffUserId)) {
            res.status(400).json({ success: false, error: 'Valid agencyTenantId, sellerTenantId, and staffUserId are required' });
            return;
        }

        let actorIsAgencyAdmin = false;
        let actorIsAccountManager = false;

        const { data: isAgencyAdmin } = await supabase.rpc('user_is_agency_admin', {
            p_agency_tenant_id: agencyTenantId,
            p_user_id: actorId,
        });
        actorIsAgencyAdmin = isAgencyAdmin === true;

        if (!actorIsAgencyAdmin) {
            const { data: amMembership } = await supabase
                .from('tenant_memberships')
                .select('id')
                .eq('tenant_id', agencyTenantId)
                .eq('user_id', actorId)
                .eq('status', 'active')
                .in(
                    'role_id',
                    (
                        await supabase
                            .from('roles')
                            .select('id')
                            .is('tenant_id', null)
                            .eq('name', 'Account Manager')
                    ).data?.map((r: any) => r.id) || ['00000000-0000-0000-0000-000000000000']
                )
                .maybeSingle();
            actorIsAccountManager = !!amMembership?.id;
        }

        if (!actorIsAgencyAdmin && !actorIsAccountManager) {
            res.status(403).json({ success: false, error: 'Only Agency Admin or Account Manager can unassign seller access' });
            return;
        }

        // Seller must belong to this agency
        const { data: seller } = await supabase
            .from('tenants')
            .select('id')
            .eq('id', sellerTenantId)
            .eq('type', 'seller')
            .eq('parent_tenant_id', agencyTenantId)
            .maybeSingle();
        if (!seller) {
            res.status(400).json({ success: false, error: 'Seller is not linked to this agency' });
            return;
        }

        // Staff target role check
        const { data: targetMembership } = await supabase
            .from('tenant_memberships')
            .select('id, roles(name)')
            .eq('tenant_id', agencyTenantId)
            .eq('user_id', staffUserId)
            .eq('status', 'active')
            .maybeSingle();
        const targetRoleName = (targetMembership as any)?.roles?.name as string | undefined;
        if (!targetMembership?.id || !targetRoleName || !['Account Manager', 'Account Coordinator'].includes(targetRoleName)) {
            res.status(400).json({ success: false, error: 'Target user is not an active AM/AC member of this agency' });
            return;
        }

        // AM restriction: can only unassign coordinators from sellers within AM scope
        if (actorIsAccountManager && !actorIsAgencyAdmin) {
            if (targetRoleName !== 'Account Coordinator') {
                res.status(403).json({ success: false, error: 'Account Managers can only unassign Account Coordinators' });
                return;
            }

            const { data: actorScopeRow } = await supabase
                .from('user_seller_assignments')
                .select('id')
                .eq('agency_tenant_id', agencyTenantId)
                .eq('seller_tenant_id', sellerTenantId)
                .eq('user_id', actorId)
                .maybeSingle();
            if (!actorScopeRow?.id) {
                res.status(403).json({ success: false, error: 'Account Managers can only unassign sellers from their own scope' });
                return;
            }
        }

        const { error: delErr } = await supabase
            .from('user_seller_assignments')
            .delete()
            .eq('agency_tenant_id', agencyTenantId)
            .eq('seller_tenant_id', sellerTenantId)
            .eq('user_id', staffUserId);
        if (delErr) throw delErr;

        auditLog(req, {
            action: 'assignment.seller_unassigned',
            resourceType: 'seller_assignment',
            resourceId: `${agencyTenantId}:${sellerTenantId}:${staffUserId}`,
            tenantId: agencyTenantId,
            metadata: {
                agencyTenantId,
                sellerTenantId,
                staffUserId,
                unassignedBy: actorId,
            },
        }).catch(() => undefined);

        res.json({ success: true });
    } catch (e: any) {
        console.error('[team] unassign-seller-access', e);
        res.status(500).json({ success: false, error: e.message || 'Internal error' });
    }
});

/**
 * GET /api/team/member-roles?tenantId=&userId=
 * Returns active role assignments for a tenant member (membership_roles).
 */
router.get('/member-roles', async (req, res) => {
    try {
        const actorId = await resolveRequestUserId(req);
        if (!actorId) {
            res.status(401).json({ success: false, error: 'Authorization required' });
            return;
        }

        const tenantId = typeof req.query.tenantId === 'string' ? req.query.tenantId : '';
        const userId = typeof req.query.userId === 'string' ? req.query.userId : '';
        if (!UUID_RE.test(tenantId) || !UUID_RE.test(userId)) {
            res.status(400).json({ success: false, error: 'Valid tenantId and userId are required' });
            return;
        }

        const { data: canManage, error: canManageErr } = await supabase.rpc('user_can_manage_tenant_members', {
            p_tenant_id: tenantId,
            p_actor_id: actorId,
        });
        if (canManageErr) throw canManageErr;

        let allowed = canManage === true;
        if (!allowed) {
            const { data: isSa } = await supabase.rpc('user_is_platform_super_admin', { p_user_id: actorId });
            if (isSa === true) allowed = true;
        }
        if (!allowed) {
            const { data: profile } = await supabase.from('profiles').select('role').eq('id', actorId).maybeSingle();
            if (profile?.role === 'admin') allowed = true;
        }

        if (!allowed) {
            res.status(403).json({ success: false, error: 'Access denied' });
            return;
        }

        const { data: membership, error: membershipErr } = await supabase
            .from('tenant_memberships')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq('user_id', userId)
            .eq('status', 'active')
            .maybeSingle();
        if (membershipErr) throw membershipErr;
        if (!membership?.id) {
            res.json({ success: true, data: [] });
            return;
        }

        const { data: roles, error: rolesErr } = await supabase
            .from('membership_roles')
            .select('role_id, roles(name)')
            .eq('membership_id', membership.id)
            .is('revoked_at', null);
        if (rolesErr) throw rolesErr;

        res.json({
            success: true,
            data: (roles || []).map((r: any) => ({
                role_id: r.role_id,
                role_name: r.roles?.name || null,
            })),
        });
    } catch (e: any) {
        console.error('[team] member-roles', e);
        res.status(500).json({ success: false, error: e.message || 'Internal error' });
    }
});

/**
 * GET /api/team/tenant-member-roles?tenantId=
 * Returns active roles grouped by user_id for one tenant.
 */
router.get('/tenant-member-roles', async (req, res) => {
    try {
        const actorId = await resolveRequestUserId(req);
        if (!actorId) {
            res.status(401).json({ success: false, error: 'Authorization required' });
            return;
        }

        const tenantId = typeof req.query.tenantId === 'string' ? req.query.tenantId : '';
        if (!UUID_RE.test(tenantId)) {
            res.status(400).json({ success: false, error: 'Valid tenantId is required' });
            return;
        }

        const { data: canManage, error: canManageErr } = await supabase.rpc('user_can_manage_tenant_members', {
            p_tenant_id: tenantId,
            p_actor_id: actorId,
        });
        if (canManageErr) throw canManageErr;

        let allowed = canManage === true;
        if (!allowed) {
            const { data: isSa } = await supabase.rpc('user_is_platform_super_admin', { p_user_id: actorId });
            if (isSa === true) allowed = true;
        }
        if (!allowed) {
            const { data: profile } = await supabase.from('profiles').select('role').eq('id', actorId).maybeSingle();
            if (profile?.role === 'admin') allowed = true;
        }
        /**
         * Read-only aggregate of member roles: anyone who can *see* the tenant (Agency Admin,
         * Seller Admin, AM/AC with assignments, Super Admin, legacy admin) may load it for the
         * Teams UI — not only users who can *manage* memberships.
         */
        if (!allowed) {
            const { data: canSee, error: visErr } = await supabase.rpc('tenant_is_visible_to_user', {
                p_tenant_id: tenantId,
                p_user_id: actorId,
            });
            if (!visErr && canSee === true) {
                allowed = true;
            } else if (visErr) {
                console.warn('[team] tenant-member-roles tenant_is_visible_to_user', visErr.message);
            }
        }
        if (!allowed) {
            res.status(403).json({ success: false, error: 'Access denied' });
            return;
        }

        const { data: rows, error: rowsErr } = await supabase
            .from('tenant_memberships')
            .select('user_id, membership_roles!inner(revoked_at, roles(name))')
            .eq('tenant_id', tenantId)
            .eq('status', 'active')
            .is('membership_roles.revoked_at', null);
        if (rowsErr) throw rowsErr;

        const grouped = new Map<string, string[]>();
        for (const row of rows || []) {
            const uid = (row as any).user_id as string;
            const rel = (row as any).membership_roles;
            const roleRows = Array.isArray(rel) ? rel : rel ? [rel] : [];
            const existing = grouped.get(uid) || [];
            for (const rr of roleRows) {
                const name = rr?.roles?.name as string | undefined;
                if (name && !existing.includes(name)) existing.push(name);
            }
            grouped.set(uid, existing);
        }

        res.json({
            success: true,
            data: Array.from(grouped.entries()).map(([user_id, role_names]) => ({ user_id, role_names })),
        });
    } catch (e: any) {
        console.error('[team] tenant-member-roles', e);
        res.status(500).json({ success: false, error: e.message || 'Internal error' });
    }
});

/**
 * POST /api/team/member-roles/sync
 * body: { tenantId, userId, roleIds[] } - replaces active membership_roles set.
 */
router.post('/member-roles/sync', async (req, res) => {
    try {
        const actorId = await resolveRequestUserId(req);
        if (!actorId) {
            res.status(401).json({ success: false, error: 'Authorization required' });
            return;
        }

        const { tenantId, userId, roleIds } = req.body ?? {};
        const normalizedRoleIds: string[] = Array.isArray(roleIds) ? roleIds.filter((v) => typeof v === 'string' && UUID_RE.test(v)) : [];
        if (!UUID_RE.test(tenantId) || !UUID_RE.test(userId)) {
            res.status(400).json({ success: false, error: 'Valid tenantId and userId are required' });
            return;
        }
        if (normalizedRoleIds.length === 0) {
            res.status(400).json({ success: false, error: 'At least one role is required' });
            return;
        }

        const { data: canManage, error: canManageErr } = await supabase.rpc('user_can_manage_tenant_members', {
            p_tenant_id: tenantId,
            p_actor_id: actorId,
        });
        if (canManageErr) throw canManageErr;

        let allowed = canManage === true;
        if (!allowed) {
            const { data: isSa } = await supabase.rpc('user_is_platform_super_admin', { p_user_id: actorId });
            if (isSa === true) allowed = true;
        }
        if (!allowed) {
            const { data: profile } = await supabase.from('profiles').select('role').eq('id', actorId).maybeSingle();
            if (profile?.role === 'admin') allowed = true;
        }
        if (!allowed) {
            res.status(403).json({ success: false, error: 'Access denied' });
            return;
        }

        const { data: membership, error: membershipErr } = await supabase
            .from('tenant_memberships')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq('user_id', userId)
            .eq('status', 'active')
            .maybeSingle();
        if (membershipErr) throw membershipErr;
        if (!membership?.id) {
            res.status(404).json({ success: false, error: 'Active tenant membership not found for user' });
            return;
        }

        const { data: validRoles, error: validRolesErr } = await supabase
            .from('roles')
            .select('id, name')
            .in('id', normalizedRoleIds)
            .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
            .is('deleted_at', null);
        if (validRolesErr) throw validRolesErr;
        const validRoleIds = new Set((validRoles || []).map((r: any) => r.id as string));

        const selectedSuperAdmin = (validRoles || []).some((r: any) => r?.name === 'Super Admin');
        if (selectedSuperAdmin) {
            res.status(400).json({ success: false, error: 'Super Admin role cannot be assigned to tenant memberships' });
            return;
        }

        if (validRoleIds.size !== normalizedRoleIds.length) {
            res.status(400).json({ success: false, error: 'One or more selected roles are invalid for this tenant' });
            return;
        }

        const { data: currentRows, error: currentErr } = await supabase
            .from('membership_roles')
            .select('id, role_id')
            .eq('membership_id', membership.id)
            .is('revoked_at', null);
        if (currentErr) throw currentErr;

        const currentByRoleId = new Map<string, any>((currentRows || []).map((r: any) => [r.role_id, r]));
        const toInsert = normalizedRoleIds.filter((rid) => !currentByRoleId.has(rid));
        const toRevoke = (currentRows || []).filter((r: any) => !validRoleIds.has(r.role_id));

        // Insert first, revoke second:
        // avoids transient "no active roles" states that can trigger primary-role sync
        // to null and violate tenant_memberships.role_id NOT NULL.
        if (toInsert.length > 0) {
            const now = new Date().toISOString();
            const payload = toInsert.map((rid) => ({
                membership_id: membership.id,
                role_id: rid,
                granted_by: actorId,
                created_at: now,
                snapshot_json: { source: 'api.team.member_roles.sync', actor_id: actorId },
            }));
            const { error: insertErr } = await supabase.from('membership_roles').insert(payload);
            if (insertErr) throw insertErr;
        }

        if (toRevoke.length > 0) {
            const revokeIds = toRevoke.map((r: any) => r.id);
            const { error: revokeErr } = await supabase
                .from('membership_roles')
                .update({ revoked_at: new Date().toISOString() })
                .in('id', revokeIds);
            if (revokeErr) throw revokeErr;
        }

        auditLog(req, {
            action: 'role.assignment_update',
            resourceType: 'membership_role',
            resourceId: membership.id,
            tenantId,
            metadata: {
                actorId,
                targetUserId: userId,
                roleIds: normalizedRoleIds,
                inserted: toInsert.length,
                revoked: toRevoke.length,
            },
        }).catch(() => undefined);

        res.json({
            success: true,
            data: {
                membershipId: membership.id,
                roleIds: normalizedRoleIds,
                inserted: toInsert.length,
                revoked: toRevoke.length,
            },
        });
    } catch (e: any) {
        console.error('[team] member-roles/sync', e);
        res.status(500).json({ success: false, error: e.message || 'Internal error' });
    }
});

/**
 * PATCH /api/team/agency-tenant/:tenantId
 * body: { name?: string, status?: 'active' | 'inactive' | 'suspended' }
 * Allowed: Agency Admin for that agency, or platform Super Admin (incl. legacy profiles.role = admin).
 */
router.patch('/agency-tenant/:tenantId', async (req, res) => {
    try {
        const tenantId = req.params.tenantId;
        const actorId = await resolveRequestUserId(req);
        if (!actorId) {
            res.status(401).json({ success: false, error: 'Authorization required' });
            return;
        }
        if (!UUID_RE.test(tenantId)) {
            res.status(400).json({ success: false, error: 'Valid tenantId is required' });
            return;
        }

        let canEdit = false;
        const { data: isAgencyAdmin, error: aaErr } = await supabase.rpc('user_is_agency_admin', {
            p_agency_tenant_id: tenantId,
            p_user_id: actorId,
        });
        if (aaErr) {
            console.error('[team] user_is_agency_admin', aaErr.message);
            res.status(500).json({ success: false, error: 'Permission check failed' });
            return;
        }
        if (isAgencyAdmin === true) {
            canEdit = true;
        }
        if (!canEdit) {
            const { data: isSa, error: saErr } = await supabase.rpc('user_is_platform_super_admin', {
                p_user_id: actorId,
            });
            if (saErr) {
                console.error('[team] user_is_platform_super_admin', saErr.message);
                res.status(500).json({ success: false, error: 'Permission check failed' });
                return;
            }
            if (isSa === true) {
                canEdit = true;
            }
        }
        if (!canEdit) {
            const { data: profile } = await supabase.from('profiles').select('role').eq('id', actorId).maybeSingle();
            if (profile?.role === 'admin') {
                canEdit = true;
            }
        }
        if (!canEdit) {
            res.status(403).json({ success: false, error: 'Super Admin or Agency Admin access required' });
            return;
        }

        const { data: tenant, error: tErr } = await supabase.from('tenants').select('id, type').eq('id', tenantId).maybeSingle();
        if (tErr) throw tErr;
        if (!tenant || (tenant as any).type !== 'agency') {
            res.status(400).json({ success: false, error: 'Not an agency tenant' });
            return;
        }

        const { name, status } = req.body ?? {};
        const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (name !== undefined) {
            const n = String(name).trim();
            if (!n) {
                res.status(400).json({ success: false, error: 'Name cannot be empty' });
                return;
            }
            updates.name = n.slice(0, 200);
        }
        if (status !== undefined) {
            const s = String(status).toLowerCase();
            if (!['active', 'inactive', 'suspended'].includes(s)) {
                res.status(400).json({ success: false, error: 'Invalid status' });
                return;
            }
            updates.status = s;
        }
        if (Object.keys(updates).length === 1) {
            res.status(400).json({ success: false, error: 'No valid fields to update' });
            return;
        }

        const { data: row, error: uErr } = await supabase.from('tenants').update(updates).eq('id', tenantId).select().single();
        if (uErr) throw uErr;

        const lifecycle = tenantStatusTriggersLifecycle('agency', (updates.status as string | undefined) ?? null);
        if (lifecycle.deactivateAgency) {
            await deactivateAgencyLifecycle(tenantId, actorId);
        }

        res.json({ success: true, data: row });
    } catch (e: any) {
        console.error('[team] agency-tenant PATCH', e);
        res.status(500).json({ success: false, error: e.message || 'Internal error' });
    }
});

export default router;
