import { useState, useEffect, useMemo, useRef, useCallback, type ChangeEvent, type CSSProperties } from 'react';
import {
    Building2,
    Check,
    Loader2,
    AlertCircle,
    Palette,
    ArrowLeft,
    Upload,
    Image as ImageIcon,
    CheckCircle2,
    Clock,
    History,
    LayoutDashboard,
    ShoppingBag,
    Package,
    Calculator,
    TrendingUp,
    Calendar,
    Plus,
    X,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTenantContext } from '../../contexts/TenantContext';
import { MAMBA_SNAKE_HEAD_SRC } from '../../lib/brandAssets';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { fetchBranding, patchBranding, uploadBrandingLogo, deleteBrandingLogo, type CustomPreset } from '../../lib/brandingApi';
import { PLATFORM_BRANDING_FORM_THEME_ONLY } from '../../lib/platformBrandingDefaults';
import { normalizeHex6, normalizeHexAlpha } from '../../lib/colorUtils';
import { BrandColorPopover } from '../branding/BrandColorPopover';
import { apiFetch } from '../../lib/apiClient';

type AgencyBrandingViewProps = {
    /** Sidebar / home navigation (e.g. back to Agency console). */
    onNavigate?: (tab: string) => void;
};

// ---------------------------------------------------------------------------
// Audit row types
// ---------------------------------------------------------------------------
type AuditProfile = { full_name: string | null; email: string | null } | null;
type AuditRow = {
    id: string;
    actor_user_id: string | null;
    action: 'create' | 'update';
    before_json: Record<string, unknown> | null;
    after_json: Record<string, unknown>;
    created_at: string;
    profiles: AuditProfile;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatRelativeTime(isoDate: string): string {
    const diff = Date.now() - new Date(isoDate).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
}

function auditSummary(row: AuditRow): string {
    if (row.action === 'create') return 'Set up initial branding';
    const after = row.after_json;
    const before = row.before_json ?? {};
    const parts: string[] = [];
    if (after.hasLogo !== before.hasLogo) {
        parts.push(after.hasLogo ? 'uploaded logo' : 'removed logo');
    }
    if (after.displayName !== before.displayName) {
        parts.push(after.displayName ? `renamed to "${after.displayName}"` : 'cleared display name');
    }
    if (after.primaryColor !== before.primaryColor) parts.push('changed primary color');
    if (after.secondaryColor !== before.secondaryColor) parts.push('changed secondary color');
    if (after.emailSenderName !== before.emailSenderName) parts.push('updated email sender name');
    if (after.emailSenderAddress !== before.emailSenderAddress) parts.push('updated email sender address');
    return parts.length > 0 ? parts.join(', ') : 'Updated branding settings';
}

// ---------------------------------------------------------------------------
// Live preview mini-shell
// ---------------------------------------------------------------------------
function BrandPreviewCard({
    displayName,
    primaryColor,
    sidebarBgColor,
    sidebarBorderColor,
    textColor,
    textMutedColor,
    cssVars,
    logoUrl,
}: {
    displayName: string;
    primaryColor: string;
    sidebarBgColor: string;
    sidebarBorderColor: string;
    textColor: string;
    textMutedColor: string;
    cssVars: CSSProperties;
    logoUrl: string | null;
}) {
    const [activePreviewTab, setActivePreviewTab] = useState<'overview' | 'orders' | 'products' | 'profit-loss' | 'marketing'>('overview');
    const navItems: Array<{ id: 'overview' | 'orders' | 'products' | 'profit-loss' | 'marketing'; icon: any; label: string }> = [
        { id: 'overview', icon: LayoutDashboard, label: 'Overview' },
        { id: 'orders', icon: ShoppingBag, label: 'Orders' },
        { id: 'products', icon: Package, label: 'Products' },
        { id: 'profit-loss', icon: Calculator, label: 'P&L Statement' },
        { id: 'marketing', icon: TrendingUp, label: 'Marketing' },
    ];

    const renderedPreview = useMemo(() => {
        if (activePreviewTab === 'overview') {
            return (
                <div className="space-y-3">
                    <div className="grid grid-cols-4 gap-2">
                        {Array.from({ length: 4 }).map((_, i) => (
                            <div key={i} className="brand-card rounded-lg p-2.5">
                                <div className="h-2 w-12 rounded bg-white/15 mb-2" />
                                <div className="h-4 w-10 rounded bg-white/20 mb-2" />
                                <div className="h-2 w-8 rounded" style={{ backgroundColor: i % 2 === 0 ? 'var(--brand-profit)' : 'var(--brand-loss)' }} />
                            </div>
                        ))}
                    </div>
                    <div className="brand-card rounded-lg p-3 space-y-2">
                        <div className="h-2 w-28 rounded bg-white/15" />
                        <div className="h-24 rounded-lg" style={{ backgroundColor: 'var(--brand-interactive-hover-bg)' }} />
                    </div>
                </div>
            );
        }
        if (activePreviewTab === 'orders') {
            return (
                <div className="space-y-2.5">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className="brand-card rounded-lg p-2.5">
                            <div className="flex items-center justify-between mb-2">
                                <div className="h-2 w-20 rounded bg-white/15" />
                                <div className={`px-2 py-0.5 rounded text-[10px] ${i % 2 === 0 ? 'brand-state-info' : 'brand-state-success'}`}>Status</div>
                            </div>
                            <div className="h-2 w-full rounded bg-white/10 mb-1.5" />
                            <div className="h-2 w-2/3 rounded bg-white/10" />
                        </div>
                    ))}
                </div>
            );
        }
        if (activePreviewTab === 'products') {
            return (
                <div className="grid grid-cols-3 gap-2.5">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="brand-card rounded-lg p-2">
                            <div className="aspect-square rounded mb-2" style={{ backgroundColor: 'var(--brand-interactive-hover-bg)' }} />
                            <div className="h-2 w-full rounded bg-white/10 mb-1.5" />
                            <div className="h-3 w-14 rounded" style={{ backgroundColor: 'var(--brand-primary)' }} />
                        </div>
                    ))}
                </div>
            );
        }
        if (activePreviewTab === 'profit-loss') {
            return (
                <div className="space-y-3">
                    <div className="grid grid-cols-4 gap-2">
                        <div className="brand-card rounded-lg p-2.5"><div className="h-2 w-14 rounded bg-white/20 mb-2" /><div className="h-4 w-12 rounded bg-white/20" /></div>
                        <div className="brand-card rounded-lg p-2.5"><div className="h-2 w-14 rounded bg-white/20 mb-2" /><div className="h-4 w-12 rounded bg-white/20" /></div>
                        <div className="rounded-lg p-2.5 border" style={{ backgroundColor: 'var(--brand-success-bg)', borderColor: 'var(--brand-success-border)' }}><div className="h-2 w-14 rounded bg-white/20 mb-2" /><div className="h-4 w-12 rounded bg-white/20" /></div>
                        <div className="rounded-lg p-2.5 border" style={{ backgroundColor: 'var(--brand-danger-bg)', borderColor: 'var(--brand-danger-border)' }}><div className="h-2 w-14 rounded bg-white/20 mb-2" /><div className="h-4 w-12 rounded bg-white/20" /></div>
                    </div>
                    <div className="brand-card rounded-lg p-3 space-y-2">
                        {Array.from({ length: 5 }).map((_, i) => (
                            <div key={i} className="flex items-center justify-between border-b pb-2 last:border-b-0 last:pb-0" style={{ borderColor: 'var(--brand-card-border)' }}>
                                <div className="h-2 w-28 rounded bg-white/10" />
                                <div className={`h-2 w-16 rounded ${i % 2 === 0 ? 'brand-profit' : 'brand-loss'}`} style={{ backgroundColor: i % 2 === 0 ? 'var(--brand-profit)' : 'var(--brand-loss)' }} />
                            </div>
                        ))}
                    </div>
                </div>
            );
        }
        return (
            <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="brand-card rounded-lg p-2.5">
                            <div className="h-2 w-16 rounded bg-white/10 mb-2" />
                            <div className="h-4 w-10 rounded bg-white/20" />
                        </div>
                    ))}
                </div>
                <div className="brand-card rounded-lg p-3">
                    <div className="h-24 rounded-lg" style={{ backgroundColor: 'var(--brand-interactive-hover-bg)' }} />
                </div>
            </div>
        );
    }, [activePreviewTab]);

    return (
        <div
            className="rounded-2xl overflow-hidden shadow-2xl shadow-black/50 select-none border"
            style={{ ...cssVars, backgroundColor: 'var(--brand-bg)', borderColor: sidebarBorderColor }}
            aria-hidden
        >
            <div className="flex" style={{ minHeight: '520px', maxHeight: '520px' }}>
                {/* ── Sidebar ── */}
                <div className="w-52 border-r flex flex-col shrink-0" style={{ backgroundColor: sidebarBgColor, borderColor: sidebarBorderColor }}>
                    {/* Brand header */}
                    <div className="px-4 py-4 border-b flex items-center gap-3" style={{ borderColor: sidebarBorderColor }}>
                        {logoUrl ? (
                            <img src={logoUrl} alt="" className="h-11 w-11 shrink-0 object-contain" />
                        ) : (
                            <img src={MAMBA_SNAKE_HEAD_SRC} alt="" className="h-11 w-11 shrink-0 object-contain" />
                        )}
                        <div className="min-w-0">
                            <p className="text-sm font-bold truncate leading-tight" style={{ color: textColor }}>{displayName || 'Your brand'}</p>
                            <p className="text-[10px] truncate" style={{ color: textMutedColor }}>TikTok Shop Dashboard</p>
                        </div>
                    </div>

                    {/* Nav */}
                    <nav className="flex-1 p-3 overflow-hidden">
                        <p className="px-3 text-[9px] font-bold uppercase tracking-widest mb-1.5" style={{ color: textMutedColor }}>
                            Shop
                        </p>
                        <div className="space-y-0.5">
                            {navItems.map((item) => (
                                <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => setActivePreviewTab(item.id)}
                                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-left transition-colors"
                                    style={
                                        activePreviewTab === item.id
                                            ? {
                                                  color: primaryColor,
                                                  backgroundColor: `${primaryColor}18`,
                                                  border: `1px solid ${primaryColor}20`,
                                              }
                                            : { color: textMutedColor }
                                    }
                                >
                                    <item.icon className="w-3.5 h-3.5 shrink-0" />
                                    <span>{item.label}</span>
                                </button>
                            ))}
                        </div>
                    </nav>

                    {/* User footer */}
                    <div className="p-3 border-t" style={{ borderColor: sidebarBorderColor }}>
                        <div className="rounded-xl px-3 py-2.5 brand-card">
                            <div className="flex items-center justify-between mb-1">
                                <span className="text-[9px]" style={{ color: textMutedColor }}>Role</span>
                                <span
                                    className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                                    style={{ color: 'var(--brand-btn-text)', backgroundColor: primaryColor }}
                                >
                                    SELLER
                                </span>
                            </div>
                            <div className="h-2.5 w-24 rounded" style={{ backgroundColor: 'rgba(255,255,255,0.1)' }} />
                            <div className="h-2 w-32 rounded mt-1" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }} />
                        </div>
                    </div>
                </div>

                {/* ── Main content ── */}
                <div className="flex-1 min-w-0 flex flex-col brand-bg overflow-hidden">
                    <div className="px-5 pt-3 pb-2 border-b" style={{ borderColor: 'var(--brand-sidebar-border)' }}>
                        <div className="flex items-center gap-2 text-[10px] brand-muted">
                            <Calendar className="w-3 h-3 shrink-0" />
                            Live preview uses real shop view components
                        </div>
                    </div>
                    <div className="flex-1 overflow-hidden p-3">
                        {renderedPreview}
                    </div>
                </div>
            </div>

            {/* Footer bar */}
            <div
                className="px-4 py-2.5 border-t flex items-center justify-between"
                style={{ borderColor: sidebarBorderColor, backgroundColor: sidebarBgColor }}
            >
                <span className="text-[10px]" style={{ color: textMutedColor }}>Seller dashboard preview</span>
                <span className="text-[10px] font-mono" style={{ color: `${primaryColor}80` }}>
                    {primaryColor}
                </span>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------
/**
 * Dedicated white-label / seller-facing branding configuration (PRD §3.7).
 * Includes live preview, save success feedback, and audit change history.
 */
export function AgencyBrandingView({ onNavigate }: AgencyBrandingViewProps) {
    const { agencyMemberships, isAgencyAdminOn, isPlatformSuperAdmin } = useTenantContext();
    const { user, profile } = useAuth();
    const queryClient = useQueryClient();
    const logoFileRef = useRef<HTMLInputElement>(null);
    const saveSuccessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const [selectedAgencyId, setSelectedAgencyId] = useState<string | null>(() => agencyMemberships[0]?.tenant_id ?? null);
    const [busy, setBusy] = useState(false);
    const [logoBusy, setLogoBusy] = useState(false);
    const [saveErr, setSaveErr] = useState<string | null>(null);
    const [savedOk, setSavedOk] = useState(false);
    const [logoErr, setLogoErr] = useState<string | null>(null);
    const [activeColorTab, setActiveColorTab] = useState<'accents' | 'surfaces' | 'sidebar' | 'typography' | 'semantic'>('accents');
    const [form, setForm] = useState(() => ({
        displayName: '',
        ...PLATFORM_BRANDING_FORM_THEME_ONLY,
        emailSenderName: '',
        emailSenderAddress: '',
    }));

    useEffect(() => {
        if (!selectedAgencyId && agencyMemberships[0]) {
            setSelectedAgencyId(agencyMemberships[0].tenant_id);
        }
    }, [agencyMemberships, selectedAgencyId]);

    // Clean up the save-success dismiss timer on unmount
    useEffect(() => () => { if (saveSuccessTimerRef.current) clearTimeout(saveSuccessTimerRef.current); }, []);

    const { data: myAgencyPermActions = [] } = useQuery({
        queryKey: ['agency-branding-effective-perms', selectedAgencyId, user?.id],
        queryFn: async () => {
            if (!selectedAgencyId || !user?.id) return [];
            const { data, error } = await supabase.rpc('get_my_effective_permissions_on_tenant', {
                p_tenant_id: selectedAgencyId,
            });
            if (error) throw error;
            return (data || [])
                .map((row: { action?: string }) => row.action)
                .filter((a: string | undefined): a is string => typeof a === 'string');
        },
        enabled: !!selectedAgencyId && !!user?.id,
    });

    const canEdit =
        !!selectedAgencyId &&
        (isAgencyAdminOn(selectedAgencyId) ||
            isPlatformSuperAdmin ||
            profile?.role === 'admin' ||
            myAgencyPermActions.includes('edit_brand_settings'));

    const {
        data: branding,
        isLoading,
        error: loadError,
    } = useQuery({
        queryKey: ['agency-branding', selectedAgencyId],
        queryFn: () => fetchBranding(selectedAgencyId!),
        enabled: !!selectedAgencyId,
    });

    useEffect(() => {
        if (!branding) return;
        const P = PLATFORM_BRANDING_FORM_THEME_ONLY;
        setForm({
            displayName: branding.displayName,
            primaryColor: normalizeHexAlpha(branding.primaryColor),
            secondaryColor: normalizeHexAlpha(branding.secondaryColor, '#1FA97C'),
            bgColor: normalizeHexAlpha(branding.bgColor ?? P.bgColor),
            sidebarBgColor: normalizeHexAlpha(branding.sidebarBgColor ?? P.sidebarBgColor),
            sidebarBorderColor: normalizeHexAlpha(branding.sidebarBorderColor ?? P.sidebarBorderColor),
            cardBgColor: normalizeHexAlpha(branding.cardBgColor ?? P.cardBgColor),
            cardBorderColor: normalizeHexAlpha(branding.cardBorderColor ?? P.cardBorderColor),
            textColor: normalizeHexAlpha(branding.textColor ?? P.textColor),
            textMutedColor: normalizeHexAlpha(branding.textMutedColor ?? P.textMutedColor),
            btnTextColor: normalizeHexAlpha(branding.btnTextColor ?? P.btnTextColor),
            cardHoverColor: normalizeHexAlpha(branding.cardHoverColor ?? P.cardHoverColor),
            interactiveHoverBg: normalizeHexAlpha(branding.interactiveHoverBg ?? P.interactiveHoverBg),
            interactiveFocusRing: normalizeHexAlpha(branding.interactiveFocusRing ?? P.interactiveFocusRing),
            successBg: normalizeHexAlpha(branding.successBg ?? P.successBg),
            successText: normalizeHexAlpha(branding.successText ?? P.successText),
            successBorder: normalizeHexAlpha(branding.successBorder ?? P.successBorder),
            warningBg: normalizeHexAlpha(branding.warningBg ?? P.warningBg),
            warningText: normalizeHexAlpha(branding.warningText ?? P.warningText),
            warningBorder: normalizeHexAlpha(branding.warningBorder ?? P.warningBorder),
            dangerBg: normalizeHexAlpha(branding.dangerBg ?? P.dangerBg),
            dangerText: normalizeHexAlpha(branding.dangerText ?? P.dangerText),
            dangerBorder: normalizeHexAlpha(branding.dangerBorder ?? P.dangerBorder),
            infoBg: normalizeHexAlpha(branding.infoBg ?? P.infoBg),
            infoText: normalizeHexAlpha(branding.infoText ?? P.infoText),
            infoBorder: normalizeHexAlpha(branding.infoBorder ?? P.infoBorder),
            profitColor: normalizeHexAlpha(branding.profitColor ?? P.profitColor),
            lossColor: normalizeHexAlpha(branding.lossColor ?? P.lossColor),
            primaryCardBg: normalizeHexAlpha(branding.primaryCardBg ?? P.primaryCardBg),
            primaryCardBorder: normalizeHexAlpha(branding.primaryCardBorder ?? P.primaryCardBorder),
            secondaryCardBg: normalizeHexAlpha(branding.secondaryCardBg ?? P.secondaryCardBg),
            secondaryCardBorder: normalizeHexAlpha(branding.secondaryCardBorder ?? P.secondaryCardBorder),
            toastSuccessBg: normalizeHexAlpha(branding.toastSuccessBg ?? P.toastSuccessBg),
            toastSuccessBorder: normalizeHexAlpha(branding.toastSuccessBorder ?? P.toastSuccessBorder),
            toastSuccessIcon: normalizeHexAlpha(branding.toastSuccessIcon ?? P.toastSuccessIcon),
            toastErrorBg: normalizeHexAlpha(branding.toastErrorBg ?? P.toastErrorBg),
            toastErrorBorder: normalizeHexAlpha(branding.toastErrorBorder ?? P.toastErrorBorder),
            toastErrorIcon: normalizeHexAlpha(branding.toastErrorIcon ?? P.toastErrorIcon),
            toastInfoBg: normalizeHexAlpha(branding.toastInfoBg ?? P.toastInfoBg),
            toastInfoBorder: normalizeHexAlpha(branding.toastInfoBorder ?? P.toastInfoBorder),
            toastInfoIcon: normalizeHexAlpha(branding.toastInfoIcon ?? P.toastInfoIcon),
            toastWarningBg: normalizeHexAlpha(branding.toastWarningBg ?? P.toastWarningBg),
            toastWarningBorder: normalizeHexAlpha(branding.toastWarningBorder ?? P.toastWarningBorder),
            toastWarningIcon: normalizeHexAlpha(branding.toastWarningIcon ?? P.toastWarningIcon),
            chartGrid: normalizeHexAlpha(branding.chartGrid ?? P.chartGrid),
            chartAxis: normalizeHexAlpha(branding.chartAxis ?? P.chartAxis),
            chartSeries1: normalizeHexAlpha(branding.chartSeries1 ?? P.chartSeries1),
            chartSeries2: normalizeHexAlpha(branding.chartSeries2 ?? P.chartSeries2),
            chartSeries3: normalizeHexAlpha(branding.chartSeries3 ?? P.chartSeries3),
            chartSeries4: normalizeHexAlpha(branding.chartSeries4 ?? P.chartSeries4),
            chartSeries5: normalizeHexAlpha(branding.chartSeries5 ?? P.chartSeries5),
            chartSeries6: normalizeHexAlpha(branding.chartSeries6 ?? P.chartSeries6),
            chartPositive: normalizeHexAlpha(branding.chartPositive ?? P.chartPositive),
            chartNegative: normalizeHexAlpha(branding.chartNegative ?? P.chartNegative),
            chartNeutral: normalizeHexAlpha(branding.chartNeutral ?? P.chartNeutral),
            emailSenderName: branding.emailSenderName ?? '',
            emailSenderAddress: branding.emailSenderAddress ?? '',
        });
    }, [branding]);

    const { data: auditRows = [], isLoading: auditLoading } = useQuery<AuditRow[]>({
        queryKey: ['agency-branding-audit', selectedAgencyId],
        queryFn: async () => {
            const q = selectedAgencyId
                ? `?agencyTenantId=${encodeURIComponent(selectedAgencyId)}&audit=1&limit=20`
                : '';
            const res = await apiFetch(`/api/branding${q}`);
            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error((json as { error?: string }).error || 'Failed to load audit history');
            // GET /api/branding without audit=1 returns `data` as a branding object — not an array.
            const payload = (json as { data?: unknown }).data;
            return Array.isArray(payload) ? payload : [];
        },
        enabled: !!selectedAgencyId,
        staleTime: 30_000,
    });

    const auditList = Array.isArray(auditRows) ? auditRows : [];

    const handleSave = async () => {
        if (!selectedAgencyId || !canEdit) return;
        setSaveErr(null);
        setSavedOk(false);
        setBusy(true);
        try {
            const savedBranding = await patchBranding({
                agencyTenantId: selectedAgencyId,
                displayName: form.displayName.trim() || null,
                primaryColor: normalizeHexAlpha(form.primaryColor),
                secondaryColor: normalizeHexAlpha(form.secondaryColor, '#1FA97C'),
                bgColor: normalizeHexAlpha(form.bgColor),
                sidebarBgColor: normalizeHexAlpha(form.sidebarBgColor),
                sidebarBorderColor: normalizeHexAlpha(form.sidebarBorderColor),
                cardBgColor: normalizeHexAlpha(form.cardBgColor),
                cardBorderColor: normalizeHexAlpha(form.cardBorderColor),
                textColor: normalizeHexAlpha(form.textColor),
                textMutedColor: normalizeHexAlpha(form.textMutedColor),
                btnTextColor: normalizeHexAlpha(form.btnTextColor),
                cardHoverColor: normalizeHexAlpha(form.cardHoverColor),
                interactiveHoverBg: normalizeHexAlpha(form.interactiveHoverBg),
                interactiveFocusRing: normalizeHexAlpha(form.interactiveFocusRing),
                successBg: normalizeHexAlpha(form.successBg),
                successText: normalizeHexAlpha(form.successText),
                successBorder: normalizeHexAlpha(form.successBorder),
                warningBg: normalizeHexAlpha(form.warningBg),
                warningText: normalizeHexAlpha(form.warningText),
                warningBorder: normalizeHexAlpha(form.warningBorder),
                dangerBg: normalizeHexAlpha(form.dangerBg),
                dangerText: normalizeHexAlpha(form.dangerText),
                dangerBorder: normalizeHexAlpha(form.dangerBorder),
                infoBg: normalizeHexAlpha(form.infoBg),
                infoText: normalizeHexAlpha(form.infoText),
                infoBorder: normalizeHexAlpha(form.infoBorder),
                profitColor: normalizeHexAlpha(form.profitColor),
                lossColor: normalizeHexAlpha(form.lossColor),
                primaryCardBg: normalizeHexAlpha(form.primaryCardBg),
                primaryCardBorder: normalizeHexAlpha(form.primaryCardBorder),
                secondaryCardBg: normalizeHexAlpha(form.secondaryCardBg),
                secondaryCardBorder: normalizeHexAlpha(form.secondaryCardBorder),
                toastSuccessBg: normalizeHexAlpha(form.toastSuccessBg),
                toastSuccessBorder: normalizeHexAlpha(form.toastSuccessBorder),
                toastSuccessIcon: normalizeHexAlpha(form.toastSuccessIcon),
                toastErrorBg: normalizeHexAlpha(form.toastErrorBg),
                toastErrorBorder: normalizeHexAlpha(form.toastErrorBorder),
                toastErrorIcon: normalizeHexAlpha(form.toastErrorIcon),
                toastInfoBg: normalizeHexAlpha(form.toastInfoBg),
                toastInfoBorder: normalizeHexAlpha(form.toastInfoBorder),
                toastInfoIcon: normalizeHexAlpha(form.toastInfoIcon),
                toastWarningBg: normalizeHexAlpha(form.toastWarningBg),
                toastWarningBorder: normalizeHexAlpha(form.toastWarningBorder),
                toastWarningIcon: normalizeHexAlpha(form.toastWarningIcon),
                chartGrid: normalizeHexAlpha(form.chartGrid),
                chartAxis: normalizeHexAlpha(form.chartAxis),
                chartSeries1: normalizeHexAlpha(form.chartSeries1),
                chartSeries2: normalizeHexAlpha(form.chartSeries2),
                chartSeries3: normalizeHexAlpha(form.chartSeries3),
                chartSeries4: normalizeHexAlpha(form.chartSeries4),
                chartSeries5: normalizeHexAlpha(form.chartSeries5),
                chartSeries6: normalizeHexAlpha(form.chartSeries6),
                chartPositive: normalizeHexAlpha(form.chartPositive),
                chartNegative: normalizeHexAlpha(form.chartNegative),
                chartNeutral: normalizeHexAlpha(form.chartNeutral),
                emailSenderName: form.emailSenderName.trim() || null,
                emailSenderAddress: form.emailSenderAddress.trim() || null,
            });
            // Use PATCH response as source of truth — invalidating this query refetches GET /api/branding and can
            // overwrite with stale/incomplete rows if the refetch races or the DB replica lags.
            queryClient.setQueryData(['agency-branding', selectedAgencyId], savedBranding);
            await queryClient.invalidateQueries({ queryKey: ['seller-facing-branding'] });
            await queryClient.invalidateQueries({ queryKey: ['agency-branding-audit', selectedAgencyId] });
            setSavedOk(true);
            if (saveSuccessTimerRef.current) clearTimeout(saveSuccessTimerRef.current);
            saveSuccessTimerRef.current = setTimeout(() => setSavedOk(false), 3000);
        } catch (e: unknown) {
            setSaveErr(e instanceof Error ? e.message : 'Save failed');
        } finally {
            setBusy(false);
        }
    };

    const invalidateBrandingQueries = useCallback(async () => {
        if (selectedAgencyId) {
            await queryClient.invalidateQueries({ queryKey: ['agency-branding', selectedAgencyId] });
            await queryClient.invalidateQueries({ queryKey: ['agency-branding-audit', selectedAgencyId] });
        }
        await queryClient.invalidateQueries({ queryKey: ['seller-facing-branding'] });
    }, [selectedAgencyId, queryClient]);

    const handleLogoFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file || !selectedAgencyId || !canEdit) return;
        setLogoErr(null);
        setLogoBusy(true);
        try {
            await uploadBrandingLogo(selectedAgencyId, file);
            await invalidateBrandingQueries();
        } catch (err: unknown) {
            setLogoErr(err instanceof Error ? err.message : 'Upload failed');
        } finally {
            setLogoBusy(false);
        }
    };

    const handleRemoveLogo = async () => {
        if (!selectedAgencyId || !canEdit) return;
        setLogoErr(null);
        setLogoBusy(true);
        try {
            await deleteBrandingLogo(selectedAgencyId);
            await invalidateBrandingQueries();
        } catch (err: unknown) {
            setLogoErr(err instanceof Error ? err.message : 'Remove failed');
        } finally {
            setLogoBusy(false);
        }
    };

    const THEME_PRESETS = [
        {
            /** Full semantic reset via PLATFORM_BRANDING_FORM_THEME_ONLY in applyPreset. */
            presetKey: 'platform_default' as const,
            name: 'Mamba (Official)',
            primaryColor: '#28D99E',
            secondaryColor: '#1FA97C',
            bgColor: '#06141A',
            sidebarBgColor: '#0D1B21',
            sidebarBorderColor: '#1F3A43',
            cardBgColor: '#13262E',
            cardBorderColor: '#1F3A43',
            textColor: '#E6F3F1',
            textMutedColor: '#8CAFB3',
            btnTextColor: '#06141A',
        },
        {
            name: 'Midnight',
            primaryColor: '#3b82f6', secondaryColor: '#8b5cf6',
            bgColor: '#020617', sidebarBgColor: '#000000', sidebarBorderColor: '#1e293b',
            cardBgColor: '#ffffff06', cardBorderColor: '#ffffff1a',
            textColor: '#f8fafc', textMutedColor: '#94a3b8', btnTextColor: '#ffffff'
        },
        {
            name: 'Off-white',
            primaryColor: '#0f172a', secondaryColor: '#334155',
            bgColor: '#f8fafc', sidebarBgColor: '#ffffff', sidebarBorderColor: '#e2e8f0',
            cardBgColor: '#0000000a', cardBorderColor: '#0000001a',
            textColor: '#0f172a', textMutedColor: '#64748b', btnTextColor: '#ffffff'
        },
        {
            name: 'Forest',
            primaryColor: '#10b981', secondaryColor: '#059669',
            bgColor: '#064e3b', sidebarBgColor: '#022c22', sidebarBorderColor: '#065f46',
            cardBgColor: '#ffffff0a', cardBorderColor: '#ffffff20',
            textColor: '#ecfdf5', textMutedColor: '#a7f3d0', btnTextColor: '#ffffff'
        }
    ];

    const applyPreset = (preset: (typeof THEME_PRESETS)[number] | CustomPreset) => {
        setForm(prev => {
            if ('presetKey' in preset && preset.presetKey === 'platform_default') {
                return { ...prev, ...PLATFORM_BRANDING_FORM_THEME_ONLY };
            }
            return {
                ...prev,
                primaryColor: preset.primaryColor,
                secondaryColor: preset.secondaryColor,
                bgColor: preset.bgColor,
                sidebarBgColor: preset.sidebarBgColor,
                sidebarBorderColor: preset.sidebarBorderColor,
                cardBgColor: preset.cardBgColor,
                cardBorderColor: preset.cardBorderColor,
                textColor: preset.textColor,
                textMutedColor: preset.textMutedColor,
                btnTextColor: preset.btnTextColor,
            };
        });
    };

    const handleSaveCustomPreset = async () => {
        if (!selectedAgencyId) return;
        const name = window.prompt('Enter a name for this custom preset:');
        if (!name?.trim()) return;
        const newPreset = {
            id: crypto.randomUUID(),
            name: name.trim(),
            primaryColor: form.primaryColor,
            secondaryColor: form.secondaryColor,
            bgColor: form.bgColor,
            sidebarBgColor: form.sidebarBgColor,
            sidebarBorderColor: form.sidebarBorderColor,
            cardBgColor: form.cardBgColor,
            cardBorderColor: form.cardBorderColor,
            textColor: form.textColor,
            textMutedColor: form.textMutedColor,
            btnTextColor: form.btnTextColor,
            cardHoverColor: form.cardHoverColor,
            interactiveHoverBg: form.interactiveHoverBg,
            interactiveFocusRing: form.interactiveFocusRing,
            successBg: form.successBg,
            successText: form.successText,
            successBorder: form.successBorder,
            warningBg: form.warningBg,
            warningText: form.warningText,
            warningBorder: form.warningBorder,
            dangerBg: form.dangerBg,
            dangerText: form.dangerText,
            dangerBorder: form.dangerBorder,
            infoBg: form.infoBg,
            infoText: form.infoText,
            infoBorder: form.infoBorder,
            profitColor: form.profitColor,
            lossColor: form.lossColor,
            primaryCardBg: form.primaryCardBg,
            primaryCardBorder: form.primaryCardBorder,
            secondaryCardBg: form.secondaryCardBg,
            secondaryCardBorder: form.secondaryCardBorder,
            toastSuccessBg: form.toastSuccessBg,
            toastSuccessBorder: form.toastSuccessBorder,
            toastSuccessIcon: form.toastSuccessIcon,
            toastErrorBg: form.toastErrorBg,
            toastErrorBorder: form.toastErrorBorder,
            toastErrorIcon: form.toastErrorIcon,
            toastInfoBg: form.toastInfoBg,
            toastInfoBorder: form.toastInfoBorder,
            toastInfoIcon: form.toastInfoIcon,
            toastWarningBg: form.toastWarningBg,
            toastWarningBorder: form.toastWarningBorder,
            toastWarningIcon: form.toastWarningIcon,
            chartGrid: form.chartGrid,
            chartAxis: form.chartAxis,
            chartSeries1: form.chartSeries1,
            chartSeries2: form.chartSeries2,
            chartSeries3: form.chartSeries3,
            chartSeries4: form.chartSeries4,
            chartSeries5: form.chartSeries5,
            chartSeries6: form.chartSeries6,
            chartPositive: form.chartPositive,
            chartNegative: form.chartNegative,
            chartNeutral: form.chartNeutral,
        };
        const updated = [...(branding?.customPresets || []), newPreset];
        try {
            const data = await patchBranding({ agencyTenantId: selectedAgencyId, customPresets: updated });
            queryClient.setQueryData(['agency-branding', selectedAgencyId], data);
            await queryClient.invalidateQueries({ queryKey: ['seller-facing-branding'] });
        } catch (e) {
            console.error(e);
            alert('Failed to save preset.');
        }
    };

    const handleDeleteCustomPreset = async (presetId: string) => {
        if (!selectedAgencyId || !branding?.customPresets) return;
        if (!window.confirm('Delete this preset?')) return;
        const updated = branding.customPresets.filter(p => p.id !== presetId);
        try {
            const data = await patchBranding({ agencyTenantId: selectedAgencyId, customPresets: updated });
            queryClient.setQueryData(['agency-branding', selectedAgencyId], data);
            await queryClient.invalidateQueries({ queryKey: ['seller-facing-branding'] });
        } catch (e) {
            console.error(e);
            alert('Failed to delete preset.');
        }
    };

    const allPresets = useMemo(() => {
        return [...THEME_PRESETS, ...(branding?.customPresets || [])];
    }, [branding?.customPresets]);

    const selectedLabel = useMemo(() => {
        const m = agencyMemberships.find((x) => x.tenant_id === selectedAgencyId);
        return m?.tenants?.name || 'Agency';
    }, [agencyMemberships, selectedAgencyId]);

    // Live preview values — track form changes without waiting for a save
    const previewPrimary = normalizeHexAlpha(form.primaryColor);
    const previewSecondary = normalizeHexAlpha(form.secondaryColor, '#1FA97C');
    const previewBg = normalizeHexAlpha(form.bgColor);
    const previewSidebarBg = normalizeHexAlpha(form.sidebarBgColor);
    const previewSidebarBorder = normalizeHexAlpha(form.sidebarBorderColor);
    const previewCardBg = normalizeHexAlpha(form.cardBgColor);
    const previewCardBorder = normalizeHexAlpha(form.cardBorderColor);
    const previewText = normalizeHexAlpha(form.textColor);
    const previewTextMuted = normalizeHexAlpha(form.textMutedColor);
    const previewBtnText = normalizeHexAlpha(form.btnTextColor);
    const previewProfit = normalizeHexAlpha(form.profitColor);
    const previewLoss = normalizeHexAlpha(form.lossColor);
    const previewCssVars: CSSProperties = {
        '--brand-primary': previewPrimary,
        '--brand-secondary': previewSecondary,
        '--brand-bg': previewBg,
        '--brand-sidebar-bg': previewSidebarBg,
        '--brand-sidebar-border': previewSidebarBorder,
        '--brand-card-bg': previewCardBg,
        '--brand-card-border': previewCardBorder,
        '--brand-text': previewText,
        '--brand-text-muted': previewTextMuted,
        '--brand-btn-text': previewBtnText,
        '--brand-card-hover': normalizeHexAlpha(form.cardHoverColor),
        '--brand-interactive-hover-bg': normalizeHexAlpha(form.interactiveHoverBg),
        '--brand-interactive-focus-ring': normalizeHexAlpha(form.interactiveFocusRing),
        '--brand-success-bg': normalizeHexAlpha(form.successBg),
        '--brand-success-text': normalizeHexAlpha(form.successText),
        '--brand-success-border': normalizeHexAlpha(form.successBorder),
        '--brand-warning-bg': normalizeHexAlpha(form.warningBg),
        '--brand-warning-text': normalizeHexAlpha(form.warningText),
        '--brand-warning-border': normalizeHexAlpha(form.warningBorder),
        '--brand-danger-bg': normalizeHexAlpha(form.dangerBg),
        '--brand-danger-text': normalizeHexAlpha(form.dangerText),
        '--brand-danger-border': normalizeHexAlpha(form.dangerBorder),
        '--brand-info-bg': normalizeHexAlpha(form.infoBg),
        '--brand-info-text': normalizeHexAlpha(form.infoText),
        '--brand-info-border': normalizeHexAlpha(form.infoBorder),
        '--brand-profit': previewProfit,
        '--brand-loss': previewLoss,
        '--brand-primary-card-bg': normalizeHexAlpha(form.primaryCardBg),
        '--brand-primary-card-border': normalizeHexAlpha(form.primaryCardBorder),
        '--brand-secondary-card-bg': normalizeHexAlpha(form.secondaryCardBg),
        '--brand-secondary-card-border': normalizeHexAlpha(form.secondaryCardBorder),
        '--brand-toast-success-bg': normalizeHexAlpha(form.toastSuccessBg),
        '--brand-toast-success-border': normalizeHexAlpha(form.toastSuccessBorder),
        '--brand-toast-success-icon': normalizeHexAlpha(form.toastSuccessIcon),
        '--brand-toast-error-bg': normalizeHexAlpha(form.toastErrorBg),
        '--brand-toast-error-border': normalizeHexAlpha(form.toastErrorBorder),
        '--brand-toast-error-icon': normalizeHexAlpha(form.toastErrorIcon),
        '--brand-toast-info-bg': normalizeHexAlpha(form.toastInfoBg),
        '--brand-toast-info-border': normalizeHexAlpha(form.toastInfoBorder),
        '--brand-toast-info-icon': normalizeHexAlpha(form.toastInfoIcon),
        '--brand-toast-warning-bg': normalizeHexAlpha(form.toastWarningBg),
        '--brand-toast-warning-border': normalizeHexAlpha(form.toastWarningBorder),
        '--brand-toast-warning-icon': normalizeHexAlpha(form.toastWarningIcon),
        '--brand-chart-grid': normalizeHexAlpha(form.chartGrid),
        '--brand-chart-axis': normalizeHexAlpha(form.chartAxis),
        '--brand-chart-series-1': normalizeHexAlpha(form.chartSeries1),
        '--brand-chart-series-2': normalizeHexAlpha(form.chartSeries2),
        '--brand-chart-series-3': normalizeHexAlpha(form.chartSeries3),
        '--brand-chart-series-4': normalizeHexAlpha(form.chartSeries4),
        '--brand-chart-series-5': normalizeHexAlpha(form.chartSeries5),
        '--brand-chart-series-6': normalizeHexAlpha(form.chartSeries6),
        '--brand-chart-positive': normalizeHexAlpha(form.chartPositive),
        '--brand-chart-negative': normalizeHexAlpha(form.chartNegative),
        '--brand-chart-neutral': normalizeHexAlpha(form.chartNeutral),
    } as CSSProperties;
    const previewName = form.displayName.trim() || branding?.displayName || 'Your brand';
    const previewLogoUrl = branding?.logoSignedUrl ?? null;

    if (agencyMemberships.length === 0) {
        return (
            <div className="max-w-xl brand-muted text-sm">
                You are not a member of an agency tenant. Branding is configured at the agency level for seller-facing experiences.
            </div>
        );
    }

    return (
        <div className="w-full max-w-none space-y-10 animate-in fade-in duration-500 pb-12 relative">
            <div className="absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-mamba-green/10 via-mamba-deep/5 to-transparent -z-10 rounded-full blur-[100px] opacity-60 pointer-events-none" />

            {/* Page header */}
            <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <h1 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-white via-mamba-neon/90 to-white flex items-center gap-4">
                        <div className="p-2.5 bg-mamba-green/10 rounded-2xl border border-mamba-green/20 backdrop-blur-xl">
                            <Palette className="w-8 h-8 text-mamba-green drop-shadow-lg" />
                        </div>
                        Seller branding
                    </h1>
                    <p className="brand-muted opacity-90 mt-4 text-base max-w-2xl leading-relaxed">
                        One brand package per <strong className="brand-text opacity-90">agency</strong> (not per shop). Saving requires the <strong className="brand-text opacity-90">Edit brand settings</strong> permission (Agency Admins have it by default). The preview on the right updates live as you make changes.
                    </p>
                </div>
                {onNavigate && (
                    <button
                        type="button"
                        onClick={() => onNavigate('agency-console')}
                        className="inline-flex items-center gap-2 shrink-0 px-4 py-2.5 rounded-xl text-sm font-semibold border border-white/10 bg-white/5 text-gray-200 hover:bg-white/10 transition-colors"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Agency console
                    </button>
                )}
            </div>



            {/* Agency selector */}
            <section className="bg-white/[0.02] border border-white/10 rounded-3xl p-6 backdrop-blur-sm relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-mamba-deep/5 to-transparent pointer-events-none" />
                <div className="relative space-y-6">
                    <div className="brand-text font-bold text-lg flex items-center gap-3">
                        <div className="p-2 bg-gray-800 rounded-xl border border-white/5">
                            <Building2 className="w-5 h-5 brand-muted" />
                        </div>
                        Agency
                    </div>
                    <div className="flex flex-wrap gap-3">
                        {agencyMemberships.map((m) => (
                            <button
                                key={m.tenant_id}
                                type="button"
                                onClick={() => setSelectedAgencyId(m.tenant_id)}
                                className={`px-5 py-3 rounded-2xl text-sm font-semibold transition-all border block text-left ${
                                    selectedAgencyId === m.tenant_id
                                        ? 'bg-mamba-green/20 border-mamba-green/50 text-white shadow-lg shadow-black/20'
                                        : 'bg-gray-900/50 border-white/10 text-gray-300 hover:border-mamba-green/30 hover:bg-mamba-green/5'
                                }`}
                            >
                                <div className="flex items-center justify-between gap-4">
                                    <span>{m.tenants?.name || 'Agency'}</span>
                                    {selectedAgencyId === m.tenant_id && <Check className="w-4 h-4 text-mamba-neon" />}
                                </div>
                                <span
                                    className={`block text-[11px] mt-1 ${
                                        selectedAgencyId === m.tenant_id ? 'text-mamba-green' : 'text-gray-500'
                                    }`}
                                >
                                    {m.roles?.name}
                                </span>
                            </button>
                        ))}
                    </div>
                </div>
            </section>

            {/* Main content: settings + live preview side by side */}
            <div className="grid lg:grid-cols-2 gap-8 items-start">
                {/* Settings panel */}
                <section className="bg-white/[0.02] border border-white/10 rounded-3xl p-6 sm:p-8 backdrop-blur-sm relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-br from-mamba-green/5 to-transparent pointer-events-none" />
                    <div className="relative space-y-6 max-w-full">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <h2 className="text-lg font-bold brand-text">Appearance &amp; identity</h2>
                            {branding && (
                                <span
                                    className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg border ${
                                        branding.source === 'configured'
                                            ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25'
                                            : 'bg-gray-500/15 text-gray-400 border-gray-500/25'
                                    }`}
                                >
                                    {branding.source === 'configured' ? 'Custom' : 'Platform default'}
                                </span>
                            )}
                        </div>

                        {isLoading ? (
                            <div className="flex items-center gap-2 brand-muted text-sm py-8">
                                <Loader2 className="w-5 h-5 animate-spin" />
                                Loading branding for {selectedLabel}…
                            </div>
                        ) : loadError ? (
                            <p className="text-sm text-amber-300/90 flex items-center gap-2 py-4">
                                <AlertCircle className="w-4 h-4 shrink-0" />
                                {loadError instanceof Error ? loadError.message : String(loadError)}
                            </p>
                        ) : (
                            <>
                                {/* Basic Identity */}
                                <div className="flex flex-col sm:flex-row gap-6 items-start pb-4">
                                    {/* Logo */}
                                    <div className="shrink-0 space-y-3">
                                        <span className="text-xs font-semibold brand-muted uppercase tracking-wide">Logo</span>
                                        <div className="flex flex-col gap-3">
                                            <div className="w-24 h-24 rounded-2xl border border-white/10 bg-gray-950/80 flex items-center justify-center overflow-hidden shrink-0">
                                                {branding?.logoSignedUrl ? (
                                                    <img src={branding.logoSignedUrl} alt="" className="max-w-full max-h-full object-contain p-2" />
                                                ) : (
                                                    <ImageIcon className="w-8 h-8 text-gray-600" aria-hidden />
                                                )}
                                            </div>
                                            <input ref={logoFileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleLogoFileChange} />
                                            {canEdit && (
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <button type="button" disabled={logoBusy} onClick={() => logoFileRef.current?.click()} className="inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border border-white/15 bg-white/5 text-gray-100 hover:bg-white/10 disabled:opacity-50 transition-colors">
                                                        {logoBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />} Upload
                                                    </button>
                                                    {branding?.logoSignedUrl && (
                                                        <button type="button" disabled={logoBusy} onClick={handleRemoveLogo} className="p-1.5 rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-colors" title="Remove logo">
                                                            <X className="w-4 h-4" />
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    
                                    <div className="flex-1 space-y-5 w-full">
                                        {/* Display name */}
                                        <label className="block space-y-1.5">
                                            <span className="text-xs font-semibold brand-muted uppercase tracking-wide">Brand display name</span>
                                            <input value={form.displayName} onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))} disabled={!canEdit} maxLength={120} className="w-full px-3 py-2.5 bg-gray-950/50 border border-white/10 rounded-xl text-sm brand-text focus:border-mamba-green/50 focus:outline-none disabled:opacity-50" placeholder="Shown to sellers instead of Mamba" />
                                        </label>
                                        
                                        {/* Email identity */}
                                        <div className="grid sm:grid-cols-2 gap-4">
                                            <label className="block space-y-1.5">
                                                <span className="text-xs font-semibold brand-muted uppercase tracking-wide">Email sender name</span>
                                                <input value={form.emailSenderName} onChange={(e) => setForm((f) => ({ ...f, emailSenderName: e.target.value }))} disabled={!canEdit} className="w-full px-3 py-2.5 bg-gray-950/50 border border-white/10 rounded-xl text-sm brand-text focus:border-mamba-green/50 focus:outline-none disabled:opacity-50" placeholder="Optional" />
                                            </label>
                                            <label className="block space-y-1.5">
                                                <span className="text-xs font-semibold brand-muted uppercase tracking-wide">Email sender address</span>
                                                <input value={form.emailSenderAddress} onChange={(e) => setForm((f) => ({ ...f, emailSenderAddress: e.target.value }))} disabled={!canEdit} type="email" className="w-full px-3 py-2.5 bg-gray-950/50 border border-white/10 rounded-xl text-sm brand-text focus:border-mamba-green/50 focus:outline-none disabled:opacity-50" placeholder="Verified domain in production" />
                                            </label>
                                        </div>
                                    </div>
                                </div>

                                {/* Theme Settings */}
                                <div className="space-y-5 pt-5 border-t border-white/5">
                                    {/* Theme Presets */}
                                    <div className="space-y-3">
                                        <span className="text-xs font-semibold brand-muted uppercase tracking-wide">Theme Presets</span>
                                        <div className="flex flex-wrap gap-2 items-center">
                                            {allPresets.map((preset) => {
                                                const isCustom = 'id' in preset;
                                                return (
                                                    <div key={isCustom ? (preset as any).id : preset.name} className="relative group inline-flex">
                                                        <button type="button" onClick={() => applyPreset(preset)} disabled={!canEdit} className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-xs text-gray-200 font-semibold transition-colors disabled:opacity-50">
                                                            {preset.name}
                                                        </button>
                                                        {isCustom && canEdit && (
                                                            <button type="button" onClick={(e) => { e.stopPropagation(); handleDeleteCustomPreset((preset as any).id); }} className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-gray-800 border border-white/10 text-gray-400 hover:text-red-400 hover:bg-red-900/30 opacity-0 group-hover:opacity-100 transition-opacity">
                                                                <X className="w-2.5 h-2.5" />
                                                            </button>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                            {canEdit && (
                                                <button type="button" onClick={handleSaveCustomPreset} className="px-3 py-1.5 rounded-lg border border-dashed border-white/20 hover:border-mamba-green/50 hover:bg-mamba-green/10 text-xs text-mamba-neon font-semibold transition-colors flex items-center gap-1.5 ml-1">
                                                    <Plus className="w-3 h-3" /> Save current
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    {/* Colors Tabs */}
                                    <div className="space-y-3 bg-white/[0.02] border border-white/5 rounded-2xl p-4">
                                        <div className="flex flex-wrap items-center justify-between gap-4 mb-2">
                                            <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Custom Colors</span>
                                            <div className="flex flex-wrap bg-gray-950/50 p-1 rounded-lg border border-white/10">
                                                {(['accents', 'surfaces', 'sidebar', 'typography', 'semantic'] as const).map((tab) => (
                                                    <button
                                                        key={tab}
                                                        type="button"
                                                        onClick={() => setActiveColorTab(tab)}
                                                        className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-md transition-colors ${
                                                            activeColorTab === tab
                                                                ? 'bg-mamba-green/20 text-mamba-neon shadow-sm'
                                                                : 'text-gray-500 hover:text-gray-300'
                                                        }`}
                                                    >
                                                        {tab}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        <div className="min-h-[160px] relative">
                                            {activeColorTab === 'accents' && (
                                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-5 animate-in fade-in duration-300">
                                                    <BrandColorPopover label="Primary" value={form.primaryColor} disabled={!canEdit} onChange={(hex) => setForm((f) => ({ ...f, primaryColor: hex }))} />
                                                    <BrandColorPopover label="Secondary" value={form.secondaryColor} disabled={!canEdit} onChange={(hex) => setForm((f) => ({ ...f, secondaryColor: hex }))} />
                                                </div>
                                            )}
                                            {activeColorTab === 'surfaces' && (
                                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-5 animate-in fade-in duration-300">
                                                    <BrandColorPopover label="App Background" value={form.bgColor} disabled={!canEdit} onChange={(hex) => setForm((f) => ({ ...f, bgColor: hex }))} />
                                                    <BrandColorPopover label="Card Background" value={form.cardBgColor} disabled={!canEdit} onChange={(hex) => setForm((f) => ({ ...f, cardBgColor: hex }))} />
                                                    <BrandColorPopover label="Card Border" value={form.cardBorderColor} disabled={!canEdit} onChange={(hex) => setForm((f) => ({ ...f, cardBorderColor: hex }))} />
                                                    <BrandColorPopover label="Primary Card BG" value={form.primaryCardBg} disabled={!canEdit} onChange={(hex) => setForm((f) => ({ ...f, primaryCardBg: hex }))} />
                                                    <BrandColorPopover label="Primary Card Border" value={form.primaryCardBorder} disabled={!canEdit} onChange={(hex) => setForm((f) => ({ ...f, primaryCardBorder: hex }))} />
                                                    <BrandColorPopover label="Secondary Card BG" value={form.secondaryCardBg} disabled={!canEdit} onChange={(hex) => setForm((f) => ({ ...f, secondaryCardBg: hex }))} />
                                                    <BrandColorPopover label="Secondary Card Border" value={form.secondaryCardBorder} disabled={!canEdit} onChange={(hex) => setForm((f) => ({ ...f, secondaryCardBorder: hex }))} />
                                                    <BrandColorPopover label="Profit Card BG" value={form.successBg} disabled={!canEdit} onChange={(hex) => setForm((f) => ({ ...f, successBg: hex }))} />
                                                    <BrandColorPopover label="Profit Card Border" value={form.successBorder} disabled={!canEdit} onChange={(hex) => setForm((f) => ({ ...f, successBorder: hex }))} />
                                                    <BrandColorPopover label="Loss Card BG" value={form.dangerBg} disabled={!canEdit} onChange={(hex) => setForm((f) => ({ ...f, dangerBg: hex }))} />
                                                    <BrandColorPopover label="Loss Card Border" value={form.dangerBorder} disabled={!canEdit} onChange={(hex) => setForm((f) => ({ ...f, dangerBorder: hex }))} />
                                                    <BrandColorPopover label="Profit Value Text" value={form.profitColor} disabled={!canEdit} onChange={(hex) => setForm((f) => ({ ...f, profitColor: hex }))} />
                                                    <BrandColorPopover label="Loss Value Text" value={form.lossColor} disabled={!canEdit} onChange={(hex) => setForm((f) => ({ ...f, lossColor: hex }))} />
                                                </div>
                                            )}
                                            {activeColorTab === 'sidebar' && (
                                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-5 animate-in fade-in duration-300">
                                                    <BrandColorPopover label="Sidebar Background" value={form.sidebarBgColor} disabled={!canEdit} onChange={(hex) => setForm((f) => ({ ...f, sidebarBgColor: hex }))} />
                                                    <BrandColorPopover label="Sidebar Border" value={form.sidebarBorderColor} disabled={!canEdit} onChange={(hex) => setForm((f) => ({ ...f, sidebarBorderColor: hex }))} />
                                                </div>
                                            )}
                                            {activeColorTab === 'typography' && (
                                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-5 animate-in fade-in duration-300">
                                                    <BrandColorPopover label="Main Text" value={form.textColor} disabled={!canEdit} onChange={(hex) => setForm((f) => ({ ...f, textColor: hex }))} />
                                                    <BrandColorPopover label="Muted Text" value={form.textMutedColor} disabled={!canEdit} onChange={(hex) => setForm((f) => ({ ...f, textMutedColor: hex }))} />
                                                    <BrandColorPopover label="Button Text" value={form.btnTextColor} disabled={!canEdit} onChange={(hex) => setForm((f) => ({ ...f, btnTextColor: hex }))} />
                                                </div>
                                            )}
                                            {activeColorTab === 'semantic' && (
                                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-5 animate-in fade-in duration-300">
                                                    <BrandColorPopover label="Card Hover" value={form.cardHoverColor} disabled={!canEdit} onChange={(hex) => setForm((f) => ({ ...f, cardHoverColor: hex }))} />
                                                    <BrandColorPopover label="Warning Surface" value={form.warningBg} disabled={!canEdit} onChange={(hex) => setForm((f) => ({ ...f, warningBg: hex }))} />
                                                    <BrandColorPopover label="Warning Text" value={form.warningText} disabled={!canEdit} onChange={(hex) => setForm((f) => ({ ...f, warningText: hex }))} />
                                                    <BrandColorPopover label="Toast Success BG" value={form.toastSuccessBg} disabled={!canEdit} onChange={(hex) => setForm((f) => ({ ...f, toastSuccessBg: hex }))} />
                                                    <BrandColorPopover label="Toast Error BG" value={form.toastErrorBg} disabled={!canEdit} onChange={(hex) => setForm((f) => ({ ...f, toastErrorBg: hex }))} />
                                                    <BrandColorPopover label="Chart Grid" value={form.chartGrid} disabled={!canEdit} onChange={(hex) => setForm((f) => ({ ...f, chartGrid: hex }))} />
                                                    <BrandColorPopover label="Chart Series 1" value={form.chartSeries1} disabled={!canEdit} onChange={(hex) => setForm((f) => ({ ...f, chartSeries1: hex }))} />
                                                    <BrandColorPopover label="Chart Series 2" value={form.chartSeries2} disabled={!canEdit} onChange={(hex) => setForm((f) => ({ ...f, chartSeries2: hex }))} />
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {!canEdit && (
                                    <p className="text-sm brand-muted border border-white/5 rounded-xl px-4 py-3 bg-gray-950/40">
                                        You need the <strong className="text-gray-300">Edit brand settings</strong> permission on this agency to save. You can still review values here.
                                    </p>
                                )}

                                {saveErr && (
                                    <p className="text-sm text-amber-300/90 flex items-center gap-2">
                                        <AlertCircle className="w-4 h-4 shrink-0" />
                                        {saveErr}
                                    </p>
                                )}

                                {/* Save button row */}
                                {canEdit && (
                                    <div className="flex items-center gap-4">
                                        <button
                                            type="button"
                                            disabled={busy}
                                            onClick={handleSave}
                                            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold bg-mamba-green hover:bg-mamba-deep text-mamba-dark disabled:opacity-50 transition-colors"
                                        >
                                            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                                            Save branding
                                        </button>

                                        {/* Transient success indicator */}
                                        {savedOk && (
                                            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-400 animate-in fade-in slide-in-from-left-2 duration-300">
                                                <CheckCircle2 className="w-4 h-4" />
                                                Saved successfully
                                            </span>
                                        )}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </section>

                {/* Live preview panel */}
                <aside className="space-y-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-gray-400 uppercase tracking-wide">
                        <Palette className="w-4 h-4" />
                        Live preview
                    </div>
                    <BrandPreviewCard
                        displayName={previewName}
                        primaryColor={previewPrimary}
                        sidebarBgColor={previewSidebarBg}
                        sidebarBorderColor={previewSidebarBorder}
                        textColor={previewText}
                        textMutedColor={previewTextMuted}
                        cssVars={previewCssVars}
                        logoUrl={previewLogoUrl}
                    />
                    <p className="text-xs text-gray-600 leading-relaxed">
                        Updates as you change colors and display name. Logo refreshes after upload.
                    </p>
                </aside>
            </div>

            {/* Audit history */}
            <section className="bg-white/[0.02] border border-white/10 rounded-3xl p-6 sm:p-8 backdrop-blur-sm relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-gray-500/5 to-transparent pointer-events-none" />
                <div className="relative space-y-5">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-gray-800 rounded-xl border border-white/5">
                            <History className="w-5 h-5 text-gray-400" />
                        </div>
                        <h2 className="text-lg font-bold text-white">Change history</h2>
                    </div>

                    {auditLoading ? (
                        <div className="flex items-center gap-2 text-gray-500 text-sm py-6">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Loading history…
                        </div>
                    ) : auditList.length === 0 ? (
                        <p className="text-sm text-gray-600 py-4">No changes recorded yet for this agency.</p>
                    ) : (
                        <ol className="relative border-l border-white/5 ml-3 space-y-0">
                            {auditList.map((row, idx) => {
                                const actor = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
                                const actorName = actor?.full_name ?? actor?.email ?? 'Unknown';
                                const isLast = idx === auditList.length - 1;
                                return (
                                    <li key={row.id} className={`ml-5 ${isLast ? '' : 'pb-5'}`}>
                                        {/* Timeline dot */}
                                        <span
                                            className={`absolute -left-[7px] w-3.5 h-3.5 rounded-full border-2 border-gray-900 ${
                                                row.action === 'create' ? 'bg-emerald-500/80' : 'bg-indigo-500/80'
                                            }`}
                                        />
                                        <div className="flex flex-wrap items-baseline gap-2">
                                            <span className="text-sm font-semibold text-gray-200">{auditSummary(row)}</span>
                                            <span
                                                className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${
                                                    row.action === 'create'
                                                        ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                                                        : 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20'
                                                }`}
                                            >
                                                {row.action}
                                            </span>
                                        </div>
                                        <p className="text-xs text-gray-500 mt-1 flex items-center gap-1.5">
                                            <Clock className="w-3 h-3 shrink-0" />
                                            {formatRelativeTime(row.created_at)}
                                            <span className="text-gray-700">·</span>
                                            {actorName}
                                        </p>
                                    </li>
                                );
                            })}
                        </ol>
                    )}
                </div>
            </section>
        </div>
    );
}
