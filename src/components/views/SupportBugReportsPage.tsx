import { useCallback, useEffect, useState, type CSSProperties, type ChangeEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Bug, ImagePlus, Loader2, Trash2 } from 'lucide-react';
import {
    BUG_REPORT_MAX_IMAGE_FILES,
    fetchMyBugReports,
    readImageFileAsAttachment,
    submitBugReport,
    type BugReportContext,
    type MyBugReportItem,
} from '../../lib/supportApi';

export type SupportNavState = {
    bugReportContext?: BugReportContext;
    supportReturnPath: string;
};

type StagedImage = {
    id: string;
    filename: string;
    contentBase64: string;
    previewUrl: string;
};

const SUPPORT_BUG_SCREENSHOTS_LABEL_ID = 'support-bug-screenshots-label';
const SUPPORT_BUG_FILE_INPUT_ID = 'support-bug-report-file-input';

function newStagedImageId(): string {
    const c = globalThis.crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function useSupportNav(): { context?: BugReportContext; returnPath: string; linkState: SupportNavState } {
    const loc = useLocation();
    const s = (loc.state || {}) as Partial<SupportNavState>;
    const returnPath =
        typeof s.supportReturnPath === 'string' && s.supportReturnPath.startsWith('/') ? s.supportReturnPath : '/';
    const context = s.bugReportContext;
    const linkState: SupportNavState = { supportReturnPath: returnPath, bugReportContext: context };
    return { context, returnPath, linkState };
}

export function SupportBugReportsPage() {
    const navigate = useNavigate();
    const { pathname, search } = useLocation();
    const { context, returnPath, linkState } = useSupportNav();

    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [staged, setStaged] = useState<StagedImage[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [items, setItems] = useState<MyBugReportItem[] | null>(null);
    const [listLoading, setListLoading] = useState(true);
    const [listErr, setListErr] = useState<string | null>(null);
    const [statusRefreshEnabled, setStatusRefreshEnabled] = useState(false);

    const loadList = useCallback(async () => {
        setListLoading(true);
        setListErr(null);
        const r = await fetchMyBugReports();
        if (!r.ok) {
            setListErr(r.message);
            setItems([]);
            setListLoading(false);
            return;
        }
        setItems(r.items);
        setStatusRefreshEnabled(r.statusRefreshEnabled);
        setListLoading(false);
    }, []);

    useEffect(() => {
        void loadList();
    }, [loadList]);

    const removeStaged = useCallback((id: string) => {
        setStaged((prev) => {
            const found = prev.find((x) => x.id === id);
            if (found) URL.revokeObjectURL(found.previewUrl);
            return prev.filter((x) => x.id !== id);
        });
    }, []);

    const onFilesSelected = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
        const inputEl = e.target;
        // Snapshot before clearing: `File List` is live — resetting `value` empties the same list.
        const files = inputEl.files?.length ? Array.from(inputEl.files) : [];
        inputEl.value = '';
        if (files.length === 0) return;
        setError(null);

        const additions: StagedImage[] = [];
        for (const file of files) {
            try {
                const att = await readImageFileAsAttachment(file);
                const previewUrl = URL.createObjectURL(file);
                additions.push({ id: newStagedImageId(), ...att, previewUrl });
            } catch (err) {
                additions.forEach((a) => URL.revokeObjectURL(a.previewUrl));
                setError(err instanceof Error ? err.message : 'Invalid attachment');
                return;
            }
        }

        if (additions.length === 0) return;

        setStaged((prev) => {
            const room = Math.max(0, BUG_REPORT_MAX_IMAGE_FILES - prev.length);
            const take = additions.slice(0, room);
            const overflow = additions.slice(room);
            if (overflow.length > 0) {
                queueMicrotask(() => {
                    overflow.forEach((item) => URL.revokeObjectURL(item.previewUrl));
                    setError(`You can attach at most ${BUG_REPORT_MAX_IMAGE_FILES} images.`);
                });
            }
            return [...prev, ...take];
        });
    }, []);

    const handleSubmit = async () => {
        const t = title.trim();
        const d = description.trim();
        if (!t || !d) {
            setError('Please add a title and description.');
            return;
        }
        setBusy(true);
        setError(null);
        const attachments = staged.map(({ filename, contentBase64 }) => ({ filename, contentBase64 }));
        const result = await submitBugReport({
            title: t,
            description: d,
            route: `${pathname}${search || ''}`,
            accountId: context?.accountId,
            shopId: context?.shopId,
            shopName: context?.shopName,
            attachments: attachments.length ? attachments : undefined,
        });
        setBusy(false);
        if (!result.ok) {
            setError(result.error);
            return;
        }
        setStaged((prev) => {
            prev.forEach((s) => URL.revokeObjectURL(s.previewUrl));
            return [];
        });
        setTitle('');
        setDescription('');
        if (result.data.submissionId) {
            navigate(`/support/${result.data.submissionId}`, { replace: true, state: linkState });
            return;
        }
        void loadList();
    };

    return (
        <div className="min-h-screen brand-bg">
            <header className="border-b px-4 sm:px-6 py-4 flex items-center gap-4" style={{ borderColor: 'var(--brand-sidebar-border)' }}>
                <Link
                    to={returnPath}
                    className="inline-flex items-center gap-2 text-sm font-medium brand-nav-idle hover:opacity-90"
                    style={{ color: 'var(--brand-primary)' }}
                >
                    <ArrowLeft className="w-4 h-4" />
                    Back
                </Link>
                <div className="flex items-center gap-2 min-w-0">
                    <Bug className="w-5 h-5 shrink-0" style={{ color: 'var(--brand-primary)' }} />
                    <h1 className="text-lg font-semibold brand-text truncate">Bug reports</h1>
                </div>
            </header>

            <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-10">
                <section>
                    <h2 className="text-sm font-semibold uppercase tracking-wider brand-muted mb-3">Submit a report</h2>
                    <p className="text-xs brand-muted mb-4">
                        Technical context (IDs, route, environment) is included for support. Screenshots are optional (up to{' '}
                        {BUG_REPORT_MAX_IMAGE_FILES} images, 1 MB each).
                    </p>
                    <div className="rounded-2xl border p-5 space-y-4" style={{ borderColor: 'var(--brand-sidebar-border)' }}>
                        <div>
                            <label className="block text-xs font-medium brand-muted mb-1">Title</label>
                            <input
                                type="text"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                className="w-full rounded-lg border bg-gray-950/50 px-3 py-2 text-sm brand-text placeholder:text-gray-500 focus:outline-none focus:ring-2"
                                style={
                                    {
                                        borderColor: 'var(--brand-sidebar-border)',
                                        '--tw-ring-color': 'var(--brand-primary)',
                                    } as CSSProperties
                                }
                                placeholder="Short summary"
                                maxLength={200}
                                disabled={busy}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium brand-muted mb-1">What happened?</label>
                            <textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                className="w-full rounded-lg border bg-gray-950/50 px-3 py-2 text-sm brand-text placeholder:text-gray-500 focus:outline-none focus:ring-2 min-h-[140px]"
                                style={
                                    {
                                        borderColor: 'var(--brand-sidebar-border)',
                                        '--tw-ring-color': 'var(--brand-primary)',
                                    } as CSSProperties
                                }
                                placeholder="Steps to reproduce, expected vs actual behavior…"
                                maxLength={8000}
                                disabled={busy}
                            />
                        </div>
                        <div>
                            <span className="block text-xs font-medium brand-muted mb-1" id={SUPPORT_BUG_SCREENSHOTS_LABEL_ID}>
                                Screenshots (optional)
                            </span>
                            <input
                                id={SUPPORT_BUG_FILE_INPUT_ID}
                                type="file"
                                accept="image/png,image/jpeg,image/jpg,image/gif,image/webp,image/pjpeg,image/jfif,.png,.jpg,.jpeg,.jfif,.gif,.webp"
                                multiple
                                className="hidden"
                                aria-labelledby={SUPPORT_BUG_SCREENSHOTS_LABEL_ID}
                                onChange={onFilesSelected}
                                disabled={busy || staged.length >= BUG_REPORT_MAX_IMAGE_FILES}
                            />
                            <label
                                htmlFor={SUPPORT_BUG_FILE_INPUT_ID}
                                className={`inline-flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs font-medium border brand-nav-idle hover:bg-white/5 cursor-pointer ${
                                    busy || staged.length >= BUG_REPORT_MAX_IMAGE_FILES ? 'opacity-45 cursor-not-allowed pointer-events-none' : ''
                                }`}
                                style={{ borderColor: 'var(--brand-sidebar-border)' }}
                            >
                                <ImagePlus className="w-4 h-4 shrink-0" aria-hidden />
                                Add images
                            </label>
                            <p className="text-[11px] brand-muted mt-1.5 leading-relaxed">
                                Thumbnails appear below after you choose files (max {BUG_REPORT_MAX_IMAGE_FILES}, 1 MB each).
                            </p>
                            {staged.length > 0 && (
                                <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
                                    {staged.map((s) => (
                                        <div
                                            key={s.id}
                                            className="relative rounded-lg border overflow-hidden aspect-video bg-gray-950/80"
                                            style={{ borderColor: 'var(--brand-sidebar-border)' }}
                                        >
                                            <img src={s.previewUrl} alt="" className="w-full h-full object-contain" />
                                            <button
                                                type="button"
                                                onClick={() => removeStaged(s.id)}
                                                disabled={busy}
                                                className="absolute top-1 right-1 p-1 rounded-md bg-black/70 text-white"
                                                aria-label={`Remove ${s.filename}`}
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        {error && (
                            <p className="text-sm text-red-400 mt-1" role="alert">
                                {error}
                            </p>
                        )}
                        <div className="flex justify-end">
                            <button
                                type="button"
                                onClick={() => void handleSubmit()}
                                disabled={busy}
                                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium brand-on-primary disabled:opacity-50"
                                style={{ backgroundColor: 'var(--brand-primary)' }}
                            >
                                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                                Submit report
                            </button>
                        </div>
                    </div>
                </section>

                <section>
                    <div className="flex items-baseline justify-between gap-2 mb-3">
                        <h2 className="text-sm font-semibold uppercase tracking-wider brand-muted">Your recent reports</h2>
                        {statusRefreshEnabled && (
                            <span className="text-[10px] brand-muted">Status may refresh periodically</span>
                        )}
                    </div>
                    {listLoading && (
                        <p className="text-sm brand-muted flex items-center gap-2">
                            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                        </p>
                    )}
                    {listErr && <p className="text-sm text-red-400">{listErr}</p>}
                    {!listLoading && !listErr && items && items.length === 0 && (
                        <p className="text-sm brand-muted">No reports yet. Submit one above.</p>
                    )}
                    {!listLoading && items && items.length > 0 && (
                        <ul className="space-y-2">
                            {items.map((row) => (
                                <li key={row.id}>
                                    <Link
                                        to={`/support/${row.id}`}
                                        state={linkState}
                                        className="block rounded-xl border px-4 py-3 brand-nav-idle hover:bg-white/[0.03] transition-colors"
                                        style={{ borderColor: 'var(--brand-sidebar-border)' }}
                                    >
                                        <p className="font-medium brand-text">{row.title}</p>
                                        <p className="text-xs brand-muted mt-1">
                                            {row.identifier ?? row.externalId.slice(0, 12)}
                                            {row.status ? ` · ${row.status}` : ''}
                                            {row.shopName ? ` · ${row.shopName}` : ''}
                                        </p>
                                        {row.descriptionPreview && (
                                            <p className="text-xs brand-muted mt-2 line-clamp-2">{row.descriptionPreview}</p>
                                        )}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>
            </div>
        </div>
    );
}
