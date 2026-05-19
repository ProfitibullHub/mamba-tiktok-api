import * as Sentry from '@sentry/node';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import dotenv from 'dotenv';

// Load environment variables at the very top
dotenv.config();

// ── Sentry — must be initialized before any route/middleware imports ──────────
if (process.env.SENTRY_DSN) {
    Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.NODE_ENV || 'production',
        // Capture 100 % of traces in development, 10 % in production
        tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
        // Attach request data (path, headers — NOT body to avoid PII)
        integrations: [
            Sentry.httpIntegration(),
            Sentry.expressIntegration(),
        ],
    });
    console.log('[Sentry] Initialized with DSN');
} else {
    console.warn('[Sentry] SENTRY_DSN not set — using in-house error tracking only');
}

// ── Global process-level safety net ──────────────────────────────────────────
process.on('unhandledRejection', (reason: unknown) => {
    logSystemEvent({
        level: 'error',
        scope: 'process',
        event: 'unhandled_rejection',
        message: reason instanceof Error ? reason.message : String(reason),
        data: {
            stack: reason instanceof Error ? reason.stack : undefined,
        },
    });
    Sentry.captureException(reason);
});

process.on('uncaughtException', (err: Error) => {
    logSystemEvent({
        level: 'error',
        scope: 'process',
        event: 'uncaught_exception',
        message: err.message,
        data: {
            stack: err.stack,
        },
    });
    Sentry.captureException(err);
    // Give Sentry 2 s to flush, then hard-exit so process manager restarts
    setTimeout(() => process.exit(1), 2000);
});

import tiktokShopAuthRoutes from './routes/tiktok-shop-auth.routes.js';
import tiktokShopDataRoutes from './routes/tiktok-shop-data.routes.js';
import tiktokShopFinanceRoutes from './routes/tiktok-shop-finance.routes.js';
import adminRoutes from './routes/admin.routes.js';
import teamRoutes from './routes/team.routes.js';
import brandingRoutes from './routes/branding.routes.js';
import reportsRoutes from './routes/reports.routes.js';
import billingRoutes from './routes/billing.routes.js';
import tiktokAdsRoutes from './routes/tiktok-ads.routes.js';
import tiktokDebugRoutes from './routes/tiktok-debug.routes.js';
import tiktokWebhookRoutes from './routes/tiktok-webhook.routes.js';
import observabilityRoutes from './routes/observability.routes.js';
import supportRoutes from './routes/support.routes.js';
import messagingRoutes from './routes/messaging.routes.js';
import tasksRoutes from './routes/tasks.routes.js';
import { pollAllAdvertisers } from './services/ads-polling.service.js';
import { requestIdMiddleware } from './middleware/request-id.middleware.js';
import { globalLimiter, authLimiter, adminLimiter, syncTriggerLimiter, supportLimiter } from './middleware/rate-limit.middleware.js';
import { logSystemEvent } from './services/system-logger.js';

const app = express();
/** Vercel / other reverse proxies set X-Forwarded-For; required for accurate req.ip and express-rate-limit. */
if (process.env.VERCEL === '1' || process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true') {
    app.set('trust proxy', 1);
}
const PORT = process.env.PORT || 3001;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const FRONTEND_URLS = (process.env.FRONTEND_URLS || '')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);

// ── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = [
    'http://localhost:5173',
    'https://mamba.app',
    'https://www.mamba.app',
    FRONTEND_URL,
    ...FRONTEND_URLS,
];

const allowOriginPatterns: RegExp[] = [];

app.use(cors({
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        const isExplicitlyAllowed = allowedOrigins.includes(origin);
        const isPatternAllowed = allowOriginPatterns.some((pattern) => pattern.test(origin));
        if (isExplicitlyAllowed || isPatternAllowed) {
            callback(null, true);
        } else {
            console.warn(JSON.stringify({ level: 'WARN', ts: new Date().toISOString(), event: 'cors_blocked', origin }));
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Request-Id'],
    exposedHeaders: ['Content-Range', 'X-Content-Range', 'X-Request-Id'],
    maxAge: 600,
}));

// ── Security headers (helmet) ─────────────────────────────────────────────────
// contentSecurityPolicy disabled: this is an API-only server, not serving HTML
app.use(
    helmet({
        contentSecurityPolicy: false,
        crossOriginEmbedderPolicy: false,
        crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
);

// ── HTTP response compression ─────────────────────────────────────────────────
// Skips compression for SSE (text/event-stream) — those streams must flush
// immediately; gzip buffering prevents real-time delivery.
app.use(compression({
    filter: (req, res) => {
        const ct = res.getHeader('Content-Type');
        if (typeof ct === 'string' && ct.includes('text/event-stream')) return false;
        return compression.filter(req, res);
    },
}));

// ── Request ID + structured logging ──────────────────────────────────────────
// Generates / forwards X-Request-Id; replaces plain console.log per-request log
app.use(requestIdMiddleware);

// ── Global rate limiter ───────────────────────────────────────────────────────
app.use(globalLimiter);

// ── Health check (excluded from rate limiting above) ─────────────────────────
app.get('/health', (_req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        service: 'Mamba - TikTok Shop Dashboard Backend',
    });
});

// ── Body parsers ──────────────────────────────────────────────────────────────
// Raw body FIRST for webhook HMAC validation; larger JSON only for bug reports (image base64)
app.use('/api/tiktok-shop/webhook', express.raw({ type: 'application/json' }), tiktokWebhookRoutes);

const supportApiRouter = express.Router();
supportApiRouter.use(express.json({ limit: '4.5mb' }));
supportApiRouter.use(supportLimiter);
supportApiRouter.use(supportRoutes);
app.use('/api/support', supportApiRouter);

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// ── Routes with per-category rate limiters ───────────────────────────────────
// Auth / connect endpoints — stricter limit
app.use('/api/tiktok-shop/auth', authLimiter, tiktokShopAuthRoutes);

// Sync trigger — stricter limit to prevent sync abuse
// The SSE log-stream endpoint is a long-lived connection (not a trigger)
// — bypass the per-call limit and let the admin limiter handle it instead.
app.use('/api/tiktok-shop/sync', (req, res, next) => {
    if (req.path.startsWith('/monitoring/log-stream')) return next();
    if (req.path.startsWith('/job/')) return next(); // job-status polling must not be throttled as a trigger
    if (req.path.startsWith('/monitoring/status')) return next(); // dashboard polling endpoint
    return syncTriggerLimiter(req, res, next);
});
app.use('/api/tiktok-ads/sync', (req, res, next) => {
    if (req.path.startsWith('/job/')) return next(); // ads job-status polling endpoint
    return syncTriggerLimiter(req, res, next);
});

// Main shop data + ads
app.use('/api/tiktok-shop', tiktokShopDataRoutes);
app.use('/api/tiktok-shop/finance', tiktokShopFinanceRoutes);
app.use('/api/tiktok-ads', tiktokAdsRoutes);

// Admin / platform — separate limit
app.use('/api/admin', adminLimiter, adminRoutes);
app.use('/api/team', adminLimiter, teamRoutes);
app.use('/api/branding', adminLimiter, brandingRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/observability', observabilityRoutes);
app.use('/api/messaging', adminLimiter, messagingRoutes);
app.use('/api/tasks', adminLimiter, tasksRoutes);

// Debug (audit data view) — admin-limited
app.use('/api/tiktok-shop/debug', adminLimiter, tiktokDebugRoutes);

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found',
        details: {
            method: req.method,
            path: req.originalUrl || req.path,
            message: 'The requested API route does not exist for this HTTP method.',
        },
        hints: [
            'Check path prefix: most routes start with /api/... ',
            'Check method (GET/POST/PATCH/DELETE) matches the route definition.',
            'Use GET /health to verify backend availability.',
        ],
        knownRoots: [
            '/health',
            '/api/tiktok-shop',
            '/api/tiktok-shop/finance',
            '/api/tiktok-ads',
            '/api/admin',
            '/api/team',
            '/api/branding',
            '/api/reports',
            '/api/billing',
            '/api/observability',
            '/api/support',
            '/api/messaging',
        ],
    });
});

// ── Sentry error handler (must be LAST, before custom error handler) ──────────
if (process.env.SENTRY_DSN) {
    // Double-cast resolves Sentry's internal ExpressResponse vs express's Response mismatch
    app.use(Sentry.expressErrorHandler() as unknown as express.ErrorRequestHandler);
}

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const statusCode = typeof err.status === 'number' ? err.status : 500;
    logSystemEvent({
        level: statusCode >= 500 ? 'error' : 'warn',
        scope: 'http',
        event: 'unhandled_route_error',
        message: err.message || 'Unhandled route error',
        data: {
            status: statusCode,
            stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
        },
    });
    res.status(statusCode).json({
        success: false,
        error: err.message || 'Internal server error',
    });
});

// ── Dev-only local server + polling timer ─────────────────────────────────────
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
╚════════════════════════════════════════════════════════════╝
      `);

        const runPoll = async (range: 'today' | '7d' = 'today') => {
            try {
                await pollAllAdvertisers(range);
            } catch (e: any) {
                console.error('[Dev Cron] Poll error:', e.message);
            }
        };

        setTimeout(() => runPoll('today'), 10_000);
        setInterval(() => runPoll('today'), 5 * 60 * 1000);
        setInterval(() => runPoll('7d'), 60 * 60 * 1000);
    });
}

export default app;
