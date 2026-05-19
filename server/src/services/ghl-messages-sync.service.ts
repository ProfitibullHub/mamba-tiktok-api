/**
 * Pull email messages for a GHL conversation using Private Integration Token only
 * (no Marketplace app / webhook required).
 */

import { supabase } from '../config/supabase.js';
import { getGoHighLevelCredentials } from './email.js';
import {
    htmlToPlainSnippet,
    notifyAgencyOfMessagingActivity,
    parseEmailAddress,
    resolveAgencyInboxEmail,
} from './messaging.service.js';

const GHL_BASE = 'https://services.leadconnectorhq.com';
/** Matches outbound sends in email.ts */
const VERSION_CONVERSATIONS = '2021-04-15';
const GHL_MESSAGES_PAGE_LIMIT = 100;
const GHL_MESSAGES_MAX_PAGES = 30;

function asMessageRowArray(x: unknown): Record<string, unknown>[] {
    if (!Array.isArray(x)) return [];
    return x.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object');
}

function extractRowsFromObject(o: Record<string, unknown>): Record<string, unknown>[] {
    if (Array.isArray(o.messages)) return asMessageRowArray(o.messages);

    const wrapped = o.messages;
    if (wrapped && typeof wrapped === 'object' && !Array.isArray(wrapped)) {
        const w = wrapped as Record<string, unknown>;
        if (Array.isArray(w.messages)) return asMessageRowArray(w.messages);
    }

    if (Array.isArray(o.items)) return asMessageRowArray(o.items);
    if (Array.isArray(o.messageList)) return asMessageRowArray(o.messageList);
    if (Array.isArray(o.data)) return asMessageRowArray(o.data);
    if (Array.isArray(o.results)) return asMessageRowArray(o.results);
    return [];
}

/**
 * LeadConnector returns list payloads like:
 * `{ "messages": { "lastMessageId": "…", "nextPage": true, "messages": [ … ] } }`
 * — not a bare array on `messages`. Some tenants also wrap under `data`, or return the inner object only.
 */
function extractMessageRowsFromListPayload(payload: unknown): Record<string, unknown>[] {
    if (!payload || typeof payload !== 'object') return [];
    if (Array.isArray(payload)) return asMessageRowArray(payload);

    const o = payload as Record<string, unknown>;
    const direct = extractRowsFromObject(o);
    if (direct.length > 0) return direct;

    const data = o.data;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
        const fromData = extractRowsFromObject(data as Record<string, unknown>);
        if (fromData.length > 0) return fromData;
    }

    const result = o.result;
    if (result && typeof result === 'object' && !Array.isArray(result)) {
        return extractMessageRowsFromListPayload(result);
    }

    return [];
}

function coerceNextPageFlag(v: unknown): boolean {
    if (v === true || v === 1) return true;
    if (typeof v === 'string' && ['true', '1', 'yes'].includes(v.toLowerCase().trim())) return true;
    return false;
}

function pickMessageCursorId(w: Record<string, unknown>): string | null {
    for (const key of ['lastMessageId', 'last_message_id', 'endMessageId'] as const) {
        const x = w[key];
        if (typeof x === 'string' && x.trim().length > 0) return x.trim();
        if (typeof x === 'number' && Number.isFinite(x)) return String(x);
    }
    return null;
}

function paginationFromMessagesWrapper(wrapped: unknown): { nextPage: boolean; lastMessageId: string | null } {
    if (!wrapped || typeof wrapped !== 'object' || Array.isArray(wrapped)) {
        return { nextPage: false, lastMessageId: null };
    }
    const w = wrapped as Record<string, unknown>;
    const nextPage = coerceNextPageFlag(w.nextPage);
    return { nextPage, lastMessageId: pickMessageCursorId(w) };
}

function extractListPagination(payload: unknown): { nextPage: boolean; lastMessageId: string | null } {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return { nextPage: false, lastMessageId: null };
    }
    const o = payload as Record<string, unknown>;

    const fromRoot = paginationFromMessagesWrapper(o.messages);
    if (fromRoot.nextPage || fromRoot.lastMessageId) return fromRoot;

    const data = o.data;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
        const inner = paginationFromMessagesWrapper((data as Record<string, unknown>).messages);
        if (inner.nextPage || inner.lastMessageId) return inner;
    }

    const result = o.result;
    if (result && typeof result === 'object' && !Array.isArray(result)) {
        return extractListPagination(result);
    }

    return { nextPage: false, lastMessageId: null };
}

async function bestPayloadFromMessageListUrls(
    urls: string[],
    headers: Record<string, string>,
): Promise<{ payload: unknown | null; rowCount: number }> {
    let pagePayload: unknown = null;
    let bestRowCount = -1;
    for (const url of urls) {
        const resp = await fetch(url, { headers });
        const raw = await resp.text().catch(() => '');
        if (!resp.ok) {
            console.warn(
                '[ghl-sync] messages fetch HTTP',
                resp.status,
                url.split('?')[0],
                raw.slice(0, 180),
            );
            continue;
        }
        try {
            const parsed = JSON.parse(raw) as unknown;
            const n = extractMessageRowsFromListPayload(parsed).length;
            if (n > bestRowCount) {
                bestRowCount = n;
                pagePayload = parsed;
            }
        } catch {
            console.warn('[ghl-sync] invalid JSON from', url.split('?')[0]);
        }
    }
    const rowCount = bestRowCount < 0 ? 0 : bestRowCount;
    return { payload: pagePayload, rowCount };
}

export async function fetchGhlConversationMessages(ghlConversationId: string): Promise<Record<string, unknown>[]> {
    const auth = getGoHighLevelCredentials();
    if (!auth) return [];

    const locationId = (process.env.GOHIGHLEVEL_LOCATION_ID || '').trim();
    const headers: Record<string, string> = {
        Authorization: `Bearer ${auth.pit}`,
        Accept: 'application/json',
        Version: VERSION_CONVERSATIONS,
    };

    const aggregated: Record<string, unknown>[] = [];
    let cursor: string | undefined;
    const seenProviderIds = new Set<string>();

    for (let page = 0; page < GHL_MESSAGES_MAX_PAGES; page++) {
        const pathQs = new URLSearchParams();
        pathQs.set('limit', String(GHL_MESSAGES_PAGE_LIMIT));
        if (locationId) pathQs.set('locationId', locationId);
        if (cursor) pathQs.set('lastMessageId', cursor);

        /**
         * Only use `/conversations/{conversationId}/messages`.
         * Do NOT call `/conversations/messages?conversationId=…` — LeadConnector routes
         * `GET /conversations/messages` as `/conversations/:conversationId` with id `"messages"`,
         * which yields 400 "Conversation with id messages not found".
         */
        const urlsToTry = [
            `${GHL_BASE}/conversations/${encodeURIComponent(ghlConversationId)}/messages?${pathQs.toString()}`,
        ];

        let { payload: pagePayload, rowCount: bestRowCount } = await bestPayloadFromMessageListUrls(
            urlsToTry,
            headers,
        );

        if (
            bestRowCount < 1 &&
            locationId &&
            !['1', 'true', 'yes'].includes((process.env.GHL_MESSAGES_REQUIRE_LOCATION_ID || '').trim().toLowerCase())
        ) {
            const pathQsNoLoc = new URLSearchParams();
            pathQsNoLoc.set('limit', String(GHL_MESSAGES_PAGE_LIMIT));
            if (cursor) pathQsNoLoc.set('lastMessageId', cursor);
            const retry = await bestPayloadFromMessageListUrls(
                [
                    `${GHL_BASE}/conversations/${encodeURIComponent(ghlConversationId)}/messages?${pathQsNoLoc.toString()}`,
                ],
                headers,
            );
            if (retry.rowCount > bestRowCount) {
                pagePayload = retry.payload;
                bestRowCount = retry.rowCount;
                if (retry.rowCount > 0) {
                    console.info(
                        '[ghl-sync] messages list: retry without locationId succeeded (rows=%s); check GOHIGHLEVEL_LOCATION_ID matches this conversation location',
                        String(retry.rowCount),
                    );
                }
            }
        }

        if (pagePayload === null) break;

        const rows = extractMessageRowsFromListPayload(pagePayload);
        if (rows.length === 0 && page === 0 && bestRowCount <= 0) {
            const keys =
                pagePayload && typeof pagePayload === 'object' && !Array.isArray(pagePayload) ?
                    Object.keys(pagePayload as Record<string, unknown>).slice(0, 12)
                :   [];
            console.warn('[ghl-sync] messages list parsed 0 rows; top-level keys:', keys.join(', ') || '(none)');
        }

        const newRows: Record<string, unknown>[] = [];
        for (const r of rows) {
            const pid = ghlRowProviderMessageId(r);
            if (pid) {
                if (seenProviderIds.has(pid)) continue;
                seenProviderIds.add(pid);
            }
            newRows.push(r);
        }
        if (page > 0 && newRows.length === 0) break;

        aggregated.push(...newRows);

        let { nextPage, lastMessageId } = extractListPagination(pagePayload);
        if (!lastMessageId && rows.length > 0) {
            const lastRow = rows[rows.length - 1] as Record<string, unknown>;
            lastMessageId = ghlRowProviderMessageId(lastRow);
        }
        const fullPage = rows.length >= GHL_MESSAGES_PAGE_LIMIT;
        if (!nextPage && fullPage && lastMessageId) {
            nextPage = true;
        }
        if (!lastMessageId) break;
        if (!nextPage) break;
        cursor = lastMessageId;
    }

    return aggregated;
}

function numOrString(v: unknown): string | null {
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
    return null;
}

/**
 * List-messages rows use numeric `type` where 3 = Email (see GHL conversations schema:
 * "meta will contain email, for message type 3"). We must not rely on `messageType` alone —
 * it can be missing while `type` is still 3, otherwise Gmail replies are skipped entirely.
 */
export function isLikelyGhlEmailRow(m: Record<string, unknown>): boolean {
    const mt = String(m.messageType ?? '').toLowerCase();
    const mts = String(m.messageTypeString ?? '').toLowerCase();
    if (mt === 'email' || mt.includes('email')) return true;
    if (mts.includes('email')) return true;
    if (m.messageTypeId === 3 || m.messageTypeId === '3') return true;
    const channelType = Number(m.type);
    if (channelType === 3) return true;
    const meta = m.meta;
    if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
        const mo = meta as Record<string, unknown>;
        if ('email' in mo && mo.email !== null && typeof mo.email === 'object') return true;
    }
    /** Inbound Gmail sometimes arrives with a non‑3 `type` / odd `messageType`; treat as email when clearly email-shaped. */
    const dir = String(m.direction ?? '').toLowerCase().trim();
    if (dir === 'inbound') {
        const ct = String(m.contentType ?? '').toLowerCase();
        if (
            ct.includes('html') ||
            ct.includes('text/plain') ||
            ct === 'text' ||
            ct.includes('multipart')
        ) {
            return true;
        }
        if (typeof m.subject === 'string' && m.subject.trim().length > 2) return true;
        if (typeof m.from === 'string' && m.from.includes('@')) return true;
    }
    return false;
}

export function ghlRowDirection(m: Record<string, unknown>): 'inbound' | 'outbound' | null {
    const meta = m.meta;
    const raw =
        m.direction ??
        (meta && typeof meta === 'object' && !Array.isArray(meta) ?
            (meta as Record<string, unknown>).direction
        :   undefined);
    const d = String(raw ?? '')
        .toLowerCase()
        .trim();
    if (d === 'inbound') return 'inbound';
    if (d === 'outbound') return 'outbound';
    return null;
}

export function ghlRowProviderMessageId(m: Record<string, unknown>): string | null {
    const id =
        numOrString(m.id) ||
        numOrString(m.messageId) ||
        numOrString(m.emailMessageId) ||
        numOrString(m.altId) ||
        null;
    return id;
}

/**
 * Email-tracking ids for this conversation row (`meta.email.messageIds`).
 * These match the ids returned by `POST /conversations/messages` (which we save as
 * `provider_message_id` on outbound rows at send time). The conversation row's `id`
 * is a different identifier, so without this lookup the dedup pass would re-insert
 * every outbound that round-trips through GHL.
 */
export function ghlRowEmailTrackingIds(m: Record<string, unknown>): string[] {
    const meta = m.meta;
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return [];
    const nested = (meta as Record<string, unknown>).email;
    if (!nested || typeof nested !== 'object' || Array.isArray(nested)) return [];
    const arr = (nested as Record<string, unknown>).messageIds;
    if (!Array.isArray(arr)) return [];
    const out: string[] = [];
    for (const v of arr) {
        if (typeof v === 'string' && v.trim().length > 0) out.push(v.trim());
        else if (typeof v === 'number' && Number.isFinite(v)) out.push(String(v));
    }
    return out;
}

export function ghlRowCreatedAtIso(m: Record<string, unknown>): string | null {
    const v =
        (typeof m.dateAdded === 'string' && m.dateAdded) ||
        (typeof m.createdAt === 'string' && m.createdAt) ||
        (typeof m.date === 'string' && m.date) ||
        null;
    if (!v) return null;
    const t = Date.parse(v);
    if (Number.isNaN(t)) return null;
    return new Date(t).toISOString();
}

/**
 * `mg.msgsndr.org` is GoHighLevel's transactional routing host. Local-parts like
 * `info+mamba.app@mg.msgsndr.org` are not user inboxes — they're GHL's relay mailboxes.
 * We treat them as non-human and replace them in chat display.
 */
export function isLeadConnectorRoutingAddress(email: string | null | undefined): boolean {
    if (!email) return false;
    const normalized = email.trim().toLowerCase();
    if (!normalized.includes('@')) return false;
    const host = normalized.split('@').pop() ?? '';
    return host === 'mg.msgsndr.org' || host.endsWith('.msgsndr.org') || host === 'msgsndr.org';
}

function firstToEmail(m: Record<string, unknown>): string {
    const to = m.to;
    if (typeof to === 'string' && to.includes('@')) return parseEmailAddress(to);
    if (Array.isArray(to) && to.length > 0 && typeof to[0] === 'string') return parseEmailAddress(to[0]);
    return '';
}

/** List API may expose HTML/plain on different keys depending on channel/version. */
function ghlRowEmailHtmlRaw(m: Record<string, unknown>): string {
    const keys: unknown[] = [m.body, m.html, m.htmlBody, m.bodyHtml, m.text, m.message];
    for (const c of keys) {
        if (typeof c === 'string' && c.trim().length > 0) return c;
    }
    const meta = m.meta;
    if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
        const nested = (meta as Record<string, unknown>).email;
        if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
            const ne = nested as Record<string, unknown>;
            for (const k of ['body', 'html', 'text', 'snippet', 'plainText'] as const) {
                const c = ne[k];
                if (typeof c === 'string' && c.trim().length > 0) return c;
            }
        }
    }
    return '';
}

function rowHasRenderablePlain(m: Record<string, unknown>): boolean {
    return htmlToPlainSnippet(ghlRowEmailHtmlRaw(m), 65535).trim().length > 0;
}

/**
 * Trim the parts of a reply email that quote the previous message. We strip the obvious
 * containers first (`<blockquote>`, Gmail/Outlook quote wrappers, MS Teams "OutlookMessageHeader"),
 * then drop common attribution lines on the resulting plain text.
 *
 * The list endpoint returns a *snippet* of the conversation thread (often the quoted body),
 * not the user's actual reply, so without this step inbound chat bubbles show the previous
 * outgoing message instead of the new reply.
 */
export function stripQuotedReplyFromHtml(html: string): string {
    let out = html;
    /** Drop tracking pixels & any inline images that are referenced by the quoted block. */
    out = out.replace(/<img\b[^>]*>/gi, '');
    /** Most quoted-reply variants nest inside <blockquote>; remove its full contents. */
    out = out.replace(/<blockquote\b[^>]*>[\s\S]*?<\/blockquote>/gi, '');
    /** Gmail wraps the attribution + blockquote in `gmail_quote_container` / `gmail_attr` — leftover noise after blockquote removal. */
    out = out.replace(
        /<div\b[^>]*class\s*=\s*["'][^"']*gmail_attr[^"']*["'][^>]*>[\s\S]*?<\/div>/gi,
        '',
    );
    /** Outlook desktop adds <div id="appendonsend"> separator + <hr> + <div id="divRplyFwdMsg">. */
    out = out.replace(/<div\b[^>]*id\s*=\s*["']appendonsend["'][^>]*>[\s\S]*?<\/div>/gi, '');
    out = out.replace(
        /<div\b[^>]*id\s*=\s*["']divRplyFwdMsg["'][^>]*>[\s\S]*$/gi,
        '',
    );
    out = out.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
    return out;
}

/**
 * Normalize an email subject for matching against a conversation thread title.
 * Strips reply/forward prefixes (Re:, RE:, Fwd:, FW:, etc.), bracketed tags like `[Mamba]`,
 * the digest "New message:" wrapper we add, and collapses whitespace — so all of
 *   - "Re: Testing Unified messaging"
 *   - "[Mamba] New message: Testing Unified messaging"
 *   - "Re: [Mamba] New message: Testing Unified messaging"
 * normalize to the same string as "Testing Unified messaging".
 */
export function normalizeSubject(subject: string | null | undefined): string {
    if (!subject) return '';
    let s = subject.trim();
    for (let i = 0; i < 8; i++) {
        const before = s;
        /** Drop leading bracket tags like `[Mamba]` / `[EXTERNAL]`. */
        s = s.replace(/^\s*\[[^\]]{0,40}\]\s*/g, '');
        /** Strip any chain of reply/forward prefixes. */
        s = s.replace(/^\s*(re|fwd?|aw|sv|wg|res?p)\s*:\s*/i, '');
        /** Strip the in-app digest wrapper we send as `[Mamba] New message: <subject>`. */
        s = s.replace(/^\s*new\s+message\s*:\s*/i, '');
        if (s === before) break;
    }
    return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * True when the email is one of the bot-generated "[Mamba] New message: <subject>" digests
 * we send to nudge the other party to check the in-app inbox. We pull *replies* to those
 * digests into the chat (so the agency's Gmail reply still threads correctly), but we don't
 * want the digest itself to appear as a chat bubble — it's just `A new message was posted in…`.
 */
export function isMessagingDigestEmail(detail: Record<string, unknown>): boolean {
    const subj = typeof detail.subject === 'string' ? detail.subject : '';
    if (!/\b\s*new\s+message\s*:/i.test(subj)) return false;
    /** Inbound replies will have `Re:` (or no prefix) but the digest itself never starts with Re. */
    if (/^\s*(re|fwd?|aw|sv|wg|res?p)\s*:/i.test(subj)) return false;
    /**
     * Body sanity check — our digest format ships the literal phrase below from
     * `messaging.service.notifyAgencyOfMessagingActivity`.
     */
    const body = typeof detail.body === 'string' ? detail.body : '';
    if (/A new message was posted in/i.test(body)) return true;
    /** Fallback: outbound + bracket+New message subject is almost certainly the digest. */
    const dir = String(detail.direction ?? '').toLowerCase();
    return dir === 'outbound' && /^\s*\[[^\]]{0,40}\]\s*new\s+message\s*:/i.test(subj);
}

/** Plain-text fallback for replies where quote markup is non-standard or missing. */
export function stripAttributionLine(plain: string): string {
    if (!plain) return plain;
    /** "On <date/time>, <name> wrote:" — Apple Mail / Gmail / standard MUAs. */
    const attrib = /\bOn\s+[^\n]{0,250}?\s+wrote:\s*/i;
    const m = plain.match(attrib);
    if (m && typeof m.index === 'number') {
        const before = plain.slice(0, m.index).trim();
        if (before.length > 0) return before;
    }
    /** "From: ... Sent: ... To: ..." — Outlook style header block. */
    const outlook = /(^|\n)\s*From:\s+[^\n]+\n\s*Sent:\s+/i;
    const om = plain.match(outlook);
    if (om && typeof om.index === 'number') {
        const before = plain.slice(0, om.index).trim();
        if (before.length > 0) return before;
    }
    /** "-----Original Message-----" — older MUA divider. */
    const idx = plain.search(/-{3,}\s*Original\s+Message\s*-{3,}/i);
    if (idx > 0) return plain.slice(0, idx).trim();
    return plain;
}

/**
 * Final email body shown in chat: HTML noise stripped, blockquote/quote-divs removed,
 * tags reduced to plain, attribution line trimmed, whitespace collapsed.
 */
export function emailBodyToCleanPlain(html: string, maxLen = 65535): string {
    if (!html) return '';
    const clean = stripQuotedReplyFromHtml(html);
    const plain = htmlToPlainSnippet(clean, maxLen);
    const stripped = stripAttributionLine(plain).trim();
    if (stripped.length > 0) return stripped;
    /** Hard fallback: original plain (without quote stripping) so we never store an empty body. */
    return htmlToPlainSnippet(html, maxLen);
}

const ghlContactEmailCache = new Map<string, string | null>();

async function fetchGhlContactEmail(contactId: string): Promise<string | null> {
    const cached = ghlContactEmailCache.get(contactId);
    if (cached !== undefined) return cached;
    const auth = getGoHighLevelCredentials();
    if (!auth) {
        ghlContactEmailCache.set(contactId, null);
        return null;
    }
    const url = `${GHL_BASE}/contacts/${encodeURIComponent(contactId)}`;
    const resp = await fetch(url, {
        headers: {
            Authorization: `Bearer ${auth.pit}`,
            Accept: 'application/json',
            /** Contacts API uses a separate version pin from Conversations. */
            Version: '2021-07-28',
        },
    });
    const raw = await resp.text().catch(() => '');
    if (!resp.ok) {
        console.warn('[ghl-sync] contact lookup HTTP', resp.status, raw.slice(0, 160));
        ghlContactEmailCache.set(contactId, null);
        return null;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        ghlContactEmailCache.set(contactId, null);
        return null;
    }
    if (!parsed || typeof parsed !== 'object') {
        ghlContactEmailCache.set(contactId, null);
        return null;
    }
    const c =
        (parsed as Record<string, unknown>).contact ??
        (parsed as Record<string, unknown>).data ??
        parsed;
    if (!c || typeof c !== 'object') {
        ghlContactEmailCache.set(contactId, null);
        return null;
    }
    const email = (c as Record<string, unknown>).email;
    const out =
        typeof email === 'string' && email.includes('@') ? email.trim().toLowerCase() : null;
    ghlContactEmailCache.set(contactId, out);
    return out;
}

/**
 * Resolve every GHL conversation that has activity for a contact email.
 *
 * GHL conversations are 1:1 with contacts, but multiple conversations can exist for the same
 * email (rare but happens when contacts get split). We return them all so the sync can merge
 * messages from each. Sorted newest-first so the caller can pick the canonical thread for
 * `external_thread_id` reconciliation.
 */
export async function findGhlConversationsByContactEmail(
    contactEmail: string,
): Promise<Array<{ conversationId: string; contactId: string | null; lastMs: number; lastType: string }>> {
    const auth = getGoHighLevelCredentials();
    if (!auth) return [];
    const locationId = (process.env.GOHIGHLEVEL_LOCATION_ID || '').trim();
    if (!locationId) return [];
    const email = contactEmail.trim().toLowerCase();
    if (!email.includes('@')) return [];

    const params = new URLSearchParams();
    params.set('locationId', locationId);
    params.set('query', email);
    params.set('limit', '20');

    const resp = await fetch(`${GHL_BASE}/conversations/search?${params.toString()}`, {
        headers: {
            Authorization: `Bearer ${auth.pit}`,
            Accept: 'application/json',
            Version: VERSION_CONVERSATIONS,
        },
    });
    const raw = await resp.text().catch(() => '');
    if (!resp.ok) {
        console.warn('[ghl-sync] conversations/search HTTP', resp.status, raw.slice(0, 180));
        return [];
    }
    let json: unknown;
    try {
        json = JSON.parse(raw);
    } catch {
        return [];
    }
    if (!json || typeof json !== 'object') return [];
    const list = (json as { conversations?: unknown }).conversations;
    if (!Array.isArray(list)) return [];

    const out: Array<{ conversationId: string; contactId: string | null; lastMs: number; lastType: string }> = [];
    for (const raw of list) {
        if (!raw || typeof raw !== 'object') continue;
        const c = raw as Record<string, unknown>;
        const cEmail = typeof c.email === 'string' ? c.email.trim().toLowerCase() : '';
        if (cEmail !== email) continue;
        const id = typeof c.id === 'string' ? c.id.trim() : '';
        if (!id) continue;
        const contactId = typeof c.contactId === 'string' ? c.contactId.trim() : null;
        const lastMs =
            typeof c.lastMessageDate === 'number' ? c.lastMessageDate
            :   typeof c.dateUpdated === 'number' ? c.dateUpdated
            :   typeof c.dateAdded === 'number' ? c.dateAdded
            :   0;
        const lastType = typeof c.lastMessageType === 'string' ? c.lastMessageType.toLowerCase() : '';
        out.push({ conversationId: id, contactId, lastMs, lastType });
    }
    out.sort((a, b) => {
        const aEmail = a.lastType.includes('email') ? 1 : 0;
        const bEmail = b.lastType.includes('email') ? 1 : 0;
        if (aEmail !== bEmail) return bEmail - aEmail;
        return b.lastMs - a.lastMs;
    });
    return out;
}

/**
 * Resolve the GHL conversation that actually carries email traffic for a contact email.
 *
 * Why we need this: the `conversationId` returned by `POST /conversations/messages` can refer
 * to a different (sometimes orphan) conversation than the one GHL routes the email reply into —
 * e.g. when the recipient already has an existing conversation tied to their contact, GHL
 * threads inbound replies there even though the POST response named a fresh id. Without this
 * reconciliation we keep polling the orphan and never see Gmail replies.
 */
export async function findGhlConversationByContactEmail(
    contactEmail: string,
): Promise<{ conversationId: string; contactId: string | null } | null> {
    const auth = getGoHighLevelCredentials();
    if (!auth) return null;
    const locationId = (process.env.GOHIGHLEVEL_LOCATION_ID || '').trim();
    if (!locationId) return null;
    const email = contactEmail.trim().toLowerCase();
    if (!email.includes('@')) return null;

    const params = new URLSearchParams();
    params.set('locationId', locationId);
    params.set('query', email);
    params.set('limit', '20');

    const resp = await fetch(`${GHL_BASE}/conversations/search?${params.toString()}`, {
        headers: {
            Authorization: `Bearer ${auth.pit}`,
            Accept: 'application/json',
            Version: VERSION_CONVERSATIONS,
        },
    });
    const raw = await resp.text().catch(() => '');
    if (!resp.ok) {
        console.warn('[ghl-sync] conversations/search HTTP', resp.status, raw.slice(0, 180));
        return null;
    }
    let json: unknown;
    try {
        json = JSON.parse(raw);
    } catch {
        console.warn('[ghl-sync] conversations/search invalid JSON');
        return null;
    }
    if (!json || typeof json !== 'object') return null;
    const list = (json as { conversations?: unknown }).conversations;
    if (!Array.isArray(list) || list.length === 0) return null;

    let best: { id: string; contactId: string | null; ts: number } | null = null;
    for (const raw of list) {
        if (!raw || typeof raw !== 'object') continue;
        const c = raw as Record<string, unknown>;
        const cEmail = typeof c.email === 'string' ? c.email.trim().toLowerCase() : '';
        if (cEmail !== email) continue;
        const id = typeof c.id === 'string' ? c.id.trim() : '';
        if (!id) continue;
        const contactId = typeof c.contactId === 'string' ? c.contactId.trim() : null;
        const lastMs =
            typeof c.lastMessageDate === 'number' ? c.lastMessageDate
            :   typeof c.dateUpdated === 'number' ? c.dateUpdated
            :   typeof c.dateAdded === 'number' ? c.dateAdded
            :   0;
        const lastType = typeof c.lastMessageType === 'string' ? c.lastMessageType.toLowerCase() : '';
        /** Strongly prefer email conversations; otherwise fall back to most recent any-type. */
        const score = lastType.includes('email') ? lastMs + 1 : lastMs;
        if (!best || score > best.ts) best = { id, contactId, ts: score };
    }

    return best ? { conversationId: best.id, contactId: best.contactId } : null;
}

/**
 * LeadConnector often omits the full `body` on `GET …/conversations/:id/messages` for Email rows
 * (large HTML). Hydrate with `GET /conversations/messages/:messageId` when the list row is empty.
 * @see https://github.com/GoHighLevel/highlevel-api-docs/issues/40
 */
async function fetchGhlMessageDetail(messageId: string): Promise<Record<string, unknown> | null> {
    const auth = getGoHighLevelCredentials();
    if (!auth) return null;

    const url = `${GHL_BASE}/conversations/messages/${encodeURIComponent(messageId)}`;
    const resp = await fetch(url, {
        headers: {
            Authorization: `Bearer ${auth.pit}`,
            Accept: 'application/json',
            Version: VERSION_CONVERSATIONS,
        },
    });
    const raw = await resp.text().catch(() => '');
    if (!resp.ok) {
        console.warn('[ghl-sync] message detail HTTP', resp.status, raw.slice(0, 160));
        return null;
    }
    try {
        const j = JSON.parse(raw) as unknown;
        if (!j || typeof j !== 'object') return null;
        const o = j as Record<string, unknown>;
        const inner = o.message ?? o.data ?? o.msg;
        if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
            return inner as Record<string, unknown>;
        }
        return o;
    } catch {
        console.warn('[ghl-sync] message detail invalid JSON');
        return null;
    }
}

/**
 * Fetch a single email message (one row per inbound/outbound exchange) by its email-message-id.
 *
 * The conversation-messages list collapses related replies into "thread bundles" (1 row whose
 * body shows only the latest reply) and so can never reproduce GHL's own UI of every individual
 * message. This endpoint returns each email separately. Each conversation message's
 * `meta.email.messageIds` array enumerates the email-message-ids belonging to that thread, and
 * the per-email endpoint resolves any of them (including ours saved at send time).
 *
 * @see GHL "Get Email Message" — `GET /conversations/messages/email/{emailMessageId}`
 */
async function fetchGhlEmailMessage(
    emailMessageId: string,
): Promise<Record<string, unknown> | null> {
    const auth = getGoHighLevelCredentials();
    if (!auth) return null;

    const url = `${GHL_BASE}/conversations/messages/email/${encodeURIComponent(emailMessageId)}`;
    const resp = await fetch(url, {
        headers: {
            Authorization: `Bearer ${auth.pit}`,
            Accept: 'application/json',
            Version: VERSION_CONVERSATIONS,
        },
    });
    const raw = await resp.text().catch(() => '');
    if (!resp.ok) {
        if (resp.status !== 404) {
            console.warn('[ghl-sync] email message HTTP', resp.status, raw.slice(0, 160));
        }
        return null;
    }
    try {
        const j = JSON.parse(raw) as unknown;
        if (!j || typeof j !== 'object') return null;
        const o = j as Record<string, unknown>;
        const inner = o.emailMessage ?? o.message ?? o.data;
        if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
            return inner as Record<string, unknown>;
        }
        return o;
    } catch {
        return null;
    }
}

/**
 * Merge GHL conversation history into `messaging_messages` (PIT poll — no webhook).
 * Inserts only Email rows with stable provider ids; skips duplicates.
 */
export async function syncGhlEmailRowsIntoMamba(opts: {
    mambaConversationId: string;
    sellerTenantId: string;
    conversationSubject: string;
    ghlConversationId: string;
}): Promise<{
    fetched: number;
    insertedInbound: number;
    hydratedDetails: number;
    insertedOutbound: number;
    diagnostics: {
        skippedNotEmail: number;
        skippedNoDirection: number;
        skippedNoProviderId: number;
        skippedDuplicate: number;
        skippedEmptyBody: number;
        inboundSeen: number;
        outboundSeen: number;
    };
}> {
    const rows = await fetchGhlConversationMessages(opts.ghlConversationId);
    console.log(
        '[ghl-sync] GHL raw list',
        opts.ghlConversationId,
        '→',
        rows.length,
        'row(s)',
        rows.map((raw) => {
            const m = raw as Record<string, unknown>;
            return {
                id: ghlRowProviderMessageId(m) ?? null,
                direction: m.direction ?? null,
                messageType: m.messageType ?? null,
                type: m.type ?? null,
            };
        }),
    );
    let insertedInbound = 0;
    let insertedOutbound = 0;
    let lastInboundPreview = '';
    let hydratedDetails = 0;
    const diagnostics = {
        skippedNotEmail: 0,
        skippedNoDirection: 0,
        skippedNoProviderId: 0,
        skippedDuplicate: 0,
        skippedEmptyBody: 0,
        inboundSeen: 0,
        /** Email rows classified outbound (excludes skipped-no-direction). */
        outboundSeen: 0,
    };

    /**
     * Each conversation-messages row is a *thread bundle* whose body is just the latest reply.
     * Fan out to every individual email via `meta.email.messageIds` so multi-reply threads
     * (e.g. "Is it working from my gmail app" → "Let me reply again..." → "Testing from gmail app")
     * each become their own chat bubble instead of being collapsed into one.
     */
    const emailMessageIds: string[] = [];
    const seenEmailIds = new Set<string>();
    for (const row of rows) {
        const m = row;
        if (!isLikelyGhlEmailRow(m)) {
            diagnostics.skippedNotEmail += 1;
            continue;
        }
        const tids = ghlRowEmailTrackingIds(m);
        if (tids.length > 0) {
            for (const t of tids) {
                if (seenEmailIds.has(t)) continue;
                seenEmailIds.add(t);
                emailMessageIds.push(t);
            }
        } else {
            /** Some legacy rows don't surface `meta.email.messageIds`; fall back to the conversation message id. */
            const fallback = ghlRowProviderMessageId(m);
            if (fallback && !seenEmailIds.has(fallback)) {
                seenEmailIds.add(fallback);
                emailMessageIds.push(fallback);
            }
        }
    }

    /**
     * GHL stores at most one email conversation per contact. When a Mamba seller has multiple
     * subjects (e.g. a bug-report thread *and* "Testing Unified messaging"), they all share
     * the same `external_thread_id`. Filter incoming emails by normalized subject so each
     * Mamba conversation only shows messages from its own subject thread.
     */
    const targetSubject = normalizeSubject(opts.conversationSubject);

    for (const emailId of emailMessageIds) {
        const { data: existsByEmailId } = await supabase
            .from('messaging_messages')
            .select('id')
            .eq('provider_message_id', emailId)
            .maybeSingle();
        if (existsByEmailId) {
            diagnostics.skippedDuplicate += 1;
            continue;
        }

        const detail = await fetchGhlEmailMessage(emailId);
        if (!detail) {
            diagnostics.skippedNoProviderId += 1;
            continue;
        }
        hydratedDetails += 1;

        if (!isLikelyGhlEmailRow(detail)) {
            diagnostics.skippedNotEmail += 1;
            continue;
        }

        if (isMessagingDigestEmail(detail)) {
            /** Suppress our own "[Mamba] New message: …" notification mails — they'd appear as bot rows. */
            diagnostics.skippedNotEmail += 1;
            continue;
        }

        if (targetSubject) {
            const detailSubj =
                typeof detail.subject === 'string' ? normalizeSubject(detail.subject) : '';
            if (!detailSubj || detailSubj !== targetSubject) {
                /** Different subject in the same GHL conversation — belongs to a different Mamba thread. */
                diagnostics.skippedNotEmail += 1;
                continue;
            }
        }

        const direction = ghlRowDirection(detail);
        if (!direction) {
            diagnostics.skippedNoDirection += 1;
            continue;
        }
        if (direction === 'inbound') diagnostics.inboundSeen += 1;
        else diagnostics.outboundSeen += 1;

        const fromRaw = typeof detail.from === 'string' ? detail.from : '';
        let senderEmail = fromRaw ? parseEmailAddress(fromRaw) : '';
        if (!senderEmail.includes('@') && direction === 'outbound') {
            senderEmail = firstToEmail(detail);
        }
        if (!senderEmail.includes('@')) {
            const alt =
                (typeof detail.fromEmail === 'string' && detail.fromEmail) ||
                (typeof detail.email === 'string' && detail.email) ||
                (typeof detail.sender === 'string' && detail.sender);
            if (alt) {
                const p = parseEmailAddress(alt);
                if (p.includes('@')) senderEmail = p;
            }
        }
        if (!senderEmail.includes('@')) {
            const cId = typeof detail.contactId === 'string' ? detail.contactId : '';
            if (cId) {
                const lookup = await fetchGhlContactEmail(cId);
                if (lookup) senderEmail = lookup;
            }
        }
        if (!senderEmail.includes('@')) senderEmail = 'unknown@invalid.local';

        /**
         * `*@mg.msgsndr.org` and similar Lead Connector routing mailboxes are not real human
         * addresses — they're GHL's internal routing layer. Showing them in chat (e.g.
         * `info+mamba.app@mg.msgsndr.org`) is meaningless to the user. Prefer a saner sender:
         *  - For outbound: the agency-side participant we know about (branding inbox owner).
         *  - For inbound: the GHL contact's email (the real human who sent the reply).
         */
        if (isLeadConnectorRoutingAddress(senderEmail)) {
            if (direction === 'inbound') {
                const cId = typeof detail.contactId === 'string' ? detail.contactId : '';
                if (cId) {
                    const lookup = await fetchGhlContactEmail(cId);
                    if (lookup && !isLeadConnectorRoutingAddress(lookup)) {
                        senderEmail = lookup;
                    }
                }
            }
        }

        const htmlBody = ghlRowEmailHtmlRaw(detail);
        let plain = emailBodyToCleanPlain(htmlBody, 65535);
        if (!plain.trim()) {
            const subj =
                typeof detail.subject === 'string' && detail.subject.trim().length > 0
                    ? detail.subject.trim()
                    : '';
            if (subj) plain = subj.slice(0, 2000);
        }
        if (!plain.trim()) {
            diagnostics.skippedEmptyBody += 1;
            continue;
        }

        const createdAt = ghlRowCreatedAtIso(detail);

        const insertRow: Record<string, unknown> = {
            conversation_id: opts.mambaConversationId,
            direction,
            sender_user_id: null,
            sender_email: senderEmail.toLowerCase(),
            body: plain,
            provider_message_id: emailId,
            send_status: direction === 'outbound' ? 'sent' : null,
        };
        if (createdAt) insertRow.created_at = createdAt;

        const { error } = await supabase.from('messaging_messages').insert(insertRow as never);
        if (error) {
            if (/duplicate key|unique constraint/i.test(error.message)) {
                diagnostics.skippedDuplicate += 1;
                continue;
            }
            console.warn('[ghl-sync] insert email message', error.message);
            continue;
        }
        if (direction === 'inbound') {
            insertedInbound += 1;
            lastInboundPreview = plain.slice(0, 400);
        } else {
            insertedOutbound += 1;
        }
    }

    if (insertedInbound > 0 && lastInboundPreview) {
        const inbox = await resolveAgencyInboxEmail(opts.sellerTenantId);
        if (inbox) {
            await notifyAgencyOfMessagingActivity({
                agencyInbox: inbox,
                conversationSubject: opts.conversationSubject,
                previewPlain: lastInboundPreview,
            });
        }
    }

    if (rows.length > 0 && insertedInbound === 0 && diagnostics.inboundSeen > 0) {
        console.warn('[ghl-sync] GHL returned inbound email rows but none were inserted', {
            ghlConversationId: opts.ghlConversationId,
            diagnostics,
        });
    }

    if (rows.length > 0 && insertedInbound === 0 && diagnostics.inboundSeen === 0) {
        console.warn(
            '[ghl-sync] After sync, no inbound rows: list had %d message row(s) from GHL for this poll. ' +
                '`totals` are counts of rows that hit each skip/type bucket (not your full thread count in the GHL UI). ' +
                'If listRowCount is smaller than the UI, pagination or external_thread_id may be wrong.',
            rows.length,
            {
                ghlConversationId: opts.ghlConversationId,
                listRowCount: rows.length,
                totals: diagnostics,
            },
        );
    }

    return {
        fetched: rows.length,
        insertedInbound,
        hydratedDetails,
        insertedOutbound,
        diagnostics,
    };
}
