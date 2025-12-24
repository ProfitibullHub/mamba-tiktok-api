import dotenv from 'dotenv';

dotenv.config();

export const tiktokConfig = {
    clientKey: process.env.TIKTOK_CLIENT_KEY || '',
    clientSecret: process.env.TIKTOK_CLIENT_SECRET || '',
    redirectUri: process.env.TIKTOK_REDIRECT_URI || 'http://localhost:3001/api/tiktok/auth/callback',


    authUrl: 'https://www.tiktok.com/v2/auth/authorize/',
    tokenUrl: 'https://open.tiktokapis.com/v2/oauth/token/',


    apiBaseUrl: 'https://open.tiktokapis.com',


    scopes: [
        'user.info.basic',
        'user.info.profile',
        'user.info.stats',
        'video.list',
    ].join(','),


    tokenExpiryBuffer: 5 * 60 * 1000,
};

if (!tiktokConfig.clientKey || !tiktokConfig.clientSecret) {
    console.warn('Warning: TikTok API credentials not configured. Please check your .env file.');
}
