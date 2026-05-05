/**
 * Transactional HTML email via LeadConnector / GoHighLevel API v2 (Private Integration Token).
 * @returns delivered — false when GOHIGHLEVEL_PIT or GOHIGHLEVEL_LOCATION_ID is missing (logged only; no mail sent).
 */

const GHL_BASE = 'https://services.leadconnectorhq.com';
const VERSION_CONTACTS = '2021-07-28';
const VERSION_CONVERSATIONS = '2021-04-15';
/** HighLevel caps per uploaded file / send batch; see Conversations upload docs. */
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export type SendHtmlEmailOptions = {
    /** Overrides default from (REPORTS_FROM_EMAIL → INVITE_FROM_EMAIL → noreply@mamba.app). */
    from?: string;
    /**
     * When `from` resolves to a bare address (no `Name <email>`), build `Name <email>` for LeadConnector.
     * Inbox clients often show only the local part for bare addresses (e.g. "noreply").
     */
    fromDisplayName?: string;
    /** Optional attachments (decoded to binary and uploaded to GHL — max 5 MB each). */
    attachments?: Array<{
        filename: string;
        contentBase64: string;
    }>;
};

async function sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

function parseGhlError(status: number, raw: string): string {
    let detail = raw;
    try {
        const j = JSON.parse(raw) as { message?: string; meta?: unknown };
        if (j?.message) detail = String(j.message);
    } catch {
        /* keep raw */
    }
    return `LeadConnector API error (${status}): ${detail || 'unknown'}`;
}

function loadGhlCredentials(): { pit: string; locationId: string } | null {
    const pit = (process.env.GOHIGHLEVEL_PIT ?? '').trim();
    const locationId = (process.env.GOHIGHLEVEL_LOCATION_ID ?? '').trim();
    if (!pit || !locationId) return null;
    return { pit, locationId };
}

function sanitizeFromDisplayName(name: string): string {
    const t = name.replace(/[\r\n<>"]/g, ' ').replace(/\s+/g, ' ').trim();
    return t.slice(0, 100) || 'Mamba';
}

/** Pull `addr@host` from `addr@host` or `Name <addr@host>`. */
function extractEmailAddress(fromField: string): string {
    const t = fromField.trim();
    const lastLt = t.lastIndexOf('<');
    if (lastLt >= 0 && t.endsWith('>')) {
        return t.slice(lastLt + 1, -1).trim();
    }
    return t;
}

/**
 * LeadConnector `emailFrom` accepts a full RFC5322-style `Display Name <addr@domain>` string.
 * When `fromDisplayName` is set (e.g. agency whitelabel), it overrides any existing display
 * name so misconfigured `email_sender_name` (e.g. "noreply") does not appear in the inbox.
 */
function formatEmailFromHeader(resolvedAddress: string, fromDisplayName?: string): string {
    const trimmed = resolvedAddress.trim();
    const hint = fromDisplayName?.trim();
    if (hint) {
        const email = extractEmailAddress(trimmed);
        if (email.includes('@')) {
            return `${sanitizeFromDisplayName(hint)} <${email}>`;
        }
    }
    if (trimmed.includes('<') && trimmed.includes('>')) {
        return trimmed;
    }
    const display = sanitizeFromDisplayName(
        (process.env.REPORTS_FROM_DISPLAY_NAME || 'Mamba').trim()
    );
    const email = extractEmailAddress(trimmed);
    return `${display} <${email.includes('@') ? email : trimmed}>`;
}

async function upsertContact(
    pit: string,
    locationId: string,
    email: string
): Promise<string> {
    const body = {
        locationId,
        email,
        firstName: 'Mamba',
        lastName: 'User',
        source: 'Mamba transactional email',
    };
    const resp = await fetch(`${GHL_BASE}/contacts/upsert`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${pit}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Version: VERSION_CONTACTS,
        },
        body: JSON.stringify(body),
    });
    const raw = await resp.text().catch(() => '');
    if (!resp.ok) {
        throw new Error(parseGhlError(resp.status, raw));
    }
    try {
        const j = JSON.parse(raw) as { contact?: { id?: string }; id?: string };
        const id = j.contact?.id ?? j.id;
        if (!id || typeof id !== 'string') {
            throw new Error('LeadConnector upsert returned no contact id');
        }
        return id;
    } catch (e: unknown) {
        if (e instanceof Error && e.message.startsWith('LeadConnector')) throw e;
        throw new Error('LeadConnector upsert: invalid JSON response');
    }
}

function attachmentUrlsFromUploadPayload(payload: unknown): string[] {
    const root = payload as Record<string, unknown> | null;
    if (!root || typeof root !== 'object') return [];

    const collect = (u: unknown): string[] => {
        if (!u) return [];
        if (typeof u === 'string') return [u];
        if (Array.isArray(u)) return u.flatMap(collect);
        if (typeof u === 'object' && 'url' in u && typeof (u as { url: unknown }).url === 'string') {
            return [(u as { url: string }).url];
        }
        if (typeof u === 'object' && !Array.isArray(u)) {
            return Object.values(u).flatMap(collect);
        }
        return [];
    };

    const uploadedFiles = root.uploadedFiles ?? root.urls ?? root.data;
    return collect(uploadedFiles);
}

async function uploadAttachment(
    pit: string,
    locationId: string,
    contactId: string,
    filename: string,
    buffer: Buffer
): Promise<string> {
    if (buffer.length > MAX_ATTACHMENT_BYTES) {
        throw new Error(
            `LeadConnector attachment exceeds ${MAX_ATTACHMENT_BYTES} bytes (${filename}); reduce export size`
        );
    }

    const blob = new Blob([buffer], { type: 'application/octet-stream' });
    const form = new FormData();
    form.set('contactId', contactId);
    form.set('locationId', locationId);
    form.set('fileAttachment', blob, filename);

    const resp = await fetch(`${GHL_BASE}/conversations/messages/upload`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${pit}`,
            Accept: 'application/json',
            Version: VERSION_CONVERSATIONS,
        },
        body: form,
    });
    const raw = await resp.text().catch(() => '');
    if (!resp.ok) {
        throw new Error(parseGhlError(resp.status, raw));
    }

    try {
        const j = JSON.parse(raw) as unknown;
        const urls = attachmentUrlsFromUploadPayload(j);
        if (urls.length === 0) {
            throw new Error('LeadConnector upload returned no attachment URLs');
        }
        return urls[0] as string;
    } catch (e: unknown) {
        if (e instanceof Error && e.message.startsWith('LeadConnector')) throw e;
        throw new Error('LeadConnector upload: invalid JSON response');
    }
}

function truncatePlainFromHtml(html: string): string {
    const stripped = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    return stripped.slice(0, 16000);
}

async function sendGhlConversationEmail(params: {
    pit: string;
    contactId: string;
    toEmail: string;
    emailFrom: string;
    subject: string;
    html: string;
    attachmentUrls: string[];
}): Promise<void> {
    const body: Record<string, unknown> = {
        type: 'Email',
        contactId: params.contactId,
        emailTo: params.toEmail,
        emailFrom: params.emailFrom,
        subject: params.subject,
        html: params.html,
        message: truncatePlainFromHtml(params.html),
    };
    if (params.attachmentUrls.length > 0) {
        body.attachments = params.attachmentUrls;
    }

    const resp = await fetch(`${GHL_BASE}/conversations/messages`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${params.pit}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Version: VERSION_CONVERSATIONS,
        },
        body: JSON.stringify(body),
    });
    const raw = await resp.text().catch(() => '');
    if (!resp.ok) {
        throw new Error(parseGhlError(resp.status, raw));
    }
}

function isTransientSendFailure(err: unknown): boolean {
    if (!(err instanceof Error)) return true;
    const msg = err.message;
    const m = /LeadConnector API error \((\d+)\)/.exec(msg);
    if (m) {
        const status = Number(m[1]);
        /** Retry rate limits + server errors only — not 400/413/permission failures */
        return status >= 500 || status === 429;
    }
    /** Parsing / attachment limits / logical errors prefixed with LeadConnector — do not retry */
    if (/\bLeadConnector\b/.test(msg)) return false;
    /** Likely fetch/network — retry once */
    return true;
}

async function executeSendViaGoHighLevel(
    auth: { pit: string; locationId: string },
    toEmail: string,
    subject: string,
    html: string,
    options?: SendHtmlEmailOptions
): Promise<void> {
    const { pit, locationId } = auth;
    const defaultFrom =
        process.env.REPORTS_FROM_EMAIL || process.env.INVITE_FROM_EMAIL || 'noreply@mamba.app';
    const fromEmail = formatEmailFromHeader(options?.from ?? defaultFrom, options?.fromDisplayName);

    const contactId = await upsertContact(pit, locationId, toEmail.trim().toLowerCase());

    const rawAttachments = (options?.attachments || []).filter(
        (a) => a.filename && a.contentBase64
    );
    if (rawAttachments.length > 5) {
        throw new Error('LeadConnector allows at most 5 attachments per message');
    }

    const attachmentUrls: string[] = [];
    for (const att of rawAttachments) {
        const buf = Buffer.from(att.contentBase64, 'base64');
        const url = await uploadAttachment(pit, locationId, contactId, att.filename, buf);
        attachmentUrls.push(url);
    }

    await sendGhlConversationEmail({
        pit,
        contactId,
        toEmail: toEmail.trim(),
        emailFrom: fromEmail,
        subject,
        html,
        attachmentUrls,
    });
}

export async function sendHtmlEmail(
    toEmail: string,
    subject: string,
    html: string,
    options?: SendHtmlEmailOptions
): Promise<{ delivered: boolean }> {
    const auth = loadGhlCredentials();
    if (!auth) {
        console.warn('[email] GOHIGHLEVEL_PIT or GOHIGHLEVEL_LOCATION_ID not set — email not sent. To:', toEmail, 'Subject:', subject);
        return { delivered: false };
    }

    try {
        try {
            await executeSendViaGoHighLevel(auth, toEmail, subject, html, options);
        } catch (firstErr) {
            if (!isTransientSendFailure(firstErr)) throw firstErr;
            await sleep(800);
            await executeSendViaGoHighLevel(auth, toEmail, subject, html, options);
            console.warn(
                '[email] send retry succeeded after initial failure:',
                (firstErr as Error)?.message
            );
        }
        return { delivered: true };
    } catch (e: unknown) {
        console.error('[email] LeadConnector send failed:', e instanceof Error ? e.message : e);
        throw e;
    }
}
