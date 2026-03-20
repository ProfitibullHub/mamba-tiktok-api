# TikTok Integration Setup Guide

## Quick Start

Follow these steps to get the TikTok integration running:

### 1. Get Supabase Service Role Key

1. Go to https://supabase.com/dashboard/project/kgfnluwjsswttpctheml/settings/api
2. Copy the `service_role` key (NOT the `anon` key)
3. Open `server/.env` and replace `YOUR_SERVICE_ROLE_KEY_HERE` with your key

### 2. Configure TikTok Developer Portal

1. Go to https://developers.tiktok.com/
2. Navigate to your app → "Login Kit" settings
3. Add this redirect URI: `http://localhost:3001/api/tiktok/auth/callback`

### 3. Run Database Migration

**Option A: Supabase Dashboard**
1. Go to https://supabase.com/dashboard/project/kgfnluwjsswttpctheml/editor
2. Click "SQL Editor"
3. Copy the entire contents of `supabase/migrations/20251204163000_add_tiktok_integration.sql`
4. Paste and click "Run"

**Option B: Using Supabase CLI** (if installed)
```bash
supabase db push
```

### 4. Install Backend Dependencies

```bash
cd server
npm install
```

### 5. Start Backend Server

```bash
cd server
npm run dev
```

You should see:
```
🚀 TikTok Dashboard Backend Server
Server running on: http://localhost:3001
```

### 6. Test the Integration

Your frontend is already running. To test:

1. Add a link to the Account Settings page in your navigation
2. Navigate to Account Settings
3. Click "Connect TikTok"
4. Authorize the app on TikTok
5. Click "Sync Now" to fetch your data
6. View your analytics!

## Troubleshooting

### Backend won't start
- Make sure you've added the Supabase service role key to `server/.env`
- Run `npm install` in the server directory

### OAuth redirect fails
- Verify the redirect URI in TikTok Developer Portal matches exactly: `http://localhost:3001/api/tiktok/auth/callback`
- No trailing slashes!

### Database errors
- Make sure you ran the migration SQL in Supabase
- Check that all 4 tables were created: `tiktok_auth_tokens`, `tiktok_user_info`, `tiktok_videos`, `tiktok_video_analytics`

## Next Steps

Once everything is working:
- Add navigation link to Account Settings page
- Set up scheduled syncs (daily/hourly)
- Deploy backend to production (Railway, Render, etc.)
- Update redirect URI for production domain
