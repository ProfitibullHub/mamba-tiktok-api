import { Router, type Request, type Response } from 'express';
import { supabase } from '../config/supabase.js';
import {
    resolveRequestTenantContext,
    resolveRequestUserId,
    userIsPlatformSuperAdmin,
} from '../middleware/account-access.middleware.js';
import { requireAuthorization } from '../middleware/authorize.middleware.js';
import { auditLog } from '../services/audit-logger.js';
import { sendHtmlEmail } from '../services/email.js';
import { MESSAGING_GHL_PROVIDER } from '../services/ghl-messaging-field-mapping.js';
import {
    collectMessagingParticipantEmails,
    collectMessagingParticipantSet,
    type MessagingParticipantSet,
    getSellerMessagingRecipientUserIds,
    htmlToPlainSnippet,
    notifyAgencyOfMessagingActivity,
    plainTextToEmailHtml,
    resolveAgencyBrandingForSellerTenant,
    resolveAgencyInboxEmail,
    resolveSellerAgencyOutboundEmails,
    rpcMessagingSellerVisible,
    parseEmailAddress,
} from '../services/messaging.service.js';
import {
    findGhlConversationsByContactEmail,
    syncGhlEmailRowsIntoMamba,
} from '../services/ghl-messages-sync.service.js';

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_SUBJECT = 500;
const MAX_BODY = 16_000;
const MESSAGE_PAGE = 80;
/** Throttle GHL list-messages polls per Mamba conversation (per server instance). */
const GHL_POLL_THROTTLE_MS = 25_000;
const ghlPollLastAt = new Map<string, number>();
/** Avoid stacking concurrent GHL jobs for the same Mamba conversation. */
const ghlPollInflight = new Set<string>();

/** Participant directory is stable for minutes; caching removes repeated heavy joins on each poll. */
const PARTICIPANT_CACHE_MS = 5 * 60 * 1000;
const participantSetCache = new Map<string, { t: number; data: MessagingParticipantSet }>();

async function getMessagingParticipantsCached(sellerTenantId: string): Promise<MessagingParticipantSet> {
    const now = Date.now();
    const hit = participantSetCache.get(sellerTenantId);
    if (hit && now - hit.t < PARTICIPANT_CACHE_MS) return hit.data;
    const data = await collectMessagingParticipantSet(sellerTenantId);
    participantSetCache.set(sellerTenantId, { t: now, data });
    return data;
}

async function runMessagingGhlPollJob(args: {
    mambaConversationId: string;
    sellerTenantId: string;
    subject: string;
    initialExternalThreadId: string | null;
}): Promise<void> {
    const { mambaConversationId, sellerTenantId, subject } = args;
    let ghlThread =
        typeof args.initialExternalThreadId === 'string' && args.initialExternalThreadId.trim().length > 0 ?
            args.initialExternalThreadId.trim()
        :   null;
    try {
        const participantEmails = await collectMessagingParticipantEmails(sellerTenantId);
        const linkedThreads = new Map<string, { contactId: string | null; lastMs: number; lastType: string }>();
        for (const email of participantEmails) {
            const found = await findGhlConversationsByContactEmail(email);
            for (const c of found) {
                const existing = linkedThreads.get(c.conversationId);
                if (!existing || c.lastMs > existing.lastMs) {
                    linkedThreads.set(c.conversationId, {
                        contactId: c.contactId,
                        lastMs: c.lastMs,
                        lastType: c.lastType,
                    });
                }
            }
        }

        const linkedList = [...linkedThreads.entries()].sort((a, b) => {
            const ae = a[1].lastType.includes('email') ? 1 : 0;
            const be = b[1].lastType.includes('email') ? 1 : 0;
            if (ae !== be) return be - ae;
            return b[1].lastMs - a[1].lastMs;
        });
        const canonical =
            linkedList.find(([cid]) => cid === ghlThread)?.[0] ?? linkedList[0]?.[0] ?? null;

        if (canonical && canonical !== ghlThread) {
            const { error: upErr } = await supabase
                .from('messaging_conversations')
                .update({ external_thread_id: canonical })
                .eq('id', mambaConversationId);
            if (upErr) {
                console.warn('[messaging] reconcile external_thread_id update failed', upErr.message);
            } else {
                ghlThread = canonical;
            }
        }

        const threadIdsToPoll = [
            ...linkedList.map(([cid]) => cid),
            ...(ghlThread && !linkedList.some(([cid]) => cid === ghlThread) ? [ghlThread] : []),
        ];

        const subj =
            typeof subject === 'string' && subject.trim().length > 0 ? subject.trim() : 'Conversation';

        for (const ghlConvId of threadIdsToPoll) {
            try {
                await syncGhlEmailRowsIntoMamba({
                    mambaConversationId,
                    sellerTenantId,
                    conversationSubject: subj,
                    ghlConversationId: ghlConvId,
                });
            } catch (e) {
                console.warn('[messaging] GHL poll sync failed', ghlConvId, e);
            }
        }
    } catch (e) {
        console.warn('[messaging] GHL background poll error', mambaConversationId, e);
    } finally {
        ghlPollInflight.delete(mambaConversationId);
    }
}

function badRequest(res: Response, msg: string) {
    return res.status(400).json({ success: false, error: msg });
}

/**
 * Platform Super Admins can compose and reply on any conversation by default. They go through
 * the same routing as the agency side (agency branding → seller's contact email) via the
 * synthetic agency tenant context. Set `MESSAGING_BLOCK_PLATFORM_SUPER_ADMIN_SEND=true` to
 * lock that down again (e.g. for production-only PRD compliance).
 */
function platformSuperAdminMessagingSendBlocked(): boolean {
    const v = (process.env.MESSAGING_BLOCK_PLATFORM_SUPER_ADMIN_SEND || '').trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes';
}

function normalizeInboundPayload(
    body: unknown
): Record<string, unknown> | null {
    if (!body || typeof body !== 'object') return null;
    const b = body as Record<string, unknown>;
    if (b.type === 'InboundMessage') return b;
    if (typeof b.message === 'object' && b.message !== null) {
        const m = b.message as Record<string, unknown>;
        if (m.type === 'InboundMessage') return m;
    }
    return null;
}

function verifyGhlWebhook(req: Request): boolean {
    const secret = (process.env.MESSAGING_GHL_WEBHOOK_SECRET || '').trim();
    if (!secret) {
        console.warn('[messaging] MESSAGING_GHL_WEBHOOK_SECRET not set — rejecting inbound');
        return false;
    }
    const auth = req.headers.authorization;
    if (typeof auth === 'string' && auth === `Bearer ${secret}`) return true;
    const headerSecret = req.headers['x-messaging-ghl-secret'];
    const raw = Array.isArray(headerSecret) ? headerSecret[0] : headerSecret;
    if (typeof raw === 'string' && raw === secret) return true;
    return false;
}

function dedupeUserIdsPreserveOrder(ids: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of ids) {
        if (!UUID_RE.test(id) || seen.has(id)) continue;
        seen.add(id);
        out.push(id);
    }
    return out;
}

async function userCanManageSellerTenantMembers(actorId: string, sellerTenantId: string): Promise<boolean> {
    const { data: isSa } = await supabase.rpc('user_is_platform_super_admin', { p_user_id: actorId });
    if (isSa === true) return true;
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', actorId).maybeSingle();
    if (profile?.role === 'admin') return true;
    const { data: can, error } = await supabase.rpc('user_can_manage_tenant_members', {
        p_tenant_id: sellerTenantId,
        p_actor_id: actorId,
    });
    if (error) {
        console.warn('[messaging] user_can_manage_tenant_members', error.message);
        return false;
    }
    return can === true;
}

async function userCanSeeSellerTenant(actorId: string, sellerTenantId: string): Promise<boolean> {
    const { data: isSa } = await supabase.rpc('user_is_platform_super_admin', { p_user_id: actorId });
    if (isSa === true) return true;
    const { data: canSee, error } = await supabase.rpc('tenant_is_visible_to_user', {
        p_tenant_id: sellerTenantId,
        p_user_id: actorId,
    });
    if (error) {
        console.warn('[messaging] tenant_is_visible_to_user', error.message);
        return false;
    }
    return canSee === true;
}

/**
 * Sellers available for the inbox seller-picker.
 *
 * Scope by caller role:
 *  - Seller member → their own tenant only (they are the seller; they don't pick another).
 *  - Agency member (Admin / AM / AC) → sellers assigned to them via `assignedSellerIds`.
 *  - Platform Super Admin → all active seller tenants (no scope restriction).
 */
router.get(
    '/sellers',
    requireAuthorization({ action: 'messages.view', denyAction: 'messaging.permission_denied' }),
    async (req: Request, res: Response) => {
        try {
            const userId = await resolveRequestUserId(req);
            if (!userId) return res.status(401).json({ success: false, error: 'Authorization required' });

            const isSuper = await userIsPlatformSuperAdmin(userId);

            /** Platform Super Admin: return every active seller tenant. */
            if (isSuper) {
                const { data: tenants, error } = await supabase
                    .from('tenants')
                    .select('id, name')
                    .eq('type', 'seller')
                    .eq('status', 'active')
                    .order('name');
                if (error) {
                    console.error('[messaging] /sellers super', error.message);
                    return res.status(500).json({ success: false, error: 'Failed to load sellers' });
                }
                return res.json({
                    success: true,
                    data: {
                        items: (tenants || []).map((t) => ({
                            id: t.id,
                            name: typeof t.name === 'string' ? t.name : t.id,
                        })),
                    },
                });
            }

            const ctx = await resolveRequestTenantContext(req);
            if (!ctx) return res.status(403).json({ success: false, error: 'Tenant context required' });

            /** Seller member: only their own tenant. */
            if (ctx.tenantType === 'seller') {
                const { data: t } = await supabase
                    .from('tenants')
                    .select('id, name')
                    .eq('id', ctx.tenantId)
                    .maybeSingle();
                const visible = await rpcMessagingSellerVisible(ctx.tenantId, userId);
                if (!visible) return res.status(403).json({ success: false, error: 'Access denied' });
                return res.json({
                    success: true,
                    data: {
                        items:
                            t?.id ?
                                [{ id: t.id, name: typeof t.name === 'string' ? t.name : 'Seller' }]
                            :   [],
                    },
                });
            }

            if (ctx.tenantType !== 'agency') {
                return res.status(403).json({ success: false, error: 'Messaging inbox is for seller or agency tenants' });
            }

            /**
             * Agency member (Admin, Account Manager, Account Coordinator):
             * `assignedSellerIds` is populated by the RBAC RPC and already scoped to this user's
             * assignments. An Agency Admin with no explicit assignments may have an empty list if the
             * RPC is set up that way — fall back to all sellers under this agency in that case.
             */
            let ids = ctx.assignedSellerIds;

            if (ids.length === 0) {
                /** Fetch all sellers whose parent_tenant_id = this agency tenant. */
                const { data: fallbackTenants } = await supabase
                    .from('tenants')
                    .select('id, name')
                    .eq('type', 'seller')
                    .eq('parent_tenant_id', ctx.tenantId)
                    .eq('status', 'active')
                    .order('name');
                const items = (fallbackTenants || []).map((t) => ({
                    id: t.id,
                    name: typeof t.name === 'string' ? t.name : t.id,
                }));
                return res.json({ success: true, data: { items } });
            }

            const { data: tenants, error } = await supabase
                .from('tenants')
                .select('id, name')
                .in('id', ids)
                .eq('type', 'seller')
                .order('name');
            if (error) {
                console.error('[messaging] /sellers', error.message);
                return res.status(500).json({ success: false, error: 'Failed to load sellers' });
            }
            const items = (tenants || []).map((t) => ({
                id: t.id,
                name: typeof t.name === 'string' ? t.name : t.id,
            }));
            return res.json({ success: true, data: { items } });
        } catch (e: unknown) {
            console.error('[messaging] /sellers', e);
            return res.status(500).json({ success: false, error: 'Internal error' });
        }
    },
);

/**
 * Who receives agency→seller email for this shop (ordered: first = To, rest = BCC). Empty = default rule.
 */
router.get('/seller-recipients', async (req: Request, res: Response) => {
    try {
        const actorId = await resolveRequestUserId(req);
        if (!actorId) return res.status(401).json({ success: false, error: 'Authorization required' });

        const sellerTenantId = typeof req.query.sellerTenantId === 'string' ? req.query.sellerTenantId.trim() : '';
        if (!UUID_RE.test(sellerTenantId)) return badRequest(res, 'sellerTenantId is required');

        const { data: tenantRow } = await supabase
            .from('tenants')
            .select('type')
            .eq('id', sellerTenantId)
            .maybeSingle();
        if (tenantRow?.type !== 'seller') {
            return badRequest(res, 'Tenant must be a seller');
        }

        const canSee = await userCanSeeSellerTenant(actorId, sellerTenantId);
        if (!canSee) return res.status(403).json({ success: false, error: 'Access denied' });

        const canManage = await userCanManageSellerTenantMembers(actorId, sellerTenantId);
        const recipientUserIds = await getSellerMessagingRecipientUserIds(sellerTenantId);

        return res.json({
            success: true,
            data: {
                recipientUserIds,
                canManage,
                usesDefault: recipientUserIds.length === 0,
            },
        });
    } catch (e: unknown) {
        console.error('[messaging] GET seller-recipients', e);
        return res.status(500).json({ success: false, error: 'Internal error' });
    }
});

router.put('/seller-recipients', async (req: Request, res: Response) => {
    try {
        const actorId = await resolveRequestUserId(req);
        if (!actorId) return res.status(401).json({ success: false, error: 'Authorization required' });

        const body = (req.body || {}) as Record<string, unknown>;
        const sellerTenantId =
            typeof body.sellerTenantId === 'string' ? body.sellerTenantId.trim()
            : typeof body.seller_tenant_id === 'string' ? body.seller_tenant_id.trim()
            : '';
        if (!UUID_RE.test(sellerTenantId)) return badRequest(res, 'sellerTenantId is required');

        const { data: tenantRow } = await supabase
            .from('tenants')
            .select('type')
            .eq('id', sellerTenantId)
            .maybeSingle();
        if (tenantRow?.type !== 'seller') {
            return badRequest(res, 'Tenant must be a seller');
        }

        const canManage = await userCanManageSellerTenantMembers(actorId, sellerTenantId);
        if (!canManage) return res.status(403).json({ success: false, error: 'Access denied' });

        const rawIds = body.recipientUserIds ?? body.recipient_user_ids;
        if (!Array.isArray(rawIds)) return badRequest(res, 'recipientUserIds must be an array');

        const normalized = dedupeUserIdsPreserveOrder(
            rawIds.filter((v): v is string => typeof v === 'string'),
        );
        if (normalized.length > 20) return badRequest(res, 'At most 20 recipients');

        if (normalized.length > 0) {
            const { data: memberships, error: mErr } = await supabase
                .from('tenant_memberships')
                .select('user_id')
                .eq('tenant_id', sellerTenantId)
                .eq('status', 'active')
                .in('user_id', normalized);
            if (mErr) {
                console.error('[messaging] PUT seller-recipients memberships', mErr.message);
                return res.status(500).json({ success: false, error: 'Validation failed' });
            }
            const active = new Set((memberships ?? []).map((m) => m.user_id));
            for (const uid of normalized) {
                if (!active.has(uid)) {
                    return badRequest(res, 'Each recipient must be an active member of this seller team');
                }
            }
            const { data: profiles, error: pErr } = await supabase
                .from('profiles')
                .select('id, email')
                .in('id', normalized);
            if (pErr) {
                console.error('[messaging] PUT seller-recipients profiles', pErr.message);
                return res.status(500).json({ success: false, error: 'Validation failed' });
            }
            const emailByUser = new Map((profiles ?? []).map((p) => [p.id, p.email]));
            for (const uid of normalized) {
                const em = emailByUser.get(uid);
                if (typeof em !== 'string' || !em.includes('@')) {
                    return badRequest(res, 'Each recipient must have an email address on their profile');
                }
            }
        }

        const { error: upErr } = await supabase.from('seller_messaging_settings').upsert({
            seller_tenant_id: sellerTenantId,
            recipient_user_ids: normalized,
        });
        if (upErr) {
            console.error('[messaging] PUT seller-recipients upsert', upErr.message);
            return res.status(500).json({ success: false, error: 'Failed to save settings' });
        }

        await auditLog(req, {
            action: 'messaging.seller_recipients.updated',
            resourceType: 'seller_messaging_settings',
            resourceId: sellerTenantId,
            tenantId: sellerTenantId,
            metadata: { recipientCount: normalized.length },
        });

        return res.json({
            success: true,
            data: {
                recipientUserIds: normalized,
                usesDefault: normalized.length === 0,
            },
        });
    } catch (e: unknown) {
        console.error('[messaging] PUT seller-recipients', e);
        return res.status(500).json({ success: false, error: 'Internal error' });
    }
});

router.get(
    '/conversations',
    requireAuthorization({ action: 'messages.view', denyAction: 'messaging.permission_denied' }),
    async (req: Request, res: Response) => {
        try {
            const userId = await resolveRequestUserId(req);
            if (!userId) return res.status(401).json({ success: false, error: 'Authorization required' });

            const ctx = await resolveRequestTenantContext(req);
            if (!ctx) return res.status(403).json({ success: false, error: 'Tenant context required' });

            const q = typeof req.query.sellerTenantId === 'string' ? req.query.sellerTenantId.trim() : '';
            const isSuper = await userIsPlatformSuperAdmin(userId);

            if (isSuper) {
                if (!q || !UUID_RE.test(q)) {
                    return badRequest(res, 'sellerTenantId is required for platform operators');
                }
                const visible = await rpcMessagingSellerVisible(q, userId);
                if (!visible) return res.status(403).json({ success: false, error: 'Access denied' });
                const { data: rows, error } = await supabase
                    .from('messaging_conversations')
                    .select(
                        'id, seller_tenant_id, subject, status, provider, external_thread_id, created_at, updated_at, last_message_at',
                    )
                    .eq('seller_tenant_id', q)
                    .order('updated_at', { ascending: false })
                    .limit(200);
                if (error) {
                    console.error('[messaging] list conversations (super)', error.message);
                    return res.status(500).json({ success: false, error: 'Failed to list conversations' });
                }
                return res.json({ success: true, data: { items: rows || [] } });
            }

            let sellerFilter: string | null = null;

            if (ctx.tenantType === 'seller') {
                sellerFilter = ctx.tenantId;
                if (q && q !== ctx.tenantId) {
                    return res.status(403).json({ success: false, error: 'Invalid seller scope' });
                }
            } else if (ctx.tenantType === 'agency') {
                if (q) {
                    if (!UUID_RE.test(q)) return badRequest(res, 'Invalid sellerTenantId');
                    if (!ctx.assignedSellerIds.includes(q)) {
                        return res.status(403).json({ success: false, error: 'Seller not in your scope' });
                    }
                    sellerFilter = q;
                } else if (ctx.assignedSellerIds.length === 0) {
                    return res.json({ success: true, data: { items: [] } });
                }
            } else {
                return res.status(403).json({ success: false, error: 'Unsupported tenant type' });
            }

            let query = supabase
                .from('messaging_conversations')
                .select(
                    'id, seller_tenant_id, subject, status, provider, external_thread_id, created_at, updated_at, last_message_at',
                )
                .order('updated_at', { ascending: false })
                .limit(200);

            if (sellerFilter) {
                query = query.eq('seller_tenant_id', sellerFilter);
            } else {
                query = query.in('seller_tenant_id', ctx.assignedSellerIds);
            }

            const { data: rows, error } = await query;
            if (error) {
                console.error('[messaging] list conversations', error.message);
                return res.status(500).json({ success: false, error: 'Failed to list conversations' });
            }

            const rowList = rows || [];
            const distinctSellerIds = [...new Set(rowList.map((r) => r.seller_tenant_id as string).filter(Boolean))];
            const visibilityPairs = await Promise.all(
                distinctSellerIds.map(async (sid) => {
                    const ok = await rpcMessagingSellerVisible(sid, userId);
                    return [sid, ok] as const;
                }),
            );
            const visibleSellers = new Set(visibilityPairs.filter(([, ok]) => ok).map(([sid]) => sid));
            const out = rowList.filter((r) => visibleSellers.has(r.seller_tenant_id as string));

            return res.json({ success: true, data: { items: out } });
        } catch (e: unknown) {
            console.error('[messaging] GET /conversations', e);
            return res.status(500).json({ success: false, error: 'Internal error' });
        }
    },
);

router.post(
    '/conversations',
    requireAuthorization({ action: 'messages.send', denyAction: 'messaging.permission_denied' }),
    async (req: Request, res: Response) => {
        try {
            const userId = await resolveRequestUserId(req);
            if (!userId) return res.status(401).json({ success: false, error: 'Authorization required' });
            const isSuper = await userIsPlatformSuperAdmin(userId);
            if (isSuper && platformSuperAdminMessagingSendBlocked()) {
                return res.status(403).json({
                    success: false,
                    error:
                        'Platform operators are blocked from creating conversations on this environment.',
                });
            }

            const body = (req.body || {}) as Record<string, unknown>;
            const subject =
                typeof body.subject === 'string' ? body.subject.trim().slice(0, MAX_SUBJECT) : '';
            const sellerRaw =
                typeof body.sellerTenantId === 'string' ? body.sellerTenantId.trim() : '';
            if (!subject) return badRequest(res, 'subject is required');
            if (!UUID_RE.test(sellerRaw)) return badRequest(res, 'sellerTenantId must be a UUID');

            const ctx = await resolveRequestTenantContext(req);
            if (!ctx) return res.status(403).json({ success: false, error: 'Tenant context required' });

            if (ctx.tenantType === 'seller' && sellerRaw !== ctx.tenantId) {
                return res.status(403).json({ success: false, error: 'sellerTenantId must match your tenant' });
            }
            if (
                ctx.tenantType === 'agency' &&
                !ctx.assignedSellerIds.includes(sellerRaw) &&
                !isSuper
            ) {
                return res.status(403).json({ success: false, error: 'Seller not in your scope' });
            }

            const visible = await rpcMessagingSellerVisible(sellerRaw, userId);
            if (!visible) return res.status(403).json({ success: false, error: 'Access denied' });

            const { data: inserted, error } = await supabase
                .from('messaging_conversations')
                .insert({
                    seller_tenant_id: sellerRaw,
                    subject,
                    provider: MESSAGING_GHL_PROVIDER,
                })
                .select('id, seller_tenant_id, subject, created_at')
                .single();

            if (error || !inserted) {
                console.error('[messaging] insert conversation', error?.message);
                return res.status(500).json({ success: false, error: 'Failed to create conversation' });
            }

            await auditLog(req, {
                action: 'messaging.conversation.create',
                resourceType: 'messaging_conversation',
                resourceId: inserted.id,
                tenantId: sellerRaw,
                metadata: { sellerTenantId: sellerRaw, subject },
            });

            return res.status(201).json({ success: true, data: { conversation: inserted } });
        } catch (e: unknown) {
            console.error('[messaging] POST /conversations', e);
            return res.status(500).json({ success: false, error: 'Internal error' });
        }
    },
);

router.get(
    '/conversations/:conversationId/messages',
    requireAuthorization({ action: 'messages.view', denyAction: 'messaging.permission_denied' }),
    async (req: Request, res: Response) => {
        try {
            const userId = await resolveRequestUserId(req);
            if (!userId) return res.status(401).json({ success: false, error: 'Authorization required' });
            const id = req.params.conversationId;
            if (!UUID_RE.test(id)) return badRequest(res, 'Invalid conversation id');

            const { data: conv, error: cErr } = await supabase
                .from('messaging_conversations')
                .select('id, seller_tenant_id, subject, external_thread_id')
                .eq('id', id)
                .maybeSingle();
            if (cErr || !conv) return res.status(404).json({ success: false, error: 'Conversation not found' });

            const visible = await rpcMessagingSellerVisible(conv.seller_tenant_id, userId);
            if (!visible) return res.status(403).json({ success: false, error: 'Access denied' });

            const sellerTenantId = conv.seller_tenant_id as string;

            const now = Date.now();
            const last = ghlPollLastAt.get(id) ?? 0;
            const shouldPoll = now - last >= GHL_POLL_THROTTLE_MS;

            let ghlSync: {
                attempted: boolean;
                throttled: boolean;
                background?: boolean;
            } = { attempted: false, throttled: false };

            if (shouldPoll && !ghlPollInflight.has(id)) {
                ghlPollInflight.add(id);
                ghlPollLastAt.set(id, now);
                ghlSync = { attempted: true, throttled: false, background: true };
                void runMessagingGhlPollJob({
                    mambaConversationId: id,
                    sellerTenantId,
                    subject: typeof conv.subject === 'string' ? conv.subject : '',
                    initialExternalThreadId:
                        typeof conv.external_thread_id === 'string' ? conv.external_thread_id : null,
                }).catch((e) => console.warn('[messaging] GHL background job', id, e));
            } else if (!shouldPoll) {
                ghlSync = { attempted: false, throttled: true };
            }

            const limitRaw = parseInt(String(req.query.limit || ''), 10);
            const limit =
                Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= MESSAGE_PAGE ? limitRaw : MESSAGE_PAGE;
            const before = typeof req.query.before === 'string' && UUID_RE.test(req.query.before) ? req.query.before : null;

            let q = supabase
                .from('messaging_messages')
                .select(
                    'id, conversation_id, direction, sender_user_id, sender_email, body, created_at, send_status, provider_message_id',
                )
                .eq('conversation_id', id)
                .order('created_at', { ascending: false })
                .limit(limit);
            if (before) {
                const { data: pivot } = await supabase
                    .from('messaging_messages')
                    .select('created_at')
                    .eq('id', before)
                    .maybeSingle();
                if (pivot?.created_at) {
                    q = q.lt('created_at', pivot.created_at as string);
                }
            }

            const participantsPromise = getMessagingParticipantsCached(sellerTenantId);
            const messagesPromise = (async () => {
                const { data: rows, error } = await q;
                if (error) throw new Error(error.message);
                return rows;
            })();

            let participantSet: MessagingParticipantSet;
            let messageRows: unknown[] | null;
            try {
                [messageRows, participantSet] = await Promise.all([messagesPromise, participantsPromise]);
            } catch (e) {
                console.error('[messaging] list messages / participants', e);
                return res.status(500).json({ success: false, error: 'Failed to load messages' });
            }

            const chronological = [...(messageRows || [])].reverse();

            return res.json({
                success: true,
                data: { messages: chronological, ghlSync, participants: participantSet },
            });
        } catch (e: unknown) {
            console.error('[messaging] GET messages', e);
            return res.status(500).json({ success: false, error: 'Internal error' });
        }
    },
);

router.post(
    '/conversations/:conversationId/messages',
    requireAuthorization({ action: 'messages.send', denyAction: 'messaging.permission_denied' }),
    async (req: Request, res: Response) => {
        try {
            const userId = await resolveRequestUserId(req);
            if (!userId) return res.status(401).json({ success: false, error: 'Authorization required' });
            const isSuper = await userIsPlatformSuperAdmin(userId);
            if (isSuper && platformSuperAdminMessagingSendBlocked()) {
                return res.status(403).json({
                    success: false,
                    error: 'Platform operators are blocked from sending messages on this environment.',
                });
            }

            const id = req.params.conversationId;
            if (!UUID_RE.test(id)) return badRequest(res, 'Invalid conversation id');

            const bodyRaw = (req.body || {}) as Record<string, unknown>;
            const bodyText =
                typeof bodyRaw.body === 'string' ? bodyRaw.body.trim().slice(0, MAX_BODY) : '';
            if (!bodyText) return badRequest(res, 'body is required');

            const { data: conv, error: cErr } = await supabase
                .from('messaging_conversations')
                .select(
                    'id, seller_tenant_id, subject, external_thread_id, provider',
                )
                .eq('id', id)
                .maybeSingle();
            if (cErr || !conv) return res.status(404).json({ success: false, error: 'Conversation not found' });

            const visible = await rpcMessagingSellerVisible(conv.seller_tenant_id, userId);
            if (!visible) return res.status(403).json({ success: false, error: 'Access denied' });

            const ctx = await resolveRequestTenantContext(req);
            if (!ctx) return res.status(403).json({ success: false, error: 'Tenant context required' });

            const { data: profile } = await supabase
                .from('profiles')
                .select('email, full_name')
                .eq('id', userId)
                .maybeSingle();
            const myEmail =
                typeof profile?.email === 'string' && profile.email.includes('@') ?
                    profile.email.trim().toLowerCase()
                :   null;
            if (!myEmail) {
                return badRequest(res, 'Your profile must include an email address to send messages');
            }

            let toEmail: string;
            let emailFrom: string;
            let fromDisplayName: string | undefined;
            let contactUpsert: string;
            let emailBcc: string[] | undefined;
            const ghlConvId =
                typeof conv.external_thread_id === 'string' && conv.external_thread_id ?
                    conv.external_thread_id
                :   undefined;

            /**
             * Platform Super Admins always speak from the agency side regardless of which tenant
             * their profile happens to live in (their `ctx` may resolve to seller/agency/synthetic).
             * They are administrative operators acting on behalf of the seller's parent agency.
             */
            const useAgencySendPath = ctx.tenantType === 'agency' || isSuper;

            if (useAgencySendPath) {
                const sellerRouting = await resolveSellerAgencyOutboundEmails(conv.seller_tenant_id);
                if (!sellerRouting) {
                    return res.status(409).json({
                        success: false,
                        error: 'No seller contact email found for this tenant',
                    });
                }
                toEmail = sellerRouting.toEmail;
                contactUpsert = sellerRouting.contactUpsert;
                emailBcc =
                    sellerRouting.bccEmails.length > 0 ? sellerRouting.bccEmails : undefined;
                const brand = await resolveAgencyBrandingForSellerTenant(conv.seller_tenant_id);
                emailFrom = brand.fromAddress;
                fromDisplayName = brand.fromDisplayName || undefined;
            } else {
                emailBcc = undefined;
                const agencyTo = await resolveAgencyInboxEmail(conv.seller_tenant_id);
                if (!agencyTo) {
                    return res.status(409).json({
                        success: false,
                        error: 'Agency inbox email is not configured (branding or MESSAGING_AGENCY_NOTIFY_EMAIL)',
                    });
                }
                toEmail = agencyTo;
                contactUpsert = agencyTo;
                emailFrom = myEmail;
                fromDisplayName =
                    typeof profile?.full_name === 'string' && profile.full_name.trim() ?
                        profile.full_name.trim()
                    :   'Seller';
            }

            const html = plainTextToEmailHtml(bodyText);
            const { data: pendingRow, error: insErr } = await supabase
                .from('messaging_messages')
                .insert({
                    conversation_id: id,
                    direction: 'outbound',
                    sender_user_id: userId,
                    sender_email: myEmail,
                    body: htmlToPlainSnippet(html, MAX_BODY),
                    send_status: 'pending',
                })
                .select('id')
                .single();

            if (insErr || !pendingRow) {
                console.error('[messaging] insert outbound', insErr?.message);
                return res.status(500).json({ success: false, error: 'Failed to save message' });
            }

            let sendError: string | null = null;
            let providerMessageId: string | null = null;
            let newThreadId: string | undefined;

            try {
                const result = await sendHtmlEmail(toEmail, conv.subject || 'Message', html, {
                    from: emailFrom,
                    fromDisplayName,
                    contactEmailForUpsert: contactUpsert,
                    ghlConversationId: ghlConvId,
                    emailBcc,
                });
                if (!result.delivered) {
                    sendError = 'Email transport not configured (GHL credentials missing)';
                } else {
                    providerMessageId = result.messageId ?? null;
                    newThreadId = result.conversationId;
                }
            } catch (e: unknown) {
                sendError = e instanceof Error ? e.message : 'Send failed';
            }

            const finalStatus = sendError ? 'failed' : 'sent';
            await supabase
                .from('messaging_messages')
                .update({
                    send_status: finalStatus,
                    provider_message_id: providerMessageId,
                    send_error: sendError,
                })
                .eq('id', pendingRow.id);

            if (newThreadId && !conv.external_thread_id) {
                await supabase
                    .from('messaging_conversations')
                    .update({ external_thread_id: newThreadId })
                    .eq('id', id);
            }

            await auditLog(req, {
                action: 'messaging.message.sent',
                resourceType: 'messaging_message',
                resourceId: pendingRow.id,
                tenantId: conv.seller_tenant_id,
                metadata: {
                    conversationId: id,
                    direction: 'outbound',
                    sendStatus: finalStatus,
                    providerMessageId,
                },
            });

            // MVP notify: seller-authored outbound → agency inbox digest (not for agency→seller).
            if (ctx.tenantType === 'seller') {
                const inbox = await resolveAgencyInboxEmail(conv.seller_tenant_id);
                if (inbox) {
                    void notifyAgencyOfMessagingActivity({
                        agencyInbox: inbox,
                        conversationSubject: conv.subject || 'Conversation',
                        previewPlain: htmlToPlainSnippet(html),
                    }).catch((e) => console.warn('[messaging] notifyAgencyOfMessagingActivity', e));
                }
            }

            if (sendError) {
                return res.status(502).json({
                    success: false,
                    error: sendError,
                    data: { messageId: pendingRow.id, sendStatus: finalStatus },
                });
            }

            participantSetCache.delete(conv.seller_tenant_id);

            return res.status(201).json({
                success: true,
                data: {
                    message: {
                        id: pendingRow.id,
                        sendStatus: finalStatus,
                        providerMessageId,
                    },
                },
            });
        } catch (e: unknown) {
            console.error('[messaging] POST message', e);
            return res.status(500).json({ success: false, error: 'Internal error' });
        }
    },
);

/**
 * GoHighLevel InboundMessage webhook (Email). Configure in GHL with shared secret:
 * Authorization: Bearer <MESSAGING_GHL_WEBHOOK_SECRET> or header X-Messaging-Ghl-Secret.
 */
router.post('/webhooks/ghl-inbound', async (req: Request, res: Response) => {
    try {
        if (!verifyGhlWebhook(req)) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }

        const payload = normalizeInboundPayload(req.body);
        if (!payload) {
            return res.status(400).json({ success: false, error: 'Expected InboundMessage payload' });
        }

        const expectedLoc = (process.env.GOHIGHLEVEL_LOCATION_ID || '').trim();
        const loc = typeof payload.locationId === 'string' ? payload.locationId : '';
        if (expectedLoc && loc && loc !== expectedLoc) {
            return res.status(403).json({ success: false, error: 'Location mismatch' });
        }

        const messageType = typeof payload.messageType === 'string' ? payload.messageType : '';
        if (messageType.toLowerCase() !== 'email') {
            return res.status(202).json({ success: true, ignored: true, reason: 'non-email' });
        }

        const ghlConversationId = typeof payload.conversationId === 'string' ? payload.conversationId : '';
        if (!ghlConversationId) {
            return res.status(400).json({ success: false, error: 'conversationId missing' });
        }

        const { data: conv, error: cErr } = await supabase
            .from('messaging_conversations')
            .select('id, seller_tenant_id, subject, external_thread_id')
            .eq('provider', MESSAGING_GHL_PROVIDER)
            .eq('external_thread_id', ghlConversationId)
            .maybeSingle();

        if (cErr) {
            console.error('[messaging] webhook find conv', cErr.message);
            return res.status(500).json({ success: false, error: 'Lookup failed' });
        }

        if (!conv) {
            console.warn(
                '[messaging] Inbound email for unknown GHL conversation — rejected (PRD default)',
                ghlConversationId,
            );
            return res.status(404).json({ success: false, error: 'conversation_not_mapped' });
        }

        const providerMsgId =
            (typeof payload.emailMessageId === 'string' && payload.emailMessageId) ||
            (typeof payload.messageId === 'string' && payload.messageId) ||
            null;

        if (providerMsgId) {
            const { data: existing } = await supabase
                .from('messaging_messages')
                .select('id')
                .eq('provider_message_id', providerMsgId)
                .maybeSingle();
            if (existing) {
                return res.status(200).json({ success: true, deduped: true });
            }
        }

        const fromRaw = typeof payload.from === 'string' ? payload.from : '';
        const senderEmail = fromRaw ? parseEmailAddress(fromRaw) : '';
        if (!senderEmail.includes('@')) {
            return res.status(400).json({ success: false, error: 'Invalid from' });
        }

        const htmlBody = typeof payload.body === 'string' ? payload.body : '';
        const plain = htmlToPlainSnippet(htmlBody || fromRaw, MAX_BODY);

        const { data: inserted, error: insErr } = await supabase
            .from('messaging_messages')
            .insert({
                conversation_id: conv.id,
                direction: 'inbound',
                sender_user_id: null,
                sender_email: senderEmail,
                body: plain,
                provider_message_id: providerMsgId,
            })
            .select('id')
            .single();

        if (insErr) {
            if (/duplicate key|unique constraint/i.test(insErr.message)) {
                return res.status(200).json({ success: true, deduped: true });
            }
            console.error('[messaging] webhook insert', insErr.message);
            return res.status(500).json({ success: false, error: 'Insert failed' });
        }

        if (!conv.external_thread_id) {
            await supabase
                .from('messaging_conversations')
                .update({ external_thread_id: ghlConversationId })
                .eq('id', conv.id);
        }

        await auditLog(req, {
            action: 'messaging.message.received',
            resourceType: 'messaging_message',
            resourceId: inserted?.id ?? null,
            tenantId: conv.seller_tenant_id,
            metadata: {
                conversationId: conv.id,
                ghlConversationId,
                providerMessageId: providerMsgId,
            },
        });

        const inbox = await resolveAgencyInboxEmail(conv.seller_tenant_id);
        if (inbox) {
            await notifyAgencyOfMessagingActivity({
                agencyInbox: inbox,
                conversationSubject: conv.subject || 'Conversation',
                previewPlain: plain,
            });
        }

        return res.status(200).json({ success: true, data: { messageId: inserted?.id } });
    } catch (e: unknown) {
        console.error('[messaging] webhook', e);
        return res.status(500).json({ success: false, error: 'Internal error' });
    }
});

export default router;
