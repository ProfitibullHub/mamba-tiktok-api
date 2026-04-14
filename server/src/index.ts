import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

// Load environment variables at the very top
dotenv.config();

import tiktokShopAuthRoutes from './routes/tiktok-shop-auth.routes.js';
import tiktokShopDataRoutes from './routes/tiktok-shop-data.routes.js';
import tiktokShopFinanceRoutes from './routes/tiktok-shop-finance.routes.js';
import adminRoutes from './routes/admin.routes.js';
import teamRoutes from './routes/team.routes.js';
import reportsRoutes from './routes/reports.routes.js';
import tiktokAdsRoutes from './routes/tiktok-ads.routes.js';
import tiktokDebugRoutes from './routes/tiktok-debug.routes.js';
import tiktokWebhookRoutes from './routes/tiktok-webhook.routes.js';
import { pollAllAdvertisers } from './services/ads-polling.service.js';

const app = express();
const PORT = process.env.PORT || 3001;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const FRONTEND_URLS = (process.env.FRONTEND_URLS || '')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);

// Middleware - Support both local and production frontend URLs
const allowedOrigins = [
    'http://localhost:5173',
    'https://tiktok-dashboard-frontend-eight.vercel.app',
    'https://mamba-frontend.vercel.app',
    'https://mamba-red.vercel.app',
    'https://mamba-phi.vercel.app',
    'https://mamba.app',
    'https://www.mamba.app',
    FRONTEND_URL,
    ...FRONTEND_URLS
];

const allowOriginPatterns = [
    /^https:\/\/mamba-[a-z0-9-]+\.vercel\.app$/i
];

// Enhanced CORS configuration for Vercel serverless functions
app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);

        const isExplicitlyAllowed = allowedOrigins.includes(origin);
        const isPatternAllowed = allowOriginPatterns.some((pattern) => pattern.test(origin));

        if (isExplicitlyAllowed || isPatternAllowed) {
            callback(null, true);
        } else {
            console.log('CORS blocked origin:', origin);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposedHeaders: ['Content-Range', 'X-Content-Range'],
    maxAge: 600 // Cache preflight for 10 minutes
}));

// Additional CORS headers middleware for Vercel (belt and suspenders approach)
app.use((req, res, next) => {
    const origin = req.headers.origin;
    const isAllowedOrigin = !!origin && (
        allowedOrigins.includes(origin) ||
        allowOriginPatterns.some((pattern) => pattern.test(origin))
    );

    if (isAllowedOrigin) {
        res.header('Access-Control-Allow-Origin', origin);
        res.header('Access-Control-Allow-Credentials', 'true');
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
        res.header('Access-Control-Expose-Headers', 'Content-Range, X-Content-Range');
    }

    // Handle preflight OPTIONS requests
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    next();
});

// Request logging
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        service: 'Mamba - TikTok Shop Dashboard Backend',
    });
});

// Mount webhook route with RAW body parser (must be before express.json signature-breaking parse)
app.use('/api/tiktok-shop/webhook', express.raw({ type: 'application/json' }), tiktokWebhookRoutes);

// JSON parser for all non-webhook routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Mount TikTok Shop routes
app.use('/api/tiktok-shop/auth', tiktokShopAuthRoutes);
app.use('/api/tiktok-shop', tiktokShopDataRoutes);
app.use('/api/tiktok-shop/finance', tiktokShopFinanceRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/reports', reportsRoutes);

// Mount TikTok Ads routes
app.use('/api/tiktok-ads', tiktokAdsRoutes);

// Mount TikTok Debug/Audit routes (raw API data for data authenticity verification)
app.use('/api/tiktok-shop/debug', tiktokDebugRoutes);

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found',
    });
});

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('Error:', err);
    res.status(err.status || 500).json({
        success: false,
        error: err.message || 'Internal server error',
    });
});

// Start server if not running in Vercel (Vercel handles the serverless function execution)
if (!process.env.VERCEL) {
    app.listen(PORT, () => {
        console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   🛍️  Mamba - TikTok Shop Dashboard Backend               ║
║                                                            ║
║   Server running on: http://localhost:${PORT}              ║
║   Frontend URL: ${FRONTEND_URL}                            ║
║                                                            ║
║   TikTok Shop API Endpoints:                               ║
║   - POST /api/tiktok-shop/auth/start                       ║
║   - GET  /api/tiktok-shop/auth/callback                    ║
║   - GET  /api/tiktok-shop/auth/status/:accountId           ║
║   - DELETE /api/tiktok-shop/auth/disconnect/:accountId     ║
║   - GET  /api/tiktok-shop/shops/:accountId                 ║
║   - GET  /api/tiktok-shop/orders/:accountId                ║
║   - GET  /api/tiktok-shop/products/:accountId              ║
║   - GET  /api/tiktok-shop/settlements/:accountId           ║
║   - GET  /api/tiktok-shop/performance/:accountId           ║
║   - POST /api/tiktok-shop/sync/:accountId                  ║
║   - GET  /api/tiktok-shop/sync/cron-settlements (Vercel)   ║
║                                                            ║
║   📊 Ads Polling: every 5 min (local dev timer active)     ║
╚════════════════════════════════════════════════════════════╝
      `);

        // ── Local dev ads polling timer ───────────────────────────────────────
        // Mirrors the Vercel Cron jobs so real-time updates work in development.
        // In production, Vercel Cron calls POST /api/tiktok-ads/poll-all on schedule.
        const runPoll = async (range: 'today' | '7d' = 'today') => {
            try {
                await pollAllAdvertisers(range);
            } catch (e: any) {
                console.error('[Dev Cron] Poll error:', e.message);
            }
        };

        // Run once 10 seconds after boot (let the server fully settle first)
        setTimeout(() => runPoll('today'), 10_000);

        // Then every 5 minutes for today's data
        setInterval(() => runPoll('today'), 5 * 60 * 1000);

        // Every 60 minutes do a 7-day accuracy pass
        setInterval(() => runPoll('7d'), 60 * 60 * 1000);
    });
}

export default app;
