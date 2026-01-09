import dotenv from 'dotenv';

dotenv.config();

export const tiktokConfig = {
    clientKey: process.env.TIKTOK_CLIENT_KEY || '',
    clientSecret: process.env.TIKTOK_CLIENT_SECRET || '',
    redirectUri: process.env.TIKTOK_REDIRECT_URI || 'http://localhost:3001/api/tiktok/auth/callback',

    // TikTok API endpoints (using open.tiktokapis.com for OAuth v2)
    authUrl: 'https://www.tiktok.com/v2/auth/authorize/',
    tokenUrl: 'https://open.tiktokapis.com/v2/oauth/token/',

    // API endpoints
    apiBaseUrl: 'https://open.tiktokapis.com',

    // OAuth scopes - all available scopes for complete data access
    scopes: [
        'user.info.basic',    // Basic user info (open_id, union_id)
        'user.info.profile',  // Profile info (display name, avatar, bio, verification)
        'user.info.stats',    // Statistics (follower count, following count, likes, video count)
        'video.list',         // Access to user's videos and engagement metrics
    ].join(','),

    // Token expiry buffer (refresh 5 minutes before expiry)
    tokenExpiryBuffer: 5 * 60 * 1000,
};

if (!tiktokConfig.clientKey || !tiktokConfig.clientSecret) {
    console.warn('Warning: TikTok API credentials not configured. Please check your .env file.');
}
