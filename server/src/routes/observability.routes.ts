import { Router } from 'express';
import { resolveRequestUserId } from '../middleware/account-access.middleware.js';
import { logSystemEvent } from '../services/system-logger.js';

const router = Router();

/**
 * POST /api/observability/client-error
 * Capture frontend/runtime errors so they appear in system monitoring.
 */
router.post('/client-error', async (req, res) => {
    try {
        const userId = await resolveRequestUserId(req);
        if (!userId) {
            return res.status(401).json({ success: false, error: 'Authorization required' });
        }

        const body = (req.body || {}) as Record<string, unknown>;
        const message = typeof body.message === 'string' ? body.message : 'Client-side error';
        const event = typeof body.event === 'string' ? body.event : 'client.error';
        const accountId = typeof body.accountId === 'string' ? body.accountId : null;

        logSystemEvent({
            level: 'error',
            scope: 'frontend',
            event,
            message,
            accountId,
            data: {
                userId,
                route: typeof body.route === 'string' ? body.route : null,
                source: typeof body.source === 'string' ? body.source : null,
                stack: typeof body.stack === 'string' ? body.stack : null,
                metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
            },
        });

        return res.json({ success: true });
    } catch (e: any) {
        return res.status(500).json({ success: false, error: e?.message || 'Failed to capture client error' });
    }
});

export default router;
