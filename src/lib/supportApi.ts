import { apiFetch } from './apiClient';

/** Must match server `bug-report-attachments.ts` (Vercel-safe total request size). */
export const BUG_REPORT_MAX_IMAGE_FILES = 2;
export const BUG_REPORT_MAX_IMAGE_BYTES = 1024 * 1024;

export type BugReportContext = {
    accountId?: string;
    shopId?: string;
    shopName?: string;
};

export type BugReportImageAttachment = {
    filename: string;
    contentBase64: string;
};

export type SubmitBugReportPayload = BugReportContext & {
    title: string;
    description: string;
    route?: string;
    attachments?: BugReportImageAttachment[];
};

export type SubmitBugReportSuccess = {
    /** Database row id for `/support/:submissionId`; null if insert failed after email send. */
    submissionId: string | null;
    externalId: string;
    identifier: string | null;
    url: string | null;
    status: string | null;
    /** When true, server may refresh vendor status on list GET (TTL). */
    statusVisibilityEnabled: boolean;
};

export async function submitBugReport(
    payload: SubmitBugReportPayload,
): Promise<{ ok: true; data: SubmitBugReportSuccess } | { ok: false; error: string; status?: number }> {
    const res = await apiFetch('/api/support/bug-reports', {
        method: 'POST',
        body: JSON.stringify({
            title: payload.title,
            description: payload.description,
            route: payload.route,
            accountId: payload.accountId,
            shopId: payload.shopId,
            shopName: payload.shopName,
            userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
            attachments: payload.attachments?.length ? payload.attachments : undefined,
        }),
    });
    const body = (await res.json().catch(() => ({}))) as { success?: boolean; data?: SubmitBugReportSuccess; error?: string };
    if (!res.ok || !body.success || !body.data) {
        return {
            ok: false,
            error: typeof body.error === 'string' ? body.error : `Request failed (${res.status})`,
            status: res.status,
        };
    }
    return { ok: true, data: body.data };
}

export type MyBugReportItem = {
    id: string;
    title: string;
    vendor: string;
    externalId: string;
    identifier: string | null;
    url: string | null;
    status: string | null;
    statusRefreshedAt: string | null;
    createdAt: string;
    descriptionPreview: string | null;
    shopId: string | null;
    shopName: string | null;
    accountId: string | null;
};

export type BugReportDetailItem = {
    id: string;
    title: string;
    vendor: string;
    externalId: string;
    identifier: string | null;
    url: string | null;
    status: string | null;
    statusRefreshedAt: string | null;
    createdAt: string;
    description: string | null;
    shopId: string | null;
    shopName: string | null;
    accountId: string | null;
    tenantId: string | null;
};

export async function fetchMyBugReports(): Promise<
    { ok: true; items: MyBugReportItem[]; statusRefreshEnabled: boolean } | { ok: false; message: string }
> {
    const res = await apiFetch('/api/support/bug-reports', { method: 'GET' });
    const body = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        data?: { statusVisibilityEnabled?: boolean; items?: MyBugReportItem[] };
        error?: string;
    };
    if (!res.ok || !body.success || !body.data) {
        return {
            ok: false,
            message: typeof body.error === 'string' ? body.error : `Request failed (${res.status})`,
        };
    }
    return {
        ok: true,
        items: body.data.items ?? [],
        statusRefreshEnabled: body.data.statusVisibilityEnabled === true,
    };
}

export async function fetchBugReportDetail(
    submissionId: string,
): Promise<{ ok: true; item: BugReportDetailItem } | { ok: false; message: string; status?: number }> {
    const res = await apiFetch(`/api/support/bug-reports/${encodeURIComponent(submissionId)}`, { method: 'GET' });
    const body = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        data?: { item?: BugReportDetailItem };
        error?: string;
    };
    if (!res.ok || !body.success || !body.data?.item) {
        return {
            ok: false,
            message: typeof body.error === 'string' ? body.error : `Request failed (${res.status})`,
            status: res.status,
        };
    }
    return { ok: true, item: body.data.item };
}

function extensionAllowed(name: string): boolean {
    const lower = name.toLowerCase();
    const dot = lower.lastIndexOf('.');
    if (dot < 0) return false;
    return ['.png', '.jpg', '.jpeg', '.jfif', '.gif', '.webp'].includes(lower.slice(dot));
}

function isHeicType(type: string): boolean {
    const t = type.toLowerCase();
    return t === 'image/heic' || t === 'image/heif';
}

/** Windows / some browsers omit `file.type`; allow when extension matches. */
function bugReportImageFileOk(file: File): { ok: true } | { ok: false; message: string } {
    const type = (file.type || '').trim().toLowerCase();
    if (isHeicType(type)) {
        return {
            ok: false,
            message: 'HEIC photos are not supported here. Export as JPEG or PNG and try again.',
        };
    }
    if (type && type !== 'application/octet-stream' && !type.startsWith('image/')) {
        return { ok: false, message: 'Only image files are allowed' };
    }
    const extOk = extensionAllowed(file.name);
    const unknownMime = !type || type === 'application/octet-stream';
    if (unknownMime) {
        if (extOk) return { ok: true };
        return { ok: false, message: 'Use PNG, JPEG, GIF, WebP, or JFIF' };
    }
    return { ok: true };
}

/** Filename safe for server + guaranteed allowed extension when OS omits it. */
function attachmentFilenameForBugReport(file: File): string {
    let base = file.name.replace(/[^\w.\-]+/g, '_').replace(/^\.+/, '').slice(0, 120);
    if (extensionAllowed(base)) {
        return base.length > 0 ? base : 'screenshot.png';
    }
    const t = (file.type || '').trim().toLowerCase();
    let ext = '.png';
    if (t.includes('jpeg') || t.includes('jpg') || t.includes('jfif') || t.includes('pjpeg')) ext = '.jpg';
    else if (t.includes('png')) ext = '.png';
    else if (t.includes('gif')) ext = '.gif';
    else if (t.includes('webp')) ext = '.webp';
    const stem = base.replace(/\.[^.]+$/, '').replace(/^\.+$/, '') || 'screenshot';
    return `${stem}${ext}`.slice(0, 120);
}

/** Read a single image as base64 for bug-report JSON (PNG, JPEG, GIF, WebP only). */
export function readImageFileAsAttachment(file: File): Promise<BugReportImageAttachment> {
    return new Promise((resolve, reject) => {
        const gate = bugReportImageFileOk(file);
        if (!gate.ok) {
            reject(new Error(gate.message));
            return;
        }
        if (file.size > BUG_REPORT_MAX_IMAGE_BYTES) {
            reject(new Error(`Each image must be at most ${Math.floor(BUG_REPORT_MAX_IMAGE_BYTES / (1024 * 1024))} MB`));
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            const dataUrl = reader.result as string;
            const comma = dataUrl.indexOf(',');
            if (comma < 0) {
                reject(new Error('Could not read file'));
                return;
            }
            resolve({
                filename: attachmentFilenameForBugReport(file),
                contentBase64: dataUrl.slice(comma + 1),
            });
        };
        reader.onerror = () => reject(new Error('Could not read file'));
        reader.readAsDataURL(file);
    });
}
