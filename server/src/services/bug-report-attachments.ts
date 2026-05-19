import { Buffer } from 'node:buffer';

/** Keep total JSON body under typical serverless limits (e.g. Vercel ~4.5 MB). */
export const BUG_REPORT_MAX_ATTACHMENTS = 2;
export const BUG_REPORT_MAX_BYTES_PER_FILE = 1024 * 1024; // 1 MiB raw per image after decode

export type BugReportAttachment = {
    filename: string;
    contentBase64: string;
};

function looksLikeImage(buf: Buffer): boolean {
    if (buf.length < 12) return false;
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true;
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return true;
    if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.length >= 12 && buf.toString('ascii', 8, 12) === 'WEBP') return true;
    return false;
}

function sanitizeFilename(name: unknown): string {
    const raw = typeof name === 'string' ? name.trim() : '';
    const base = raw.replace(/[^\w.\-]+/g, '_').replace(/^\.+/, '').slice(0, 120);
    return base.length > 0 ? base : 'screenshot.png';
}

const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.jfif', '.gif', '.webp']);

function extensionOk(filename: string): boolean {
    const lower = filename.toLowerCase();
    const dot = lower.lastIndexOf('.');
    if (dot < 0) return false;
    return ALLOWED_EXT.has(lower.slice(dot));
}

/** Parse JSON `attachments` from bug-report body; returns `{ error }` or `{ attachments }`. */
export function parseBugReportAttachments(body: Record<string, unknown>):
    | { ok: true; attachments: BugReportAttachment[] }
    | { ok: false; error: string } {
    const raw = body.attachments;
    if (raw == null || raw === undefined) {
        return { ok: true, attachments: [] };
    }
    if (!Array.isArray(raw)) {
        return { ok: false, error: 'attachments must be an array when provided' };
    }
    if (raw.length > BUG_REPORT_MAX_ATTACHMENTS) {
        return {
            ok: false,
            error: `At most ${BUG_REPORT_MAX_ATTACHMENTS} images may be attached (server limit)`,
        };
    }

    const out: BugReportAttachment[] = [];

    for (let i = 0; i < raw.length; i++) {
        const item = raw[i];
        if (!item || typeof item !== 'object') {
            return { ok: false, error: 'Each attachment must be an object with filename and contentBase64' };
        }
        const rec = item as Record<string, unknown>;
        const filename = sanitizeFilename(rec.filename);
        if (!extensionOk(filename)) {
            return {
                ok: false,
                error: 'Only PNG, JPEG, GIF, WebP, and JFIF images are allowed',
            };
        }
        const b64 = typeof rec.contentBase64 === 'string' ? rec.contentBase64.trim() : '';
        if (!b64) {
            return { ok: false, error: 'Each attachment needs a non-empty contentBase64 payload' };
        }

        let buf: Buffer;
        try {
            buf = Buffer.from(b64, 'base64');
        } catch {
            return { ok: false, error: 'Invalid base64 in attachment' };
        }

        if (buf.length > BUG_REPORT_MAX_BYTES_PER_FILE) {
            return {
                ok: false,
                error: `Each image must be at most ${Math.floor(BUG_REPORT_MAX_BYTES_PER_FILE / (1024 * 1024))} MB`,
            };
        }
        if (buf.length === 0 || !looksLikeImage(buf)) {
            return { ok: false, error: 'Attachment is not a recognized image file' };
        }

        out.push({ filename, contentBase64: b64 });
    }

    return { ok: true, attachments: out };
}
