import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import { useAppToastStore } from '../store/useAppToastStore';

/** Above typical modal overlays (z-[70]–z-[100]); portal avoids parent stacking contexts. */
const TOAST_Z = 100_050;

export function AppToastHost() {
    const [mounted, setMounted] = useState(false);
    const items = useAppToastStore((s) => s.items);
    const remove = useAppToastStore((s) => s.remove);

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted || typeof document === 'undefined') return null;

    return createPortal(
        <div
            className="fixed top-4 right-4 flex flex-col gap-2 w-[min(420px,calc(100vw-2rem))] pointer-events-none p-0 m-0"
            style={{ zIndex: TOAST_Z }}
            aria-live="polite"
        >
            {items.map((t) => (
                <div
                    key={t.id}
                    className={`pointer-events-auto rounded-xl px-4 py-3 shadow-2xl backdrop-blur-md flex items-start gap-3 animate-in slide-in-from-right fade-in duration-200 ${
                        t.kind === 'ok'
                            ? 'brand-toast-success'
                            : 'brand-toast-error'
                    }`}
                    style={{ color: '#F8FAFC' }}
                >
                    {t.kind === 'ok' ? (
                        <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'var(--brand-toast-success-icon)' }} aria-hidden />
                    ) : (
                        <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'var(--brand-toast-error-icon)' }} aria-hidden />
                    )}
                    <p className="text-sm font-medium flex-1 leading-snug text-white/95">{t.message}</p>
                    <button
                        type="button"
                        onClick={() => remove(t.id)}
                        className="shrink-0 p-1 rounded-lg text-white/80 hover:text-white hover:bg-white/15"
                        aria-label="Dismiss"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            ))}
        </div>,
        document.body,
    );
}
