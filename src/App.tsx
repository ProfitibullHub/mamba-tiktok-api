import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { TenantProvider, useTenantContext } from './contexts/TenantContext';
import { SellerBrandingProvider } from './contexts/SellerBrandingContext';
import { Login } from './components/Login';
import { ConsolePage } from './components/ConsolePage';
import { ShopPage } from './components/ShopPage';
import { ResetPassword } from './components/ResetPassword';
import { TikTokAdsCallback } from './components/TikTokAdsCallback';
import { AcceptInvitationView } from './components/views/AcceptInvitationView';
import { SupportBugReportsPage } from './components/views/SupportBugReportsPage';
import { SupportBugReportDetailPage } from './components/views/SupportBugReportDetailPage';
import { MessagingInboxPage } from './components/views/MessagingInboxPage';
import { useEffect, useState } from 'react';
import { reportClientError } from './lib/observability';
import { AppToastHost } from './components/AppToastHost';

function SupportBrandedLayout({ children }: { children: React.ReactNode }) {
    const { profileTenantId, sellerFacingBrandingEligible, loading: tenantLoading } = useTenantContext();
    if (tenantLoading) {
        return (
            <div className="min-h-screen bg-mamba-dark flex items-center justify-center">
                <div className="animate-spin rounded-full h-16 w-16 border-4 border-mamba-green border-t-transparent" />
            </div>
        );
    }
    return (
        <SellerBrandingProvider
            enabled={sellerFacingBrandingEligible}
            brandingCacheKey={profileTenantId || '_'}
            documentTitle={null}
        >
            {children}
        </SellerBrandingProvider>
    );
}

function detectPasswordFlow(): 'reset' | 'invite' | null {
    const hash = window.location.hash;
    const isResetPath = window.location.pathname === '/reset-password';
    if (hash.includes('type=recovery') || isResetPath) return 'reset';
    if (hash.includes('type=invite')) return 'invite';
    return null;
}

function AppContent() {
    const { user, loading } = useAuth();
    const location = useLocation();
    const [passwordFlowMode, setPasswordFlowMode] = useState<'reset' | 'invite' | null>(detectPasswordFlow);

    const isTikTokAdsCallback = window.location.pathname === '/auth/tiktok-ads/callback';
    useEffect(() => {
        const onError = (event: ErrorEvent) => {
            void reportClientError({
                event: 'frontend.window_error',
                message: event.message || 'Unhandled window error',
                route: window.location.pathname,
                source: event.filename || 'window.onerror',
                stack: event.error?.stack,
                metadata: {
                    line: event.lineno,
                    column: event.colno,
                },
            });
        };
        const onUnhandledRejection = (event: PromiseRejectionEvent) => {
            const reason = event.reason;
            void reportClientError({
                event: 'frontend.unhandled_rejection',
                message: reason instanceof Error ? reason.message : String(reason),
                route: window.location.pathname,
                source: 'window.unhandledrejection',
                stack: reason instanceof Error ? reason.stack : undefined,
            });
        };

        window.addEventListener('error', onError);
        window.addEventListener('unhandledrejection', onUnhandledRejection);
        return () => {
            window.removeEventListener('error', onError);
            window.removeEventListener('unhandledrejection', onUnhandledRejection);
        };
    }, []);

    const isResetPasswordPath = window.location.pathname === '/reset-password';
    const isAcceptInvitation = window.location.pathname === '/accept-invitation';

    if (loading) {
        return (
            <div className="min-h-screen bg-mamba-dark flex items-center justify-center">
                <div className="animate-spin rounded-full h-16 w-16 border-4 border-mamba-green border-t-transparent" />
            </div>
        );
    }

    if (isTikTokAdsCallback) {
        return <TikTokAdsCallback />;
    }

    // Accept invitation page is available whether logged in or not
    if (isAcceptInvitation) {
        return <AcceptInvitationView />;
    }

    if (passwordFlowMode && user) {
        return <ResetPassword mode={passwordFlowMode} onComplete={() => setPasswordFlowMode(null)} />;
    }

    if (isResetPasswordPath && !user) {
        return (
            <div className="min-h-screen bg-mamba-dark flex items-center justify-center">
                <div className="animate-spin rounded-full h-16 w-16 border-4 border-mamba-green border-t-transparent" />
            </div>
        );
    }

    if (!user) {
        // Do not leave a deep shop URL in the address bar after sign-out or unauthenticated visits
        if (location.pathname.startsWith('/shop/')) {
            return <Navigate to="/" replace />;
        }
        return <Login />;
    }

    return (
        <TenantProvider>
            <Routes>
                <Route path="/" element={<ConsolePage />} />
                <Route
                    path="/support"
                    element={
                        <SupportBrandedLayout>
                            <SupportBugReportsPage />
                        </SupportBrandedLayout>
                    }
                />
                <Route
                    path="/support/:submissionId"
                    element={
                        <SupportBrandedLayout>
                            <SupportBugReportDetailPage />
                        </SupportBrandedLayout>
                    }
                />
                <Route
                    path="/messages"
                    element={
                        <SupportBrandedLayout>
                            <MessagingInboxPage />
                        </SupportBrandedLayout>
                    }
                />
                <Route
                    path="/messages/:conversationId"
                    element={
                        <SupportBrandedLayout>
                            <MessagingInboxPage />
                        </SupportBrandedLayout>
                    }
                />
                <Route path="/shop/:shopSlug" element={<ShopPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </TenantProvider>
    );
}

function App() {
    return (
        <BrowserRouter>
            <AppToastHost />
            <AuthProvider>
                <AppContent />
            </AuthProvider>
        </BrowserRouter>
    );
}

export default App;
