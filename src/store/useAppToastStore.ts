import { create } from 'zustand';

export type AppToastKind = 'ok' | 'err';

export type AppToastItem = {
    id: string;
    kind: AppToastKind;
    message: string;
};

type AppToastState = {
    items: AppToastItem[];
    push: (kind: AppToastKind, message: string) => void;
    remove: (id: string) => void;
};

let toastSeq = 0;

export const useAppToastStore = create<AppToastState>((set) => ({
    items: [],
    push: (kind, message) => {
        const id = `app-toast-${Date.now()}-${toastSeq++}`;
        set((s) => ({ items: [...s.items, { id, kind, message }] }));
        window.setTimeout(() => {
            set((s) => ({ items: s.items.filter((i) => i.id !== id) }));
        }, 6500);
    },
    remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
}));

/** Fixed-layer toast above modals (portal to document.body). */
export function showAppToast(message: string, kind: AppToastKind = 'ok') {
    useAppToastStore.getState().push(kind, message);
}
