import { apiFetch } from './apiClient';

export type MessagingSellerOption = { id: string; name: string };

export type MessagingConversation = {
    id: string;
    seller_tenant_id: string;
    subject: string;
    status: string | null;
    provider: string;
    external_thread_id: string | null;
    created_at: string;
    updated_at: string;
    last_message_at: string | null;
};

export type MessagingMessage = {
    id: string;
    conversation_id: string;
    direction: 'inbound' | 'outbound';
    sender_user_id: string | null;
    sender_email: string;
    body: string;
    created_at: string;
    send_status: string | null;
    provider_message_id: string | null;
};

export async function fetchMessagingSellers(): Promise<
    { ok: true; items: MessagingSellerOption[] } | { ok: false; message: string }
> {
    const res = await apiFetch('/api/messaging/sellers');
    const body = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        data?: { items?: MessagingSellerOption[] };
        error?: string;
    };
    const items = body.data?.items;
    if (!res.ok || body.success !== true || !body.data || !Array.isArray(items)) {
        return {
            ok: false,
            message: typeof body.error === 'string' ? body.error : `Request failed (${res.status})`,
        };
    }
    return { ok: true, items };
}

export async function fetchMessagingConversations(
    sellerTenantId?: string | null,
): Promise<{ ok: true; items: MessagingConversation[] } | { ok: false; message: string }> {
    const q =
        sellerTenantId && sellerTenantId.length > 0 ?
            `?sellerTenantId=${encodeURIComponent(sellerTenantId)}`
        :   '';
    const res = await apiFetch(`/api/messaging/conversations${q}`);
    const body = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        data?: { items?: MessagingConversation[] };
        error?: string;
    };
    if (!res.ok || !body.success || !body.data) {
        return {
            ok: false,
            message: typeof body.error === 'string' ? body.error : `Request failed (${res.status})`,
        };
    }
    return { ok: true, items: body.data.items ?? [] };
}

export async function createMessagingConversation(
    sellerTenantId: string,
    subject: string,
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
    const res = await apiFetch('/api/messaging/conversations', {
        method: 'POST',
        body: JSON.stringify({ sellerTenantId, subject }),
    });
    const body = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        data?: { conversation?: { id: string } };
        error?: string;
    };
    if (!res.ok || !body.success || !body.data?.conversation?.id) {
        return {
            ok: false,
            message: typeof body.error === 'string' ? body.error : `Request failed (${res.status})`,
        };
    }
    return { ok: true, id: body.data.conversation.id };
}

export type MessagingParticipantInfo = {
    name: string | null;
    role: string | null;
    side: 'seller' | 'agency';
    userId: string | null;
};

export type MessagingParticipants = {
    sellerEmails: string[];
    agencyEmails: string[];
    /** Lowercased-email → display info, used for `Name · Role` labels in the chat UI. */
    directory: Record<string, MessagingParticipantInfo>;
};

export async function fetchMessagingMessages(
    conversationId: string,
): Promise<
    | { ok: true; messages: MessagingMessage[]; participants: MessagingParticipants }
    | { ok: false; message: string }
> {
    const res = await apiFetch(`/api/messaging/conversations/${encodeURIComponent(conversationId)}/messages`);
    const body = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        data?: { messages?: MessagingMessage[]; participants?: MessagingParticipants };
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
        messages: body.data.messages ?? [],
        participants: body.data.participants ?? { sellerEmails: [], agencyEmails: [], directory: {} },
    };
}

export async function sendMessagingMessage(
    conversationId: string,
    text: string,
): Promise<{ ok: true } | { ok: false; message: string; status?: number }> {
    const res = await apiFetch(`/api/messaging/conversations/${encodeURIComponent(conversationId)}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body: text }),
    });
    const body = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
    if (!res.ok || !body.success) {
        return {
            ok: false,
            message: typeof body.error === 'string' ? body.error : `Request failed (${res.status})`,
            status: res.status,
        };
    }
    return { ok: true };
}
