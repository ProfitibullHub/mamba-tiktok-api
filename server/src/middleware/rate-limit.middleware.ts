/**
 * rate-limit.middleware.ts
 *
 * Tiered rate limiters using express-rate-limit.
 * Each limiter uses an in-memory store (default) — suitable for single-process
 * Vercel serverless functions (each function instance has its own state).
 *
 * For multi-instance horizontal scale, swap the store for
 * `rate-limit-redis` or `@vercel/kv`.
 *
 * Tiers:
 *   globalLimiter          — 300 requests / 15 min, all routes
 *   authLimiter            — 20 requests / 15 min, auth / connect endpoints
 *   syncTriggerLimiter     — 15 requests / 60 sec, manual sync enqueue
 *   adminLimiter           — 60 requests / 15 min, admin/platform routes
 */

import rateLimit from 'express-rate-limit';
import { logSystemEvent } from '../services/system-logger.js';

/** Standard "too many requests" response body */
function rateLimitHandler(req: any, res: any) {
    const path = `${req.baseUrl || ''}${req.path || ''}`;
    logSystemEvent({
        level: 'warn',
        scope: 'http',
        event: 'request.rate_limited',
        message: `${req.method} ${path} -> 429`,
        data: {
            method: req.method,
            path,
            ip:
                (typeof req.headers?.['x-forwarded-for'] === 'string'
                    ? req.headers['x-forwarded-for']
                    : req.socket?.remoteAddress) ?? null,
            retryAfter: res.getHeader('Retry-After') ?? null,
        },
    });
    res.status(429).json({
        success: false,
        error: 'Too many requests. Please slow down and try again.',
        retryAfter: res.getHeader('Retry-After'),
    });
}

/** 300 req / 15 min — applied globally */
export const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: rateLimitHandler,
    skip: (req) => {
        // Never rate-limit Vercel Cron (they arrive with a matching secret)
        const auth = req.headers.authorization;
        const secret = process.env.CRON_SECRET;
        return !!secret && auth === `Bearer ${secret}`;
    },
});

/** 20 req / 15 min — auth and shop connect endpoints */
export const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: rateLimitHandler,
});

/** 15 req / 60 sec — POST /sync/:accountId (manual sync trigger) */
export const syncTriggerLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 15,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: rateLimitHandler,
    skip: (req) => {
        const auth = req.headers.authorization;
        const secret = process.env.CRON_SECRET;
        return !!secret && auth === `Bearer ${secret}`;
    },
});

/** 60 req / 15 min — admin and monitoring routes */
export const adminLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: rateLimitHandler,
});
