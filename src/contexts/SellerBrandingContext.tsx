import {
    createContext,
    useContext,
    useMemo,
    useEffect,
    useRef,
    type CSSProperties,
    type ReactNode,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchBranding, type BrandingResolved } from '../lib/brandingApi';
import { PLATFORM_BRANDING_RESOLVED_DEFAULT } from '../lib/platformBrandingDefaults';

/** Platform defaults when no agency row exists or outside branding provider. */
export const DEFAULT_SELLER_BRANDING: BrandingResolved = PLATFORM_BRANDING_RESOLVED_DEFAULT;

export type SellerBrandingState = {
    data: BrandingResolved;
    isLoading: boolean;
    fetchError: Error | null;
    /** True while this shell is fetching branding (avoid flashing default "Mamba" in header). */
    shellPending: boolean;
    /** Provider was mounted with branding enabled (console: JWT tenant is agency or seller). */
    agencyConsoleBranding: boolean;
    /** Apply on a layout root so descendants can use `var(--brand-primary)` / `var(--brand-secondary)`. */
    cssVariables: CSSProperties;
};

export type SellerBrandingDocumentTitle =
    | { kind: 'shop'; shopName: string }
    /** Home console: title shows agency display name for seller-tenant JWTs. */
    | { kind: 'console' };

function brandingToCssVars(b: BrandingResolved): CSSProperties {
    return {
        '--brand-primary': b.primaryColor,
        '--brand-secondary': b.secondaryColor,
        '--brand-bg': b.bgColor || DEFAULT_SELLER_BRANDING.bgColor!,
        '--brand-sidebar-bg': b.sidebarBgColor || DEFAULT_SELLER_BRANDING.sidebarBgColor!,
        '--brand-sidebar-border': b.sidebarBorderColor || DEFAULT_SELLER_BRANDING.sidebarBorderColor!,
        '--brand-card-bg': b.cardBgColor || DEFAULT_SELLER_BRANDING.cardBgColor!,
        '--brand-card-border': b.cardBorderColor || DEFAULT_SELLER_BRANDING.cardBorderColor!,
        '--brand-text': b.textColor || DEFAULT_SELLER_BRANDING.textColor!,
        '--brand-text-muted': b.textMutedColor || DEFAULT_SELLER_BRANDING.textMutedColor!,
        '--brand-btn-text': b.btnTextColor || DEFAULT_SELLER_BRANDING.btnTextColor!,
        '--brand-card-hover': b.cardHoverColor || DEFAULT_SELLER_BRANDING.cardHoverColor!,
        '--brand-interactive-hover-bg': b.interactiveHoverBg || DEFAULT_SELLER_BRANDING.interactiveHoverBg!,
        '--brand-interactive-focus-ring': b.interactiveFocusRing || DEFAULT_SELLER_BRANDING.interactiveFocusRing!,
        '--brand-success-bg': b.successBg || DEFAULT_SELLER_BRANDING.successBg!,
        '--brand-success-text': b.successText || DEFAULT_SELLER_BRANDING.successText!,
        '--brand-success-border': b.successBorder || DEFAULT_SELLER_BRANDING.successBorder!,
        '--brand-warning-bg': b.warningBg || DEFAULT_SELLER_BRANDING.warningBg!,
        '--brand-warning-text': b.warningText || DEFAULT_SELLER_BRANDING.warningText!,
        '--brand-warning-border': b.warningBorder || DEFAULT_SELLER_BRANDING.warningBorder!,
        '--brand-danger-bg': b.dangerBg || DEFAULT_SELLER_BRANDING.dangerBg!,
        '--brand-danger-text': b.dangerText || DEFAULT_SELLER_BRANDING.dangerText!,
        '--brand-danger-border': b.dangerBorder || DEFAULT_SELLER_BRANDING.dangerBorder!,
        '--brand-info-bg': b.infoBg || DEFAULT_SELLER_BRANDING.infoBg!,
        '--brand-info-text': b.infoText || DEFAULT_SELLER_BRANDING.infoText!,
        '--brand-info-border': b.infoBorder || DEFAULT_SELLER_BRANDING.infoBorder!,
        '--brand-profit': b.profitColor || DEFAULT_SELLER_BRANDING.profitColor!,
        '--brand-loss': b.lossColor || DEFAULT_SELLER_BRANDING.lossColor!,
        '--brand-primary-card-bg': b.primaryCardBg || DEFAULT_SELLER_BRANDING.primaryCardBg!,
        '--brand-primary-card-border': b.primaryCardBorder || DEFAULT_SELLER_BRANDING.primaryCardBorder!,
        '--brand-secondary-card-bg': b.secondaryCardBg || DEFAULT_SELLER_BRANDING.secondaryCardBg!,
        '--brand-secondary-card-border': b.secondaryCardBorder || DEFAULT_SELLER_BRANDING.secondaryCardBorder!,
        '--brand-toast-success-bg': b.toastSuccessBg || DEFAULT_SELLER_BRANDING.toastSuccessBg!,
        '--brand-toast-success-border': b.toastSuccessBorder || DEFAULT_SELLER_BRANDING.toastSuccessBorder!,
        '--brand-toast-success-icon': b.toastSuccessIcon || DEFAULT_SELLER_BRANDING.toastSuccessIcon!,
        '--brand-toast-error-bg': b.toastErrorBg || DEFAULT_SELLER_BRANDING.toastErrorBg!,
        '--brand-toast-error-border': b.toastErrorBorder || DEFAULT_SELLER_BRANDING.toastErrorBorder!,
        '--brand-toast-error-icon': b.toastErrorIcon || DEFAULT_SELLER_BRANDING.toastErrorIcon!,
        '--brand-toast-info-bg': b.toastInfoBg || DEFAULT_SELLER_BRANDING.toastInfoBg!,
        '--brand-toast-info-border': b.toastInfoBorder || DEFAULT_SELLER_BRANDING.toastInfoBorder!,
        '--brand-toast-info-icon': b.toastInfoIcon || DEFAULT_SELLER_BRANDING.toastInfoIcon!,
        '--brand-toast-warning-bg': b.toastWarningBg || DEFAULT_SELLER_BRANDING.toastWarningBg!,
        '--brand-toast-warning-border': b.toastWarningBorder || DEFAULT_SELLER_BRANDING.toastWarningBorder!,
        '--brand-toast-warning-icon': b.toastWarningIcon || DEFAULT_SELLER_BRANDING.toastWarningIcon!,
        '--brand-chart-grid': b.chartGrid || DEFAULT_SELLER_BRANDING.chartGrid!,
        '--brand-chart-axis': b.chartAxis || DEFAULT_SELLER_BRANDING.chartAxis!,
        '--brand-chart-series-1': b.chartSeries1 || DEFAULT_SELLER_BRANDING.chartSeries1!,
        '--brand-chart-series-2': b.chartSeries2 || DEFAULT_SELLER_BRANDING.chartSeries2!,
        '--brand-chart-series-3': b.chartSeries3 || DEFAULT_SELLER_BRANDING.chartSeries3!,
        '--brand-chart-series-4': b.chartSeries4 || DEFAULT_SELLER_BRANDING.chartSeries4!,
        '--brand-chart-series-5': b.chartSeries5 || DEFAULT_SELLER_BRANDING.chartSeries5!,
        '--brand-chart-series-6': b.chartSeries6 || DEFAULT_SELLER_BRANDING.chartSeries6!,
        '--brand-chart-positive': b.chartPositive || DEFAULT_SELLER_BRANDING.chartPositive!,
        '--brand-chart-negative': b.chartNegative || DEFAULT_SELLER_BRANDING.chartNegative!,
        '--brand-chart-neutral': b.chartNeutral || DEFAULT_SELLER_BRANDING.chartNeutral!,
    } as CSSProperties;
}

const SellerBrandingContext = createContext<SellerBrandingState | null>(null);

/** Same root segment as prefetch on ShopPage — shares React Query cache with `SellerBrandingProvider`. */
export const SELLER_FACING_BRANDING_QK = 'seller-facing-branding';

/**
 * Resolves agency white-label via `GET /api/branding` (JWT tenant → parent agency for sellers).
 * Use the same `brandingCacheKey` for shop + console when both run under the same profile tenant so React Query shares cache.
 */
export function SellerBrandingProvider({
    enabled,
    brandingCacheKey,
    documentTitle,
    children,
}: {
    /** When false, skips GET /api/branding and shows platform defaults immediately (no shell spinner). */
    enabled: boolean;
    brandingCacheKey: string;
    documentTitle: SellerBrandingDocumentTitle | null;
    children: ReactNode;
}) {
    const savedTitleRef = useRef<string | null>(null);

    const { data, isLoading, error, isFetching } = useQuery({
        queryKey: [SELLER_FACING_BRANDING_QK, brandingCacheKey],
        queryFn: () => fetchBranding(),
        enabled: enabled && Boolean(brandingCacheKey),
        staleTime: 30 * 60 * 1000,
        gcTime: 60 * 60 * 1000,
        refetchOnWindowFocus: false,
    });

    const resolved = data ?? DEFAULT_SELLER_BRANDING;
    /** Shop: wait for first paint. Console: prefetch usually fills cache — only stall if no data yet and still fetching. */
    const shellPending = enabled && !data && isFetching;

    const value = useMemo<SellerBrandingState>(
        () => ({
            data: resolved,
            isLoading,
            fetchError: error instanceof Error ? error : null,
            shellPending,
            agencyConsoleBranding: enabled,
            cssVariables: brandingToCssVars(resolved),
        }),
        [resolved, isLoading, error, shellPending, enabled],
    );

    const titleKind = documentTitle?.kind;
    const shopNameForTitle = documentTitle?.kind === 'shop' ? documentTitle.shopName : '';

    useEffect(() => {
        if (!enabled || titleKind == null) return;
        if (savedTitleRef.current === null) {
            savedTitleRef.current = document.title;
        }
        if (isLoading && !data) {
            if (titleKind === 'shop' && shopNameForTitle) {
                document.title = shopNameForTitle;
            } else if (titleKind === 'console') {
                document.title = 'Console';
            }
            return () => {
                document.title = savedTitleRef.current ?? 'Mamba';
            };
        }
        if (titleKind === 'shop' && shopNameForTitle) {
            document.title = `${shopNameForTitle} · ${resolved.displayName}`;
        } else if (titleKind === 'console') {
            document.title = `Console · ${resolved.displayName}`;
        }
        return () => {
            document.title = savedTitleRef.current ?? 'Mamba';
        };
    }, [enabled, titleKind, shopNameForTitle, resolved.displayName, isLoading, data]);

    return (
        <SellerBrandingContext.Provider value={value}>
            <div className="contents" style={value.cssVariables}>
                {shellPending ? (
                    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-[#111827]">
                        <div className="w-8 h-8 rounded-full border-2 border-white/10 border-t-white/60 animate-spin" />
                    </div>
                ) : (
                    children
                )}
            </div>
        </SellerBrandingContext.Provider>
    );
}

/** Defaults when not inside `SellerBrandingProvider` (e.g. agency-only console user). */
export function useSellerBranding(): SellerBrandingState {
    const ctx = useContext(SellerBrandingContext);
    if (ctx) return ctx;
    const d = DEFAULT_SELLER_BRANDING;
    return {
        data: d,
        isLoading: false,
        fetchError: null,
        shellPending: false,
        agencyConsoleBranding: false,
        cssVariables: brandingToCssVars(d),
    };
}
