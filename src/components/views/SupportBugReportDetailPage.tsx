import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Loader2 } from 'lucide-react';
import { fetchBugReportDetail, type BugReportContext } from '../../lib/supportApi';
import type { SupportNavState } from './SupportBugReportsPage';

function useSupportNav(): { returnPath: string; linkState: SupportNavState } {
    const loc = useLocation();
    const s = (loc.state || {}) as Partial<SupportNavState>;
    const returnPath =
        typeof s.supportReturnPath === 'string' && s.supportReturnPath.startsWith('/') ? s.supportReturnPath : '/';
    const context = s.bugReportContext as BugReportContext | undefined;
    const linkState: SupportNavState = { supportReturnPath: returnPath, bugReportContext: context };
    return { returnPath, linkState };
}

export function SupportBugReportDetailPage() {
    const { submissionId } = useParams<{ submissionId: string }>();
    const { returnPath, linkState } = useSupportNav();
    const [busy, setBusy] = useState(true);
    const [err, setErr] = useState<string | null>(null);
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState<string | null>(null);
    const [status, setStatus] = useState<string | null>(null);
    const [identifier, setIdentifier] = useState<string | null>(null);
    const [url, setUrl] = useState<string | null>(null);
    const [createdAt, setCreatedAt] = useState<string | null>(null);
    const [shopName, setShopName] = useState<string | null>(null);

    useEffect(() => {
        if (!submissionId) {
            setErr('Missing report id');
            setBusy(false);
            return;
        }
        let cancelled = false;
        (async () => {
            const r = await fetchBugReportDetail(submissionId);
            if (cancelled) return;
            if (!r.ok) {
                setErr(r.message);
                setBusy(false);
                return;
            }
            const it = r.item;
            setTitle(it.title);
            setDescription(it.description);
            setStatus(it.status);
            setIdentifier(it.identifier);
            setUrl(it.url);
            setCreatedAt(it.createdAt);
            setShopName(it.shopName);
            setBusy(false);
        })();
        return () => {
            cancelled = true;
        };
    }, [submissionId]);

    return (
        <div className="min-h-screen brand-bg">
            <header className="border-b px-4 sm:px-6 py-4 flex flex-wrap items-center gap-3" style={{ borderColor: 'var(--brand-sidebar-border)' }}>
                <Link
                    to="/support"
                    state={linkState}
                    className="inline-flex items-center gap-2 text-sm font-medium brand-nav-idle hover:opacity-90"
                    style={{ color: 'var(--brand-primary)' }}
                >
                    <ArrowLeft className="w-4 h-4" />
                    All reports
                </Link>
                <span className="text-brand-muted">·</span>
                <Link
                    to={returnPath}
                    className="text-xs brand-muted hover:text-brand-text transition-colors"
                >
                    Back to app
                </Link>
            </header>

            <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
                {busy && (
                    <p className="text-sm brand-muted flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                    </p>
                )}
                {err && !busy && (
                    <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                        {err}
                        <div className="mt-3">
                            <Link to="/support" state={linkState} className="font-medium underline">
                                Return to bug reports
                            </Link>
                        </div>
                    </div>
                )}
                {!busy && !err && (
                    <article className="rounded-2xl border p-6 space-y-4" style={{ borderColor: 'var(--brand-sidebar-border)' }}>
                        <h1 className="text-xl font-semibold brand-text">{title}</h1>
                        <dl className="grid gap-2 text-sm">
                            {createdAt && (
                                <div className="flex gap-2">
                                    <dt className="brand-muted w-28 shrink-0">Submitted</dt>
                                    <dd className="brand-text">
                                        {new Date(createdAt).toLocaleString(undefined, {
                                            dateStyle: 'medium',
                                            timeStyle: 'short',
                                        })}
                                    </dd>
                                </div>
                            )}
                            {status && (
                                <div className="flex gap-2">
                                    <dt className="brand-muted w-28 shrink-0">Status</dt>
                                    <dd className="brand-text">{status}</dd>
                                </div>
                            )}
                            {identifier && (
                                <div className="flex gap-2">
                                    <dt className="brand-muted w-28 shrink-0">Reference</dt>
                                    <dd className="font-mono text-sm brand-text">{identifier}</dd>
                                </div>
                            )}
                            {shopName && (
                                <div className="flex gap-2">
                                    <dt className="brand-muted w-28 shrink-0">Shop</dt>
                                    <dd className="brand-text">{shopName}</dd>
                                </div>
                            )}
                        </dl>
                        {url && (
                            <a
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-2 text-sm font-medium"
                                style={{ color: 'var(--brand-primary)' }}
                            >
                                Open in external system
                                <ExternalLink className="w-4 h-4" />
                            </a>
                        )}
                        <div>
                            <h2 className="text-xs font-semibold uppercase tracking-wider brand-muted mb-2">Your description</h2>
                            {description ? (
                                <div className="text-sm brand-text whitespace-pre-wrap rounded-lg border bg-gray-950/40 p-4" style={{ borderColor: 'var(--brand-sidebar-border)' }}>
                                    {description}
                                </div>
                            ) : (
                                <p className="text-sm brand-muted">
                                    This report was filed before descriptions were stored in the app. Your full message was still sent to support by email.
                                </p>
                            )}
                        </div>
                    </article>
                )}
            </div>
        </div>
    );
}
