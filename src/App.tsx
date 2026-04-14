import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { TenantProvider } from './contexts/TenantContext';
import { Login } from './components/Login';
import { ConsolePage } from './components/ConsolePage';
import { ShopPage } from './components/ShopPage';
import { ResetPassword } from './components/ResetPassword';
import { TikTokAdsCallback } from './components/TikTokAdsCallback';
import { AcceptInvitationView } from './components/views/AcceptInvitationView';
import { useState } from 'react';

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
    const isResetPasswordPath = window.location.pathname === '/reset-password';
    const isAcceptInvitation = window.location.pathname === '/accept-invitation';

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-900 flex items-center justify-center">
                <div className="animate-spin rounded-full h-16 w-16 border-4 border-pink-500 border-t-transparent" />
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
            <div className="min-h-screen bg-gray-900 flex items-center justify-center">
                <div className="animate-spin rounded-full h-16 w-16 border-4 border-pink-500 border-t-transparent" />
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
                <Route path="/shop/:shopSlug" element={<ShopPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </TenantProvider>
    );
}

function App() {
    return (
        <BrowserRouter>
            <AuthProvider>
                <AppContent />
            </AuthProvider>
        </BrowserRouter>
    );
}

export default App;
