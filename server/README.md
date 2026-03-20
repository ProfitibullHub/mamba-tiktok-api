# TikTok Dashboard Backend

Backend server for TikTok API integration with the TikTok Dashboard application.

## Features

- **OAuth 2.0 Authentication**: Secure TikTok account connection
- **Data Synchronization**: Automatic syncing of user info, videos, and analytics
- **Token Management**: Automatic token refresh before expiry
- **Rate Limiting**: Built-in protection against API rate limits
- **RESTful API**: Clean endpoints for frontend integration

## Setup

1. **Install Dependencies**
   ```bash
   cd server
   npm install
   ```

2. **Configure Environment**
   
   Copy `.env.example` to `.env` and fill in your credentials:
   ```bash
   cp .env.example .env
   ```

   Required variables:
   - `TIKTOK_CLIENT_KEY`: Your TikTok app client key
   - `TIKTOK_CLIENT_SECRET`: Your TikTok app client secret
   - `SUPABASE_URL`: Your Supabase project URL
   - `SUPABASE_SERVICE_ROLE_KEY`: Your Supabase service role key

3. **Configure TikTok Developer Portal**
   
   Add the redirect URI to your TikTok app:
   - Development: `http://localhost:3001/api/tiktok/auth/callback`
   - Production: `https://yourdomain.com/api/tiktok/auth/callback`

4. **Run Database Migration**
   
   Apply the migration in your Supabase dashboard:
   - Go to SQL Editor
   - Run the migration file: `supabase/migrations/20251204163000_add_tiktok_integration.sql`

5. **Start Server**
   ```bash
   npm run dev
   ```

## API Endpoints

### Authentication

- `POST /api/tiktok/auth/start` - Start OAuth flow
- `GET /api/tiktok/auth/callback` - OAuth callback
- `POST /api/tiktok/auth/refresh/:accountId` - Refresh token
- `GET /api/tiktok/auth/status/:accountId` - Check connection status
- `DELETE /api/tiktok/auth/disconnect/:accountId` - Disconnect account

### Data

- `GET /api/tiktok/user/:accountId` - Get user info
- `GET /api/tiktok/videos/:accountId` - Get videos list
- `GET /api/tiktok/analytics/:accountId` - Get aggregated analytics
- `POST /api/tiktok/sync/:accountId` - Trigger data sync
- `GET /api/tiktok/sync/status/:accountId` - Get sync status

## Development

```bash
npm run dev      # Start development server with hot reload
npm run build    # Build for production
npm start        # Start production server
npm run typecheck # Type check without building
```

## Architecture

- **Express.js**: Web framework
- **TypeScript**: Type safety
- **Supabase**: Database and authentication
- **Axios**: HTTP client for TikTok API
- **Node-cron**: Scheduled tasks (future feature)

## Data Flow

1. User initiates OAuth from frontend
2. Backend generates auth URL with CSRF token
3. User authorizes on TikTok
4. TikTok redirects to callback with code
5. Backend exchanges code for tokens
6. Tokens stored in Supabase
7. Data sync fetches user info and videos
8. Analytics calculated and stored

## Security

- CSRF protection on OAuth flow
- Token encryption in database (recommended)
- Row Level Security on all tables
- Service role key for backend operations
- CORS configured for frontend origin
