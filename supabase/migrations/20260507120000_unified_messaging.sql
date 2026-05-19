-- Unified Messaging Inbox (email-first): conversations + immutable messages.
-- Access is enforced in Express (service role); no client-side direct table access required.

CREATE TABLE IF NOT EXISTS public.messaging_conversations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE RESTRICT,
    subject text NOT NULL,
    status text NULL,
    provider text NOT NULL DEFAULT 'ghl',
    external_thread_id text NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    last_message_at timestamptz NULL,
    CONSTRAINT messaging_conversations_subject_len CHECK (char_length(subject) <= 500),
    CONSTRAINT messaging_conversations_provider_chk CHECK (provider IN ('ghl'))
);

CREATE INDEX IF NOT EXISTS idx_messaging_conversations_seller_updated
    ON public.messaging_conversations (seller_tenant_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_messaging_conversations_external_thread
    ON public.messaging_conversations (provider, external_thread_id)
    WHERE external_thread_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.messaging_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id uuid NOT NULL REFERENCES public.messaging_conversations (id) ON DELETE CASCADE,
    direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    sender_user_id uuid NULL REFERENCES public.profiles (id) ON DELETE SET NULL,
    sender_email text NOT NULL,
    body text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    rfc_message_id text NULL,
    in_reply_to text NULL,
    references_header text NULL,
    send_status text NULL CHECK (send_status IS NULL OR send_status IN ('pending', 'sent', 'failed')),
    provider_message_id text NULL,
    send_error text NULL,
    retry_count integer NOT NULL DEFAULT 0,
    CONSTRAINT messaging_messages_body_len CHECK (char_length(body) <= 65535),
    CONSTRAINT messaging_messages_sender_email_len CHECK (char_length(sender_email) <= 320)
);

CREATE INDEX IF NOT EXISTS idx_messaging_messages_conversation_created
    ON public.messaging_messages (conversation_id, created_at ASC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_messaging_messages_provider_msg
    ON public.messaging_messages (provider_message_id)
    WHERE provider_message_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.messaging_touch_conversation_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.messaging_conversations
    SET
        updated_at = now(),
        last_message_at = NEW.created_at
    WHERE id = NEW.conversation_id;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_messaging_messages_touch_conversation ON public.messaging_messages;
CREATE TRIGGER trg_messaging_messages_touch_conversation
    AFTER INSERT ON public.messaging_messages
    FOR EACH ROW
    EXECUTE FUNCTION public.messaging_touch_conversation_updated_at();

-- Visibility: active seller tenant + seller member OR agency with seller in assignment scope OR platform super admin.
CREATE OR REPLACE FUNCTION public.messaging_seller_visible_to_user(p_seller_tenant_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT p_seller_tenant_id IS NOT NULL
    AND p_user_id IS NOT NULL
    AND EXISTS (
        SELECT 1
        FROM public.tenants s
        WHERE s.id = p_seller_tenant_id
          AND s.type = 'seller'
    )
    AND (
        public.user_is_platform_super_admin(p_user_id)
        OR EXISTS (
            SELECT 1
            FROM public.get_request_tenant_context(p_user_id) ctx
            WHERE ctx.tenant_type = 'seller'
              AND ctx.tenant_id = p_seller_tenant_id
        )
        OR EXISTS (
            SELECT 1
            FROM public.get_request_tenant_context(p_user_id) ctx
            WHERE ctx.tenant_type = 'agency'
              AND p_seller_tenant_id = ANY (ctx.assigned_seller_ids)
        )
    );
$$;

REVOKE ALL ON FUNCTION public.messaging_seller_visible_to_user(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.messaging_seller_visible_to_user(uuid, uuid) TO service_role;

ALTER TABLE public.messaging_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messaging_messages ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.messaging_conversations IS 'Email-backed conversation; one seller tenant per thread (PRD).';
COMMENT ON TABLE public.messaging_messages IS 'Immutable message row (MVP); inbound/outbound + provider ids for GHL.';
