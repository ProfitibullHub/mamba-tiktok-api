import { Link } from 'react-router-dom';
import { ShieldOff, Store } from 'lucide-react';

type Props = {
    /** Shown for support; avoid implying whether the shop exists in the system */
    attemptedLabel?: string;
};

/**
 * Full-screen gate when a signed-in user opens a shop URL they are not allowed to use.
 * Keeps the shop shell (sidebar, data hooks) from mounting.
 */
export function UnauthorizedShopAccess({ attemptedLabel }: Props) {
    return (
        <div className="flex min-h-screen items-center justify-center bg-gray-900 px-4">
            <div className="w-full max-w-md rounded-2xl border border-white/10 bg-gray-950/80 p-8 text-center shadow-xl backdrop-blur-sm">
                <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-rose-500/15 ring-1 ring-rose-500/30">
                    <ShieldOff className="h-8 w-8 text-rose-400" strokeWidth={1.75} />
                </div>
                <h1 className="text-xl font-semibold tracking-tight text-white">Access not allowed</h1>
                <p className="mt-3 text-sm leading-relaxed text-gray-400">
                    Your account does not have permission to open this shop in Mamba. If you believe this is a mistake,
                    contact your agency or workspace administrator.
                </p>
                {attemptedLabel ? (
                    <p className="mt-4 rounded-lg bg-white/5 px-3 py-2 font-mono text-xs text-gray-500">
                        Requested: <span className="text-gray-300">{attemptedLabel}</span>
                    </p>
                ) : null}
                <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
                    <Link
                        to="/"
                        replace
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-pink-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-pink-500"
                    >
                        <Store className="h-4 w-4" />
                        Back to console
                    </Link>
                </div>
            </div>
        </div>
    );
}
