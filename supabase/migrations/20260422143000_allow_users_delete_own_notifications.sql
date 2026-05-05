-- Allow users to delete their own console notifications.
-- Existing policies already allow SELECT and UPDATE for self-owned rows.

DROP POLICY IF EXISTS "Users can delete their own notifications" ON public.user_notifications;

CREATE POLICY "Users can delete their own notifications"
    ON public.user_notifications
    FOR DELETE
    USING (auth.uid() = user_id);
