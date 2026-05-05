import express from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { supabase } from '../config/supabase.js';
import { authorize } from '../services/authorization.service.js';
import { auditLog } from '../services/audit-logger.js';
import { userIsPlatformSuperAdmin, type RequestTenantContext } from '../middleware/account-access.middleware.js';

const router = express.Router();

const BRANDING_LOGO_BUCKET = 'tenant-branding-logos';
const BRANDING_LOGO_SIGNED_SECONDS = Number(process.env.BRANDING_LOGO_SIGNED_TTL_SEC || 3600);
const BRANDING_LOGO_MAX_BYTES = 2 * 1024 * 1024;

const uploadLogo = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: BRANDING_LOGO_MAX_BYTES },
    fileFilter(_req, file, cb) {
        const ok = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(file.mimetype);
        cb(null, ok);
    },
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_COLOR_RE = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RBAC_V2_AUTHZ_ENABLED = process.env.RBAC_V2_AUTHZ !== 'false';

async function hasEffectiveAction(userId: string, tenantId: string, action: string): Promise<boolean> {
    if (!RBAC_V2_AUTHZ_ENABLED) return true;
    const { data, error } = await supabase.rpc('get_user_effective_permissions_on_tenant', {
        p_user_id: userId,
        p_tenant_id: tenantId,
    });
    if (error) {
        console.error('[branding] get_user_effective_permissions_on_tenant', error.message);
        return false;
    }
    const rows = Array.isArray(data) ? data : [];
    return rows.some((row: { action?: string }) => row?.action === action);
}

async function getParentAgencyIdForSellerTenant(sellerTenantId: string): Promise<string | null> {
    const { data, error } = await supabase
        .from('tenants')
        .select('parent_tenant_id')
        .eq('id', sellerTenantId)
        .eq('type', 'seller')
        .maybeSingle();
    if (error || !data?.parent_tenant_id) return null;
    return data.parent_tenant_id as string;
}

async function canViewBrandingTarget(
    userId: string,
    ctx: RequestTenantContext,
    targetAgencyId: string,
    isSuper: boolean,
): Promise<boolean> {
    if (isSuper || !RBAC_V2_AUTHZ_ENABLED) return true;
    if (await hasEffectiveAction(userId, targetAgencyId, 'view_brand_settings')) return true;
    if (ctx.tenantType === 'seller') {
        const parent = await getParentAgencyIdForSellerTenant(ctx.tenantId);
        if (parent === targetAgencyId && (await hasEffectiveAction(userId, ctx.tenantId, 'view_brand_settings'))) {
            return true;
        }
    }
    return false;
}

async function canEditBrandingTarget(userId: string, targetAgencyId: string, isSuper: boolean): Promise<boolean> {
    if (isSuper || !RBAC_V2_AUTHZ_ENABLED) return true;
    return hasEffectiveAction(userId, targetAgencyId, 'edit_brand_settings');
}

const PLATFORM_DEFAULTS = {
    primaryColor: '#ec4899',
    secondaryColor: '#6366f1',
    displayName: 'Mamba',
} as const;

type BrandingRow = {
    id: string;
    tenant_id: string;
    primary_color: string | null;
    secondary_color: string | null;
    bg_color: string | null;
    sidebar_bg_color: string | null;
    sidebar_border_color: string | null;
    card_bg_color: string | null;
    card_border_color: string | null;
    text_color: string | null;
    text_muted_color: string | null;
    btn_text_color: string | null;
    card_hover_color: string | null;
    interactive_hover_bg: string | null;
    interactive_focus_ring: string | null;
    success_bg: string | null;
    success_text: string | null;
    success_border: string | null;
    warning_bg: string | null;
    warning_text: string | null;
    warning_border: string | null;
    danger_bg: string | null;
    danger_text: string | null;
    danger_border: string | null;
    info_bg: string | null;
    info_text: string | null;
    info_border: string | null;
    profit_color: string | null;
    loss_color: string | null;
    primary_card_bg: string | null;
    primary_card_border: string | null;
    secondary_card_bg: string | null;
    secondary_card_border: string | null;
    toast_success_bg: string | null;
    toast_success_border: string | null;
    toast_success_icon: string | null;
    toast_error_bg: string | null;
    toast_error_border: string | null;
    toast_error_icon: string | null;
    toast_info_bg: string | null;
    toast_info_border: string | null;
    toast_info_icon: string | null;
    toast_warning_bg: string | null;
    toast_warning_border: string | null;
    toast_warning_icon: string | null;
    chart_grid: string | null;
    chart_axis: string | null;
    chart_series_1: string | null;
    chart_series_2: string | null;
    chart_series_3: string | null;
    chart_series_4: string | null;
    chart_series_5: string | null;
    chart_series_6: string | null;
    chart_positive: string | null;
    chart_negative: string | null;
    chart_neutral: string | null;
    display_name: string | null;
    email_sender_name: string | null;
    email_sender_address: string | null;
    logo_object_path: string | null;
    created_at: string;
    updated_at: string;
    custom_presets: unknown;
};

/** Explicit column list — avoids relying on PostgREST `*` when the schema cache lags migrations. */
const TENANT_BRANDING_SELECT =
    'id, tenant_id, primary_color, secondary_color, bg_color, sidebar_bg_color, sidebar_border_color, card_bg_color, card_border_color, text_color, text_muted_color, btn_text_color, card_hover_color, interactive_hover_bg, interactive_focus_ring, success_bg, success_text, success_border, warning_bg, warning_text, warning_border, danger_bg, danger_text, danger_border, info_bg, info_text, info_border, profit_color, loss_color, primary_card_bg, primary_card_border, secondary_card_bg, secondary_card_border, toast_success_bg, toast_success_border, toast_success_icon, toast_error_bg, toast_error_border, toast_error_icon, toast_info_bg, toast_info_border, toast_info_icon, toast_warning_bg, toast_warning_border, toast_warning_icon, chart_grid, chart_axis, chart_series_1, chart_series_2, chart_series_3, chart_series_4, chart_series_5, chart_series_6, chart_positive, chart_negative, chart_neutral, display_name, email_sender_name, email_sender_address, logo_object_path, custom_presets, created_at, updated_at';

function normalizeRpcSingleBrandingRow(data: unknown): BrandingRow | null {
    if (data == null) return null;
    if (Array.isArray(data)) return (data[0] as BrandingRow | undefined) ?? null;
    return data as BrandingRow;
}

/**
 * Read full `tenant_branding` row from Postgres via RPC (theme columns included).
 * REST `select('*')` can omit columns added after PostgREST last loaded the schema, which made the UI fall back to Midnight defaults.
 */
async function fetchTenantBrandingRow(tenantId: string): Promise<{ data: BrandingRow | null; error: { message: string } | null }> {
    const { data: rpcData, error: rpcErr } = await supabase.rpc('tenant_branding_get_row', { p_tenant_id: tenantId });
    if (!rpcErr) {
        return { data: normalizeRpcSingleBrandingRow(rpcData), error: null };
    }
    console.warn('[branding] tenant_branding_get_row RPC failed, using REST select', rpcErr.message);
    const { data: restData, error: restErr } = await supabase
        .from('tenant_branding')
        .select(TENANT_BRANDING_SELECT)
        .eq('tenant_id', tenantId)
        .maybeSingle();
    if (restErr) return { data: null, error: restErr };
    return { data: (restData as BrandingRow | null) ?? null, error: null };
}

/** Canonical seller-facing theme fallbacks (keep aligned with src/lib/platformBrandingDefaults.ts). */
const PLATFORM_THEME_MERGE_DEFAULTS = {
    bg_color: '#111827',
    sidebar_bg_color: '#111827',
    sidebar_border_color: '#1f2937',
    card_bg_color: '#ffffff06',
    card_border_color: '#ffffff1a',
    text_color: '#ffffff',
    text_muted_color: '#6b7280',
    btn_text_color: '#ffffff',
    card_hover_color: '#ffffff12',
    interactive_hover_bg: '#ffffff12',
    interactive_focus_ring: '#ec489955',
    success_bg: '#10b9811f',
    success_text: '#6ee7b7',
    success_border: '#10b98166',
    warning_bg: '#f59e0b1f',
    warning_text: '#fcd34d',
    warning_border: '#f59e0b66',
    danger_bg: '#ef44441f',
    danger_text: '#fca5a5',
    danger_border: '#ef444466',
    info_bg: '#3b82f61f',
    info_text: '#93c5fd',
    info_border: '#3b82f666',
    profit_color: '#34d399',
    loss_color: '#f87171',
    primary_card_bg: '#111827',
    primary_card_border: '#374151',
    secondary_card_bg: '#1f2937',
    secondary_card_border: '#374151',
    toast_success_bg: '#052e22',
    toast_success_border: '#10b98173',
    toast_success_icon: '#34d399',
    toast_error_bg: '#3f1010',
    toast_error_border: '#ef444473',
    toast_error_icon: '#f87171',
    toast_info_bg: '#0f1f3f',
    toast_info_border: '#3b82f673',
    toast_info_icon: '#60a5fa',
    toast_warning_bg: '#3b2208',
    toast_warning_border: '#f59e0b73',
    toast_warning_icon: '#fbbf24',
    chart_grid: '#33415566',
    chart_axis: '#94a3b8',
    chart_series_1: '#ec4899',
    chart_series_2: '#6366f1',
    chart_series_3: '#22c55e',
    chart_series_4: '#eab308',
    chart_series_5: '#06b6d4',
    chart_series_6: '#f97316',
    chart_positive: '#34d399',
    chart_negative: '#f87171',
    chart_neutral: '#64748b',
} as const;

function mergeBranding(row: BrandingRow | null, agencyTenantId: string | null) {
    const d = PLATFORM_THEME_MERGE_DEFAULTS;
    const source = row ? ('configured' as const) : ('platform_default' as const);
    return {
        agencyTenantId,
        source,
        primaryColor: row?.primary_color?.trim() || PLATFORM_DEFAULTS.primaryColor,
        secondaryColor: row?.secondary_color?.trim() || PLATFORM_DEFAULTS.secondaryColor,
        bgColor: row?.bg_color?.trim() ?? d.bg_color,
        sidebarBgColor: row?.sidebar_bg_color?.trim() ?? d.sidebar_bg_color,
        sidebarBorderColor: row?.sidebar_border_color?.trim() ?? d.sidebar_border_color,
        cardBgColor: row?.card_bg_color?.trim() ?? d.card_bg_color,
        cardBorderColor: row?.card_border_color?.trim() ?? d.card_border_color,
        textColor: row?.text_color?.trim() ?? d.text_color,
        textMutedColor: row?.text_muted_color?.trim() ?? d.text_muted_color,
        btnTextColor: row?.btn_text_color?.trim() ?? d.btn_text_color,
        cardHoverColor: row?.card_hover_color?.trim() ?? d.card_hover_color,
        interactiveHoverBg: row?.interactive_hover_bg?.trim() ?? d.interactive_hover_bg,
        interactiveFocusRing: row?.interactive_focus_ring?.trim() ?? d.interactive_focus_ring,
        successBg: row?.success_bg?.trim() ?? d.success_bg,
        successText: row?.success_text?.trim() ?? d.success_text,
        successBorder: row?.success_border?.trim() ?? d.success_border,
        warningBg: row?.warning_bg?.trim() ?? d.warning_bg,
        warningText: row?.warning_text?.trim() ?? d.warning_text,
        warningBorder: row?.warning_border?.trim() ?? d.warning_border,
        dangerBg: row?.danger_bg?.trim() ?? d.danger_bg,
        dangerText: row?.danger_text?.trim() ?? d.danger_text,
        dangerBorder: row?.danger_border?.trim() ?? d.danger_border,
        infoBg: row?.info_bg?.trim() ?? d.info_bg,
        infoText: row?.info_text?.trim() ?? d.info_text,
        infoBorder: row?.info_border?.trim() ?? d.info_border,
        profitColor: row?.profit_color?.trim() ?? d.profit_color,
        lossColor: row?.loss_color?.trim() ?? d.loss_color,
        primaryCardBg: row?.primary_card_bg?.trim() ?? d.primary_card_bg,
        primaryCardBorder: row?.primary_card_border?.trim() ?? d.primary_card_border,
        secondaryCardBg: row?.secondary_card_bg?.trim() ?? d.secondary_card_bg,
        secondaryCardBorder: row?.secondary_card_border?.trim() ?? d.secondary_card_border,
        toastSuccessBg: row?.toast_success_bg?.trim() ?? d.toast_success_bg,
        toastSuccessBorder: row?.toast_success_border?.trim() ?? d.toast_success_border,
        toastSuccessIcon: row?.toast_success_icon?.trim() ?? d.toast_success_icon,
        toastErrorBg: row?.toast_error_bg?.trim() ?? d.toast_error_bg,
        toastErrorBorder: row?.toast_error_border?.trim() ?? d.toast_error_border,
        toastErrorIcon: row?.toast_error_icon?.trim() ?? d.toast_error_icon,
        toastInfoBg: row?.toast_info_bg?.trim() ?? d.toast_info_bg,
        toastInfoBorder: row?.toast_info_border?.trim() ?? d.toast_info_border,
        toastInfoIcon: row?.toast_info_icon?.trim() ?? d.toast_info_icon,
        toastWarningBg: row?.toast_warning_bg?.trim() ?? d.toast_warning_bg,
        toastWarningBorder: row?.toast_warning_border?.trim() ?? d.toast_warning_border,
        toastWarningIcon: row?.toast_warning_icon?.trim() ?? d.toast_warning_icon,
        chartGrid: row?.chart_grid?.trim() ?? d.chart_grid,
        chartAxis: row?.chart_axis?.trim() ?? d.chart_axis,
        chartSeries1: row?.chart_series_1?.trim() ?? d.chart_series_1,
        chartSeries2: row?.chart_series_2?.trim() ?? d.chart_series_2,
        chartSeries3: row?.chart_series_3?.trim() ?? d.chart_series_3,
        chartSeries4: row?.chart_series_4?.trim() ?? d.chart_series_4,
        chartSeries5: row?.chart_series_5?.trim() ?? d.chart_series_5,
        chartSeries6: row?.chart_series_6?.trim() ?? d.chart_series_6,
        chartPositive: row?.chart_positive?.trim() ?? d.chart_positive,
        chartNegative: row?.chart_negative?.trim() ?? d.chart_negative,
        chartNeutral: row?.chart_neutral?.trim() ?? d.chart_neutral,
        displayName: row?.display_name?.trim() || PLATFORM_DEFAULTS.displayName,
        emailSenderName: row?.email_sender_name?.trim() ?? null,
        emailSenderAddress: row?.email_sender_address?.trim() ?? null,
        customPresets: Array.isArray(row?.custom_presets) ? row.custom_presets : [],
        updatedAt: row?.updated_at ?? null,
    };
}

type BrandingApiPayload = ReturnType<typeof mergeBranding> & { logoSignedUrl: string | null };

async function withLogoSignedUrl(row: BrandingRow | null, agencyTenantId: string | null): Promise<BrandingApiPayload> {
    const base = mergeBranding(row, agencyTenantId);
    if (!row?.logo_object_path || !agencyTenantId) {
        return { ...base, logoSignedUrl: null };
    }
    const { data, error } = await supabase.storage
        .from(BRANDING_LOGO_BUCKET)
        .createSignedUrl(row.logo_object_path, BRANDING_LOGO_SIGNED_SECONDS);
    if (error || !data?.signedUrl) {
        console.error('[branding] createSignedUrl', error?.message);
        return { ...base, logoSignedUrl: null };
    }
    return { ...base, logoSignedUrl: data.signedUrl };
}

function snapshotFromRow(row: BrandingRow | null): Record<string, unknown> {
    if (!row) return {};
    return {
        primaryColor: row.primary_color,
        secondaryColor: row.secondary_color,
        bgColor: row.bg_color,
        sidebarBgColor: row.sidebar_bg_color,
        sidebarBorderColor: row.sidebar_border_color,
        cardBgColor: row.card_bg_color,
        cardBorderColor: row.card_border_color,
        textColor: row.text_color,
        textMutedColor: row.text_muted_color,
        btnTextColor: row.btn_text_color,
        cardHoverColor: row.card_hover_color,
        interactiveHoverBg: row.interactive_hover_bg,
        interactiveFocusRing: row.interactive_focus_ring,
        successBg: row.success_bg,
        successText: row.success_text,
        successBorder: row.success_border,
        warningBg: row.warning_bg,
        warningText: row.warning_text,
        warningBorder: row.warning_border,
        dangerBg: row.danger_bg,
        dangerText: row.danger_text,
        dangerBorder: row.danger_border,
        infoBg: row.info_bg,
        infoText: row.info_text,
        infoBorder: row.info_border,
        profitColor: row.profit_color,
        lossColor: row.loss_color,
        primaryCardBg: row.primary_card_bg,
        primaryCardBorder: row.primary_card_border,
        secondaryCardBg: row.secondary_card_bg,
        secondaryCardBorder: row.secondary_card_border,
        toastSuccessBg: row.toast_success_bg,
        toastSuccessBorder: row.toast_success_border,
        toastSuccessIcon: row.toast_success_icon,
        toastErrorBg: row.toast_error_bg,
        toastErrorBorder: row.toast_error_border,
        toastErrorIcon: row.toast_error_icon,
        toastInfoBg: row.toast_info_bg,
        toastInfoBorder: row.toast_info_border,
        toastInfoIcon: row.toast_info_icon,
        toastWarningBg: row.toast_warning_bg,
        toastWarningBorder: row.toast_warning_border,
        toastWarningIcon: row.toast_warning_icon,
        chartGrid: row.chart_grid,
        chartAxis: row.chart_axis,
        chartSeries1: row.chart_series_1,
        chartSeries2: row.chart_series_2,
        chartSeries3: row.chart_series_3,
        chartSeries4: row.chart_series_4,
        chartSeries5: row.chart_series_5,
        chartSeries6: row.chart_series_6,
        chartPositive: row.chart_positive,
        chartNegative: row.chart_negative,
        chartNeutral: row.chart_neutral,
        displayName: row.display_name,
        emailSenderName: row.email_sender_name,
        emailSenderAddress: row.email_sender_address,
        customPresets: row.custom_presets,
        hasLogo: Boolean(row.logo_object_path),
    };
}

function detectImageKind(buf: Buffer): 'png' | 'jpeg' | 'webp' | null {
    if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
    if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
    if (buf.length >= 12 && buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'webp';
    return null;
}

function extAndContentType(kind: 'png' | 'jpeg' | 'webp'): { ext: string; contentType: string } {
    if (kind === 'jpeg') return { ext: 'jpg', contentType: 'image/jpeg' };
    if (kind === 'png') return { ext: 'png', contentType: 'image/png' };
    return { ext: 'webp', contentType: 'image/webp' };
}

async function guardBrandingEditAccess(
    userId: string,
    ctx: RequestTenantContext,
    agencyId: string,
    isSuper: boolean,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
    const { data: tenant, error: tErr } = await supabase.from('tenants').select('id, type').eq('id', agencyId).maybeSingle();
    if (tErr || !tenant || tenant.type !== 'agency') {
        return { ok: false, status: 400, error: 'Invalid agency tenant' };
    }
    const { data: allowed, error: rpcErr } = await supabase.rpc('user_can_resolve_branding_agency', {
        p_user_id: userId,
        p_agency_tenant_id: agencyId,
    });
    if (rpcErr) {
        console.error('[branding] user_can_resolve_branding_agency', rpcErr.message);
        return { ok: false, status: 500, error: 'Permission resolution failed' };
    }
    if (allowed !== true && !isSuper) {
        return { ok: false, status: 403, error: 'Access denied' };
    }
    if (!(await canEditBrandingTarget(userId, agencyId, isSuper))) {
        return { ok: false, status: 403, error: 'Permission missing: edit_brand_settings for this agency' };
    }
    return { ok: true };
}

async function resolveBrandingAgencyId(ctx: RequestTenantContext): Promise<string | null> {
    const { data: tenant, error } = await supabase
        .from('tenants')
        .select('id, type, parent_tenant_id')
        .eq('id', ctx.tenantId)
        .maybeSingle();

    if (error || !tenant) return null;

    if (tenant.type === 'agency') return tenant.id;
    if (tenant.type === 'seller') {
        const parent = tenant.parent_tenant_id;
        if (!parent || typeof parent !== 'string') return null;
        return parent;
    }
    return null;
}

function normalizeOptionalColor(v: unknown): string | null | undefined {
    if (v === undefined) return undefined;
    if (v === null) return null;
    if (typeof v !== 'string') return undefined;
    const s = v.trim();
    if (s === '') return null;
    if (!HEX_COLOR_RE.test(s)) return undefined;
    return s;
}

/** Read PATCH fields from camelCase or snake_case (proxies / older clients). */
function pickBodyField(body: Record<string, unknown>, camel: string, snake: string): unknown {
    if (Object.prototype.hasOwnProperty.call(body, camel)) return body[camel];
    if (Object.prototype.hasOwnProperty.call(body, snake)) return body[snake];
    return undefined;
}

/** Same merge rule for every color column (primary, secondary, and theme tokens). */
function mergePatchColor(next: string | null | undefined, prev: string | null | undefined): string | null {
    return next !== undefined ? next : prev ?? null;
}

const THEME_COLOR_KEYS = [
    'bg_color',
    'sidebar_bg_color',
    'sidebar_border_color',
    'card_bg_color',
    'card_border_color',
    'text_color',
    'text_muted_color',
    'btn_text_color',
    'card_hover_color',
    'interactive_hover_bg',
    'interactive_focus_ring',
    'success_bg',
    'success_text',
    'success_border',
    'warning_bg',
    'warning_text',
    'warning_border',
    'danger_bg',
    'danger_text',
    'danger_border',
    'info_bg',
    'info_text',
    'info_border',
    'profit_color',
    'loss_color',
    'primary_card_bg',
    'primary_card_border',
    'secondary_card_bg',
    'secondary_card_border',
    'toast_success_bg',
    'toast_success_border',
    'toast_success_icon',
    'toast_error_bg',
    'toast_error_border',
    'toast_error_icon',
    'toast_info_bg',
    'toast_info_border',
    'toast_info_icon',
    'toast_warning_bg',
    'toast_warning_border',
    'toast_warning_icon',
    'chart_grid',
    'chart_axis',
    'chart_series_1',
    'chart_series_2',
    'chart_series_3',
    'chart_series_4',
    'chart_series_5',
    'chart_series_6',
    'chart_positive',
    'chart_negative',
    'chart_neutral',
] as const;

const SEMANTIC_COLOR_FIELDS = [
    ['cardHoverColor', 'card_hover_color'],
    ['interactiveHoverBg', 'interactive_hover_bg'],
    ['interactiveFocusRing', 'interactive_focus_ring'],
    ['successBg', 'success_bg'],
    ['successText', 'success_text'],
    ['successBorder', 'success_border'],
    ['warningBg', 'warning_bg'],
    ['warningText', 'warning_text'],
    ['warningBorder', 'warning_border'],
    ['dangerBg', 'danger_bg'],
    ['dangerText', 'danger_text'],
    ['dangerBorder', 'danger_border'],
    ['infoBg', 'info_bg'],
    ['infoText', 'info_text'],
    ['infoBorder', 'info_border'],
    ['profitColor', 'profit_color'],
    ['lossColor', 'loss_color'],
    ['primaryCardBg', 'primary_card_bg'],
    ['primaryCardBorder', 'primary_card_border'],
    ['secondaryCardBg', 'secondary_card_bg'],
    ['secondaryCardBorder', 'secondary_card_border'],
    ['toastSuccessBg', 'toast_success_bg'],
    ['toastSuccessBorder', 'toast_success_border'],
    ['toastSuccessIcon', 'toast_success_icon'],
    ['toastErrorBg', 'toast_error_bg'],
    ['toastErrorBorder', 'toast_error_border'],
    ['toastErrorIcon', 'toast_error_icon'],
    ['toastInfoBg', 'toast_info_bg'],
    ['toastInfoBorder', 'toast_info_border'],
    ['toastInfoIcon', 'toast_info_icon'],
    ['toastWarningBg', 'toast_warning_bg'],
    ['toastWarningBorder', 'toast_warning_border'],
    ['toastWarningIcon', 'toast_warning_icon'],
    ['chartGrid', 'chart_grid'],
    ['chartAxis', 'chart_axis'],
    ['chartSeries1', 'chart_series_1'],
    ['chartSeries2', 'chart_series_2'],
    ['chartSeries3', 'chart_series_3'],
    ['chartSeries4', 'chart_series_4'],
    ['chartSeries5', 'chart_series_5'],
    ['chartSeries6', 'chart_series_6'],
    ['chartPositive', 'chart_positive'],
    ['chartNegative', 'chart_negative'],
    ['chartNeutral', 'chart_neutral'],
] as const;

/** PostgREST may return one row as an object; SETOF returns an array. */
function normalizeRpcBrandingRows(data: unknown): BrandingRow[] {
    if (data == null) return [];
    if (Array.isArray(data)) return data as BrandingRow[];
    return [data as BrandingRow];
}

/**
 * Supabase client omits JSON keys whose value is `undefined`, so PostgREST can treat missing args as NULL.
 * Force explicit nulls for RPC parameters.
 */
function nullishRpcArgs<T extends Record<string, unknown>>(o: T): T {
    const out = { ...o } as Record<string, unknown>;
    for (const k of Object.keys(out)) {
        if (out[k] === undefined) out[k] = null;
    }
    return out as T;
}

/** True if we intended to store theme colors but the row still has NULLs (REST upsert stripped unknown columns, or RPC missing). */
function themePersistMismatch(
    row: BrandingRow | null,
    payload: Record<(typeof THEME_COLOR_KEYS)[number], string | null>,
): boolean {
    if (!row) return true;
    for (const k of THEME_COLOR_KEYS) {
        const want = payload[k];
        if (want != null && String(want).trim() !== '' && row[k] == null) {
            return true;
        }
    }
    return false;
}

function normalizeOptionalText(v: unknown, maxLen: number): string | null | undefined {
    if (v === undefined) return undefined;
    if (v === null) return null;
    if (typeof v !== 'string') return undefined;
    const s = v.trim();
    if (s === '') return null;
    if (s.length > maxLen) return undefined;
    return s;
}

function isValidEmail(v: string): boolean {
    if (v.length > 254) return false;
    // pragmatic RFC-like check for stored sender addresses
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function wantsBrandingAudit(req: express.Request): boolean {
    const a = req.query.audit;
    const s = Array.isArray(a) ? a[0] : a;
    return s === '1' || s === 'true';
}

/**
 * GET /api/branding/audit — also available as GET /api/branding?audit=1 (same handler).
 * Nested /audit 404s if an old server/dist is running; the query form hits the root route that always exists.
 */
async function handleBrandingAuditGet(req: express.Request, res: express.Response) {
    try {
        const auth = await authorize(req, { action: 'view_brand_settings', denyAction: 'branding.audit_view_denied' });
        if (!auth.allowed) {
            res.status(auth.status).json({ success: false, error: auth.reason });
            return;
        }

        const rawAgency = typeof req.query.agencyTenantId === 'string' ? req.query.agencyTenantId.trim() : '';
        if (rawAgency && !UUID_RE.test(rawAgency)) {
            res.status(400).json({ success: false, error: 'Invalid agencyTenantId' });
            return;
        }

        const targetAgencyId =
            rawAgency && UUID_RE.test(rawAgency) ? rawAgency : await resolveBrandingAgencyId(auth.context);

        if (!targetAgencyId) {
            res.json({ success: true, data: [] });
            return;
        }

        const isSuper = await userIsPlatformSuperAdmin(auth.context.userId);

        const canView = await canViewBrandingTarget(auth.context.userId, auth.context, targetAgencyId, isSuper);
        if (!canView) {
            res.status(403).json({ success: false, error: 'Access denied' });
            return;
        }

        const rawLimit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 20;
        const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 50) : 20;

        const { data: rows, error: fetchErr } = await supabase
            .from('tenant_branding_audit')
            .select('id, tenant_id, actor_user_id, action, before_json, after_json, created_at, profiles:actor_user_id(full_name, email)')
            .eq('tenant_id', targetAgencyId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (fetchErr) {
            console.error('[branding] GET audit fetch', fetchErr.message);
            res.status(500).json({ success: false, error: 'Failed to load audit history' });
            return;
        }

        res.json({ success: true, data: rows ?? [] });
    } catch (e: any) {
        console.error('[branding] GET audit', e?.message);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
}

/**
 * GET /api/branding
 * Optional query: agencyTenantId — read branding for that agency (must pass visibility + view_brand_settings rules).
 * Optional query: audit=1 — branding change history (same as GET /api/branding/audit).
 * Without query: agency from profile tenant, or parent agency when profile tenant is a linked seller.
 */
router.get('/', async (req, res) => {
    if (wantsBrandingAudit(req)) {
        await handleBrandingAuditGet(req, res);
        return;
    }
    try {
        const auth = await authorize(req, { action: 'view_brand_settings', denyAction: 'branding.view_denied' });
        if (!auth.allowed) {
            res.status(auth.status).json({ success: false, error: auth.reason });
            return;
        }

        const rawAgency = typeof req.query.agencyTenantId === 'string' ? req.query.agencyTenantId.trim() : '';
        if (rawAgency && !UUID_RE.test(rawAgency)) {
            res.status(400).json({ success: false, error: 'Invalid agencyTenantId' });
            return;
        }

        const targetAgencyId =
            rawAgency && UUID_RE.test(rawAgency) ? rawAgency : await resolveBrandingAgencyId(auth.context);

        if (!targetAgencyId) {
            res.json({
                success: true,
                data: await withLogoSignedUrl(null, null),
            });
            return;
        }

        const [isSuper, rpcOut] = await Promise.all([
            userIsPlatformSuperAdmin(auth.context.userId),
            supabase.rpc('user_can_resolve_branding_agency', {
                p_user_id: auth.context.userId,
                p_agency_tenant_id: targetAgencyId,
            }),
        ]);

        const { data: allowed, error: rpcErr } = rpcOut;
        if (rpcErr) {
            console.error('[branding] user_can_resolve_branding_agency', rpcErr.message);
            res.status(500).json({ success: false, error: 'Permission resolution failed' });
            return;
        }
        if (allowed !== true && !isSuper) {
            res.status(403).json({ success: false, error: 'Access denied' });
            return;
        }

        if (!(await canViewBrandingTarget(auth.context.userId, auth.context, targetAgencyId, isSuper))) {
            res.status(403).json({ success: false, error: 'Access denied' });
            return;
        }

        const { data: row, error: fetchErr } = await fetchTenantBrandingRow(targetAgencyId);

        if (fetchErr) {
            console.error('[branding] fetch tenant_branding', fetchErr.message);
            res.status(500).json({ success: false, error: 'Failed to load branding' });
            return;
        }

        res.json({
            success: true,
            data: await withLogoSignedUrl((row as BrandingRow | null) ?? null, targetAgencyId),
        });
    } catch (e: any) {
        console.error('[branding] GET /', e?.message);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

/**
 * PATCH /api/branding
 * Body may include agencyTenantId to edit a specific agency (Agency Console multi-tenant selector).
 * Caller must have edit_brand_settings on that agency (or be platform super admin).
 */
router.patch('/', async (req, res) => {
    try {
        const auth = await authorize(req, { action: 'edit_brand_settings', denyAction: 'branding.edit_denied' });
        if (!auth.allowed) {
            res.status(auth.status).json({ success: false, error: auth.reason });
            return;
        }

        const isSuper = await userIsPlatformSuperAdmin(auth.context.userId);

        const body =
            req.body && typeof req.body === 'object' && !Array.isArray(req.body)
                ? (req.body as Record<string, unknown>)
                : {};
        const rawTarget =
            typeof body.agencyTenantId === 'string' && UUID_RE.test(body.agencyTenantId.trim())
                ? body.agencyTenantId.trim()
                : null;

        const agencyId =
            rawTarget || (auth.context.tenantType === 'agency' ? auth.context.tenantId : null);

        if (!agencyId) {
            res.status(400).json({
                success: false,
                error: 'Specify agencyTenantId in the request body, or switch your profile tenant to the agency you are editing.',
            });
            return;
        }

        const guard = await guardBrandingEditAccess(auth.context.userId, auth.context, agencyId, isSuper);
        if (!guard.ok) {
            res.status(guard.status).json({ success: false, error: guard.error });
            return;
        }
        const nextPrimary = normalizeOptionalColor(pickBodyField(body, 'primaryColor', 'primary_color'));
        const nextSecondary = normalizeOptionalColor(pickBodyField(body, 'secondaryColor', 'secondary_color'));
        const nextBg = normalizeOptionalColor(pickBodyField(body, 'bgColor', 'bg_color'));
        const nextSidebarBg = normalizeOptionalColor(pickBodyField(body, 'sidebarBgColor', 'sidebar_bg_color'));
        const nextSidebarBorder = normalizeOptionalColor(pickBodyField(body, 'sidebarBorderColor', 'sidebar_border_color'));
        const nextCardBg = normalizeOptionalColor(pickBodyField(body, 'cardBgColor', 'card_bg_color'));
        const nextCardBorder = normalizeOptionalColor(pickBodyField(body, 'cardBorderColor', 'card_border_color'));
        const nextText = normalizeOptionalColor(pickBodyField(body, 'textColor', 'text_color'));
        const nextTextMuted = normalizeOptionalColor(pickBodyField(body, 'textMutedColor', 'text_muted_color'));
        const nextBtnText = normalizeOptionalColor(pickBodyField(body, 'btnTextColor', 'btn_text_color'));
        const semanticColorUpdates = Object.fromEntries(
            SEMANTIC_COLOR_FIELDS.map(([camel, snake]) => [snake, normalizeOptionalColor(pickBodyField(body, camel, snake))])
        ) as Record<(typeof SEMANTIC_COLOR_FIELDS)[number][1], string | null | undefined>;
        const nextDisplay = normalizeOptionalText(pickBodyField(body, 'displayName', 'display_name'), 120);
        const nextSenderName = normalizeOptionalText(pickBodyField(body, 'emailSenderName', 'email_sender_name'), 120);
        const nextSenderAddr = normalizeOptionalText(pickBodyField(body, 'emailSenderAddress', 'email_sender_address'), 254);

        if (
            nextPrimary === undefined &&
            nextSecondary === undefined &&
            nextBg === undefined &&
            nextSidebarBg === undefined &&
            nextSidebarBorder === undefined &&
            nextCardBg === undefined &&
            nextCardBorder === undefined &&
            nextText === undefined &&
            nextTextMuted === undefined &&
            nextBtnText === undefined &&
            Object.values(semanticColorUpdates).every((v) => v === undefined) &&
            nextDisplay === undefined &&
            nextSenderName === undefined &&
            nextSenderAddr === undefined &&
            pickBodyField(body, 'customPresets', 'custom_presets') === undefined
        ) {
            res.status(400).json({ success: false, error: 'No valid fields to update' });
            return;
        }

        const rawPrimary = pickBodyField(body, 'primaryColor', 'primary_color');
        const primaryProvided =
            rawPrimary != null && typeof rawPrimary === 'string' && rawPrimary.trim() !== '';
        if (primaryProvided && (nextPrimary === undefined || (nextPrimary !== null && !HEX_COLOR_RE.test(nextPrimary)))) {
            res.status(400).json({ success: false, error: 'Invalid primaryColor (use #RGB, #RRGGBB, or #RRGGBBAA)' });
            return;
        }
        const rawSecondary = pickBodyField(body, 'secondaryColor', 'secondary_color');
        const secondaryProvided =
            rawSecondary != null && typeof rawSecondary === 'string' && rawSecondary.trim() !== '';
        if (secondaryProvided && (nextSecondary === undefined || (nextSecondary !== null && !HEX_COLOR_RE.test(nextSecondary)))) {
            res.status(400).json({ success: false, error: 'Invalid secondaryColor (use #RGB, #RRGGBB, or #RRGGBBAA)' });
            return;
        }
        
        const validateColorField = (raw: unknown, nextVal: string | null | undefined) => {
            const provided = raw != null && typeof raw === 'string' && raw.trim() !== '';
            if (provided && (nextVal === undefined || (nextVal !== null && !HEX_COLOR_RE.test(nextVal)))) {
                return false;
            }
            return true;
        };

        if (
            !validateColorField(pickBodyField(body, 'bgColor', 'bg_color'), nextBg) ||
            !validateColorField(pickBodyField(body, 'sidebarBgColor', 'sidebar_bg_color'), nextSidebarBg) ||
            !validateColorField(pickBodyField(body, 'sidebarBorderColor', 'sidebar_border_color'), nextSidebarBorder) ||
            !validateColorField(pickBodyField(body, 'cardBgColor', 'card_bg_color'), nextCardBg) ||
            !validateColorField(pickBodyField(body, 'cardBorderColor', 'card_border_color'), nextCardBorder) ||
            !validateColorField(pickBodyField(body, 'textColor', 'text_color'), nextText) ||
            !validateColorField(pickBodyField(body, 'textMutedColor', 'text_muted_color'), nextTextMuted) ||
            !validateColorField(pickBodyField(body, 'btnTextColor', 'btn_text_color'), nextBtnText) ||
            SEMANTIC_COLOR_FIELDS.some(([camel, snake]) =>
                !validateColorField(pickBodyField(body, camel, snake), semanticColorUpdates[snake])
            )
        ) {
            res.status(400).json({ success: false, error: 'Invalid color format (use #RGB, #RRGGBB, or #RRGGBBAA)' });
            return;
        }
        const rawDisplay = pickBodyField(body, 'displayName', 'display_name');
        const displayProvided = rawDisplay != null && typeof rawDisplay === 'string' && rawDisplay.trim() !== '';
        if (displayProvided && nextDisplay === undefined) {
            res.status(400).json({ success: false, error: 'Invalid displayName' });
            return;
        }
        if (nextDisplay !== undefined && nextDisplay !== null && nextDisplay.length < 1) {
            res.status(400).json({ success: false, error: 'displayName cannot be empty when provided' });
            return;
        }
        const rawSenderName = pickBodyField(body, 'emailSenderName', 'email_sender_name');
        const senderNameProvided =
            rawSenderName != null && typeof rawSenderName === 'string' && rawSenderName.trim() !== '';
        if (senderNameProvided && nextSenderName === undefined) {
            res.status(400).json({ success: false, error: 'Invalid emailSenderName' });
            return;
        }
        const rawSenderAddr = pickBodyField(body, 'emailSenderAddress', 'email_sender_address');
        const senderAddrProvided =
            rawSenderAddr != null && typeof rawSenderAddr === 'string' && rawSenderAddr.trim() !== '';
        if (senderAddrProvided && (nextSenderAddr === undefined || (nextSenderAddr !== null && !isValidEmail(nextSenderAddr)))) {
            res.status(400).json({ success: false, error: 'Invalid emailSenderAddress' });
            return;
        }

        const { data: existing, error: exErr } = await fetchTenantBrandingRow(agencyId);
        if (exErr) {
            console.error('[branding] load existing', exErr.message);
            res.status(500).json({ success: false, error: 'Failed to load branding' });
            return;
        }

        const prev = (existing as BrandingRow | null) ?? null;

        const rawCustomPresets = pickBodyField(body, 'customPresets', 'custom_presets');

        const rowPayload = {
            primary_color: mergePatchColor(nextPrimary, prev?.primary_color ?? null),
            secondary_color: mergePatchColor(nextSecondary, prev?.secondary_color ?? null),
            bg_color: mergePatchColor(nextBg, prev?.bg_color ?? null),
            sidebar_bg_color: mergePatchColor(nextSidebarBg, prev?.sidebar_bg_color ?? null),
            sidebar_border_color: mergePatchColor(nextSidebarBorder, prev?.sidebar_border_color ?? null),
            card_bg_color: mergePatchColor(nextCardBg, prev?.card_bg_color ?? null),
            card_border_color: mergePatchColor(nextCardBorder, prev?.card_border_color ?? null),
            text_color: mergePatchColor(nextText, prev?.text_color ?? null),
            text_muted_color: mergePatchColor(nextTextMuted, prev?.text_muted_color ?? null),
            btn_text_color: mergePatchColor(nextBtnText, prev?.btn_text_color ?? null),
            ...Object.fromEntries(
                SEMANTIC_COLOR_FIELDS.map(([, snake]) => [
                    snake,
                    mergePatchColor(semanticColorUpdates[snake], prev?.[snake] ?? null),
                ])
            ),
            display_name: nextDisplay !== undefined ? nextDisplay : prev?.display_name ?? null,
            email_sender_name: nextSenderName !== undefined ? nextSenderName : prev?.email_sender_name ?? null,
            email_sender_address: nextSenderAddr !== undefined ? nextSenderAddr : prev?.email_sender_address ?? null,
            custom_presets: rawCustomPresets !== undefined ? rawCustomPresets : prev?.custom_presets ?? [],
            logo_object_path: prev?.logo_object_path ?? null,
        };

        // Prefer DB RPC: one INSERT ... ON CONFLICT touching all columns (same path as primary/secondary).
        const rpcPayload = nullishRpcArgs({
            p_tenant_id: agencyId,
            p_primary_color: rowPayload.primary_color,
            p_secondary_color: rowPayload.secondary_color,
            p_bg_color: rowPayload.bg_color,
            p_sidebar_bg_color: rowPayload.sidebar_bg_color,
            p_sidebar_border_color: rowPayload.sidebar_border_color,
            p_card_bg_color: rowPayload.card_bg_color,
            p_card_border_color: rowPayload.card_border_color,
            p_text_color: rowPayload.text_color,
            p_text_muted_color: rowPayload.text_muted_color,
            p_btn_text_color: rowPayload.btn_text_color,
            ...Object.fromEntries(
                SEMANTIC_COLOR_FIELDS.map(([, snake]) => [
                    `p_${snake}`,
                    rowPayload[snake as keyof typeof rowPayload] ?? null,
                ])
            ),
            p_display_name: rowPayload.display_name,
            p_email_sender_name: rowPayload.email_sender_name,
            p_email_sender_address: rowPayload.email_sender_address,
            p_custom_presets: rowPayload.custom_presets,
            p_logo_object_path: rowPayload.logo_object_path,
        });

        let saved: BrandingRow | null = null;
        const { data: rpcData, error: rpcErr } = await supabase.rpc('tenant_branding_apply_patch', rpcPayload);
        if (!rpcErr && rpcData != null) {
            const rows = normalizeRpcBrandingRows(rpcData);
            saved = rows.length > 0 ? rows[0]! : null;
        }
        if (!saved) {
            if (rpcErr) {
                console.error('[branding] tenant_branding_apply_patch failed; attempting REST upsert', rpcErr.message);
            } else {
                console.warn('[branding] tenant_branding_apply_patch returned no row; attempting REST upsert');
            }
            const { data: upData, error: upErr } = await supabase
                .from('tenant_branding')
                .upsert({ tenant_id: agencyId, ...rowPayload }, { onConflict: 'tenant_id' })
                .select(TENANT_BRANDING_SELECT)
                .single();
            if (upErr || !upData) {
                console.error('[branding] save branding row', rpcErr?.message || upErr?.message);
                res.status(400).json({
                    success: false,
                    error:
                        upErr?.message ||
                        rpcErr?.message ||
                        'Failed to save branding. Apply migration 20260420130000_tenant_branding_apply_patch_rpc.sql on Supabase.',
                });
                return;
            }
            saved = upData as BrandingRow;
        }

        const { data: freshRow, error: freshErr } = await fetchTenantBrandingRow(agencyId);
        if (freshErr) {
            console.error('[branding] re-fetch after save', freshErr.message);
        }
        const after = ((freshRow as BrandingRow | null) ?? saved) as BrandingRow;

        if (themePersistMismatch(after, rowPayload as Record<(typeof THEME_COLOR_KEYS)[number], string | null>)) {
            console.error('[branding] theme columns not persisted after save', {
                agencyId,
                rpcErr: rpcErr?.message ?? null,
            });
            res.status(503).json({
                success: false,
                error:
                    "Theme colors did not persist. Apply Supabase migrations 20260419200000_tenant_branding_m3_theme.sql (theme columns) and 20260420130000_tenant_branding_apply_patch_rpc.sql (RPC). In the SQL editor run: NOTIFY pgrst, 'reload schema';",
            });
            return;
        }
        const auditAction = prev ? 'update' : 'create';
        const { error: audErr } = await supabase.from('tenant_branding_audit').insert({
            tenant_id: agencyId,
            actor_user_id: auth.context.userId,
            action: auditAction,
            before_json: prev ? snapshotFromRow(prev) : null,
            after_json: snapshotFromRow(after),
        });
        if (audErr) {
            console.error('[branding] tenant_branding_audit insert', audErr.message);
        }

        await auditLog(req, {
            action: prev ? 'branding.update' : 'branding.create',
            resourceType: 'tenant_branding',
            resourceId: after.id,
            tenantId: agencyId,
            beforeState: prev ? snapshotFromRow(prev) : null,
            afterState: snapshotFromRow(after),
        });

        res.json({
            success: true,
            data: await withLogoSignedUrl(after, agencyId),
        });
    } catch (e: any) {
        console.error('[branding] PATCH /', e?.message);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

/**
 * POST /api/branding/logo
 * multipart/form-data: field "file" (PNG/JPEG/WebP, max 2 MB), optional "agencyTenantId".
 */
router.post('/logo', (req, res, next) => {
    uploadLogo.single('file')(req, res, (err: unknown) => {
        if (err) {
            if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
                res.status(400).json({ success: false, error: 'File too large (max 2 MB)' });
                return;
            }
            const msg = err instanceof Error ? err.message : 'Upload failed';
            res.status(400).json({ success: false, error: msg });
            return;
        }
        next();
    });
}, async (req, res) => {
    try {
        const auth = await authorize(req, { action: 'edit_brand_settings', denyAction: 'branding.edit_denied' });
        if (!auth.allowed) {
            res.status(auth.status).json({ success: false, error: auth.reason });
            return;
        }

        const isSuper = await userIsPlatformSuperAdmin(auth.context.userId);
        const rawBody = req.body && typeof req.body === 'object' ? req.body : {};
        const rawTarget =
            typeof (rawBody as { agencyTenantId?: unknown }).agencyTenantId === 'string'
                ? (rawBody as { agencyTenantId: string }).agencyTenantId.trim()
                : '';
        const agencyId =
            rawTarget && UUID_RE.test(rawTarget)
                ? rawTarget
                : auth.context.tenantType === 'agency'
                  ? auth.context.tenantId
                  : null;

        if (!agencyId) {
            res.status(400).json({
                success: false,
                error: 'Specify agencyTenantId in the form body, or switch your profile tenant to the agency you are editing.',
            });
            return;
        }

        const guard = await guardBrandingEditAccess(auth.context.userId, auth.context, agencyId, isSuper);
        if (!guard.ok) {
            res.status(guard.status).json({ success: false, error: guard.error });
            return;
        }

        const file = req.file;
        if (!file?.buffer?.length) {
            res.status(400).json({ success: false, error: 'Missing file field' });
            return;
        }

        const kind = detectImageKind(file.buffer);
        if (!kind) {
            res.status(400).json({ success: false, error: 'Invalid image file (allowed: PNG, JPEG, WebP)' });
            return;
        }
        const { ext, contentType } = extAndContentType(kind);
        const objectPath = `${agencyId}/${randomUUID()}.${ext}`;

        const { data: prevRow, error: exErr } = await fetchTenantBrandingRow(agencyId);
        if (exErr) {
            console.error('[branding] load existing for logo', exErr.message);
            res.status(500).json({ success: false, error: 'Failed to load branding' });
            return;
        }
        const prev = (prevRow as BrandingRow | null) ?? null;

        const { error: upStorageErr } = await supabase.storage
            .from(BRANDING_LOGO_BUCKET)
            .upload(objectPath, file.buffer, { contentType, upsert: false });
        if (upStorageErr) {
            console.error('[branding] storage upload', upStorageErr.message);
            res.status(500).json({ success: false, error: 'Logo upload failed' });
            return;
        }

        let saved: BrandingRow;
        if (prev) {
            const { data, error: updErr } = await supabase
                .from('tenant_branding')
                .update({ logo_object_path: objectPath })
                .eq('tenant_id', agencyId)
                .select(TENANT_BRANDING_SELECT)
                .single();
            if (updErr || !data) {
                await supabase.storage.from(BRANDING_LOGO_BUCKET).remove([objectPath]);
                console.error('[branding] update logo path', updErr?.message);
                res.status(500).json({ success: false, error: 'Failed to save logo' });
                return;
            }
            saved = data as BrandingRow;
        } else {
            const { data, error: insErr } = await supabase
                .from('tenant_branding')
                .insert({ tenant_id: agencyId, logo_object_path: objectPath })
                .select(TENANT_BRANDING_SELECT)
                .single();
            if (insErr || !data) {
                await supabase.storage.from(BRANDING_LOGO_BUCKET).remove([objectPath]);
                console.error('[branding] insert branding row for logo', insErr?.message);
                res.status(500).json({ success: false, error: 'Failed to save logo' });
                return;
            }
            saved = data as BrandingRow;
        }

        if (prev?.logo_object_path && prev.logo_object_path !== objectPath) {
            const { error: rmErr } = await supabase.storage.from(BRANDING_LOGO_BUCKET).remove([prev.logo_object_path]);
            if (rmErr) {
                console.warn('[branding] remove old logo object', rmErr.message);
            }
        }

        const auditAction = prev ? 'update' : 'create';
        const { error: audErr } = await supabase.from('tenant_branding_audit').insert({
            tenant_id: agencyId,
            actor_user_id: auth.context.userId,
            action: auditAction,
            before_json: prev ? snapshotFromRow(prev) : null,
            after_json: snapshotFromRow(saved),
        });
        if (audErr) {
            console.error('[branding] tenant_branding_audit insert', audErr.message);
        }

        await auditLog(req, {
            action: prev ? 'branding.update' : 'branding.create',
            resourceType: 'tenant_branding',
            resourceId: saved.id,
            tenantId: agencyId,
            beforeState: prev ? snapshotFromRow(prev) : null,
            afterState: snapshotFromRow(saved),
        });

        res.json({
            success: true,
            data: await withLogoSignedUrl(saved, agencyId),
        });
    } catch (e: any) {
        console.error('[branding] POST /logo', e?.message);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

/**
 * DELETE /api/branding/logo
 * Query: optional agencyTenantId (same rules as PATCH).
 */
router.delete('/logo', async (req, res) => {
    try {
        const auth = await authorize(req, { action: 'edit_brand_settings', denyAction: 'branding.edit_denied' });
        if (!auth.allowed) {
            res.status(auth.status).json({ success: false, error: auth.reason });
            return;
        }

        const isSuper = await userIsPlatformSuperAdmin(auth.context.userId);
        const rawQ = typeof req.query.agencyTenantId === 'string' ? req.query.agencyTenantId.trim() : '';
        const agencyId =
            rawQ && UUID_RE.test(rawQ)
                ? rawQ
                : auth.context.tenantType === 'agency'
                  ? auth.context.tenantId
                  : null;

        if (!agencyId) {
            res.status(400).json({
                success: false,
                error: 'Specify agencyTenantId query param, or switch your profile tenant to the agency you are editing.',
            });
            return;
        }

        const guard = await guardBrandingEditAccess(auth.context.userId, auth.context, agencyId, isSuper);
        if (!guard.ok) {
            res.status(guard.status).json({ success: false, error: guard.error });
            return;
        }

        const { data: prevRow, error: exErr } = await fetchTenantBrandingRow(agencyId);
        if (exErr) {
            console.error('[branding] load for logo delete', exErr.message);
            res.status(500).json({ success: false, error: 'Failed to load branding' });
            return;
        }
        const prev = (prevRow as BrandingRow | null) ?? null;
        if (!prev?.logo_object_path) {
            res.json({
                success: true,
                data: await withLogoSignedUrl(prev, agencyId),
            });
            return;
        }

        const oldPath = prev.logo_object_path;

        const { data: saved, error: updErr } = await supabase
            .from('tenant_branding')
            .update({ logo_object_path: null })
            .eq('tenant_id', agencyId)
            .select(TENANT_BRANDING_SELECT)
            .single();
        if (updErr || !saved) {
            console.error('[branding] clear logo path', updErr?.message);
            res.status(500).json({ success: false, error: 'Failed to remove logo' });
            return;
        }

        const after = saved as BrandingRow;
        const { error: rmErr } = await supabase.storage.from(BRANDING_LOGO_BUCKET).remove([oldPath]);
        if (rmErr) {
            console.warn('[branding] storage remove logo', rmErr.message);
        }

        const { error: audErr } = await supabase.from('tenant_branding_audit').insert({
            tenant_id: agencyId,
            actor_user_id: auth.context.userId,
            action: 'update',
            before_json: snapshotFromRow(prev),
            after_json: snapshotFromRow(after),
        });
        if (audErr) {
            console.error('[branding] tenant_branding_audit insert', audErr.message);
        }

        await auditLog(req, {
            action: 'branding.update',
            resourceType: 'tenant_branding',
            resourceId: after.id,
            tenantId: agencyId,
            beforeState: snapshotFromRow(prev),
            afterState: snapshotFromRow(after),
        });

        res.json({
            success: true,
            data: await withLogoSignedUrl(after, agencyId),
        });
    } catch (e: any) {
        console.error('[branding] DELETE /logo', e?.message);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

/**
 * GET /api/branding/audit — alias for GET /api/branding?audit=1&...
 */
router.get('/audit', handleBrandingAuditGet);

export default router;
