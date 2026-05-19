import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    X,
    Loader2,
    ChevronLeft,
    Plus,
    Pencil,
    EyeOff,
    Eye,
    CalendarRange,
    ListOrdered,
    Ban,
} from 'lucide-react';
import type { Account } from '../lib/supabase';
import type { DateRange } from './DateRangePicker';
import {
    appendCustomPlLineItemValue,
    createCustomPlLineItem,
    CUSTOM_PL_CATEGORY_OPTIONS,
    deactivateCustomPlLineItem,
    type CustomPlCategory,
    type CustomPlLineItemDto,
    type CustomPlValueDto,
    patchCustomPlLineItemValue,
    updateCustomPlLineItem,
} from '../lib/customPlFinanceApi';

export type CustomPlModalLineRow = {
    id: string;
    name: string;
    category: string;
    sort_order: number;
    is_active: boolean;
    amount_in_range: number | null;
    value_segments: Array<{
        id: string;
        amount: number;
        amount_in_report?: number;
        start_date: string;
        end_date: string | null;
    }>;
};

type View = 'list' | 'newLine' | 'addValue' | 'editLine' | 'adjustValue';

function fmtMoney(n: number | null): string {
    if (n === null) return '—';
    const v = Number.isFinite(n) ? n : 0;
    const abs = Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (v < 0) return `-$${abs}`;
    return `$${abs}`;
}

/** Accepts pasted values like `$20,000` or `20,000.50` (commas stripped). */
function parseMoneyInput(raw: string): number {
    const s = raw.trim().replace(/\$/g, '').replace(/,/g, '').replace(/\s+/g, '');
    if (s === '' || s === '-' || s === '+') return NaN;
    return parseFloat(s);
}

function categoryLabel(cat: string): string {
    return CUSTOM_PL_CATEGORY_OPTIONS.find(o => o.value === cat)?.label ?? cat;
}

export interface CustomPlManageModalProps {
    isOpen: boolean;
    onClose: () => void;
    account: Account;
    shopId: string;
    dateRange: DateRange;
    timezone: string;
    lines: CustomPlModalLineRow[];
    onAfterSave: () => void | Promise<void>;
}

export function CustomPlManageModal({
    isOpen,
    onClose,
    account,
    shopId,
    dateRange,
    timezone: _timezone,
    lines: linesProp,
    onAfterSave,
}: CustomPlManageModalProps) {
    const [view, setView] = useState<View>('list');
    const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [adjustCtx, setAdjustCtx] = useState<{
        line: CustomPlModalLineRow;
        seg: CustomPlModalLineRow['value_segments'][number];
    } | null>(null);
    /** Only reset navigation when the modal opens; not on every lines refresh (e.g. after create → add amount). */
    const wasOpenRef = useRef(false);

    useEffect(() => {
        if (isOpen) {
            const justOpened = !wasOpenRef.current;
            wasOpenRef.current = true;
            if (justOpened) {
                setView('list');
                setSelectedLineId(null);
                setAdjustCtx(null);
                setBusy(false);
                setError(null);
            }
        } else {
            wasOpenRef.current = false;
            setBusy(false);
        }
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !busy) onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isOpen, busy, onClose]);

    const selectedLine = useMemo(
        () => (selectedLineId ? linesProp.find(l => l.id === selectedLineId) ?? null : null),
        [linesProp, selectedLineId],
    );

    const refreshFromParent = useCallback(async () => {
        await onAfterSave();
    }, [onAfterSave]);

    const handleBackdrop = (e: React.MouseEvent) => {
        if (busy) return;
        if (e.target === e.currentTarget) onClose();
    };

    if (!isOpen) return null;

    return (
        <div
            className={`fixed inset-0 z-[60] flex items-center justify-center bg-black/55 backdrop-blur-sm p-4 ${busy ? 'cursor-wait' : ''}`}
            onMouseDown={handleBackdrop}
            role="presentation"
            aria-busy={busy}
        >
            <div
                className="brand-card w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl shadow-2xl border overflow-hidden"
                style={{ borderColor: 'var(--brand-card-border)' }}
                onMouseDown={e => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="custom-pl-modal-title"
                aria-busy={busy}
                // @ts-expect-error React 18 `HTMLAttributes` omits `inert` (supported in DOM)
                inert={busy ? true : undefined}
            >
                <div
                    className="flex items-center justify-between gap-3 px-5 py-4 border-b shrink-0"
                    style={{ borderColor: 'var(--brand-card-border)' }}
                >
                    <div className="flex items-center gap-2 min-w-0">
                        {view !== 'list' && (
                            <button
                                type="button"
                                disabled={busy}
                                onClick={() => {
                                    if (busy) return;
                                    setView('list');
                                    setError(null);
                                    setAdjustCtx(null);
                                }}
                                className="p-1.5 rounded-lg brand-muted hover:brand-text transition-colors shrink-0 disabled:opacity-40 disabled:pointer-events-none disabled:cursor-not-allowed"
                                aria-label="Back"
                                title={busy ? 'Wait for the current action to finish' : undefined}
                            >
                                <ChevronLeft className="w-5 h-5" />
                            </button>
                        )}
                        <div className="min-w-0">
                            <h2 id="custom-pl-modal-title" className="text-lg font-semibold brand-text truncate">
                                {view === 'list' && 'Custom P&L lines'}
                                {view === 'newLine' && 'New line item'}
                                {view === 'addValue' && 'Add dated amount'}
                                {view === 'editLine' && 'Edit line item'}
                                {view === 'adjustValue' && 'Adjust value segment'}
                            </h2>
                            <p className="text-xs brand-muted truncate">
                                {dateRange.startDate} → {dateRange.endDate}
                                {_timezone ? ` · ${_timezone}` : ''}
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                            if (!busy) onClose();
                        }}
                        className="p-2 rounded-lg brand-muted hover:brand-text transition-colors shrink-0 disabled:opacity-40 disabled:pointer-events-none disabled:cursor-not-allowed"
                        aria-label="Close"
                        title={busy ? 'Wait for the current action to finish' : 'Close'}
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {error && (
                    <div
                        className="mx-5 mt-3 px-3 py-2 rounded-lg text-sm border"
                        style={{
                            backgroundColor: 'var(--brand-danger-bg, rgba(220,38,38,0.12))',
                            borderColor: 'var(--brand-danger-border, rgba(220,38,38,0.35))',
                            color: 'var(--brand-danger-text, #fecaca)',
                        }}
                    >
                        {error}
                    </div>
                )}

                <div className="flex-1 overflow-y-auto px-5 py-4 custom-scrollbar">
                    {view === 'list' && (
                        <ListView
                            lines={linesProp}
                            onAddLine={() => {
                                setError(null);
                                setView('newLine');
                            }}
                            onAddValue={id => {
                                setSelectedLineId(id);
                                setError(null);
                                setView('addValue');
                            }}
                            onAdjustValue={(line, seg) => {
                                setError(null);
                                setAdjustCtx({ line, seg });
                                setView('adjustValue');
                            }}
                            onEdit={id => {
                                setSelectedLineId(id);
                                setError(null);
                                setView('editLine');
                            }}
                            onToggleActive={async (id, next) => {
                                const label = next ? 'show this line on reports again' : 'hide this line from reports (historical values stay)';
                                if (!window.confirm(`${next ? 'Restore' : 'Hide'} line — ${label}?`)) return;
                                setBusy(true);
                                setError(null);
                                try {
                                    await updateCustomPlLineItem(account.id, id, { is_active: next });
                                    await refreshFromParent();
                                } catch (e: unknown) {
                                    setError(e instanceof Error ? e.message : 'Update failed');
                                } finally {
                                    setBusy(false);
                                }
                            }}
                            onDeactivateLine={async row => {
                                if (
                                    !window.confirm(
                                        `Remove “${row.name}” from P&L reports?\n\nHistorical dated amounts stay in the database. You can restore the line later with Edit → “Show on P&L”.`,
                                    )
                                ) {
                                    return;
                                }
                                setBusy(true);
                                setError(null);
                                try {
                                    await deactivateCustomPlLineItem(account.id, row.id);
                                    if (selectedLineId === row.id) {
                                        setSelectedLineId(null);
                                        setView('list');
                                    }
                                    await refreshFromParent();
                                } catch (e: unknown) {
                                    setError(e instanceof Error ? e.message : 'Update failed');
                                } finally {
                                    setBusy(false);
                                }
                            }}
                            busy={busy}
                        />
                    )}

                    {view === 'newLine' && (
                        <NewLineForm
                            accountId={account.id}
                            shopId={shopId}
                            busy={busy}
                            setBusy={setBusy}
                            setError={setError}
                            onDone={async (created: CustomPlLineItemDto) => {
                                await refreshFromParent();
                                setSelectedLineId(created.id);
                                setError(null);
                                setView('addValue');
                            }}
                        />
                    )}

                    {view === 'addValue' && selectedLine && (
                        <AddValueForm
                            accountId={account.id}
                            line={selectedLine}
                            busy={busy}
                            setBusy={setBusy}
                            setError={setError}
                            onDone={async (created, lineRow) => {
                                await refreshFromParent();
                                const amt =
                                    typeof created.amount === 'number' && Number.isFinite(created.amount)
                                        ? created.amount
                                        : parseFloat(String(created.amount ?? ''));
                                const seg: CustomPlModalLineRow['value_segments'][number] = {
                                    id: created.id,
                                    amount: Number.isFinite(amt) ? amt : 0,
                                    amount_in_report: Number.isFinite(amt) ? amt : 0,
                                    start_date: created.start_date,
                                    end_date: created.end_date ?? null,
                                };
                                const prev = lineRow.value_segments ?? [];
                                const mergedLine: CustomPlModalLineRow = {
                                    ...lineRow,
                                    value_segments: [...prev.filter(s => s.id !== created.id), seg],
                                };
                                setAdjustCtx({ line: mergedLine, seg });
                                setView('adjustValue');
                                setError(null);
                            }}
                        />
                    )}

                    {view === 'editLine' && selectedLine && (
                        <EditLineForm
                            accountId={account.id}
                            line={selectedLine}
                            busy={busy}
                            setBusy={setBusy}
                            setError={setError}
                            onDone={async () => {
                                await refreshFromParent();
                                setView('list');
                            }}
                        />
                    )}

                    {view === 'adjustValue' && adjustCtx && (
                        <AdjustValueForm
                            key={`${adjustCtx.line.id}-${adjustCtx.seg.id}`}
                            accountId={account.id}
                            line={adjustCtx.line}
                            segment={adjustCtx.seg}
                            busy={busy}
                            setBusy={setBusy}
                            setError={setError}
                            onDone={async (opts) => {
                                if (!opts?.skipRefresh) {
                                    await refreshFromParent();
                                }
                                setAdjustCtx(null);
                                setView('list');
                            }}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}

function ListView({
    lines,
    onAddLine,
    onAddValue,
    onAdjustValue,
    onEdit,
    onToggleActive,
    onDeactivateLine,
    busy,
}: {
    lines: CustomPlModalLineRow[];
    onAddLine: () => void;
    onAddValue: (id: string) => void;
    onAdjustValue?: (line: CustomPlModalLineRow, seg: CustomPlModalLineRow['value_segments'][number]) => void;
    onEdit: (id: string) => void;
    onToggleActive: (id: string, next: boolean) => void;
    onDeactivateLine: (row: CustomPlModalLineRow) => void | Promise<void>;
    busy: boolean;
}) {
    const sorted = useMemo(
        () => [...lines].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
        [lines],
    );

    return (
        <div className="space-y-4">
            <div
                className="rounded-xl border p-3 text-xs brand-muted space-y-2 leading-relaxed"
                style={{ borderColor: 'var(--brand-card-border)', backgroundColor: 'var(--brand-interactive-hover-bg, rgba(255,255,255,0.03))' }}
            >
                <p className="flex items-start gap-2 brand-text font-medium text-sm">
                    <CalendarRange className="w-4 h-4 shrink-0 mt-0.5" />
                    How this works
                </p>
                <ul className="list-disc pl-4 space-y-1">
                    <li>Amounts use UTC calendar dates, matching the P&amp;L date range you select above the report.</li>
                    <li>Overlapping value ranges for the same line are not allowed. Starting a new period after an open-ended value automatically closes the previous segment.</li>
                    <li>Editing requires TikTok shop connection permission and seller admin access (same as agency fee settings).</li>
                    <li>
                        <strong className="brand-text">Remove from reports</strong> sets the line inactive; amounts remain for audit and history. Use <strong className="brand-text">Restore</strong> to show it again.
                    </li>
                    <li>
                        After you save an amount, we open <strong className="brand-text">Adjust value segment</strong> so you can optionally shorten, split, or supersede that period. Your amount is already saved; use <strong className="brand-text">Continue without changes</strong> there if you do not need those tools. From the list, <strong className="brand-text">Adjust…</strong> next to a segment opens the same screen.
                    </li>
                </ul>
            </div>

            <div className="flex justify-end">
                <button
                    type="button"
                    disabled={busy}
                    onClick={onAddLine}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors border disabled:opacity-40 disabled:pointer-events-none"
                    style={{
                        backgroundColor: 'var(--brand-primary)',
                        color: 'var(--brand-on-primary, #fff)',
                        borderColor: 'var(--brand-primary)',
                    }}
                >
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    Add line item
                </button>
            </div>

            {sorted.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center border rounded-xl border-dashed" style={{ borderColor: 'var(--brand-card-border)' }}>
                    <ListOrdered className="w-10 h-10 brand-muted mb-2 opacity-60" />
                    <p className="brand-text font-medium">No custom lines yet</p>
                    <p className="text-sm brand-muted mt-1 max-w-sm">
                        Create a line (e.g. &quot;Warehouse rent&quot;) then add dated amounts. They roll into the P&amp;L when the segment overlaps your report; if the segment is longer than the report, the amount is prorated by calendar days in range.
                    </p>
                </div>
            ) : (
                <ul className="space-y-3">
                    {sorted.map(row => (
                        <li
                            key={row.id}
                            className="rounded-xl border p-4 space-y-3"
                            style={{ borderColor: 'var(--brand-card-border)' }}
                        >
                            <div className="flex justify-between gap-3 items-start">
                                <div className="min-w-0">
                                    <p className="font-medium brand-text truncate">
                                        {row.name}
                                        {!row.is_active && (
                                            <span className="ml-2 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded brand-muted border" style={{ borderColor: 'var(--brand-card-border)' }}>
                                                Hidden
                                            </span>
                                        )}
                                    </p>
                                    <p className="text-xs brand-muted mt-0.5">{categoryLabel(row.category)}</p>
                                </div>
                                <div className="text-right shrink-0">
                                    <p className="text-xs brand-muted">In this range</p>
                                    <p className="text-sm font-mono tabular-nums brand-text">{fmtMoney(row.amount_in_range)}</p>
                                </div>
                            </div>

                            {(row.value_segments?.length ?? 0) > 0 && (
                                <div className="text-[11px] brand-muted space-y-1 border-t pt-2" style={{ borderColor: 'var(--brand-card-border)' }}>
                                    <p className="font-medium brand-text text-xs">Value segments</p>
                                    {(row.value_segments ?? []).map(seg => {
                                        const stored = Number(seg.amount);
                                        const inReport =
                                            seg.amount_in_report != null && Number.isFinite(seg.amount_in_report)
                                                ? Number(seg.amount_in_report)
                                                : stored;
                                        const prorated =
                                            Math.abs(stored - inReport) >= 0.005 && seg.amount_in_report != null;
                                        return (
                                            <div key={seg.id} className="flex justify-between gap-2 items-start font-mono tabular-nums">
                                                <span className="min-w-0 flex-1">
                                                    {seg.start_date}
                                                    {seg.end_date ? ` → ${seg.end_date}` : ' → …'}
                                                </span>
                                                <span className="text-right shrink-0 flex flex-col items-end gap-1">
                                                    <span>
                                                    {prorated ? (
                                                        <span className="block" title="Stored segment total vs portion counted in the current report (prorated by calendar days).">
                                                            <span className="brand-muted">{fmtMoney(stored)}</span>
                                                            <span className="mx-1 brand-muted">→</span>
                                                            <span>{fmtMoney(inReport)}</span>
                                                            <span className="block text-[10px] font-sans font-normal brand-muted normal-case">
                                                                in this report
                                                            </span>
                                                        </span>
                                                    ) : (
                                                        fmtMoney(inReport)
                                                    )}
                                                    </span>
                                                    {onAdjustValue && row.is_active && (
                                                        <button
                                                            type="button"
                                                            disabled={busy}
                                                            onClick={() => onAdjustValue(row, seg)}
                                                            className="text-[11px] font-sans font-medium px-2 py-0.5 rounded border transition-colors brand-text disabled:opacity-40"
                                                            style={{ borderColor: 'var(--brand-card-border)' }}
                                                        >
                                                            Adjust…
                                                        </button>
                                                    )}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            <div className="flex flex-col gap-2 pt-1">
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        disabled={busy || !row.is_active}
                                        title={!row.is_active ? 'Restore the line before adding amounts' : undefined}
                                        onClick={() => onAddValue(row.id)}
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-colors disabled:opacity-40 disabled:pointer-events-none brand-text"
                                        style={{ borderColor: 'var(--brand-card-border)', backgroundColor: 'var(--brand-interactive-hover-bg)' }}
                                    >
                                        <Plus className="w-3.5 h-3.5" />
                                        Add amount
                                    </button>
                                    <button
                                        type="button"
                                        disabled={busy}
                                        onClick={() => onEdit(row.id)}
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-colors brand-text"
                                        style={{ borderColor: 'var(--brand-card-border)', backgroundColor: 'var(--brand-interactive-hover-bg)' }}
                                    >
                                        <Pencil className="w-3.5 h-3.5" />
                                        Edit
                                    </button>
                                    {row.is_active ? (
                                        <button
                                            type="button"
                                            disabled={busy}
                                            onClick={() => onToggleActive(row.id, false)}
                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-colors brand-muted"
                                            style={{ borderColor: 'var(--brand-card-border)' }}
                                        >
                                            <EyeOff className="w-3.5 h-3.5" />
                                            Hide from P&amp;L
                                        </button>
                                    ) : (
                                        <button
                                            type="button"
                                            disabled={busy}
                                            onClick={() => onToggleActive(row.id, true)}
                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-colors brand-muted"
                                            style={{ borderColor: 'var(--brand-card-border)' }}
                                        >
                                            <Eye className="w-3.5 h-3.5" />
                                            Restore
                                        </button>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    disabled={busy || !row.is_active}
                                    onClick={() => void onDeactivateLine(row)}
                                    className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors w-full sm:w-auto sm:self-start brand-text brand-row-hover disabled:opacity-40 disabled:pointer-events-none"
                                    style={{
                                        borderColor: 'color-mix(in srgb, var(--brand-loss) 42%, var(--brand-card-border))',
                                        backgroundColor: 'color-mix(in srgb, var(--brand-loss) 10%, var(--brand-card-bg))',
                                    }}
                                    title="Hide this line from P&L reports; dated amounts are kept for history"
                                >
                                    <Ban className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--brand-loss)' }} aria-hidden />
                                    <span>Remove from reports</span>
                                </button>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function NewLineForm({
    accountId,
    shopId,
    busy,
    setBusy,
    setError,
    onDone,
}: {
    accountId: string;
    shopId: string;
    busy: boolean;
    setBusy: (v: boolean) => void;
    setError: (s: string | null) => void;
    onDone: (created: CustomPlLineItemDto) => Promise<void>;
}) {
    const [category, setCategory] = useState<CustomPlCategory>('expenses');
    const [name, setName] = useState('');
    const [sortOrder, setSortOrder] = useState('0');

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        const n = name.trim();
        if (!n) {
            setError('Name is required');
            return;
        }
        const so = parseInt(sortOrder, 10);
        setBusy(true);
        setError(null);
        try {
            const created = await createCustomPlLineItem(accountId, {
                shop_id: shopId,
                category,
                name: n,
                sort_order: Number.isFinite(so) ? so : 0,
            });
            setName('');
            setSortOrder('0');
            setCategory('expenses');
            await onDone(created);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Failed to create line');
        } finally {
            setBusy(false);
        }
    };

    return (
        <form onSubmit={submit} className="space-y-4 max-w-md">
            <div>
                <label className="block text-xs font-medium brand-muted mb-1.5">Category</label>
                <select
                    value={category}
                    disabled={busy}
                    onChange={e => setCategory(e.target.value as CustomPlCategory)}
                    className="w-full rounded-lg border px-3 py-2 text-sm brand-text bg-transparent outline-none focus:ring-2 focus:ring-offset-0 disabled:opacity-50"
                    style={{ borderColor: 'var(--brand-card-border)' }}
                >
                    {CUSTOM_PL_CATEGORY_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>
                            {opt.label}
                        </option>
                    ))}
                </select>
                <p className="text-[11px] brand-muted mt-1">{CUSTOM_PL_CATEGORY_OPTIONS.find(o => o.value === category)?.description}</p>
            </div>
            <div>
                <label className="block text-xs font-medium brand-muted mb-1.5">Line name</label>
                <input
                    value={name}
                    disabled={busy}
                    onChange={e => setName(e.target.value)}
                    placeholder="e.g. Warehouse rent"
                    className="w-full rounded-lg border px-3 py-2 text-sm brand-text bg-transparent outline-none focus:ring-2 disabled:opacity-50"
                    style={{ borderColor: 'var(--brand-card-border)' }}
                    maxLength={200}
                    autoFocus
                />
            </div>
            <div>
                <label className="block text-xs font-medium brand-muted mb-1.5">Sort order</label>
                <input
                    type="number"
                    value={sortOrder}
                    disabled={busy}
                    onChange={e => setSortOrder(e.target.value)}
                    className="w-full rounded-lg border px-3 py-2 text-sm brand-text bg-transparent outline-none focus:ring-2 disabled:opacity-50"
                    style={{ borderColor: 'var(--brand-card-border)' }}
                />
                <p className="text-[11px] brand-muted mt-1">Lower numbers appear first in lists.</p>
            </div>
            <div className="flex gap-2 pt-2">
                <button
                    type="submit"
                    disabled={busy}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40"
                    style={{ backgroundColor: 'var(--brand-primary)', color: 'var(--brand-on-primary, #fff)' }}
                >
                    {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                    Create line
                </button>
            </div>
        </form>
    );
}

function AddValueForm({
    accountId,
    line,
    busy,
    setBusy,
    setError,
    onDone,
}: {
    accountId: string;
    line: CustomPlModalLineRow;
    busy: boolean;
    setBusy: (v: boolean) => void;
    setError: (s: string | null) => void;
    onDone: (created: CustomPlValueDto, lineRow: CustomPlModalLineRow) => Promise<void>;
}) {
    const [amount, setAmount] = useState('');
    const [startDate, setStartDate] = useState('');
    const [hasEnd, setHasEnd] = useState(false);
    const [endDate, setEndDate] = useState('');

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        const amt = parseMoneyInput(amount);
        if (!Number.isFinite(amt)) {
            setError('Enter a valid amount');
            return;
        }
        if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
            setError('Choose a valid start date');
            return;
        }
        if (hasEnd) {
            if (!endDate || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
                setError('Choose a valid end date, or turn off “Set end date”');
                return;
            }
            if (endDate < startDate) {
                setError('End date must be on or after start date');
                return;
            }
        }
        setBusy(true);
        setError(null);
        try {
            const created = await appendCustomPlLineItemValue(accountId, line.id, {
                start_date: startDate,
                end_date: hasEnd ? endDate : null,
                amount: amt,
            });
            setAmount('');
            setStartDate('');
            setEndDate('');
            setHasEnd(false);
            await onDone(created, line);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Failed to save amount');
        } finally {
            setBusy(false);
        }
    };

    return (
        <form onSubmit={submit} className="space-y-4 max-w-md">
            <p className="text-sm brand-muted">
                Line: <span className="brand-text font-medium">{line.name}</span> ({categoryLabel(line.category)})
            </p>
            <div>
                <label className="block text-xs font-medium brand-muted mb-1.5">Amount</label>
                <input
                    type="text"
                    inputMode="decimal"
                    value={amount}
                    disabled={busy}
                    onChange={e => setAmount(e.target.value)}
                    placeholder="20000 or 20,000"
                    className="w-full rounded-lg border px-3 py-2 text-sm brand-text bg-transparent outline-none focus:ring-2 font-mono tabular-nums disabled:opacity-50"
                    style={{ borderColor: 'var(--brand-card-border)' }}
                    autoFocus
                />
                <p className="text-[11px] brand-muted mt-1">
                    Commas and $ are OK. Use negative numbers for credits or reversals.
                </p>
            </div>
            <div>
                <label className="block text-xs font-medium brand-muted mb-1.5">Start date (UTC)</label>
                <input
                    type="date"
                    value={startDate}
                    disabled={busy}
                    onChange={e => setStartDate(e.target.value)}
                    className="w-full rounded-lg border px-3 py-2 text-sm brand-text bg-transparent outline-none focus:ring-2 disabled:opacity-50"
                    style={{ borderColor: 'var(--brand-card-border)' }}
                />
            </div>
            <div className="flex items-center gap-2">
                <input
                    id="custom-pl-has-end"
                    type="checkbox"
                    checked={hasEnd}
                    disabled={busy}
                    onChange={e => setHasEnd(e.target.checked)}
                    className="rounded border-gray-500 disabled:opacity-50"
                />
                <label htmlFor="custom-pl-has-end" className="text-sm brand-text cursor-pointer">
                    Set end date (otherwise ongoing)
                </label>
            </div>
            {hasEnd && (
                <div>
                    <label className="block text-xs font-medium brand-muted mb-1.5">End date (UTC)</label>
                    <input
                        type="date"
                        value={endDate}
                        disabled={busy}
                        onChange={e => setEndDate(e.target.value)}
                        min={startDate || undefined}
                        className="w-full rounded-lg border px-3 py-2 text-sm brand-text bg-transparent outline-none focus:ring-2 disabled:opacity-50"
                        style={{ borderColor: 'var(--brand-card-border)' }}
                    />
                </div>
            )}
            <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40"
                style={{ backgroundColor: 'var(--brand-primary)', color: 'var(--brand-on-primary, #fff)' }}
            >
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                Save amount
            </button>
        </form>
    );
}

function EditLineForm({
    accountId,
    line,
    busy,
    setBusy,
    setError,
    onDone,
}: {
    accountId: string;
    line: CustomPlModalLineRow;
    busy: boolean;
    setBusy: (v: boolean) => void;
    setError: (s: string | null) => void;
    onDone: () => Promise<void>;
}) {
    const [name, setName] = useState(line.name);
    const [sortOrder, setSortOrder] = useState(String(line.sort_order));
    const [isActive, setIsActive] = useState(line.is_active);

    useEffect(() => {
        setName(line.name);
        setSortOrder(String(line.sort_order));
        setIsActive(line.is_active);
    }, [line.id, line.name, line.sort_order, line.is_active]);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        const n = name.trim();
        if (!n) {
            setError('Name is required');
            return;
        }
        const so = parseInt(sortOrder, 10);
        setBusy(true);
        setError(null);
        try {
            await updateCustomPlLineItem(accountId, line.id, {
                name: n,
                sort_order: Number.isFinite(so) ? so : 0,
                is_active: isActive,
            });
            await onDone();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Failed to update');
        } finally {
            setBusy(false);
        }
    };

    return (
        <form onSubmit={submit} className="space-y-4 max-w-md">
            <p className="text-xs brand-muted">
                Category: <span className="brand-text capitalize">{categoryLabel(line.category)}</span> (change by creating a new line)
            </p>
            <div>
                <label className="block text-xs font-medium brand-muted mb-1.5">Name</label>
                <input
                    value={name}
                    disabled={busy}
                    onChange={e => setName(e.target.value)}
                    className="w-full rounded-lg border px-3 py-2 text-sm brand-text bg-transparent outline-none focus:ring-2 disabled:opacity-50"
                    style={{ borderColor: 'var(--brand-card-border)' }}
                    maxLength={200}
                />
            </div>
            <div>
                <label className="block text-xs font-medium brand-muted mb-1.5">Sort order</label>
                <input
                    type="number"
                    value={sortOrder}
                    disabled={busy}
                    onChange={e => setSortOrder(e.target.value)}
                    className="w-full rounded-lg border px-3 py-2 text-sm brand-text bg-transparent outline-none focus:ring-2 disabled:opacity-50"
                    style={{ borderColor: 'var(--brand-card-border)' }}
                />
            </div>
            <div className="flex items-center gap-2">
                <input
                    id="custom-pl-edit-active"
                    type="checkbox"
                    checked={isActive}
                    disabled={busy}
                    onChange={e => setIsActive(e.target.checked)}
                    className="rounded border-gray-500 disabled:opacity-50"
                />
                <label htmlFor="custom-pl-edit-active" className="text-sm brand-text cursor-pointer">
                    Show on P&amp;L (active)
                </label>
            </div>
            <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40"
                style={{ backgroundColor: 'var(--brand-primary)', color: 'var(--brand-on-primary, #fff)' }}
            >
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                Save changes
            </button>
        </form>
    );
}

type AdjustMode = 'truncate' | 'split' | 'supersede';

function AdjustValueForm({
    accountId,
    line,
    segment,
    busy,
    setBusy,
    setError,
    onDone,
}: {
    accountId: string;
    line: CustomPlModalLineRow;
    segment: CustomPlModalLineRow['value_segments'][number];
    busy: boolean;
    setBusy: (v: boolean) => void;
    setError: (s: string | null) => void;
    onDone: (opts?: { skipRefresh?: boolean }) => Promise<void>;
}) {
    const [mode, setMode] = useState<AdjustMode>('truncate');
    const [truncateEnd, setTruncateEnd] = useState(segment.end_date || '');
    const [splitFrom, setSplitFrom] = useState('');
    const [splitAmount, setSplitAmount] = useState('');
    const [splitEnd, setSplitEnd] = useState('');
    const [supAmount, setSupAmount] = useState('');
    const [supStart, setSupStart] = useState('');
    const [supEnd, setSupEnd] = useState('');

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        const ymd = /^\d{4}-\d{2}-\d{2}$/;
        setBusy(true);
        try {
            if (mode === 'truncate') {
                if (!truncateEnd || !ymd.test(truncateEnd)) {
                    setError('Choose a valid end date (UTC)');
                    return;
                }
                if (truncateEnd < segment.start_date) {
                    setError('End date must be on or after the segment start');
                    return;
                }
                if (segment.end_date && truncateEnd > segment.end_date) {
                    setError('End date must be on or before the current segment end');
                    return;
                }
                await patchCustomPlLineItemValue(accountId, line.id, segment.id, { end_date: truncateEnd });
            } else if (mode === 'split') {
                if (!splitFrom || !ymd.test(splitFrom)) {
                    setError('Split requires a valid effective_from date');
                    return;
                }
                if (splitFrom <= segment.start_date) {
                    setError('effective_from must be after the segment start date');
                    return;
                }
                const amt = parseMoneyInput(splitAmount);
                if (!Number.isFinite(amt)) {
                    setError('Enter a valid amount for the new segment');
                    return;
                }
                if (splitEnd && (!ymd.test(splitEnd) || splitEnd < splitFrom)) {
                    setError('Optional split end date must be on or after effective_from');
                    return;
                }
                await patchCustomPlLineItemValue(accountId, line.id, segment.id, {
                    effective_from: splitFrom,
                    amount: amt,
                    end_date: splitEnd && ymd.test(splitEnd) ? splitEnd : undefined,
                });
            } else {
                const amt = parseMoneyInput(supAmount);
                if (!Number.isFinite(amt)) {
                    setError('Enter a valid supersede amount');
                    return;
                }
                if (!supStart || !ymd.test(supStart)) {
                    setError('Supersede requires a valid start_date');
                    return;
                }
                if (supEnd && (!ymd.test(supEnd) || supEnd < supStart)) {
                    setError('Optional end date must be on or after start_date');
                    return;
                }
                await patchCustomPlLineItemValue(accountId, line.id, segment.id, {
                    supersede: true,
                    amount: amt,
                    start_date: supStart,
                    end_date: supEnd && ymd.test(supEnd) ? supEnd : undefined,
                });
            }
            await onDone();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Update failed');
        } finally {
            setBusy(false);
        }
    };

    const continueWithoutChanges = async () => {
        setError(null);
        setBusy(true);
        try {
            await onDone({ skipRefresh: true });
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Could not return to list');
        } finally {
            setBusy(false);
        }
    };

    return (
        <form onSubmit={submit} className="space-y-4 max-w-lg">
            <p className="text-sm brand-muted">
                Line <span className="brand-text font-medium">{line.name}</span> — segment {segment.start_date}
                {segment.end_date ? ` → ${segment.end_date}` : ' → …'} ({fmtMoney(segment.amount)})
            </p>
            <p className="text-xs brand-muted leading-relaxed border-l-2 pl-3" style={{ borderColor: 'var(--brand-card-border)' }}>
                This amount is already saved. Truncate, split, or supersede only if you need to change how this period is represented; otherwise use{' '}
                <span className="brand-text font-medium">Continue without changes</span> below.
            </p>
            <div className="flex flex-wrap gap-2">
                {(['truncate', 'split', 'supersede'] as const).map(m => (
                    <button
                        key={m}
                        type="button"
                        disabled={busy}
                        onClick={() => {
                            setMode(m);
                            setError(null);
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                            mode === m ? 'brand-text' : 'brand-muted'
                        }`}
                        style={{
                            borderColor: 'var(--brand-card-border)',
                            backgroundColor: mode === m ? 'var(--brand-interactive-hover-bg)' : 'transparent',
                        }}
                    >
                        {m === 'truncate' && 'Truncate end'}
                        {m === 'split' && 'Split'}
                        {m === 'supersede' && 'Supersede'}
                    </button>
                ))}
            </div>

            {mode === 'truncate' && (
                <div>
                    <label className="block text-xs font-medium brand-muted mb-1.5">New end date (UTC)</label>
                    <input
                        type="date"
                        value={truncateEnd}
                        disabled={busy}
                        min={segment.start_date}
                        max={segment.end_date || undefined}
                        onChange={e => setTruncateEnd(e.target.value)}
                        className="w-full rounded-lg border px-3 py-2 text-sm brand-text bg-transparent outline-none focus:ring-2 disabled:opacity-50"
                        style={{ borderColor: 'var(--brand-card-border)' }}
                    />
                    <p className="text-[11px] brand-muted mt-1">Shortens this segment for reporting; must stay within the current date span.</p>
                </div>
            )}

            {mode === 'split' && (
                <div className="space-y-3">
                    <div>
                        <label className="block text-xs font-medium brand-muted mb-1.5">effective_from (UTC)</label>
                        <input
                            type="date"
                            value={splitFrom}
                            disabled={busy}
                            min={segment.start_date}
                            onChange={e => setSplitFrom(e.target.value)}
                            className="w-full rounded-lg border px-3 py-2 text-sm brand-text bg-transparent outline-none focus:ring-2 disabled:opacity-50"
                            style={{ borderColor: 'var(--brand-card-border)' }}
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-medium brand-muted mb-1.5">Amount for new tail segment</label>
                        <input
                            type="text"
                            inputMode="decimal"
                            value={splitAmount}
                            disabled={busy}
                            onChange={e => setSplitAmount(e.target.value)}
                            className="w-full rounded-lg border px-3 py-2 text-sm font-mono tabular-nums brand-text bg-transparent outline-none focus:ring-2 disabled:opacity-50"
                            style={{ borderColor: 'var(--brand-card-border)' }}
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-medium brand-muted mb-1.5">Optional end date for new segment</label>
                        <input
                            type="date"
                            value={splitEnd}
                            disabled={busy}
                            onChange={e => setSplitEnd(e.target.value)}
                            className="w-full rounded-lg border px-3 py-2 text-sm brand-text bg-transparent outline-none focus:ring-2 disabled:opacity-50"
                            style={{ borderColor: 'var(--brand-card-border)' }}
                        />
                    </div>
                    <p className="text-[11px] brand-muted">Creates a new value row from the chosen date; the prior segment is closed before that date.</p>
                </div>
            )}

            {mode === 'supersede' && (
                <div className="space-y-3">
                    <p className="text-[11px] brand-muted leading-relaxed">
                        Supersede retires this segment for reporting and inserts a replacement amount for the dates you specify.
                    </p>
                    <div>
                        <label className="block text-xs font-medium brand-muted mb-1.5">Replacement amount</label>
                        <input
                            type="text"
                            inputMode="decimal"
                            value={supAmount}
                            disabled={busy}
                            onChange={e => setSupAmount(e.target.value)}
                            className="w-full rounded-lg border px-3 py-2 text-sm font-mono tabular-nums brand-text bg-transparent outline-none focus:ring-2 disabled:opacity-50"
                            style={{ borderColor: 'var(--brand-card-border)' }}
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-medium brand-muted mb-1.5">start_date (UTC)</label>
                        <input
                            type="date"
                            value={supStart}
                            disabled={busy}
                            onChange={e => setSupStart(e.target.value)}
                            className="w-full rounded-lg border px-3 py-2 text-sm brand-text bg-transparent outline-none focus:ring-2 disabled:opacity-50"
                            style={{ borderColor: 'var(--brand-card-border)' }}
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-medium brand-muted mb-1.5">Optional end_date</label>
                        <input
                            type="date"
                            value={supEnd}
                            disabled={busy}
                            onChange={e => setSupEnd(e.target.value)}
                            className="w-full rounded-lg border px-3 py-2 text-sm brand-text bg-transparent outline-none focus:ring-2 disabled:opacity-50"
                            style={{ borderColor: 'var(--brand-card-border)' }}
                        />
                    </div>
                </div>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                    type="button"
                    disabled={busy}
                    onClick={() => void continueWithoutChanges()}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors disabled:opacity-40 brand-text brand-row-hover"
                    style={{ borderColor: 'var(--brand-card-border)', backgroundColor: 'var(--brand-interactive-hover-bg)' }}
                >
                    Continue without changes
                </button>
                <button
                    type="submit"
                    disabled={busy}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40"
                    style={{ backgroundColor: 'var(--brand-primary)', color: 'var(--brand-on-primary, #fff)' }}
                >
                    {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                    Apply
                </button>
            </div>
        </form>
    );
}
