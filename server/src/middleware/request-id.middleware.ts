/**
 * request-id.middleware.ts
 *
 * Generates a unique X-Request-Id for every incoming request.
 * - If the client provides one in the request header, it is forwarded as-is.
 * - Otherwise, a new UUID is generated.
 *
 * The ID is:
 *   - Set on res.locals.requestId for use in route handlers / loggers
 *   - Echoed back in the X-Request-Id response header for correlation in logs
 *
 * Also replaces the basic console.log request logger with a structured log
 * that includes method, path, status, and response time.
 */

import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { logSystemEvent } from '../services/system-logger.js';

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
    const existing = req.headers['x-request-id'];
    const requestId =
        typeof existing === 'string' && existing.length > 0
            ? existing
            : randomUUID();

    // Make available to routes and loggers
    res.locals.requestId = requestId;
    req.headers['x-request-id'] = requestId;

    // Echo back in response
    res.setHeader('X-Request-Id', requestId);

    // Track start time for response-time logging
    const startedAt = Date.now();

    // Log after response is finished so we capture the status code
    res.on('finish', () => {
        const durationMs = Date.now() - startedAt;
        const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
        const ip =
            (typeof req.headers['x-forwarded-for'] === 'string'
                ? req.headers['x-forwarded-for']
                : req.socket?.remoteAddress) ?? null;

        // Suppress high-frequency success noise; keep actionable warnings/errors.
        const fullPath = `${req.baseUrl || ''}${req.path || ''}`;
        const noisySuccessPaths = [
            '/sync/monitoring/status',
            '/stats',
        ];
        const isNoisySuccessPath = noisySuccessPaths.some((p) => fullPath.includes(p));

        // 304s are typically cache/poll chatter; skip unless it's an error class.
        if (res.statusCode === 304) {
            return;
        }

        if (isNoisySuccessPath && res.statusCode < 400) {
            return;
        }

        logSystemEvent({
            level,
            scope: 'http',
            event: 'request.completed',
            message: `${req.method} ${req.path} -> ${res.statusCode}`,
            data: {
                requestId,
                method: req.method,
                path: req.path,
                status: res.statusCode,
                durationMs,
                ip,
                ua: req.headers['user-agent'] ?? null,
            },
        });
    });

    next();
}
