import express from 'express';
import { supabase } from '../config/supabase.js';
import { resolveRequestUserId } from '../middleware/account-access.middleware.js';
import { sendHtmlEmail } from '../services/email.js';
import { auditLog } from '../services/audit-logger.js';
import { authorize } from '../services/authorization.service.js';
import { applyFinancialFieldFiltering, getFinancialFieldAccess } from '../services/financial-visibility.service.js';
import { calculateOrderGMV } from '../utils/gmvCalculations.js';
import { isCancelledOrRefunded } from '../utils/orderFinancials.js';
import {
    formatShopDateISO,
    getShopDayEndExclusiveTimestamp,
    getShopDayStartTimestamp,
    previousCalendarDayISO,
} from '../utils/dateUtils.js';

const router = express.Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const EXPORT_PERMISSION = 'export_pnl';
const EXPORT_FEATURE = 'export_pnl';
const SCHEDULE_PERMISSION = 'schedule_export';
const SCHEDULE_FEATURE = 'schedule_export';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

type ShopOrderRow = {
    order_id: string;
    order_status?: string | null;
    paid_time?: string | null;
    create_time?: string | null;
    payment_info?: Record<string, string | undefined> | null;
    /** DB column is `total_amount`; client store uses `order_amount` after mapping. */
    total_amount?: number | string | null;
    is_sample_order?: boolean | null;
    cancel_reason?: string | null;
    cancellation_initiator?: string | null;
};

function orderPaidTs(o: ShopOrderRow): number {
    if (o.paid_time) {
        const t = new Date(o.paid_time).getTime();
        if (!Number.isNaN(t)) return Math.floor(t / 1000);
    }
    if (o.create_time) {
        const t = new Date(o.create_time).getTime();
        if (!Number.isNaN(t)) return Math.floor(t / 1000);
    }
    return 0;
}

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

async function getSellerTenantIdForAccount(accountId: string): Promise<string | null> {
    const { data, error } = await supabase
        .from('accounts')
        .select('tenant_id')
        .eq('id', accountId)
        .maybeSingle();
    if (error || !data?.tenant_id) return null;
    return data.tenant_id as string;
}

async function assertCanExportDashboard(req: express.Request, accountId: string): Promise<{ ok: boolean; userId: string | null; reason?: string }> {
    const userId = await resolveRequestUserId(req);
    if (!userId) return { ok: false, userId: null, reason: 'Authorization required' };

    const exportAuth = await authorize(req, {
        action: EXPORT_PERMISSION,
        accountId,
        featureKey: EXPORT_FEATURE,
        denyAction: 'export.permission_denied',
    });
    if (!exportAuth.allowed) {
        return { ok: false, userId, reason: exportAuth.reason };
    }
    return { ok: true, userId };
}

/**
 * Frontend passes TikTok `shop_id` (platform id) in most places; DB rows use UUID `id`.
 * Resolve to the internal row for this account.
 */
async function resolveTiktokShopForAccount(
    accountId: string,
    shopIdOrKey: string
): Promise<{ id: string; shop_name: string | null; timezone: string | null; account_id: string } | null> {
    if (!UUID_RE.test(accountId)) return null;
    const key = String(shopIdOrKey ?? '').trim();
    if (!key) return null;

    if (UUID_RE.test(key)) {
        const { data, error } = await supabase
            .from('tiktok_shops')
            .select('id, shop_name, timezone, account_id')
            .eq('id', key)
            .eq('account_id', accountId)
            .maybeSingle();
        if (error || !data) return null;
        return data;
    }

    const { data: byPlatformId, error: e1 } = await supabase
        .from('tiktok_shops')
        .select('id, shop_name, timezone, account_id')
        .eq('account_id', accountId)
        .eq('shop_id', key)
        .maybeSingle();
    if (!e1 && byPlatformId) return byPlatformId;

    const { data: byName } = await supabase
        .from('tiktok_shops')
        .select('id, shop_name, timezone, account_id')
        .eq('account_id', accountId)
        .eq('shop_name', key)
        .maybeSingle();
    return byName ?? null;
}

async function loadOrdersInPaidRange(
    shopId: string,
    startIso: string,
    endIso: string
): Promise<ShopOrderRow[]> {
    const pageSize = 1000;
    const all: ShopOrderRow[] = [];
    let from = 0;
    for (;;) {
        const { data, error } = await supabase
            .from('shop_orders')
            .select(
                'order_id, order_status, paid_time, create_time, payment_info, total_amount, is_sample_order, cancel_reason, cancellation_initiator'
            )
            .eq('shop_id', shopId)
            .not('paid_time', 'is', null)
            .gte('paid_time', startIso)
            .lt('paid_time', endIso)
            .order('paid_time', { ascending: true })
            .range(from, from + pageSize - 1);

        if (error) throw error;
        const batch = (data || []) as ShopOrderRow[];
        all.push(...batch);
        if (batch.length < pageSize) break;
        from += pageSize;
        if (from > 20000) break;
    }
    return all;
}

function summarizeOrders(orders: ShopOrderRow[], startSec: number, endSec: number) {
    const inRange = orders.filter((o) => {
        const ts = orderPaidTs(o);
        return ts >= startSec && ts < endSec;
    });

    const nonSample = inRange.filter((o) => !o.is_sample_order);
    const forMetrics = nonSample.filter((o) => !isCancelledOrRefunded(o));
    const orderCount = forMetrics.length;
    const gmv = forMetrics.reduce((sum, o) => sum + calculateOrderGMV(o), 0);
    return { orderCount, gmv, totalPaidInRange: inRange.length };
}

type ReportType = 'order' | 'pl';

type PlSummary = {
    gmv: number;
    totalOrders: number;
    totalRevenue: number;
    netSales: number;
    grossProfit: number;
    netProfit: number;
    adSpend?: number;
};

function money(n: number): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

function parseReportTypes(body: Record<string, unknown> | null | undefined): ReportType[] {
    const raw = body?.reportTypes;
    if (Array.isArray(raw)) {
        const set = new Set<ReportType>();
        for (const x of raw) {
            if (x === 'order' || x === 'pl') set.add(x);
        }
        return Array.from(set);
    }
    const mode = body?.reportMode;
    if (mode === 'both') return ['order', 'pl'];
    if (mode === 'pl') return ['pl'];
    if (mode === 'order') return ['order'];
    return ['order'];
}

function parsePlSummary(body: Record<string, unknown> | null | undefined): PlSummary | null {
    const p = body?.plSummary;
    if (!p || typeof p !== 'object') return null;
    const o = p as Record<string, unknown>;
    const keys = ['gmv', 'totalOrders', 'totalRevenue', 'netSales', 'grossProfit', 'netProfit'] as const;
    for (const k of keys) {
        const v = o[k];
        if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    }
    const adRaw = o.adSpend;
    const adSpend =
        typeof adRaw === 'number' && Number.isFinite(adRaw) ? adRaw : undefined;
    return {
        gmv: o.gmv as number,
        totalOrders: o.totalOrders as number,
        totalRevenue: o.totalRevenue as number,
        netSales: o.netSales as number,
        grossProfit: o.grossProfit as number,
        netProfit: o.netProfit as number,
        adSpend,
    };
}

function buildEmailShell(
    accountName: string,
    shopLabel: string,
    periodLabel: string,
    inner: string,
    footerNote: string
): string {
    return `
<div style="font-family:Inter,system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#0f0f12;color:#e5e5e5;">
  <h1 style="font-size:18px;margin:0 0 8px;color:#fff;">Mamba — dashboard report</h1>
  <p style="margin:0 0 16px;color:#a3a3a3;font-size:14px;">
    ${escapeHtml(accountName)} · ${escapeHtml(shopLabel)}
  </p>
  <p style="margin:0 0 20px;color:#d4d4d4;font-size:14px;">Period: <strong style="color:#fff;">${escapeHtml(
      periodLabel
  )}</strong></p>
  ${inner}
  <p style="margin-top:24px;font-size:11px;color:#525252;">${escapeHtml(footerNote)}</p>
</div>`.trim();
}

function buildOrderSectionHtml(opts: {
    orderCount: number;
    gmv: number;
    note?: string;
}): string {
    const gmvStr = money(opts.gmv);
    return `
  <div style="margin-bottom:28px;padding-bottom:20px;border-bottom:1px solid #27272a;">
    <h2 style="font-size:15px;margin:0 0 12px;color:#fafafa;">Order-based summary</h2>
    <p style="margin:0 0 12px;font-size:12px;color:#737373;">Computed from paid orders in the database (same GMV rules as the live dashboard).</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #27272a;color:#a3a3a3;">Paid orders (excl. cancelled / sample)</td>
        <td style="padding:10px 0;border-bottom:1px solid #27272a;text-align:right;font-weight:600;color:#fff;">${
            opts.orderCount
        }</td>
      </tr>
      <tr>
        <td style="padding:10px 0;color:#a3a3a3;">GMV</td>
        <td style="padding:10px 0;text-align:right;font-weight:600;color:#fff;">${escapeHtml(gmvStr)}</td>
      </tr>
    </table>
    ${
        opts.note
            ? `<p style="margin-top:12px;font-size:12px;color:#737373;">${escapeHtml(opts.note)}</p>`
            : ''
    }
  </div>`;
}

function buildPlSectionHtml(pl: PlSummary): string {
    const rows: [string, string][] = [
        ['GMV (dashboard)', money(pl.gmv)],
        ['Orders (dashboard count)', String(pl.totalOrders)],
        ['Total revenue', money(pl.totalRevenue)],
        ['Net sales (statements)', money(pl.netSales)],
        ['Gross profit', money(pl.grossProfit)],
        ['Net profit', money(pl.netProfit)],
    ];
    if (pl.adSpend !== undefined) {
        rows.push(['Marketing ad spend (synced)', money(pl.adSpend)]);
    }
    const tableRows = rows
        .map(
            ([label, val], i) =>
                `<tr>
      <td style="padding:8px 0;border-bottom:1px solid #27272a;color:#a3a3a3;">${escapeHtml(label)}</td>
      <td style="padding:8px 0;border-bottom:1px solid #27272a;text-align:right;font-weight:600;color:#fff;">${escapeHtml(val)}</td>
    </tr>`
        )
        .join('');
    return `
  <div style="margin-bottom:8px;">
    <h2 style="font-size:15px;margin:0 0 12px;color:#fafafa;">P&amp;L-style summary</h2>
    <p style="margin:0 0 12px;font-size:12px;color:#737373;">Figures match what you had on screen when sending (Overview / P&amp;L date range).</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">${tableRows}</table>
  </div>`;
}

/**
 * POST /api/reports/email-dashboard
 * body: { accountId, shopId, startDate, endDate, to, timezone?, reportTypes?: ('order'|'pl')[], plSummary?: {...} }
 * plSummary required when reportTypes includes 'pl' (validated numbers from client Overview/P&L).
 */
router.post('/email-dashboard', async (req, res) => {
    try {
        const body = req.body as Record<string, unknown> | undefined;
        const { accountId, shopId, startDate, endDate, to, timezone: tzBody } = body ?? {};
        const toEmail = typeof to === 'string' ? to.trim() : '';
        const shopKey = typeof shopId === 'string' ? shopId.trim() : '';
        if (!UUID_RE.test(accountId as string) || !shopKey) {
            res.status(400).json({ success: false, error: 'Valid accountId and shopId are required' });
            return;
        }
        if (!startDate || !endDate || typeof startDate !== 'string' || typeof endDate !== 'string') {
            res.status(400).json({ success: false, error: 'startDate and endDate (YYYY-MM-DD) are required' });
            return;
        }
        if (!EMAIL_RE.test(toEmail)) {
            res.status(400).json({ success: false, error: 'Valid recipient email (to) is required' });
            return;
        }

        const reportTypes = parseReportTypes(body);
        if (reportTypes.length === 0) {
            res.status(400).json({
                success: false,
                error: 'Select at least one report: order-based and/or P&L summary (reportTypes)',
            });
            return;
        }

        const needsPl = reportTypes.includes('pl');
        const plParsed = needsPl ? parsePlSummary(body) : null;
        if (needsPl && !plParsed) {
            res.status(400).json({
                success: false,
                error: 'plSummary with numeric gmv, totalOrders, totalRevenue, netSales, grossProfit, netProfit is required when including P&L',
            });
            return;
        }

        const can = await assertCanExportDashboard(req, accountId as string);
        if (!can.ok || !can.userId) {
            res.status(403).json({
                success: false,
                error: can.reason || 'You do not have permission to email dashboard exports for this account',
            });
            return;
        }
        const userId = can.userId;

        const shop = await resolveTiktokShopForAccount(accountId as string, shopKey);
        if (!shop) {
            res.status(400).json({ success: false, error: 'Shop not found for this account' });
            return;
        }
        const internalShopId = shop.id;

        const { data: account, error: accErr } = await supabase
            .from('accounts')
            .select('id, name')
            .eq('id', accountId as string)
            .maybeSingle();
        if (accErr || !account) {
            res.status(400).json({ success: false, error: 'Account not found' });
            return;
        }

        const timezone =
            (typeof tzBody === 'string' && tzBody.trim()) || shop.timezone || 'America/Los_Angeles';
        const periodLabel = `${startDate} → ${endDate} (${timezone})`;

        const parts: string[] = [];
        let orderCount = 0;
        let gmv = 0;

        if (reportTypes.includes('order')) {
            const startUnix = getShopDayStartTimestamp(startDate, timezone);
            const endUnix = getShopDayEndExclusiveTimestamp(endDate, timezone);
            const startIso = new Date(startUnix * 1000).toISOString();
            const endIso = new Date(endUnix * 1000).toISOString();
            const orders = await loadOrdersInPaidRange(internalShopId, startIso, endIso);
            const sum = summarizeOrders(orders, startUnix, endUnix);
            orderCount = sum.orderCount;
            gmv = sum.gmv;
            const note =
                orders.length >= 20000
                    ? 'Summary capped at 20k orders loaded; totals may be incomplete.'
                    : undefined;
            parts.push(buildOrderSectionHtml({ orderCount, gmv, note }));
        }

        if (needsPl && plParsed) {
            const sellerTenantId = await getSellerTenantIdForAccount(accountId as string);
            if (sellerTenantId) {
                const fieldAccess = await getFinancialFieldAccess(userId, sellerTenantId);
                const filtered = applyFinancialFieldFiltering(
                    {
                        gmv: plParsed.gmv,
                        totalOrders: plParsed.totalOrders,
                        totalRevenue: plParsed.totalRevenue,
                        netSales: plParsed.netSales,
                        grossProfit: plParsed.grossProfit,
                        netProfit: plParsed.netProfit,
                        adSpend: plParsed.adSpend,
                        margin: plParsed.totalRevenue !== 0 ? (plParsed.netProfit / plParsed.totalRevenue) * 100 : 0,
                    },
                    fieldAccess
                ) as Record<string, unknown>;
                const nextSummary: PlSummary = {
                    gmv: Number(filtered.gmv ?? plParsed.gmv),
                    totalOrders: Number(filtered.totalOrders ?? plParsed.totalOrders),
                    totalRevenue: Number(filtered.totalRevenue ?? plParsed.totalRevenue),
                    netSales: Number(filtered.netSales ?? plParsed.netSales),
                    grossProfit: Number(filtered.grossProfit ?? plParsed.grossProfit),
                    netProfit: Number(filtered.netProfit ?? plParsed.netProfit),
                    adSpend: typeof filtered.adSpend === 'number' ? filtered.adSpend : undefined,
                };
                parts.push(buildPlSectionHtml(nextSummary));
                if (typeof filtered.restriction_notice === 'string') {
                    parts.push(
                        `<p style="margin-top:8px;font-size:12px;color:#facc15;">${escapeHtml(filtered.restriction_notice)}</p>`
                    );
                }
            } else {
                parts.push(buildPlSectionHtml(plParsed));
            }
        }

        const footer =
            reportTypes.length > 1
                ? 'Generated by Mamba — combined report. Open the app for full detail and drill-down.'
                : 'Generated by Mamba. Open the app for full detail and drill-down.';

        const html = buildEmailShell(
            account.name || 'Shop',
            shop.shop_name || 'TikTok Shop',
            periodLabel,
            parts.join(''),
            footer
        );

        const typeLabel =
            reportTypes.length === 2 ? 'orders + P&L' : reportTypes[0] === 'pl' ? 'P&L' : 'orders';
        const subject = `Mamba ${typeLabel}: ${account.name || 'Shop'} (${periodLabel})`;
        const { delivered } = await sendHtmlEmail(toEmail, subject, html);

        // Audit: record data export event (who sent what data to whom)
        auditLog(req, {
            action: 'export.dashboard_email',
            resourceType: 'account',
            resourceId: accountId as string,
            accountId: accountId as string,
            metadata: {
                shopId: internalShopId,
                to: toEmail,
                reportTypes,
                startDate,
                endDate,
                delivered,
            },
        }).catch(() => undefined);

        res.json({
            success: true,
            data: {
                sent: true,
                emailDelivered: delivered,
                orderCount,
                gmv,
                reportTypes,
            },
        });
    } catch (e: any) {
        console.error('[reports] email-dashboard', e);
        res.status(500).json({ success: false, error: e.message || 'Failed to send email' });
    }
});

/** POST /api/reports/schedules — daily automated digest at hour_utc. */
router.post('/schedules', async (req, res) => {
    try {
        const { accountId, shopId, recipientEmail, timezone, hourUtc } = req.body ?? {};
        const email = typeof recipientEmail === 'string' ? recipientEmail.trim() : '';
        const shopKey = typeof shopId === 'string' ? shopId.trim() : '';
        if (!UUID_RE.test(accountId) || !shopKey || !EMAIL_RE.test(email)) {
            res.status(400).json({ success: false, error: 'Valid accountId, shopId, and recipientEmail required' });
            return;
        }

        const h = hourUtc !== undefined ? Number(hourUtc) : 14;
        if (!Number.isInteger(h) || h < 0 || h > 23) {
            res.status(400).json({ success: false, error: 'hourUtc must be 0–23 (UTC hour to send)' });
            return;
        }

        const canExport = await assertCanExportDashboard(req, accountId);
        if (!canExport.ok || !canExport.userId) {
            res.status(403).json({ success: false, error: canExport.reason || 'Permission denied for this account' });
            return;
        }
        const userId = canExport.userId;

        const canSchedule = await authorize(req, {
            action: SCHEDULE_PERMISSION,
            accountId,
            featureKey: SCHEDULE_FEATURE,
            denyAction: 'export.schedule_permission_denied',
        });
        if (!canSchedule.allowed) {
            res.status(canSchedule.status).json({ success: false, error: canSchedule.reason });
            return;
        }

        const shop = await resolveTiktokShopForAccount(accountId, shopKey);
        if (!shop) {
            res.status(400).json({ success: false, error: 'Shop not found for this account' });
            return;
        }

        const tz =
            typeof timezone === 'string' && timezone.trim() ? timezone.trim() : 'America/Los_Angeles';

        const { data: row, error: insErr } = await supabase
            .from('dashboard_email_schedules')
            .insert({
                created_by: userId,
                account_id: accountId,
                shop_id: shop.id,
                recipient_email: email,
                timezone: tz,
                hour_utc: h,
                enabled: true,
            })
            .select('id')
            .single();

        if (insErr) {
            console.error('[reports] schedule insert', insErr.message);
            res.status(400).json({ success: false, error: insErr.message });
            return;
        }

        res.json({ success: true, data: { id: row.id } });
    } catch (e: any) {
        console.error('[reports] schedules POST', e);
        res.status(500).json({ success: false, error: e.message || 'Internal error' });
    }
});

router.get('/schedules', async (req, res) => {
    try {
        const userId = await resolveRequestUserId(req);
        if (!userId) {
            res.status(401).json({ success: false, error: 'Authorization required' });
            return;
        }

        const { data, error } = await supabase
            .from('dashboard_email_schedules')
            .select('id, account_id, shop_id, recipient_email, timezone, hour_utc, enabled, last_sent_on, created_at')
            .eq('created_by', userId)
            .order('created_at', { ascending: false });

        if (error) {
            res.status(500).json({ success: false, error: error.message });
            return;
        }
        res.json({ success: true, data: data ?? [] });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.delete('/schedules/:id', async (req, res) => {
    try {
        const userId = await resolveRequestUserId(req);
        if (!userId) {
            res.status(401).json({ success: false, error: 'Authorization required' });
            return;
        }
        const id = req.params.id;
        if (!UUID_RE.test(id)) {
            res.status(400).json({ success: false, error: 'Invalid id' });
            return;
        }

        const { error } = await supabase
            .from('dashboard_email_schedules')
            .delete()
            .eq('id', id)
            .eq('created_by', userId);

        if (error) {
            res.status(500).json({ success: false, error: error.message });
            return;
        }
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * GET /api/reports/cron-dashboard-digests?secret=...
 * Vercel Cron: must run at most once per day on Hobby; we use one daily slot (see server/vercel.json).
 * Sends "yesterday" in each schedule's shop timezone at most once per UTC calendar day (last_sent_on).
 * hour_utc is stored for optional external schedulers or future Pro (hourly) setups; this endpoint ignores it.
 */
router.get('/cron-dashboard-digests', async (req, res) => {
    try {
        const secret = process.env.CRON_SECRET || process.env.REPORTS_CRON_SECRET;
        if (!secret) {
            res.status(503).json({ success: false, error: 'CRON_SECRET not configured' });
            return;
        }
        const expectedHeader = `Bearer ${secret}`;
        const authHeader = req.headers.authorization || '';
        const q = typeof req.query.secret === 'string' ? req.query.secret : '';
        if (authHeader !== expectedHeader && q !== secret) {
            res.status(403).json({ success: false, error: 'Forbidden' });
            return;
        }

        const todayUtc = new Date().toISOString().slice(0, 10);

        const { data: schedules, error } = await supabase
            .from('dashboard_email_schedules')
            .select('*')
            .eq('enabled', true);

        if (error) {
            res.status(500).json({ success: false, error: error.message });
            return;
        }

        let sent = 0;
        for (const row of schedules || []) {
            if (row.last_sent_on === todayUtc) continue;

            const ownerId = row.created_by as string;
            const accountId = row.account_id as string;
            const shopId = row.shop_id as string;

            const stillOk =
                (await (async () => {
                    const { data: accountOk } = await supabase.rpc('check_user_account_access', {
                        p_user_id: ownerId,
                        p_account_id: accountId,
                    });
                    if (accountOk !== true) return false;

                    const { data: profile } = await supabase
                        .from('profiles')
                        .select('tenant_id')
                        .eq('id', ownerId)
                        .maybeSingle();
                    if (!profile?.tenant_id) return false;

                    const { data: permRows } = await supabase.rpc('get_user_effective_permissions_on_tenant', {
                        p_user_id: ownerId,
                        p_tenant_id: profile.tenant_id,
                    });
                    const hasExportPerm = Array.isArray(permRows)
                        && permRows.some((r: any) => r?.action === EXPORT_PERMISSION);
                    if (!hasExportPerm) return false;

                    const { data: entitlement } = await supabase.rpc('tenant_feature_allowed', {
                        p_tenant_id: profile.tenant_id,
                        p_feature_key: EXPORT_FEATURE,
                    });
                    return entitlement === true;
                })());

            if (!stillOk) continue;

            const { data: shop } = await supabase
                .from('tiktok_shops')
                .select('shop_name, timezone, account_id')
                .eq('id', shopId)
                .maybeSingle();
            if (!shop || shop.account_id !== accountId) continue;

            const { data: account } = await supabase
                .from('accounts')
                .select('name')
                .eq('id', accountId)
                .maybeSingle();

            const tz = (row.timezone as string) || shop.timezone || 'America/Los_Angeles';
            const todayShop = formatShopDateISO(Date.now(), tz);
            const yStr = previousCalendarDayISO(todayShop, tz);
            const startUnix = getShopDayStartTimestamp(yStr, tz);
            const endUnix = getShopDayEndExclusiveTimestamp(yStr, tz);
            const startIso = new Date(startUnix * 1000).toISOString();
            const endIso = new Date(endUnix * 1000).toISOString();

            try {
                const orders = await loadOrdersInPaidRange(shopId, startIso, endIso);
                const { orderCount, gmv } = summarizeOrders(orders, startUnix, endUnix);
                const periodLabel = `${yStr} (${tz}, previous shop day)`;
                const inner = buildOrderSectionHtml({
                    orderCount,
                    gmv,
                    note: 'Automated daily digest (order-based only).',
                });
                const html = buildEmailShell(
                    account?.name || 'Shop',
                    shop.shop_name || 'TikTok Shop',
                    periodLabel,
                    inner,
                    'Generated by Mamba. P&L detail is available in the app.'
                );
                const subject = `Mamba daily digest: ${account?.name || 'Shop'} (${yStr})`;
                const { delivered } = await sendHtmlEmail(row.recipient_email as string, subject, html);

                if (delivered) {
                    await supabase
                        .from('dashboard_email_schedules')
                        .update({ last_sent_on: todayUtc, updated_at: new Date().toISOString() })
                        .eq('id', row.id);
                    sent += 1;
                } else {
                    console.warn('[reports] cron digest skipped last_sent_on — email not delivered (no RESEND_API_KEY?)');
                }
            } catch (err: any) {
                console.error('[reports] cron digest row', row.id, err?.message);
            }
        }

        res.json({ success: true, data: { checked: (schedules || []).length, sent } });
    } catch (e: any) {
        console.error('[reports] cron', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

export default router;
