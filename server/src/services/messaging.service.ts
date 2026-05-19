import { supabase } from '../config/supabase.js';
import { sendHtmlEmail } from './email.js';
import { userIsPlatformSuperAdmin } from '../middleware/account-access.middleware.js';

const HTML_TAG_RE = /<[^>]*>/g;

const UUID_LIKE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function plainTextToEmailHtml(text: string): string {
    const trimmed = text.trim();
    if (!trimmed) return '<p></p>';
    const escaped = trimmed
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    return `<p>${escaped.replace(/\r\n|\n|\r/g, '<br/>')}</p>`;
}

export function htmlToPlainSnippet(html: string, maxLen = 65535): string {
    const plain = html.replace(HTML_TAG_RE, ' ').replace(/\s+/g, ' ').trim();
    return plain.length > maxLen ? plain.slice(0, maxLen) : plain;
}

/** Pull email from RFC-style `Name <a@b>` or bare address. */
export function parseEmailAddress(fromField: string): string {
    const t = fromField.trim();
    const lastLt = t.lastIndexOf('<');
    if (lastLt >= 0 && t.endsWith('>')) {
        return t.slice(lastLt + 1, -1).trim().toLowerCase();
    }
    return t.toLowerCase();
}

export async function rpcMessagingSellerVisible(
    sellerTenantId: string,
    userId: string,
): Promise<boolean> {
    /**
     * Platform super admins always see every seller. Short-circuit before the RPC so this
     * works even if the inner `user_is_platform_super_admin` SECURITY DEFINER call can't run
     * for the API's service-role client (e.g. the GRANT EXECUTE migration hasn't been
     * applied yet, or the function was changed and the RPC chain is briefly broken).
     */
    try {
        if (await userIsPlatformSuperAdmin(userId)) return true;
    } catch (e) {
        console.warn('[messaging] super-admin short-circuit failed; falling back to RPC', e);
    }

    const { data, error } = await supabase.rpc('messaging_seller_visible_to_user', {
        p_seller_tenant_id: sellerTenantId,
        p_user_id: userId,
    });
    if (error) {
        console.error('[messaging.messaging_seller_visible_to_user]', error.message);
        return false;
    }
    return data === true;
}

export type SellerAgencyOutboundEmails = {
    toEmail: string;
    bccEmails: string[];
    /** GHL contact upsert / threading anchor — first mailbox in the list. */
    contactUpsert: string;
};

/**
 * Load ordered recipient user ids for agency→seller email; empty array if unset (use legacy rule).
 */
export async function getSellerMessagingRecipientUserIds(sellerTenantId: string): Promise<string[]> {
    const { data, error } = await supabase
        .from('seller_messaging_settings')
        .select('recipient_user_ids')
        .eq('seller_tenant_id', sellerTenantId)
        .maybeSingle();
    if (error) {
        console.error('[messaging] getSellerMessagingRecipientUserIds', error.message);
        return [];
    }
    const raw = data?.recipient_user_ids;
    if (!Array.isArray(raw)) return [];
    return raw.filter((id: unknown): id is string => typeof id === 'string' && UUID_LIKE.test(id));
}

/**
 * Map configured user ids → verified lowercased emails (active seller membership, deduped by email, order preserved).
 */
export async function resolveEmailsForSellerRecipientUserIds(
    sellerTenantId: string,
    userIds: string[],
): Promise<string[]> {
    if (userIds.length === 0) return [];
    const uniqueIds = [...new Set(userIds.filter((id) => UUID_LIKE.test(id)))];
    if (uniqueIds.length === 0) return [];

    const { data: memberships, error: mErr } = await supabase
        .from('tenant_memberships')
        .select('user_id')
        .eq('tenant_id', sellerTenantId)
        .eq('status', 'active')
        .in('user_id', uniqueIds);
    if (mErr) {
        console.error('[messaging] resolveEmailsForSellerRecipientUserIds memberships', mErr.message);
        return [];
    }
    const allowed = new Set((memberships ?? []).map((row) => row.user_id).filter(Boolean) as string[]);

    const { data: profiles, error: pErr } = await supabase
        .from('profiles')
        .select('id, email')
        .in('id', uniqueIds.filter((id) => allowed.has(id)));
    if (pErr) {
        console.error('[messaging] resolveEmailsForSellerRecipientUserIds profiles', pErr.message);
        return [];
    }
    const emailByUser = new Map<string, string>();
    for (const p of profiles || []) {
        if (typeof p.id === 'string' && typeof p.email === 'string' && p.email.includes('@')) {
            emailByUser.set(p.id, p.email.trim().toLowerCase());
        }
    }

    const out: string[] = [];
    const seenEmail = new Set<string>();
    for (const uid of userIds) {
        if (!UUID_LIKE.test(uid) || !allowed.has(uid)) continue;
        const em = emailByUser.get(uid);
        if (!em) continue;
        if (seenEmail.has(em)) continue;
        seenEmail.add(em);
        out.push(em);
    }
    return out;
}

/**
 * Agency→seller outbound: configured recipients (To + BCC) or legacy single primary contact.
 */
export async function resolveSellerAgencyOutboundEmails(
    sellerTenantId: string,
): Promise<SellerAgencyOutboundEmails | null> {
    const configuredIds = await getSellerMessagingRecipientUserIds(sellerTenantId);
    if (configuredIds.length > 0) {
        const emails = await resolveEmailsForSellerRecipientUserIds(sellerTenantId, configuredIds);
        if (emails.length > 0) {
            const [first, ...rest] = emails;
            return {
                toEmail: first,
                bccEmails: rest.filter((e) => e !== first),
                contactUpsert: first,
            };
        }
    }
    const fallback = await pickSellerContactEmail(sellerTenantId);
    if (!fallback) return null;
    return { toEmail: fallback, bccEmails: [], contactUpsert: fallback };
}

/**
 * Primary seller contact for agency → seller email: first active Seller Admin with an email;
 * otherwise any active seller-tenant member with an email.
 */
export async function pickSellerContactEmail(sellerTenantId: string): Promise<string | null> {
    const { data: memberships, error } = await supabase
        .from('tenant_memberships')
        .select('user_id, role_id')
        .eq('tenant_id', sellerTenantId)
        .eq('status', 'active');
    if (error || !memberships?.length) {
        if (error) console.error('[messaging] pickSellerContactEmail memberships', error.message);
        return null;
    }

    const roleIds = [...new Set(memberships.map((m) => m.role_id))];
    const { data: roles, error: rErr } = await supabase
        .from('roles')
        .select('id, name, tenant_id')
        .in('id', roleIds);
    if (rErr || !roles?.length) return null;

    const roleById = new Map(roles.map((r) => [r.id, r]));
    type Pri = { user_id: string; priority: number };
    const ranked: Pri[] = [];
    for (const m of memberships) {
        const r = roleById.get(m.role_id);
        if (!r || r.tenant_id != null) continue;
        const name = r.name || '';
        if (name === 'Seller Admin') ranked.push({ user_id: m.user_id, priority: 0 });
        else if (name === 'Seller User') ranked.push({ user_id: m.user_id, priority: 1 });
    }
    ranked.sort((a, b) => a.priority - b.priority);
    const orderedUserIds = [...new Set(ranked.map((r) => r.user_id))];
    if (orderedUserIds.length === 0) return null;

    const { data: profiles } = await supabase
        .from('profiles')
        .select('id, email')
        .in('id', orderedUserIds);
    const emailByUser = new Map((profiles || []).map((p) => [p.id, p.email]));

    for (const uid of orderedUserIds) {
        const em = typeof emailByUser.get(uid) === 'string' ? (emailByUser.get(uid) as string).trim().toLowerCase() : '';
        if (em.includes('@')) return em;
    }
    return null;
}

export type AgencyBrandingOut = {
    fromAddress: string;
    fromDisplayName: string | null;
};

export async function resolveAgencyBrandingForSellerTenant(
    sellerTenantId: string,
): Promise<AgencyBrandingOut> {
    const fallbackAddr =
        process.env.REPORTS_FROM_EMAIL || process.env.INVITE_FROM_EMAIL || 'noreply@mamba.app';
    const { data: tenant } = await supabase
        .from('tenants')
        .select('parent_tenant_id')
        .eq('id', sellerTenantId)
        .maybeSingle();
    const agencyId =
        typeof tenant?.parent_tenant_id === 'string' ? tenant.parent_tenant_id : null;
    if (!agencyId) {
        return { fromAddress: fallbackAddr, fromDisplayName: 'Mamba' };
    }
    const { data: b } = await supabase
        .from('tenant_branding')
        .select('email_sender_address, email_sender_name, display_name')
        .eq('tenant_id', agencyId)
        .maybeSingle();
    const addr =
        typeof b?.email_sender_address === 'string' && b.email_sender_address.includes('@')
            ? b.email_sender_address.trim()
            : fallbackAddr;
    const name =
        (typeof b?.email_sender_name === 'string' && b.email_sender_name.trim()
            ? b.email_sender_name.trim()
            : null) ||
        (typeof b?.display_name === 'string' && b.display_name.trim() ? b.display_name.trim() : null);
    return { fromAddress: addr, fromDisplayName: name };
}

/**
 * Where seller-initiated mail should be delivered (agency-facing inbox).
 * Prefer white-label sender address on parent agency branding; then env fallbacks.
 */
export async function resolveAgencyInboxEmail(sellerTenantId: string): Promise<string | null> {
    const b = await resolveAgencyBrandingForSellerTenant(sellerTenantId);
    if (b.fromAddress.includes('@')) return b.fromAddress.trim().toLowerCase();
    const fb = process.env.MESSAGING_AGENCY_NOTIFY_EMAIL || process.env.INVITE_FROM_EMAIL;
    return fb?.includes('@') ? fb.trim().toLowerCase() : null;
}

/**
 * Email addresses partitioned by which "side" of the conversation they belong to,
 * plus an identity directory keyed by lowercased email so the chat UI can render
 * `Name · Role` next to each bubble.
 *
 * - `sellerEmails`: every active member of the seller tenant (Seller Admin / Seller User).
 * - `agencyEmails`: every active member of the parent agency, plus the branding sender mailbox
 *   that GHL files outbound mail under as a routing contact.
 * - `directory`: lowercased-email → display name + primary role label + side.
 *
 * Used both for (a) discovering which GHL conversations to poll, and (b) classifying inbound
 * vs outbound messages by *sender identity* on read so the chat UI can put bubbles on the
 * correct side regardless of which GHL conversation contact they happened to be filed under.
 */
export type MessagingParticipantInfo = {
    name: string | null;
    role: string | null;
    side: 'seller' | 'agency';
    userId: string | null;
};

export type MessagingParticipantSet = {
    sellerEmails: string[];
    agencyEmails: string[];
    directory: Record<string, MessagingParticipantInfo>;
};

/**
 * Pick the most user-meaningful role label for a tenant membership row. Falls back to
 * the membership's primary role name when no granted memberships are present.
 */
function pickMembershipRoleLabel(row: {
    role_name: string | null;
    granted_role_names: string[];
}): string | null {
    /** Prefer named RBAC roles over generic ones if a user has multiple. */
    const priority = [
        'Super Admin',
        'Agency Admin',
        'Account Manager',
        'Account Coordinator',
        'Seller Admin',
        'Seller User',
    ];
    const candidates = [
        ...row.granted_role_names,
        ...(row.role_name ? [row.role_name] : []),
    ].filter((s) => typeof s === 'string' && s.trim().length > 0);
    if (candidates.length === 0) return null;
    for (const want of priority) {
        if (candidates.some((c) => c === want)) return want;
    }
    return candidates[0] ?? null;
}

async function loadTenantMemberDirectory(
    tenantId: string,
    side: 'seller' | 'agency',
): Promise<MessagingParticipantInfo[]> {
    const { data: members } = await supabase
        .from('tenant_memberships')
        .select(
            'user_id, roles(name), membership_roles(revoked_at, roles(name))',
        )
        .eq('tenant_id', tenantId)
        .eq('status', 'active');
    if (!members || members.length === 0) return [];

    const userIds = [...new Set(members.map((m) => m.user_id).filter((v): v is string => typeof v === 'string'))];
    if (userIds.length === 0) return [];

    const { data: profiles } = await supabase
        .from('profiles')
        .select('id, email, full_name')
        .in('id', userIds);
    const profileById = new Map<string, { email: string | null; full_name: string | null }>();
    for (const p of profiles || []) {
        if (typeof p.id === 'string') {
            profileById.set(p.id, {
                email: typeof p.email === 'string' ? p.email : null,
                full_name: typeof p.full_name === 'string' ? p.full_name : null,
            });
        }
    }

    const out: MessagingParticipantInfo[] = [];
    const seen = new Set<string>();
    for (const m of members) {
        const userId = typeof m.user_id === 'string' ? m.user_id : null;
        if (!userId) continue;
        const profile = profileById.get(userId);
        const email =
            typeof profile?.email === 'string' && profile.email.includes('@') ?
                profile.email.trim().toLowerCase()
            :   null;
        if (!email) continue;
        if (seen.has(email)) continue;
        seen.add(email);
        const roleRaw = m.roles as { name?: string } | { name?: string }[] | null | undefined;
        const primaryRoleName =
            Array.isArray(roleRaw) ? (typeof roleRaw[0]?.name === 'string' ? roleRaw[0].name : null)
            : typeof roleRaw?.name === 'string' ? roleRaw.name
            : null;
        const grantedNames: string[] = [];
        const granted = (m as unknown as { membership_roles?: Array<{ revoked_at: string | null; roles?: { name?: string } | { name?: string }[] }> })
            .membership_roles;
        for (const g of granted || []) {
            if (g.revoked_at) continue;
            const r = g.roles;
            if (Array.isArray(r)) {
                if (typeof r[0]?.name === 'string') grantedNames.push(r[0].name);
            } else if (typeof r?.name === 'string') {
                grantedNames.push(r.name);
            }
        }
        const role = pickMembershipRoleLabel({
            role_name: primaryRoleName,
            granted_role_names: grantedNames,
        });
        out.push({
            name: profile?.full_name && profile.full_name.trim().length > 0 ? profile.full_name.trim() : null,
            role,
            side,
            userId,
        });
        // Stash email on the entry so the caller can map it.
        (out[out.length - 1] as MessagingParticipantInfo & { __email?: string }).__email = email;
    }
    return out;
}

export async function collectMessagingParticipantSet(
    sellerTenantId: string,
): Promise<MessagingParticipantSet> {
    const sellerEmails = new Set<string>();
    const agencyEmails = new Set<string>();
    const directory: Record<string, MessagingParticipantInfo> = {};

    const sellerMembers = await loadTenantMemberDirectory(sellerTenantId, 'seller');
    for (const m of sellerMembers) {
        const email = (m as MessagingParticipantInfo & { __email?: string }).__email;
        if (!email) continue;
        sellerEmails.add(email);
        directory[email] = { name: m.name, role: m.role, side: m.side, userId: m.userId };
    }

    const { data: tenant } = await supabase
        .from('tenants')
        .select('parent_tenant_id')
        .eq('id', sellerTenantId)
        .maybeSingle();
    const agencyId =
        typeof tenant?.parent_tenant_id === 'string' ? tenant.parent_tenant_id : null;

    if (agencyId) {
        const agencyMembers = await loadTenantMemberDirectory(agencyId, 'agency');
        for (const m of agencyMembers) {
            const email = (m as MessagingParticipantInfo & { __email?: string }).__email;
            if (!email) continue;
            agencyEmails.add(email);
            directory[email] = { name: m.name, role: m.role, side: m.side, userId: m.userId };
        }
    }

    /**
     * Branding sender / agency inbox (e.g. `info@yourbrand.com`). Not a real user; we still
     * want the UI to render something better than the routing address, so attach a synthetic
     * directory entry tagged as the agency side.
     */
    const inbox = await resolveAgencyInboxEmail(sellerTenantId);
    if (inbox) {
        agencyEmails.add(inbox);
        if (!directory[inbox]) {
            const branding = await resolveAgencyBrandingForSellerTenant(sellerTenantId);
            directory[inbox] = {
                name: branding.fromDisplayName ?? 'Agency Inbox',
                role: 'Agency Inbox',
                side: 'agency',
                userId: null,
            };
        }
    }

    return {
        sellerEmails: [...sellerEmails],
        agencyEmails: [...agencyEmails],
        directory,
    };
}

/**
 * Flat list of all participant emails (used for GHL conversation discovery during sync).
 */
export async function collectMessagingParticipantEmails(
    sellerTenantId: string,
): Promise<string[]> {
    const set = await collectMessagingParticipantSet(sellerTenantId);
    return [...new Set([...set.sellerEmails, ...set.agencyEmails])];
}

/**
 * MVP digest to agency when sellers reply (inbound webhook) or send from Mamba.
 * Set MESSAGING_NOTIFY_EMAIL=0 to disable. Uses same GHL transport as other mail.
 */
export async function notifyAgencyOfMessagingActivity(opts: {
    agencyInbox: string;
    conversationSubject: string;
    previewPlain: string;
}): Promise<void> {
    const off = ['0', 'false', 'no'].includes(
        (process.env.MESSAGING_NOTIFY_EMAIL || '').trim().toLowerCase(),
    );
    if (off) return;
    const subj = `[Mamba] New message: ${opts.conversationSubject.slice(0, 72)}`;
    const html = `<p>A new message was posted in <strong>${escapeHtml(
        opts.conversationSubject.slice(0, 200),
    )}</strong>.</p><blockquote style="border-left:3px solid #ccc;padding-left:8px">${escapeHtml(
        opts.previewPlain.slice(0, 400),
    )}</blockquote>`;
    try {
        await sendHtmlEmail(opts.agencyInbox, subj, html, {
            contactEmailForUpsert: opts.agencyInbox,
        });
    } catch (e) {
        console.warn('[messaging] notifyAgencyOfMessagingActivity failed', e);
    }
}

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
