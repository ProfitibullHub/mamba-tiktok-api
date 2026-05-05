import { useState, useRef, useEffect } from 'react';
import { HexAlphaColorPicker, HexColorInput } from 'react-colorful';
import { ChevronDown } from 'lucide-react';
import { normalizeHexAlpha } from '../../lib/colorUtils';

type BrandColorPopoverProps = {
    label: string;
    value: string;
    onChange: (hex: string) => void;
    disabled?: boolean;
    presets?: string[];
};

const DEFAULT_PRESETS = ['#ec4899', '#6366f1', '#22c55e', '#0ea5e9', '#f97316', '#a855f7', '#111827', '#ffffff'];

/**
 * Professional color control: react-colorful hue/sat/alpha panel + optional quick swatches.
 * Always emits lowercase #rrggbbaa or #rrggbb for reliable server validation.
 */
export function BrandColorPopover({ label, value, onChange, disabled, presets = DEFAULT_PRESETS }: BrandColorPopoverProps) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const safe = normalizeHexAlpha(value);

    useEffect(() => {
        if (!open) return;
        const onDoc = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', onDoc);
        return () => document.removeEventListener('mousedown', onDoc);
    }, [open]);

    return (
        <div className="relative" ref={rootRef}>
            <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">{label}</span>
            <button
                type="button"
                disabled={disabled}
                onClick={() => !disabled && setOpen((o) => !o)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-white/10 bg-gray-950/50 text-left transition-colors hover:border-pink-500/40 focus:outline-none focus:ring-2 focus:ring-pink-500/30 disabled:opacity-50 disabled:pointer-events-none"
            >
                <span
                    className="h-9 w-9 rounded-lg border border-white/15 shadow-inner shrink-0 ring-1 ring-black/20"
                    style={{ backgroundColor: safe }}
                    aria-hidden
                />
                <span className="flex-1 font-mono text-sm text-gray-200">{safe}</span>
                <ChevronDown className={`w-4 h-4 text-gray-500 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>

            {open && !disabled && (
                <div
                    className="absolute z-[80] left-0 mt-2 p-4 rounded-2xl border border-white/10 bg-gray-950 shadow-2xl shadow-black/50 min-w-[14.5rem]"
                    role="dialog"
                    aria-label={`${label} color picker`}
                >
                    <div className="brand-color-picker">
                        <HexAlphaColorPicker color={safe} onChange={(c) => onChange(c.toLowerCase())} />
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-2 bg-gray-900/50 p-1.5 rounded-lg border border-white/5">
                        <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider pl-1">Hex</span>
                        <HexColorInput
                            color={safe}
                            onChange={(c) => onChange(c.toLowerCase())}
                            prefixed
                            alpha
                            className="bg-transparent text-sm font-mono text-gray-200 border border-transparent w-[100px] hover:bg-white/5 focus:bg-gray-950 focus:border-pink-500/30 rounded px-2 py-1 outline-none transition-all"
                        />
                    </div>
                    <p className="text-[10px] text-gray-500 mt-3 mb-2 uppercase tracking-wider">Presets</p>
                    <div className="flex flex-wrap gap-2">
                        {presets.map((p) => {
                            const hex = normalizeHexAlpha(p);
                            return (
                                <button
                                    key={hex}
                                    type="button"
                                    title={hex}
                                    onClick={() => onChange(hex)}
                                    className={`h-7 w-7 rounded-md border-2 transition-transform hover:scale-110 ${
                                        hex === safe ? 'border-white ring-2 ring-pink-500/50' : 'border-white/10'
                                    }`}
                                    style={{ backgroundColor: hex }}
                                />
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
