import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle, XCircle, Clock, Loader2, ShieldCheck, Store, Users, AlertTriangle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { apiFetch } from '../../lib/apiClient';
import { queryClient } from '../../queryClient';
import { removeStaleAccessQueries } from '../../lib/invalidateAccessQueries';
import { useConsoleNotificationStore } from '../../store/useConsoleNotificationStore';

type InvType = 'membership' | 'seller-link';

interface InvitationInfo {
    type: InvType;
    // membership
    tenantName?: string;
    tenantType?: string;
    roleName?: string;
    // seller-link
    agencyName?: string;
    sellerName?: string;
    // shared
    invitedBy?: string;
    expiresAt?: string;
    alreadyAccepted?: boolean;
    expired?: boolean;
}

type Phase =
    | 'loading'
    | 'preview'
    | 'auth-required'
    | 'accepting'
    | 'declining'
    | 'success'
    | 'declined'
    | 'error';

const REDIRECT_MS_SUCCESS = 2800;
const REDIRECT_MS_DECLINED = 2400;

function detectInvType(params: URLSearchParams): InvType {
    return params.get('type') === 'seller-link' ? 'seller-link' : 'membership';
}

export function AcceptInvitationView() {
    const navigate = useNavigate();
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token') ?? '';
    const invType = detectInvType(params);

    const [phase, setPhase] = useState<Phase>('loading');
    const [info, setInfo] = useState<InvitationInfo | null>(null);
    const [successData, setSuccessData] = useState<Record<string, string>>({});
    const [errorMsg, setErrorMsg] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [authStep, setAuthStep] = useState<'login' | 'signup'>('login');
    const [authBusy, setAuthBusy] = useState(false);
    const [authError, setAuthError] = useState('');

    const fetchInvitationInfo = useCallback(async () => {
        if (!token) { setPhase('error'); setErrorMsg('No invitation token found in the URL.'); return; }
        try {
            const endpoint = invType === 'seller-link'
                ? `/api/team/seller-link-info?token=${token}`
                : `/api/team/invitation-info?token=${token}`;
            const res = await apiFetch(endpoint);
            const json = await res.json().catch(() => ({}));
            if (!res.ok) { setPhase('error'); setErrorMsg(json.error || 'Invitation not found.'); return; }
            const d = json.data ?? {};
            setInfo({ type: invType, ...d });
            if (d.alreadyAccepted) {
                removeStaleAccessQueries(queryClient);
                const { data: u } = await supabase.auth.getUser();
                if (u.user?.id) void useConsoleNotificationStore.getState().fetchNotifications(u.user.id);
                setPhase('success');
                setSuccessData({ done: 'already' });
                return;
            }
            if (d.expired) { setPhase('error'); setErrorMsg('This invitation link has expired. Please ask for a new one.'); return; }

            // Check if user is logged in
            const { data: { session } } = await supabase.auth.getSession();
            setPhase(session ? 'preview' : 'auth-required');
        } catch (e: any) {
            setPhase('error'); setErrorMsg(e.message || 'Failed to load invitation.');
        }
    }, [token, invType]);

    useEffect(() => { fetchInvitationInfo(); }, [fetchInvitationInfo]);

    useEffect(() => {
        if (phase !== 'success' && phase !== 'declined') return;
        const ms = phase === 'success' ? REDIRECT_MS_SUCCESS : REDIRECT_MS_DECLINED;
        const t = window.setTimeout(() => navigate('/', { replace: true }), ms);
        return () => window.clearTimeout(t);
    }, [phase, navigate]);

    const handleLogin = async () => {
        setAuthBusy(true); setAuthError('');
        try {
            let err: any;
            if (authStep === 'login') {
                ({ error: err } = await supabase.auth.signInWithPassword({ email, password }));
            } else {
                ({ error: err } = await supabase.auth.signUp({ email, password }));
            }
            if (err) { setAuthError(err.message); setAuthBusy(false); return; }
            // Re-check the invitation now that we're logged in
            await fetchInvitationInfo();
        } catch { setAuthError('Authentication failed'); setAuthBusy(false); }
        setAuthBusy(false);
    };

    const handleAccept = async () => {
        setPhase('accepting');
        try {
            const endpoint = invType === 'seller-link' ? '/api/team/accept-seller-link' : '/api/team/accept-invitation';
            const res = await apiFetch(endpoint, { method: 'POST', body: JSON.stringify({ token }) });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) { setPhase('error'); setErrorMsg(json.error || 'Failed to accept invitation.'); return; }
            removeStaleAccessQueries(queryClient);
            const { data: u } = await supabase.auth.getUser();
            if (u.user?.id) void useConsoleNotificationStore.getState().fetchNotifications(u.user.id);
            setSuccessData(json.data ?? {});
            setPhase('success');
        } catch (e: any) { setPhase('error'); setErrorMsg(e.message || 'Failed to accept invitation.'); }
    };

    const handleDecline = async () => {
        setPhase('declining');
        setErrorMsg('');
        try {
            const endpoint =
                invType === 'seller-link' ? '/api/team/decline-seller-link' : '/api/team/decline-invitation';
            const res = await apiFetch(endpoint, { method: 'POST', body: JSON.stringify({ token }) });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setPhase('error');
                setErrorMsg(
                    typeof json.error === 'string' ? json.error : 'Could not record your response. Please try again.'
                );
                return;
            }
            removeStaleAccessQueries(queryClient);
            const { data: u } = await supabase.auth.getUser();
            if (u.user?.id) void useConsoleNotificationStore.getState().fetchNotifications(u.user.id);
            setPhase('declined');
        } catch (e: any) {
            setPhase('error');
            setErrorMsg(e?.message || 'Could not decline this invitation.');
        }
    };

    const errorIsExpired = phase === 'error' && errorMsg.toLowerCase().includes('expired');
    const errorTitle = errorIsExpired ? 'Invitation expired' : 'Something went wrong';
    const ErrorIcon = errorIsExpired ? Clock : AlertTriangle;
    const errorIconClass = errorIsExpired ? 'text-amber-400' : 'text-red-400';

    return (
        <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
            <div className="w-full max-w-md">
                {/* Header */}
                <div className="text-center mb-8">
                    <div className="text-3xl font-black bg-gradient-to-r from-violet-400 to-pink-400 bg-clip-text text-transparent tracking-tight mb-1">
                        Mamba
                    </div>
                    <p className="text-gray-400 text-sm">Team invitation</p>
                </div>

                <div className="bg-white/[0.03] border border-white/10 rounded-3xl p-8 backdrop-blur-sm relative overflow-hidden shadow-2xl">
                    <div className="absolute inset-0 bg-gradient-to-br from-violet-500/5 to-pink-500/5 pointer-events-none" />
                    <div className="relative">

                        {/* LOADING */}
                        {phase === 'loading' && (
                            <div className="flex flex-col items-center py-8 gap-4">
                                <Loader2 className="w-10 h-10 animate-spin text-violet-400" />
                                <p className="text-gray-400">Loading invitation…</p>
                            </div>
                        )}

                        {/* PREVIEW — show details + Accept/Decline */}
                        {phase === 'preview' && info && (
                            <>
                                <div className="flex items-center gap-3 mb-6">
                                    <div className={`p-3 rounded-2xl ${info.type === 'seller-link' ? 'bg-amber-500/20' : 'bg-violet-500/20'}`}>
                                        {info.type === 'seller-link'
                                            ? <Store className="w-6 h-6 text-amber-400" />
                                            : <Users className="w-6 h-6 text-violet-400" />}
                                    </div>
                                    <div>
                                        <h2 className="text-white font-bold text-xl leading-tight">
                                            {info.type === 'seller-link' ? 'Agency Link Request' : "You're invited!"}
                                        </h2>
                                        <p className="text-gray-500 text-sm">Invited by {info.invitedBy ?? 'someone'}</p>
                                    </div>
                                </div>

                                {info.type === 'membership' && (
                                    <div className="bg-gray-900/60 rounded-2xl p-5 mb-6 border border-white/5 space-y-3">
                                        <Row label="Joining" value={info.tenantName ?? '—'} />
                                        <Row label="Tenant Type" value={info.tenantType ?? '—'} />
                                        <Row label="Your Role" value={info.roleName ?? '—'} />
                                        <p className="text-xs text-gray-400 bg-white/5 border border-white/10 rounded-lg px-3 py-2 mt-3">
                                            Phase 2 users belong to one product tenant. Accepting this invite will place your account in this tenant context.
                                        </p>
                                    </div>
                                )}

                                {info.type === 'seller-link' && (
                                    <div className="bg-gray-900/60 rounded-2xl p-5 mb-6 border border-white/5 space-y-3">
                                        <Row label="Agency" value={info.agencyName ?? '—'} />
                                        <Row label="Your Shop" value={info.sellerName ?? '—'} />
                                        <p className="text-xs text-amber-400/80 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 mt-3">
                                            Accepting will link your seller tenant to this agency. Agency access is then derived from that link and any seller assignments.
                                        </p>
                                    </div>
                                )}

                                <div className="grid grid-cols-2 gap-3">
                                    <button
                                        type="button"
                                        onClick={handleDecline}
                                        className="py-3 rounded-xl font-semibold bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10 text-sm transition-colors"
                                    >
                                        Decline
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleAccept}
                                        className="py-3 rounded-xl font-bold bg-gradient-to-r from-violet-600 to-pink-600 hover:from-violet-500 hover:to-pink-500 text-white text-sm transition-all hover:shadow-lg hover:shadow-violet-500/20"
                                    >
                                        Accept
                                    </button>
                                </div>
                            </>
                        )}

                        {/* AUTH REQUIRED */}
                        {phase === 'auth-required' && info && (
                            <>
                                <div className="flex items-center gap-3 mb-6">
                                    <div className="p-3 bg-violet-500/20 rounded-2xl">
                                        <ShieldCheck className="w-6 h-6 text-violet-400" />
                                    </div>
                                    <div>
                                        <h2 className="text-white font-bold text-xl">Sign in to accept</h2>
                                        <p className="text-gray-500 text-sm">
                                            Invitation to <strong className="text-gray-300">{info.tenantName ?? info.agencyName}</strong>
                                        </p>
                                    </div>
                                </div>

                                <div className="flex gap-2 mb-5 bg-gray-900/60 rounded-xl p-1">
                                    {(['login','signup'] as const).map(s => (
                                        <button
                                            key={s}
                                            type="button"
                                            onClick={() => setAuthStep(s)}
                                            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${authStep === s ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-300'}`}
                                        >
                                            {s === 'login' ? 'Sign In' : 'Create Account'}
                                        </button>
                                    ))}
                                </div>

                                <div className="space-y-3 mb-5">
                                    <input
                                        type="email"
                                        value={email}
                                        onChange={e => setEmail(e.target.value)}
                                        placeholder="Email address"
                                        className="w-full px-4 py-3 bg-gray-950/60 border border-white/10 rounded-xl text-sm text-white placeholder-gray-600 focus:border-violet-500/50 focus:outline-none"
                                    />
                                    <input
                                        type="password"
                                        value={password}
                                        onChange={e => setPassword(e.target.value)}
                                        placeholder="Password"
                                        className="w-full px-4 py-3 bg-gray-950/60 border border-white/10 rounded-xl text-sm text-white placeholder-gray-600 focus:border-violet-500/50 focus:outline-none"
                                    />
                                </div>

                                {authError && (
                                    <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mb-4">{authError}</p>
                                )}

                                <button
                                    type="button"
                                    disabled={authBusy || !email || !password}
                                    onClick={handleLogin}
                                    className="w-full py-3 rounded-xl font-bold bg-gradient-to-r from-violet-600 to-pink-600 hover:from-violet-500 hover:to-pink-500 text-white text-sm disabled:opacity-50 transition-all"
                                >
                                    {authBusy ? <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> : null}
                                    {authStep === 'login' ? 'Sign In & Continue' : 'Create Account & Continue'}
                                </button>
                            </>
                        )}

                        {/* ACCEPTING */}
                        {phase === 'accepting' && (
                            <div className="flex flex-col items-center py-8 gap-4">
                                <Loader2 className="w-10 h-10 animate-spin text-violet-400" />
                                <p className="text-gray-400">Accepting invitation…</p>
                            </div>
                        )}

                        {/* DECLINING */}
                        {phase === 'declining' && (
                            <div className="flex flex-col items-center py-8 gap-4">
                                <Loader2 className="w-10 h-10 animate-spin text-violet-400" />
                                <p className="text-gray-400">Recording your choice…</p>
                            </div>
                        )}

                        {/* SUCCESS */}
                        {phase === 'success' && (
                            <div className="flex flex-col items-center py-6 gap-4 text-center">
                                <CheckCircle className="w-16 h-16 text-emerald-400" />
                                <h2 className="text-white font-bold text-2xl">
                                    {successData.done === 'already' ? 'Already accepted!' : 'Welcome aboard! 🎉'}
                                </h2>
                                <p className="text-gray-400 text-sm max-w-xs">
                                    {invType === 'seller-link'
                                        ? `Your shop "${info?.sellerName}" is now linked to "${info?.agencyName}".`
                                        : `You are now a member of "${info?.tenantName}" with the role "${info?.roleName}".`}
                                </p>
                                <p className="text-gray-500 text-xs max-w-xs">
                                    Redirecting to your dashboard…
                                </p>
                                <button
                                    type="button"
                                    onClick={() => navigate('/', { replace: true })}
                                    className="mt-2 px-6 py-2.5 rounded-xl font-bold bg-gradient-to-r from-violet-600 to-pink-600 text-white text-sm hover:from-violet-500 hover:to-pink-500 transition-all"
                                >
                                    Go to Dashboard now
                                </button>
                            </div>
                        )}

                        {/* DECLINED */}
                        {phase === 'declined' && (
                            <div className="flex flex-col items-center py-6 gap-4 text-center">
                                <XCircle className="w-16 h-16 text-gray-400" />
                                <h2 className="text-white font-bold text-xl">Invitation declined</h2>
                                <p className="text-gray-400 text-sm max-w-xs">
                                    {invType === 'seller-link'
                                        ? 'You chose not to link your shop. This invitation link is no longer valid.'
                                        : 'You chose not to join this team. You have not been added, and this link is no longer valid.'}
                                </p>
                                <p className="text-gray-500 text-xs max-w-xs">Redirecting to the home page…</p>
                                <button
                                    type="button"
                                    onClick={() => navigate('/', { replace: true })}
                                    className="mt-2 text-sm text-violet-400 hover:text-violet-300 underline"
                                >
                                    Go now
                                </button>
                            </div>
                        )}

                        {/* ERROR */}
                        {phase === 'error' && (
                            <div className="flex flex-col items-center py-6 gap-4 text-center">
                                <ErrorIcon className={`w-16 h-16 ${errorIconClass}`} />
                                <h2 className="text-white font-bold text-xl">{errorTitle}</h2>
                                <p className="text-gray-400 text-sm max-w-xs">{errorMsg}</p>
                                <button
                                    type="button"
                                    onClick={() => navigate('/', { replace: true })}
                                    className="mt-2 text-sm text-violet-400 hover:text-violet-300 underline"
                                >
                                    Back to Home
                                </button>
                            </div>
                        )}

                    </div>
                </div>
            </div>
        </div>
    );
}

function Row({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500 font-semibold uppercase tracking-wider">{label}</span>
            <span className="text-sm text-white font-semibold capitalize">{value}</span>
        </div>
    );
}
