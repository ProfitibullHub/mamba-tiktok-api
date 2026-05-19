import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export type MeasuredChartSize = { width: number; height: number };

/**
 * Measures a fixed-height box and exposes pixel width/height so Recharts charts can use numeric
 * dimensions instead of ResponsiveContainer (which often logs width/height -1 in flex layouts,
 * hidden panels, or during concurrent render / subscription-driven updates).
 */
export function MeasuredChartHost({
    heightPx,
    className = '',
    children,
}: {
    heightPx: number;
    className?: string;
    children: (size: MeasuredChartSize) => ReactNode;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState<MeasuredChartSize | null>(null);

    useLayoutEffect(() => {
        const el = ref.current;
        if (!el || typeof ResizeObserver === 'undefined') return;

        const read = () => {
            const r = el.getBoundingClientRect();
            const w = Math.floor(r.width);
            const h = Math.floor(r.height);
            if (w > 0 && h > 0) {
                setSize((prev) =>
                    prev?.width === w && prev?.height === h ? prev : { width: w, height: h }
                );
            }
        };

        read();
        const ro = new ResizeObserver(read);
        ro.observe(el);
        window.addEventListener('resize', read);
        return () => {
            ro.disconnect();
            window.removeEventListener('resize', read);
        };
    }, [heightPx]);

    return (
        <div
            ref={ref}
            className={`w-full min-w-0 shrink-0 ${className}`}
            style={{ height: heightPx, minHeight: heightPx }}
        >
            {size ? children(size) : null}
        </div>
    );
}
