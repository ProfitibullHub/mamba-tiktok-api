import { Building2, Check, Copy, Loader2, Search, Store, User, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
    platformSearchProfiles,
    platformSearchTenantsForOperator,
    type PlatformProfileSearchRow,
    type PlatformTenantSearchRow,
} from '../../lib/platformRpc';

function useDebouncedSearch<T>(
    query: string,
    minLen: number,
    fetcher: (q: string) => Promise<{ data: T[]; error: Error | null }>,
    enabled: boolean
) {
    const [results, setResults] = useState<T[]>([]);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    useEffect(() => {
        const q = query.trim();
        if (!enabled || q.length < minLen) {
            setResults([]);
            setErr(null);
            return;
        }
        let cancelled = false;
        const t = setTimeout(async () => {
            setLoading(true);
            setErr(null);
            try {
                const { data, error } = await fetcher(q);
                if (cancelled) return;
                if (error) {
                    setResults([]);
                    setErr(error.message);
                } else {
                    setResults(data);
                }
            } catch (e) {
                if (!cancelled) {
                    setResults([]);
                    setErr(e instanceof Error ? e.message : 'Search failed');
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        }, 320);
        return () => {
            cancelled = true;
            clearTimeout(t);
        };
    }, [query, minLen, enabled, fetcher]);

    return { results, loading, err };
}

type ProfilePickerProps = {
    value: PlatformProfileSearchRow | null;
    onChange: (v: PlatformProfileSearchRow | null) => void;
    disabled?: boolean;
    label: string;
    hint?: string;
};

export function OperatorProfilePicker({ value, onChange, disabled, label, hint }: ProfilePickerProps) {
    const [q, setQ] = useState('');
    const [open, setOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

    const fetcher = useCallback(async (query: string) => {
        const { data, error } = await platformSearchProfiles(query);
        return { data, error: error ? new Error(error.message) : null };
    }, []);
    const { results, loading, err } = useDebouncedSearch(q, 2, fetcher, !disabled && !value);

    useEffect(() => {
        const onDoc = (e: MouseEvent) => {
            if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onDoc);
        return () => document.removeEventListener('mousedown', onDoc);
    }, []);

    if (value) {
        return (
            <div className="rounded-xl border border-gray-600 bg-gray-900/80 p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 min-w-0">
                        <div className="mt-0.5 p-1.5 rounded-lg bg-violet-500/15 text-violet-300">
                            <User className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                            <div className="text-sm font-medium text-white truncate">
                                {value.full_name || value.email || 'User'}
                            </div>
                            {value.full_name && value.email ? (
                                <div className="text-xs text-gray-500 truncate">{value.email}</div>
                            ) : null}
                            <div className="flex items-center gap-1 mt-1">
                                <code className="text-[11px] text-gray-500 font-mono truncate max-w-[220px]" title={value.id}>
                                    {value.id}
                                </code>
                                <button
                                    type="button"
                                    disabled={disabled}
                                    onClick={() => {
                                        void navigator.clipboard.writeText(value.id).then(() => {
                                            setCopied(true);
                                            setTimeout(() => setCopied(false), 1600);
                                        });
                                    }}
                                    className="p-1 rounded-md text-gray-500 hover:text-white hover:bg-gray-800 disabled:opacity-40"
                                    title="Copy user id"
                                >
                                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                                </button>
                            </div>
                        </div>
                    </div>
                    <button
                        type="button"
                        disabled={disabled}
                        onClick={() => {
                            onChange(null);
                            setQ('');
                            setOpen(false);
                        }}
                        className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-gray-800 shrink-0 disabled:opacity-40"
                        title="Clear selection"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div ref={rootRef} className="space-y-1.5">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2 mb-1">
                <Search className="w-3.5 h-3.5" />
                {label}
            </label>
            {hint ? <p className="text-xs text-gray-500 mb-2">{hint}</p> : null}
            <input
                value={q}
                disabled={disabled}
                onChange={(e) => {
                    setQ(e.target.value);
                    setOpen(true);
                }}
                onFocus={() => setOpen(true)}
                placeholder="Name, email, or user id (2+ characters)"
                className="w-full bg-gray-950 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white placeholder:text-gray-600 disabled:opacity-50"
            />
            {loading && (
                <div className="text-xs text-gray-500 flex items-center gap-1 mt-1">
                    <Loader2 className="w-3 h-3 animate-spin" /> Searching…
                </div>
            )}
            {err && <p className="text-xs text-amber-400/90 mt-1">{err}</p>}
            {open && results.length > 0 && (
                <ul className="mt-1 max-h-40 overflow-y-auto rounded-xl border border-gray-700 divide-y divide-gray-800 shadow-lg z-10 relative bg-gray-950">
                    {results.map((u) => (
                        <li key={u.id}>
                            <button
                                type="button"
                                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-800/80 text-gray-200"
                                onClick={() => {
                                    onChange(u);
                                    setQ('');
                                    setOpen(false);
                                }}
                            >
                                <span className="font-medium text-white">{u.full_name || u.email || '—'}</span>
                                {u.email ? <span className="block text-xs text-gray-500">{u.email}</span> : null}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            {open && !loading && q.trim().length >= 2 && results.length === 0 && !err ? (
                <p className="text-xs text-gray-600 mt-1">No matches.</p>
            ) : null}
        </div>
    );
}

type TenantPickerProps = {
    kind: 'agency' | 'seller';
    value: PlatformTenantSearchRow | null;
    onChange: (v: PlatformTenantSearchRow | null) => void;
    disabled?: boolean;
    label: string;
    hint?: string;
};

export function OperatorTenantPicker({ kind, value, onChange, disabled, label, hint }: TenantPickerProps) {
    const [q, setQ] = useState('');
    const [open, setOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

    const fetcher = useCallback(
        async (query: string) => {
            const { data, error } = await platformSearchTenantsForOperator(query, kind);
            return { data, error: error ? new Error(error.message) : null };
        },
        [kind]
    );
    const { results, loading, err } = useDebouncedSearch(q, 2, fetcher, !disabled && !value);

    useEffect(() => {
        const onDoc = (e: MouseEvent) => {
            if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onDoc);
        return () => document.removeEventListener('mousedown', onDoc);
    }, []);

    const Icon = kind === 'agency' ? Building2 : Store;

    if (value) {
        return (
            <div className="rounded-xl border border-gray-600 bg-gray-900/80 p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 min-w-0">
                        <div
                            className={`mt-0.5 p-1.5 rounded-lg ${
                                kind === 'agency' ? 'bg-violet-500/15 text-violet-300' : 'bg-pink-500/15 text-pink-300'
                            }`}
                        >
                            <Icon className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                            <div className="text-sm font-medium text-white truncate">{value.name}</div>
                            <div className="text-[11px] text-gray-500 mt-0.5">
                                {value.type} · {value.status}
                                {value.parent_tenant_id ? (
                                    <span className="block font-mono text-gray-600 mt-0.5 truncate" title={value.parent_tenant_id}>
                                        Parent: {value.parent_tenant_id}
                                    </span>
                                ) : null}
                            </div>
                            <div className="flex items-center gap-1 mt-1">
                                <code className="text-[11px] text-gray-500 font-mono truncate max-w-[220px]" title={value.id}>
                                    {value.id}
                                </code>
                                <button
                                    type="button"
                                    disabled={disabled}
                                    onClick={() => {
                                        void navigator.clipboard.writeText(value.id).then(() => {
                                            setCopied(true);
                                            setTimeout(() => setCopied(false), 1600);
                                        });
                                    }}
                                    className="p-1 rounded-md text-gray-500 hover:text-white hover:bg-gray-800 disabled:opacity-40"
                                    title="Copy tenant id"
                                >
                                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                                </button>
                            </div>
                        </div>
                    </div>
                    <button
                        type="button"
                        disabled={disabled}
                        onClick={() => {
                            onChange(null);
                            setQ('');
                            setOpen(false);
                        }}
                        className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-gray-800 shrink-0 disabled:opacity-40"
                        title="Clear selection"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div ref={rootRef} className="space-y-1.5">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2 mb-1">
                <Icon className="w-3.5 h-3.5" />
                {label}
            </label>
            {hint ? <p className="text-xs text-gray-500 mb-2">{hint}</p> : null}
            <input
                value={q}
                disabled={disabled}
                onChange={(e) => {
                    setQ(e.target.value);
                    setOpen(true);
                }}
                onFocus={() => setOpen(true)}
                placeholder={kind === 'agency' ? 'Agency name or id' : 'Seller name or id'}
                className="w-full bg-gray-950 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white placeholder:text-gray-600 disabled:opacity-50"
            />
            {loading && (
                <div className="text-xs text-gray-500 flex items-center gap-1 mt-1">
                    <Loader2 className="w-3 h-3 animate-spin" /> Searching…
                </div>
            )}
            {err && <p className="text-xs text-amber-400/90 mt-1">{err}</p>}
            {open && results.length > 0 && (
                <ul className="mt-1 max-h-40 overflow-y-auto rounded-xl border border-gray-700 divide-y divide-gray-800 shadow-lg z-10 relative bg-gray-950">
                    {results.map((t) => (
                        <li key={t.id}>
                            <button
                                type="button"
                                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-800/80 text-gray-200"
                                onClick={() => {
                                    onChange(t);
                                    setQ('');
                                    setOpen(false);
                                }}
                            >
                                <span className="font-medium text-white">{t.name}</span>
                                <span className="block text-xs text-gray-500">
                                    {t.type} · {t.status}
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            {open && !loading && q.trim().length >= 2 && results.length === 0 && !err ? (
                <p className="text-xs text-gray-600 mt-1">No matches.</p>
            ) : null}
        </div>
    );
}
