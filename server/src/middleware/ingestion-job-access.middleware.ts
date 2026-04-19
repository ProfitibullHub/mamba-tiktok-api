import type { NextFunction, Request, Response } from 'express';
import { authorize } from '../services/authorization.service.js';
import { getIngestionJob } from '../services/ingestion-queue.service.js';
import { ACTION_TIKTOK_AUTH, FEATURE_TIKTOK_ADS, FEATURE_TIKTOK_SHOP } from '../constants/tiktok-entitlements.js';

function featureKeyForIngestionStream(stream: string): string | null {
    if (stream === 'shop') return FEATURE_TIKTOK_SHOP;
    if (stream === 'ads') return FEATURE_TIKTOK_ADS;
    return null;
}

/**
 * Ensures the caller may read the given ingestion job (account + TikTok feature entitlement).
 */
export function requireIngestionJobReadAccess() {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            const job = await getIngestionJob(req.params.jobId);
            if (!job) {
                res.status(404).json({ success: false, error: 'Job not found' });
                return;
            }
            const featureKey = featureKeyForIngestionStream(job.stream);
            if (!featureKey) {
                res.status(400).json({ success: false, error: 'Unsupported job stream' });
                return;
            }
            const result = await authorize(req, {
                action: ACTION_TIKTOK_AUTH,
                featureKey,
                accountId: job.account_id,
            });
            if (!result.allowed) {
                res.status(result.status).json({ success: false, error: result.reason });
                return;
            }
            (req as Request & { ingestionJob?: typeof job }).ingestionJob = job;
            next();
        } catch (e) {
            next(e);
        }
    };
}
