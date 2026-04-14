-- Add TikTok delivery id for webhook notification deduping

ALTER TABLE public.webhook_notifications
ADD COLUMN IF NOT EXISTS tts_notification_id TEXT;

-- Index to speed up dedupe checks
CREATE INDEX IF NOT EXISTS idx_webhook_notifications_shop_tts
ON public.webhook_notifications(shop_id, tts_notification_id);

