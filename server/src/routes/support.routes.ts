import { Router, type Request, type Response } from 'express';
import { resolveRequestUserId, resolveRequestTenantContext, userCanAccessAccount } from '../middleware/account-access.middleware.js';
import { supabase } from '../config/supabase.js';
import { logSystemEvent } from '../services/system-logger.js';
import { createTicketingProvider, isTicketingConfigured } from '../services/ticketing/ticketing.factory.js';
import { formatBugMetadataFooter, type BugReportMetadata } from '../services/ticketing/build-bug-description.js';
import { parseBugReportAttachments } from '../services/bug-report-attachments.js';
import { resolveTenantBranding, buildBrandedFromAddress } from '../services/tenant-branding.service.js';

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_TITLE = 200;
const MAX_DESCRIPTION = 8000;
const MAX_ROUTE_LEN = 512;

function ticketStatusEnabled(): boolean {
    const v = (process.env.SUPPORT_TICKET_STATUS_ENABLED || '').trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes';
}

function statusRefreshTtlMs(): number {
    const raw = parseInt(process.env.SUPPORT_TICKET_STATUS_TTL_SECONDS || '600', 10);
    if (!Number.isFinite(raw) || raw < 60) return 60_000;
    return raw * 1000;
}

function appBuildLabel(): string | null {
    const explicit = process.env.APP_BUILD_VERSION?.trim();
    if (explicit) return explicit;
    const vercel = process.env.VERCEL_GIT_COMMIT_SHA?.trim();
    if (vercel) return vercel.slice(0, 12);
    return null;
}

function badRequest(res: Response, msg: string) {
    return res.status(400).json({ success: false, error: msg });
}

async function resolveReporterEmail(req: Request, userId: string): Promise<string | null> {
    const { data: profile } = await supabase.from('profiles').select('email').eq('id', userId).maybeSingle();
    const fromProfile = typeof profile?.email === 'string' ? profile.email.trim() : '';
    if (fromProfile.includes('@')) return fromProfile.toLowerCase();

    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) return null;
    const token = auth.slice(7).trim();
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user?.email) return null;
    const e = data.user.email.trim().toLowerCase();
    return e.includes('@') ? e : null;
}

function mapListRow(row: {
    id: string;
    title: string;
    vendor: string;
    external_id: string;
    identifier: string | null;
    url: string | null;
    cached_status: string | null;
    status_refreshed_at: string | null;
    created_at: string;
    description_snapshot?: string | null;
    shop_id?: string | null;
    shop_name?: string | null;
    account_id?: string | null;
}) {
    return {
        id: row.id,
        title: row.title,
        vendor: row.vendor,
        externalId: row.external_id,
        identifier: row.identifier,
        url: row.url,
        status: row.cached_status,
        statusRefreshedAt: row.status_refreshed_at,
        createdAt: row.created_at,
        descriptionPreview:
            typeof row.description_snapshot === 'string'
                ? row.description_snapshot.length > 160
                    ? `${row.description_snapshot.slice(0, 160)}…`
                    : row.description_snapshot
                : null,
        shopId: row.shop_id ?? null,
        shopName: row.shop_name ?? null,
        accountId: row.account_id ?? null,
    };
}

/**
 * POST /api/support/bug-reports
 * body: { title, description, route?, accountId?, shopId?, shopName?, userAgent?, attachments? }
 */
router.post('/bug-reports', async (req, res) => {
    try {
        const userId = await resolveRequestUserId(req);
        if (!userId) {
            return res.status(401).json({ success: false, error: 'Authorization required' });
        }

        const provider = createTicketingProvider();
        if (!isTicketingConfigured(provider)) {
            return res.status(503).json({
                success: false,
                error: 'Bug reporting is not configured. Ask your administrator to set up ticketing.',
            });
        }

        const body = (req.body || {}) as Record<string, unknown>;
        const titleRaw = typeof body.title === 'string' ? body.title.trim() : '';
        const descriptionRaw = typeof body.description === 'string' ? body.description.trim() : '';
        if (!titleRaw || titleRaw.length > MAX_TITLE) {
            return badRequest(res, `title is required (max ${MAX_TITLE} characters)`);
        }
        if (!descriptionRaw || descriptionRaw.length > MAX_DESCRIPTION) {
            return badRequest(res, `description is required (max ${MAX_DESCRIPTION} characters)`);
        }

        let accountId: string | null = null;
        if (body.accountId != null) {
            if (typeof body.accountId !== 'string' || !UUID_RE.test(body.accountId)) {
                return badRequest(res, 'accountId must be a valid UUID when provided');
            }
            const ok = await userCanAccessAccount(userId, body.accountId, 'POST', req);
            if (!ok) {
                return res.status(403).json({ success: false, error: 'Access denied for this account' });
            }
            accountId = body.accountId;
        }

        const shopId = typeof body.shopId === 'string' && body.shopId.trim() ? body.shopId.trim().slice(0, 128) : null;
        const shopName = typeof body.shopName === 'string' && body.shopName.trim() ? body.shopName.trim().slice(0, 256) : null;
        const clientRoute =
            typeof body.route === 'string' && body.route.trim() ? body.route.trim().slice(0, MAX_ROUTE_LEN) : null;
        const userAgent =
            typeof body.userAgent === 'string' && body.userAgent.trim()
                ? body.userAgent.trim().slice(0, 2000)
                : typeof req.headers['user-agent'] === 'string'
                  ? req.headers['user-agent'].slice(0, 2000)
                  : null;

        const tenantCtx = await resolveRequestTenantContext(req);
        const tenantId = tenantCtx?.tenantId && tenantCtx.tenantId !== '00000000-0000-0000-0000-000000000000' ? tenantCtx.tenantId : null;

        const userEmail = await resolveReporterEmail(req, userId);

        if (!userEmail) {
            return badRequest(
                res,
                'An email address is required to submit a bug report. Update your profile or sign in with an email-based account.',
            );
        }

        const requestId = typeof res.locals?.requestId === 'string' ? res.locals.requestId : null;

        const meta: BugReportMetadata = {
            userId,
            userEmail,
            tenantId,
            accountId,
            shopId,
            shopName,
            clientRoute,
            requestId,
            environment: process.env.NODE_ENV || 'production',
            appBuild: appBuildLabel(),
            userAgent,
        };

        const fullDescription = `${descriptionRaw}\n\n${formatBugMetadataFooter(meta)}`;

        const branding = await resolveTenantBranding(tenantId);
        const brandedFrom = buildBrandedFromAddress(branding);

        const parsedAttachments = parseBugReportAttachments(body);
        if (!parsedAttachments.ok) {
            return badRequest(res, parsedAttachments.error);
        }

        let created;
        try {
            created = await provider.createIssue({
                title: titleRaw,
                description: fullDescription,
                reporterEmail: userEmail,
                attachments: parsedAttachments.attachments,
                emailFrom: brandedFrom,
                emailFromDisplayName: branding.displayName,
            });
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            logSystemEvent({
                level: 'error',
                scope: 'support',
                event: 'support.ticket_create_failed',
                message: msg,
                accountId,
                shopId,
                data: { userId, vendor: provider.id },
            });
            return res.status(502).json({
                success: false,
                error: 'Could not create ticket with the support system. Try again later.',
            });
        }

        const { data: insertedRow, error: insertErr } = await supabase
            .from('support_ticket_submissions')
            .insert({
                user_id: userId,
                tenant_id: tenantId,
                account_id: accountId,
                shop_id: shopId,
                shop_name: shopName,
                title: titleRaw,
                description_snapshot: descriptionRaw,
                vendor: provider.id,
                external_id: created.externalId,
                identifier: created.identifier,
                url: created.url,
                cached_status: created.initialStatus,
                status_refreshed_at: new Date().toISOString(),
            })
            .select('id')
            .maybeSingle();

        if (insertErr) {
            logSystemEvent({
                level: 'warn',
                scope: 'support',
                event: 'support.ticket_persist_failed',
                message: insertErr.message,
                accountId,
                shopId,
                data: {
                    userId,
                    externalId: created.externalId,
                    detail: insertErr.details,
                    hint: insertErr.hint,
                },
            });
        }

        const submissionId = typeof insertedRow?.id === 'string' ? insertedRow.id : null;

        return res.json({
            success: true,
            data: {
                submissionId,
                externalId: created.externalId,
                identifier: created.identifier,
                url: created.url,
                status: created.initialStatus,
                statusVisibilityEnabled: ticketStatusEnabled(),
            },
        });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Failed to submit bug report';
        return res.status(500).json({ success: false, error: msg });
    }
});

/**
 * GET /api/support/bug-reports
 * Lists the signed-in user's submissions. Vendor status refresh runs only when SUPPORT_TICKET_STATUS_ENABLED is true.
 */
router.get('/bug-reports', async (req, res) => {
    try {
        const userId = await resolveRequestUserId(req);
        if (!userId) {
            return res.status(401).json({ success: false, error: 'Authorization required' });
        }

        const statusRefresh = ticketStatusEnabled();
        const provider = createTicketingProvider();
        const runVendorRefresh = statusRefresh && isTicketingConfigured(provider);

        const { data: rows, error } = await supabase
            .from('support_ticket_submissions')
            .select(
                'id, title, vendor, external_id, identifier, url, cached_status, status_refreshed_at, created_at, description_snapshot, shop_id, shop_name, account_id',
            )
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) {
            logSystemEvent({
                level: 'error',
                scope: 'support',
                event: 'support.list_failed',
                message: error.message,
                data: { userId },
            });
            return res.status(500).json({ success: false, error: 'Could not load reports' });
        }

        const ttl = statusRefreshTtlMs();
        const now = Date.now();
        const out = [];

        for (const row of rows || []) {
            const r = row as Parameters<typeof mapListRow>[0];
            const externalId = typeof r.external_id === 'string' ? r.external_id : '';
            if (!externalId) continue;

            let status = typeof r.cached_status === 'string' ? r.cached_status : null;
            let refreshedAt = r.status_refreshed_at as string | null;
            const refreshedMs = refreshedAt ? new Date(refreshedAt).getTime() : 0;
            const stale = !refreshedMs || now - refreshedMs > ttl;

            if (runVendorRefresh && stale) {
                try {
                    const live = await provider.getIssueStatus(externalId);
                    if (live?.status != null) {
                        status = live.status;
                        refreshedAt = new Date().toISOString();
                        await supabase
                            .from('support_ticket_submissions')
                            .update({ cached_status: status, status_refreshed_at: refreshedAt })
                            .eq('id', r.id);
                    }
                } catch {
                    // keep cached status
                }
            }

            out.push(
                mapListRow({
                    ...r,
                    cached_status: status,
                    status_refreshed_at: refreshedAt,
                }),
            );
        }

        return res.json({
            success: true,
            data: { statusVisibilityEnabled: statusRefresh, items: out },
        });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Failed to list bug reports';
        return res.status(500).json({ success: false, error: msg });
    }
});

/**
 * GET /api/support/bug-reports/:submissionId
 */
router.get('/bug-reports/:submissionId', async (req, res) => {
    try {
        const submissionId = req.params.submissionId;
        if (!UUID_RE.test(submissionId)) {
            return badRequest(res, 'Invalid submission id');
        }
        const userId = await resolveRequestUserId(req);
        if (!userId) {
            return res.status(401).json({ success: false, error: 'Authorization required' });
        }

        const { data: row, error } = await supabase
            .from('support_ticket_submissions')
            .select(
                'id, title, vendor, external_id, identifier, url, cached_status, status_refreshed_at, created_at, description_snapshot, shop_id, shop_name, account_id, tenant_id',
            )
            .eq('id', submissionId)
            .eq('user_id', userId)
            .maybeSingle();

        if (error) {
            logSystemEvent({
                level: 'error',
                scope: 'support',
                event: 'support.detail_failed',
                message: error.message,
                data: { userId, submissionId },
            });
            return res.status(500).json({ success: false, error: 'Could not load report' });
        }
        if (!row) {
            return res.status(404).json({ success: false, error: 'Report not found' });
        }

        const r = row as Record<string, unknown>;
        return res.json({
            success: true,
            data: {
                item: {
                    id: r.id,
                    title: r.title,
                    vendor: r.vendor,
                    externalId: r.external_id,
                    identifier: r.identifier,
                    url: r.url,
                    status: r.cached_status,
                    statusRefreshedAt: r.status_refreshed_at,
                    createdAt: r.created_at,
                    description: typeof r.description_snapshot === 'string' ? r.description_snapshot : null,
                    shopId: r.shop_id ?? null,
                    shopName: r.shop_name ?? null,
                    accountId: r.account_id ?? null,
                    tenantId: r.tenant_id ?? null,
                },
            },
        });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Failed to load bug report';
        return res.status(500).json({ success: false, error: msg });
    }
});

export default router;
