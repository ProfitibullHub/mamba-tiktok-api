import express from 'express';
import { supabase } from '../config/supabase.js';
import { resolveRequestUserId } from '../middleware/account-access.middleware.js';

const router = express.Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Send an invitation email with an accept link.
 * Uses Resend API if RESEND_API_KEY is set; otherwise logs to console
 * (in production you should configure RESEND_API_KEY or swap for any email provider).
 */
async function sendInvitationEmail(toEmail: string, acceptUrl: string): Promise<void> {
    const resendKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.INVITE_FROM_EMAIL || 'noreply@mamba.app';

    const subject = 'You have been invited to join a team on Mamba';
    const html = `
        <div style="font-family:Inter,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
            <h2 style="color:#fff;margin-bottom:8px;">You're invited! 🎉</h2>
            <p style="color:#aaa;margin-bottom:24px;">
                You have been invited to join a team on <strong style="color:#fff;">Mamba</strong>.
                Click the button below to review and accept the invitation.
            </p>
            <a href="${acceptUrl}"
               style="display:inline-block;background:#4f46e5;color:#fff;padding:12px 28px;
                      border-radius:8px;text-decoration:none;font-weight:bold;font-size:15px;">
                Accept Invitation
            </a>
            <p style="color:#555;font-size:12px;margin-top:20px;">
                This link expires in 7 days. If you did not expect this invitation, you may safely ignore this email.
            </p>
        </div>`;

    if (resendKey) {
        const resp = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${resendKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ from: fromEmail, to: toEmail, subject, html }),
        });
        if (!resp.ok) {
            const err = await resp.text().catch(() => 'unknown error');
            throw new Error(`Resend API error: ${err}`);
        }
        return;
    }

    // Fallback: log the accept link so developers can test locally
    console.log(`[team] invitation email (no RESEND_API_KEY set):`);
    console.log(`  To: ${toEmail}`);
    console.log(`  Accept URL: ${acceptUrl}`);
}

function sanitizeIlikeQuery(q: string): string {
    return q.replace(/[%_\\]/g, '').trim().slice(0, 80);
}

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

        let sentNewInvite = false;

        if (!targetUserId && normEmail) {
            const { data: existingProfile } = await supabase
                .from('profiles')
                .select('id')
                .ilike('email', normEmail)
                .maybeSingle();

            if (existingProfile?.id) {
                targetUserId = existingProfile.id;
            } else {
                const redirectTo =
                    (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '') + '/';

                const inv = await supabase.auth.admin.inviteUserByEmail(normEmail, {
                    redirectTo,
                });

                if (inv.error) {
                    const msg = inv.error.message || '';
                    if (/already registered|already been registered/i.test(msg)) {
                        const list = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
                        const found = list.data?.users?.find(
                            (u) => (u.email || '').toLowerCase() === normEmail
                        );
                        if (found?.id) {
                            targetUserId = found.id;
                        }
                    }
                    if (!targetUserId) {
                        res.status(400).json({ success: false, error: inv.error.message || 'Invite failed' });
                        return;
                    }
                } else if (inv.data?.user?.id) {
                    targetUserId = inv.data.user.id;
                    sentNewInvite = true;
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
            .select('role')
            .eq('id', targetUserId)
            .maybeSingle();
        if (targetProfile?.role === 'admin') {
            res.status(400).json({ success: false, error: 'Platform admins cannot be assigned tenant roles' });
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

        const needsInvitationFlow =
            !existingMembership || existingMembership.status === 'declined';

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
                const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
                const acceptUrl = `${frontendUrl}/accept-invitation?token=${invToken}`;

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
                    await sendInvitationEmail(emailForInvite, acceptUrl).catch((e: Error) => {
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
            // Existing member (active, invited pending, or deactivated) — role updated, no new invite round-trip
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

        res.json({ success: true, data: row });
    } catch (e: any) {
        console.error('[team] agency-tenant PATCH', e);
        res.status(500).json({ success: false, error: e.message || 'Internal error' });
    }
});

export default router;
