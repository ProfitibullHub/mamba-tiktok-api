import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2, MessageSquarePlus, RefreshCw, Send } from 'lucide-react';
import {
    createMessagingConversation,
    fetchMessagingConversations,
    fetchMessagingMessages,
    fetchMessagingSellers,
    sendMessagingMessage,
    type MessagingConversation,
    type MessagingMessage,
    type MessagingParticipants,
    type MessagingSellerOption,
} from '../../lib/messagingApi';
import { buildConsoleTaskDeepLink, extractTaskDeepLinkSpans, type MessagingTaskSharePayload } from '../../lib/taskDeepLinks';
import { useAuth } from '../../contexts/AuthContext';
import { useTenantContext } from '../../contexts/TenantContext';
import { supabase } from '../../lib/supabase';
import { showAppToast } from '../../store/useAppToastStore';

export type MessagingNavState = {
    messagingReturnPath?: string;
    messagingTaskShare?: MessagingTaskSharePayload;
};

function useMessagingNav(): { returnPath: string; linkState: MessagingNavState; location: ReturnType<typeof useLocation> } {
    const location = useLocation();
    const s = (location.state || {}) as MessagingNavState;
    const returnPath =
        typeof s.messagingReturnPath === 'string' && s.messagingReturnPath.startsWith('/')
            ? s.messagingReturnPath
            : '/';
    const linkState: MessagingNavState = { messagingReturnPath: returnPath };
    return { returnPath, linkState, location };
}

function formatTs(iso: string): string {
    try {
        return new Date(iso).toLocaleString(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short',
        });
    } catch {
        return iso;
    }
}

function MessageBodyWithTaskLinks({ body }: { body: string }) {
    const spans = extractTaskDeepLinkSpans(body);
    if (spans.length === 0) {
        return <p className="brand-text whitespace-pre-wrap break-words">{body}</p>;
    }
    const elements: ReactNode[] = [];
    let cursor = 0;
    spans.forEach((s, i) => {
        if (s.start > cursor) {
            elements.push(<span key={`txt-${i}-${cursor}`}>{body.slice(cursor, s.start)}</span>);
        }
        const to = `/?tab=tasks&taskId=${encodeURIComponent(s.taskId)}`;
        elements.push(
            <Link
                key={`lnk-${i}-${s.start}`}
                to={to}
                className="underline font-medium break-all"
                style={{ color: 'var(--brand-primary)' }}
            >
                {body.slice(s.start, s.end)}
            </Link>,
        );
        cursor = s.end;
    });
    if (cursor < body.length) {
        elements.push(<span key={`txt-end-${cursor}`}>{body.slice(cursor)}</span>);
    }
    return <p className="brand-text whitespace-pre-wrap break-words">{elements}</p>;
}

/**
 * `*@mg.msgsndr.org` / `*.msgsndr.org` are GoHighLevel routing mailboxes (see
 * `isLeadConnectorRoutingAddress` on the server). Showing them in chat as the
 * sender is meaningless, so we substitute a human label instead.
 */
function isLcRoutingAddress(email: string): boolean {
    if (!email) return false;
    const e = email.trim().toLowerCase();
    if (!e.includes('@')) return false;
    const host = e.split('@').pop() ?? '';
    return host === 'mg.msgsndr.org' || host.endsWith('.msgsndr.org') || host === 'msgsndr.org';
}

export function MessagingInboxPage() {
    const { conversationId } = useParams<{ conversationId: string }>();
    const navigate = useNavigate();
    const { user } = useAuth();
    const { profileTenantType, isPlatformSuperAdmin } = useTenantContext();
    const viewerIsAgency = profileTenantType === 'agency';
    /**
     * A user can hold both a seller membership and the platform Super Admin role at the same
     * time (their profile.tenant_id might point to a seller tenant). For messaging UX, treat
     * Super Admin as the dominant role so they still see the account picker and can act on
     * any seller — not just the seller their profile is linked to.
     */
    const viewerIsSeller = profileTenantType === 'seller' && !isPlatformSuperAdmin;
    const { returnPath, linkState, location } = useMessagingNav();

    const [sellers, setSellers] = useState<MessagingSellerOption[]>([]);
    /**
     * Anyone who isn't a seller-only member needs to choose which seller account they're
     * acting on. Showing the picker unconditionally ensures it's visible while sellers are
     * loading, and surfaces a clear empty state if no accounts are accessible — instead of
     * vanishing silently.
     */
    const showSellerPicker = !viewerIsSeller;
    const [sellerLoading, setSellerLoading] = useState(true);
    const [sellerErr, setSellerErr] = useState<string | null>(null);
    const [selectedSellerId, setSelectedSellerId] = useState<string | null>(null);

    const [conversations, setConversations] = useState<MessagingConversation[]>([]);
    const [convLoading, setConvLoading] = useState(true);
    const [convErr, setConvErr] = useState<string | null>(null);

    const [messages, setMessages] = useState<MessagingMessage[]>([]);
    const [participants, setParticipants] = useState<MessagingParticipants>({
        sellerEmails: [],
        agencyEmails: [],
        directory: {},
    });
    const [msgLoading, setMsgLoading] = useState(false);
    const [msgErr, setMsgErr] = useState<string | null>(null);

    const [compose, setCompose] = useState('');
    const [sendBusy, setSendBusy] = useState(false);
    const [manualRefreshing, setManualRefreshing] = useState(false);
    const [newSubject, setNewSubject] = useState('');
    const [newBusy, setNewBusy] = useState(false);
    const [showNew, setShowNew] = useState(false);

    /** Avoid applying a messages fetch to the wrong thread if the user switches conversations while a request is in flight. */
    const conversationIdRef = useRef<string | undefined>(conversationId);
    useEffect(() => {
        conversationIdRef.current = conversationId;
    }, [conversationId]);

    /** Only the transcript scrolls; composer stays below. Scrolling is driven by layout, not arbitrary padding. */
    const messagesScrollRef = useRef<HTMLDivElement>(null);
    /**
     * While true, new messages / poll updates snap the list to the bottom (last bubble fully visible
     * above the composer). Users who scroll up to read history are not yanked back unless they
     * return near the bottom themselves.
     */
    const stickToBottomRef = useRef(true);

    const updateStickToBottomFromScroll = useCallback(() => {
        const el = messagesScrollRef.current;
        if (!el) return;
        const slack = 96;
        stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= slack;
    }, []);

    /** New thread: always start pinned to latest. */
    useEffect(() => {
        stickToBottomRef.current = true;
    }, [conversationId]);

    useLayoutEffect(() => {
        const el = messagesScrollRef.current;
        if (!el) return;
        if (msgLoading && messages.length === 0) return;
        if (!stickToBottomRef.current) return;
        requestAnimationFrame(() => {
            el.scrollTop = el.scrollHeight;
        });
    }, [messages, conversationId, msgLoading]);

    /** When the composer/footer height changes (font zoom, textarea reflow), keep the pinned view correct. */
    const composerFooterRef = useRef<HTMLDivElement>(null);
    const composeTextareaRef = useRef<HTMLTextAreaElement>(null);

    /** Grow with content up to a viewport-aware cap; scroll inside the field beyond that. */
    const adjustComposeTextareaHeight = useCallback(() => {
        const el = composeTextareaRef.current;
        if (!el) return;
        /** One-line + py-2 floor only for odd `scrollHeight` reports; avoid a tall empty box. */
        const singleLineFloorPx = 42;
        const layoutH =
            typeof window !== 'undefined' && window.visualViewport ?
                window.visualViewport.height
            :   window.innerHeight;
        const maxPx = Math.min(Math.round(layoutH * 0.35), 288);
        el.style.height = 'auto';
        const raw = el.scrollHeight;
        const next = Math.min(Math.max(raw, singleLineFloorPx), maxPx);
        el.style.height = `${next}px`;
    }, []);

    useLayoutEffect(() => {
        adjustComposeTextareaHeight();
    }, [compose, adjustComposeTextareaHeight]);

    useEffect(() => {
        const onResize = () => adjustComposeTextareaHeight();
        window.addEventListener('resize', onResize);
        const vv = window.visualViewport;
        vv?.addEventListener('resize', onResize);
        return () => {
            window.removeEventListener('resize', onResize);
            vv?.removeEventListener('resize', onResize);
        };
    }, [adjustComposeTextareaHeight]);

    useEffect(() => {
        const footer = composerFooterRef.current;
        const scrollEl = messagesScrollRef.current;
        if (!footer || !scrollEl) return;
        const sync = () => {
            if (!stickToBottomRef.current) return;
            requestAnimationFrame(() => {
                scrollEl.scrollTop = scrollEl.scrollHeight;
            });
        };
        const ro = new ResizeObserver(sync);
        ro.observe(footer);
        return () => ro.disconnect();
    }, [conversationId]);

    /** Mobile browsers: when the on-screen keyboard resizes the visual viewport, re-pin if needed. */
    useEffect(() => {
        const vv = typeof window !== 'undefined' ? window.visualViewport : null;
        const scrollEl = messagesScrollRef.current;
        if (!vv || !scrollEl) return;
        const onResize = () => {
            if (!stickToBottomRef.current) return;
            requestAnimationFrame(() => {
                scrollEl.scrollTop = scrollEl.scrollHeight;
            });
        };
        vv.addEventListener('resize', onResize);
        return () => vv.removeEventListener('resize', onResize);
    }, [conversationId]);

    const loadSellers = useCallback(async () => {
        setSellerLoading(true);
        setSellerErr(null);
        const r = await fetchMessagingSellers();

        let items: MessagingSellerOption[];
        if (!r.ok) {
            /**
             * API failed entirely. For platform super admins, fall back to a direct Supabase query
             * so the picker isn't blocked by API outages or stale deploys — RLS on `tenants`
             * already allows them to read every active tenant.
             */
            if (isPlatformSuperAdmin) {
                const { data, error } = await supabase
                    .from('tenants')
                    .select('id, name')
                    .eq('type', 'seller')
                    .eq('status', 'active')
                    .order('name');
                if (error) {
                    setSellerErr(r.message);
                    setSellers([]);
                    setSellerLoading(false);
                    return;
                }
                items = (data || []).map((t) => ({
                    id: t.id as string,
                    name: typeof t.name === 'string' ? t.name : (t.id as string),
                }));
            } else {
                setSellerErr(r.message);
                setSellers([]);
                setSellerLoading(false);
                return;
            }
        } else if (r.items.length === 0 && isPlatformSuperAdmin) {
            /**
             * API succeeded but returned nothing — most likely the backend hasn't picked up the
             * super-admin path yet (e.g. mid-deploy or the service-role grant migration hasn't
             * been applied). Use the same Supabase fallback so the picker stays useful.
             */
            const { data, error } = await supabase
                .from('tenants')
                .select('id, name')
                .eq('type', 'seller')
                .eq('status', 'active')
                .order('name');
            items = error
                ? []
                : (data || []).map((t) => ({
                      id: t.id as string,
                      name: typeof t.name === 'string' ? t.name : (t.id as string),
                  }));
        } else {
            items = r.items;
        }

        setSellers(items);
        setSelectedSellerId((prev) => {
            if (prev && items.some((x) => x.id === prev)) return prev;
            return items[0]?.id ?? null;
        });
        setSellerLoading(false);
    }, [isPlatformSuperAdmin]);

    const loadConversations = useCallback(async (opts?: { silent?: boolean }) => {
        const silent = Boolean(opts?.silent);
        if (!silent) setConvLoading(true);
        setConvErr(null);
        try {
            const r = await fetchMessagingConversations(selectedSellerId);
            if (!r.ok) {
                setConvErr(r.message);
                setConversations([]);
                return;
            }
            setConversations(r.items);
        } finally {
            if (!silent) setConvLoading(false);
        }
    }, [selectedSellerId]);

    const loadMessages = useCallback(async (id: string, opts?: { silent?: boolean }) => {
        const silent = Boolean(opts?.silent);
        if (!silent) setMsgLoading(true);
        setMsgErr(null);
        try {
            const r = await fetchMessagingMessages(id);
            if (conversationIdRef.current !== id) return;
            if (!r.ok) {
                setMsgErr(r.message);
                if (!silent) setMessages([]);
                return;
            }
            setMessages(r.messages);
            setParticipants(r.participants);
        } finally {
            if (!silent) setMsgLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadSellers();
    }, [loadSellers]);

    const lastMessagingTaskShareKeyRef = useRef<string | null>(null);

    /** Open Messages from Team tasks with seller + composer prefilled (PRD contextual). */
    useEffect(() => {
        const share = (location.state as MessagingNavState | undefined)?.messagingTaskShare;
        if (!share?.taskId?.trim() || !share.sellerTenantId?.trim()) return;
        if (sellerLoading) return;
        const key = `${share.taskId}:${share.sellerTenantId}`;
        if (lastMessagingTaskShareKeyRef.current === key) return;
        if (!sellers.some((s) => s.id === share.sellerTenantId)) {
            lastMessagingTaskShareKeyRef.current = key;
            showAppToast('That task’s seller account isn’t available in Messages for your login.', 'err');
            navigate(
                { pathname: location.pathname, search: location.search },
                { replace: true, state: { messagingReturnPath: returnPath } satisfies MessagingNavState },
            );
            return;
        }
        lastMessagingTaskShareKeyRef.current = key;
        setSelectedSellerId(share.sellerTenantId);
        const title = share.title?.trim() || 'Team task';
        const link = buildConsoleTaskDeepLink(share.taskId);
        setCompose(`Regarding: ${title}\n\nView or update in Mamba:\n${link}\n`);
        setNewSubject(`Team task: ${title}`);
        navigate(
            { pathname: location.pathname, search: location.search },
            { replace: true, state: { messagingReturnPath: returnPath } satisfies MessagingNavState },
        );
    }, [
        location.pathname,
        location.search,
        location.state,
        navigate,
        returnPath,
        sellerLoading,
        sellers,
    ]);

    useEffect(() => {
        if (selectedSellerId === null && !sellerLoading) {
            setConvLoading(false);
            return;
        }
        if (selectedSellerId) void loadConversations();
    }, [selectedSellerId, sellerLoading, loadConversations]);

    useEffect(() => {
        if (!conversationId) {
            setMessages([]);
            setParticipants({ sellerEmails: [], agencyEmails: [], directory: {} });
            return;
        }
        void loadMessages(conversationId);
    }, [conversationId, loadMessages]);

    const onManualRefresh = useCallback(async () => {
        if (manualRefreshing || sellerLoading) return;
        setManualRefreshing(true);
        stickToBottomRef.current = true;
        try {
            await Promise.all([
                ...(selectedSellerId ? [loadConversations({ silent: true })] : []),
                ...(conversationId ? [loadMessages(conversationId, { silent: true })] : []),
            ]);
        } finally {
            setManualRefreshing(false);
        }
    }, [
        conversationId,
        loadConversations,
        loadMessages,
        manualRefreshing,
        selectedSellerId,
        sellerLoading,
    ]);

    const onSend = async () => {
        const text = compose.trim();
        const targetId = conversationId;
        if (!targetId || !text) return;

        const optimisticId = `local:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
        const optimistic: MessagingMessage = {
            id: optimisticId,
            conversation_id: targetId,
            direction: 'outbound',
            sender_user_id: user?.id ?? null,
            sender_email: (user?.email || '').trim(),
            body: text,
            created_at: new Date().toISOString(),
            send_status: 'pending',
            provider_message_id: null,
        };

        stickToBottomRef.current = true;
        setMessages((prev) => [...prev, optimistic]);
        setCompose('');
        setSendBusy(true);
        setMsgErr(null);

        const r = await sendMessagingMessage(targetId, text);

        if (conversationIdRef.current !== targetId) {
            setSendBusy(false);
            return;
        }

        if (!r.ok) {
            setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
            setCompose(text);
            setMsgErr(r.message);
            setSendBusy(false);
            return;
        }

        setSendBusy(false);
        await Promise.all([
            loadMessages(targetId, { silent: true }),
            loadConversations({ silent: true }),
        ]);
    };

    const onCreate = async () => {
        const sub = newSubject.trim();
        if (!selectedSellerId || !sub) return;
        setNewBusy(true);
        setConvErr(null);
        const r = await createMessagingConversation(selectedSellerId, sub);
        setNewBusy(false);
        if (!r.ok) {
            setConvErr(r.message);
            return;
        }
        setNewSubject('');
        setShowNew(false);
        await loadConversations({ silent: true });
        navigate(`/messages/${r.id}`, { state: linkState });
    };

    return (
        <div className="h-[100dvh] brand-bg flex flex-col">
            <header
                className="border-b px-4 sm:px-6 py-4 flex flex-nowrap items-center justify-between gap-3 shrink-0"
                style={{ borderColor: 'var(--brand-sidebar-border)' }}
            >
                <div className="flex items-center gap-4 min-w-0">
                    <Link
                        to={returnPath}
                        className="inline-flex items-center gap-2 text-sm font-medium brand-nav-idle hover:opacity-90 shrink-0"
                        style={{ color: 'var(--brand-primary)' }}
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back
                    </Link>
                    <div className="flex items-center gap-2 min-w-0">
                        <MessageSquarePlus className="w-5 h-5 shrink-0" style={{ color: 'var(--brand-primary)' }} />
                        <h1 className="text-lg font-semibold brand-text truncate">Messages</h1>
                    </div>
                </div>
                <button
                    type="button"
                    disabled={sellerLoading || manualRefreshing}
                    aria-label="Refresh conversations and messages"
                    title="Refresh"
                    onClick={() => void onManualRefresh()}
                    className="shrink-0 inline-flex items-center justify-center rounded-lg border p-2.5 brand-nav-idle hover:bg-white/5 disabled:opacity-45"
                    style={{ borderColor: 'var(--brand-sidebar-border)' }}
                >
                    <RefreshCw
                        className={`w-4 h-4 ${manualRefreshing ? 'animate-spin' : ''}`}
                        style={{ color: 'var(--brand-primary)' }}
                    />
                </button>
            </header>

            <div className="flex flex-1 min-h-0 flex-col lg:flex-row">
                <aside
                    className="w-full lg:w-80 border-b lg:border-b-0 lg:border-r flex flex-col min-h-0 max-h-[40vh] lg:max-h-none"
                    style={{ borderColor: 'var(--brand-sidebar-border)' }}
                >
                    <div className="p-3 border-b space-y-2" style={{ borderColor: 'var(--brand-sidebar-border)' }}>
                        {showSellerPicker && (
                            <div>
                                <label className="block text-[10px] font-semibold uppercase tracking-wider brand-muted mb-1">
                                    Seller account
                                </label>
                                <select
                                    value={selectedSellerId ?? ''}
                                    onChange={(e) => {
                                        setSelectedSellerId(e.target.value || null);
                                        navigate('/messages', { state: linkState, replace: true });
                                    }}
                                    className="w-full rounded-lg border bg-gray-950/50 px-2 py-2 text-xs brand-text"
                                    style={{ borderColor: 'var(--brand-sidebar-border)' }}
                                    disabled={sellerLoading || sellers.length === 0}
                                >
                                    {sellerLoading && sellers.length === 0 ?
                                        <option value="">Loading accounts…</option>
                                    : sellers.length === 0 ?
                                        <option value="">No seller accounts available</option>
                                    :   sellers.map((s) => (
                                            <option key={s.id} value={s.id}>
                                                {s.name}
                                            </option>
                                        ))
                                    }
                                </select>
                            </div>
                        )}
                        <button
                            type="button"
                            disabled={!selectedSellerId || newBusy}
                            onClick={() => setShowNew((v) => !v)}
                            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border brand-nav-idle hover:bg-white/5 disabled:opacity-45"
                            style={{ borderColor: 'var(--brand-sidebar-border)' }}
                        >
                            <MessageSquarePlus className="w-3.5 h-3.5" />
                            New conversation
                        </button>
                        {showNew && selectedSellerId && (
                            <div className="space-y-2 pt-1">
                                <input
                                    type="text"
                                    value={newSubject}
                                    onChange={(e) => setNewSubject(e.target.value)}
                                    placeholder="Subject"
                                    maxLength={500}
                                    className="w-full rounded-lg border bg-gray-950/50 px-2 py-2 text-xs brand-text"
                                    style={{ borderColor: 'var(--brand-sidebar-border)' } as CSSProperties}
                                />
                                <button
                                    type="button"
                                    disabled={newBusy || !newSubject.trim()}
                                    onClick={() => void onCreate()}
                                    className="w-full py-2 rounded-lg text-xs font-medium brand-on-primary"
                                    style={{ backgroundColor: 'var(--brand-primary)' }}
                                >
                                    {newBusy ? 'Creating…' : 'Start'}
                                </button>
                            </div>
                        )}
                    </div>
                    <div className="flex-1 overflow-y-auto p-2">
                        {sellerLoading && (
                            <p className="text-xs brand-muted flex items-center gap-2 p-2">
                                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
                            </p>
                        )}
                        {sellerErr && <p className="text-xs text-red-400 p-2">{sellerErr}</p>}
                        {convLoading && !sellerLoading && (
                            <p className="text-xs brand-muted flex items-center gap-2 p-2">
                                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading threads…
                            </p>
                        )}
                        {convErr && <p className="text-xs text-red-400 p-2">{convErr}</p>}
                        {!convLoading &&
                            !convErr &&
                            conversations.map((c) => (
                                <Link
                                    key={c.id}
                                    to={`/messages/${c.id}`}
                                    state={linkState}
                                    className={`block rounded-lg px-3 py-2 mb-1 text-sm border transition-colors ${
                                        conversationId === c.id ?
                                            'border-[color:var(--brand-primary)] bg-white/[0.06]'
                                        :   'border-transparent hover:bg-white/[0.04]'
                                    }`}
                                >
                                    <p className="font-medium brand-text truncate">{c.subject}</p>
                                    <p className="text-[10px] brand-muted mt-0.5">{formatTs(c.updated_at)}</p>
                                </Link>
                            ))}
                        {!convLoading && !convErr && conversations.length === 0 && selectedSellerId && (
                            <p className="text-xs brand-muted p-2">No conversations yet.</p>
                        )}
                    </div>
                </aside>

                <main className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
                    {!conversationId && (
                        <div className="flex-1 flex items-center justify-center p-8">
                            <p className="text-sm brand-muted text-center">Select a conversation or start a new one.</p>
                        </div>
                    )}
                    {conversationId && (
                        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
                            <div
                                ref={messagesScrollRef}
                                onScroll={updateStickToBottomFromScroll}
                                className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-y-contain p-4 space-y-3 [scrollbar-gutter:stable]"
                            >
                                {msgLoading && messages.length === 0 && (
                                    <p className="text-sm brand-muted flex items-center gap-2">
                                        <Loader2 className="w-4 h-4 animate-spin" /> Loading messages…
                                    </p>
                                )}
                                {msgErr && <p className="text-sm text-red-400">{msgErr}</p>}
                                {(() => {
                                    /**
                                     * Sender roster + side hints for **labels** only (name / role in the banner).
                                     *
                                     * Bubble **alignment** is not “agency right / seller left”. It is only
                                     * “this row is from the signed-in viewer” → right; everyone else → left.
                                     * That way other agency admins, shared inboxes, etc. stay on the left while
                                     * you still see your own messages on the right.
                                     */
                                    const sellerSet = new Set(
                                        participants.sellerEmails.map((e) => e.toLowerCase()),
                                    );
                                    const agencySet = new Set(
                                        participants.agencyEmails.map((e) => e.toLowerCase()),
                                    );
                                    const classifySide = (email: string): 'seller' | 'agency' | 'unknown' => {
                                        const e = (email || '').toLowerCase();
                                        if (sellerSet.has(e)) return 'seller';
                                        if (agencySet.has(e)) return 'agency';
                                        return 'unknown';
                                    };
                                    /**
                                     * Used only to infer sender “side” for banner fallbacks when `sender_email`
                                     * is missing from the directory (not used for left/right alignment).
                                     */
                                    const mySide: 'seller' | 'agency' | null = viewerIsSeller
                                        ? 'seller'
                                        : viewerIsAgency || isPlatformSuperAdmin
                                          ? 'agency'
                                          : null;
                                    /**
                                         * Build the `Name · Role` label for a sender. Falls back gracefully when we
                                         * don't have the user in the directory (e.g. an external participant or a
                                         * routing mailbox we can't attribute).
                                         */
                                    const directory = participants.directory || {};
                                    const labelForEmail = (
                                        email: string | null | undefined,
                                        side: 'seller' | 'agency' | null,
                                    ): { who: string; role: string | null } => {
                                        const lc = (email || '').toLowerCase();
                                        const info = lc ? directory[lc] : undefined;
                                        if (info) {
                                            const display =
                                                info.name && info.name.trim().length > 0 ? info.name.trim() : (email || '');
                                            return { who: display, role: info.role };
                                        }
                                        if (email && !isLcRoutingAddress(email)) {
                                            const sideRole =
                                                side === 'seller' ? 'Seller team'
                                                : side === 'agency' ? 'Agency team'
                                                : null;
                                            return { who: email, role: sideRole };
                                        }
                                        const sideRole =
                                            side === 'seller' ? 'Seller team'
                                            : side === 'agency' ? 'Agency team'
                                            : 'Participant';
                                        return { who: sideRole, role: null };
                                    };

                                    /** Use the viewer's own profile as the directory entry for "You". */
                                    const myDirEntry =
                                        user?.email ? directory[user.email.toLowerCase()] : undefined;

                                    const viewerEmail = (user?.email || '').trim().toLowerCase();

                                    return messages.map((m) => {
                                        const senderEmailNorm = (m.sender_email || '').trim().toLowerCase();
                                        const sentByMeFromApp = Boolean(
                                            user?.id && m.sender_user_id && m.sender_user_id === user.id,
                                        );
                                        /** Gmail / GHL sync often has no `sender_user_id`; match profile email. */
                                        const sentByMeByEmail = Boolean(
                                            viewerEmail.length > 0 && senderEmailNorm === viewerEmail,
                                        );
                                        const isViewerOwnMessage = sentByMeFromApp || sentByMeByEmail;
                                        const alignEnd = isViewerOwnMessage;

                                        const senderSide = classifySide(m.sender_email);
                                        /**
                                         * Resolve side for banner labels only (who / role when not in directory).
                                         */
                                        let sideOfThis: 'seller' | 'agency' | null = null;
                                        if (isViewerOwnMessage) sideOfThis = mySide;
                                        else if (senderSide !== 'unknown') sideOfThis = senderSide;
                                        else if (mySide) {
                                            /** Direction-based last-resort for unknown senders. */
                                            sideOfThis = m.direction === 'outbound' ? mySide : mySide === 'seller' ? 'agency' : 'seller';
                                        }

                                        /**
                                         * Banner = `Who · Role · Timestamp`. Role is omitted only when we can't
                                         * resolve it at all; otherwise even bubbles attributed only by email show
                                         * the participant's role so the viewer always sees who is speaking.
                                         */
                                        const { who, role } = (() => {
                                            if (isViewerOwnMessage) {
                                                const myName =
                                                    myDirEntry?.name ||
                                                    user?.user_metadata?.full_name ||
                                                    user?.email ||
                                                    'You';
                                                return { who: `You (${myName})`, role: myDirEntry?.role ?? null };
                                            }
                                            return labelForEmail(m.sender_email, sideOfThis);
                                        })();
                                        const banner = role ? `${who} · ${role}` : who;
                                        return (
                                            <div
                                                key={m.id}
                                                className={`flex ${alignEnd ? 'justify-end' : 'justify-start'}`}
                                            >
                                                <div
                                                    className={`max-w-[min(100%,36rem)] rounded-2xl px-4 py-2 text-sm border ${
                                                        alignEnd ? 'rounded-br-md' : 'rounded-bl-md'
                                                    }`}
                                                    style={{
                                                        borderColor: 'var(--brand-sidebar-border)',
                                                        backgroundColor: alignEnd
                                                            ? 'color-mix(in srgb, var(--brand-primary) 18%, transparent)'
                                                            : 'color-mix(in srgb, var(--brand-card-bg) 90%, black)',
                                                    }}
                                                >
                                                    <p className="text-[10px] brand-muted mb-1">
                                                        {banner} · {formatTs(m.created_at)}
                                                        {m.send_status === 'pending' && (
                                                            <span className="brand-muted ml-2">(sending…)</span>
                                                        )}
                                                        {m.send_status === 'failed' && (
                                                            <span className="text-red-400 ml-2">(send failed)</span>
                                                        )}
                                                    </p>
                                                    <MessageBodyWithTaskLinks body={m.body} />
                                                </div>
                                            </div>
                                        );
                                    });
                                })()}
                            </div>
                            <div
                                ref={composerFooterRef}
                                className="border-t p-3 shrink-0 relative z-10 brand-bg isolate"
                                style={{
                                    borderColor: 'var(--brand-sidebar-border)',
                                    paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 0.75rem)',
                                }}
                            >
                                <div className="flex items-end gap-2 max-w-4xl mx-auto">
                                    <textarea
                                        ref={composeTextareaRef}
                                        value={compose}
                                        onChange={(e) => setCompose(e.target.value)}
                                        placeholder="Write a message…"
                                        rows={1}
                                        maxLength={16000}
                                        disabled={sendBusy}
                                        className="flex-1 rounded-xl border bg-gray-950/50 px-3 py-2 text-sm leading-normal brand-text placeholder:text-gray-500 resize-none overflow-y-auto focus:outline-none focus:ring-2 box-border min-h-0"
                                        style={
                                            {
                                                borderColor: 'var(--brand-sidebar-border)',
                                                '--tw-ring-color': 'var(--brand-primary)',
                                            } as CSSProperties
                                        }
                                    />
                                    <button
                                        type="button"
                                        disabled={sendBusy || !compose.trim()}
                                        onClick={() => void onSend()}
                                        className="shrink-0 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium brand-on-primary disabled:opacity-45"
                                        style={{ backgroundColor: 'var(--brand-primary)' }}
                                    >
                                        {sendBusy ?
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                        :   <Send className="w-4 h-4" />}
                                        Send
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
}
