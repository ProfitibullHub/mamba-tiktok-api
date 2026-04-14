-- Create webhook notifications table
CREATE TABLE IF NOT EXISTS public.webhook_notifications (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    shop_id TEXT NOT NULL,
    type_id INTEGER NOT NULL,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    raw_payload JSONB DEFAULT '{}'::jsonb,
    -- TikTok delivery id. Used for deduping webhook retries/duplicates.
    tts_notification_id TEXT,
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for querying unread notifications quickly per shop
CREATE INDEX IF NOT EXISTS idx_webhook_notifications_shop_read ON public.webhook_notifications(shop_id, is_read);
CREATE INDEX IF NOT EXISTS idx_webhook_notifications_created ON public.webhook_notifications(created_at DESC);
-- Helpful for deduping webhook retries by TikTok notification id
CREATE INDEX IF NOT EXISTS idx_webhook_notifications_shop_tts ON public.webhook_notifications(shop_id, tts_notification_id);

-- Enable Row Level Security (RLS)
ALTER TABLE public.webhook_notifications ENABLE ROW LEVEL SECURITY;

-- Create policies to allow access (assuming authenticated users or anon service role)
CREATE POLICY "Enable read access for all"
ON public.webhook_notifications FOR SELECT USING (true);

CREATE POLICY "Enable update access for all"
ON public.webhook_notifications FOR UPDATE USING (true);

CREATE POLICY "Enable insert access for all"
ON public.webhook_notifications FOR INSERT WITH CHECK (true);

CREATE POLICY "Enable delete access for all"
ON public.webhook_notifications FOR DELETE USING (true);

-- Enable REALTIME for this table so the frontend can listen to inserts instantly
-- (If this errors, it means realtime is already enabled globally or using a different publication syntax)
ALTER PUBLICATION supabase_realtime ADD TABLE public.webhook_notifications;
